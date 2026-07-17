import * as cheerio from 'cheerio';
import { SOURCE_DEFINITIONS } from './config.js';
import { absoluteUrl, cleanText, fetchText, postJson } from './http.js';
import { htmlToText, resolveEligibility } from './eligibility.js';
import { inferFee, inferType } from './normalize.js';

const CREATIVE_WEST_QUERY = `
query GetSearchOpportunities($input: SearchOpportunitiesInput!) {
  searchOpportunities(input: $input) {
    total
    items {
      id
      name
      source
      sourceUrl
      applyUrl
      type
      status
      applicationDeadline
      originalTimezone
      rollingDeadline
      city
      state
      description
      shortDescription
      eligibilityRegion
      eligibilityLocation
      eligibilityDescription
      entryFee { cost }
      fees { name value type currency }
    }
  }
}`;

const NORTH_AMERICAN_TIMEZONES = {
    AST: 'America/Puerto_Rico', ADT: 'America/Halifax',
    EST: 'America/New_York', EDT: 'America/New_York',
    CST: 'America/Chicago', CDT: 'America/Chicago',
    MST: 'America/Denver', MDT: 'America/Denver',
    PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
    AKST: 'America/Anchorage', AKDT: 'America/Anchorage',
    HST: 'Pacific/Honolulu', NST: 'America/St_Johns', NDT: 'America/St_Johns'
};

function source(id) {
    return SOURCE_DEFINITIONS.find((item) => item.id === id);
}

function dateFromText(text) {
    return text.match(/(?:Deadline\s*:\s*)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2})/i)?.[1] ||
        (/(rolling|ongoing|no deadline)/i.test(text) ? 'Rolling' : '');
}

function locationFromText(text) {
    const match = text.match(/Location\s*:\s*([^\n|]{2,100})/i);
    return match ? cleanText(match[1]) : '';
}

export function parseArtworkArchive(html, definition = source('artwork_archive')) {
    const $ = cheerio.load(html);
    const rows = [];
    $('article').each((_, element) => {
        const card = $(element);
        const anchor = card.find('a[href*="/call-for-entry/"]').first();
        const name = cleanText(card.find('h3').first().text());
        const detail = (key) => cleanText(card.attr(`data-nova-${key}`));
        const field = (label) => cleanText(card.find('dt').filter((__, term) => cleanText($(term).text()) === label).first().next('dd').text());
        const deadline = detail('deadline') || field('Deadline:');
        const listingUrl = absoluteUrl(anchor.attr('href'), definition.url);
        const canonicalUrl = absoluteUrl(card.attr('data-nova-link') || listingUrl, definition.url);
        if (!name || !listingUrl || !canonicalUrl || !deadline) return;
        const fee = detail('fee-details') || field('Entry Fee:');
        const eligibility = detail('eligibility') || field('Eligibility:');
        rows.push({
            name,
            deadline,
            link: canonicalUrl,
            sourceListingUrl: absoluteUrl(card.attr('data-nova-source-link') || listingUrl, definition.url),
            type: detail('type') || field('Type:'),
            fees: inferFee(`Entry Fee: ${fee}`),
            country: /international/i.test(eligibility) ? 'International' : '',
            hostLocation: detail('location') || field('Location:'),
            feeDetails: fee,
            description: detail('description') || cleanText(card.find('p').first().text()),
            source: definition.name,
            sourceUrl: absoluteUrl(card.attr('data-nova-source-link') || definition.url, definition.url),
            confidence: 0.68
        });
    });
    return uniqueByLinkAndName(rows);
}

export function parseCreativeCapital(html, definition = source('creative_capital'), typeOverride = '') {
    const $ = cheerio.load(html);
    const rows = [];
    $('a.item').each((_, element) => {
        const anchor = $(element);
        const name = cleanText(anchor.find('h3').text());
        const description = cleanText(anchor.find('.item-desc').text());
        const label = cleanText(anchor.find('.item-info').text());
        if (!name) return;
        rows.push({
            name,
            deadline: label.replace(/Deadline\s*:/gi, '').trim(),
            link: absoluteUrl(anchor.attr('href'), definition.url),
            type: typeOverride || inferType(name, description),
            fees: inferFee(description),
            country: /international|worldwide|artists anywhere/i.test(description) ? 'International' : '',
            hostLocation: locationFromText(description),
            feeDetails: description.match(/(?:application|entry|submission) fee[^.]{0,70}/i)?.[0] || '',
            description,
            source: definition.name,
            sourceUrl: definition.url,
            confidence: 0.62
        });
    });
    return uniqueByLinkAndName(rows);
}

export function creativeWestDeadline(item) {
    if (item.rollingDeadline) return { deadline: 'Rolling', issue: '' };
    const raw = String(item.applicationDeadline || '');
    if (!raw) return { deadline: '', issue: '' };
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { deadline: raw, issue: '' };
    const timezone = String(item.originalTimezone || '').toUpperCase();
    const zone = NORTH_AMERICAN_TIMEZONES[timezone];
    if (!zone) return { deadline: '', issue: `unknown deadline timezone: ${timezone || 'missing'}` };
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return { deadline: '', issue: 'invalid application deadline' };
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return { deadline: `${value.year}-${value.month}-${value.day}`, issue: '' };
}

function relevantCreativeWestFees(item) {
    const all = [
        ...(Array.isArray(item.fees) ? item.fees : []),
        ...(Array.isArray(item.entryFee) ? item.entryFee : item.entryFee ? [item.entryFee] : [])
    ];
    return all.filter((fee) => {
        const text = `${fee.type || ''} ${fee.name || ''}`;
        if (/participation|media|booth|jury|tuition|travel|exhibition/i.test(text)) return false;
        return /application|entry|submission/i.test(text) || Object.hasOwn(fee, 'cost');
    });
}

export function creativeWestFeeSummary(item) {
    const fees = relevantCreativeWestFees(item);
    if (!fees.length) return { fees: '', feeDetails: '' };
    const values = fees.map((fee) => Number(fee.value ?? fee.cost));
    const details = fees.map((fee) => {
        const value = fee.value ?? fee.cost ?? '';
        return [fee.name || fee.type || 'Application fee', value, fee.currency].filter(Boolean).join(' ');
    }).filter(Boolean).join('; ');
    if (values.some((value) => Number.isFinite(value) && value > 0)) return { fees: 'y', feeDetails: details };
    if (values.length && values.every((value) => Number.isFinite(value) && value === 0)) return { fees: 'n', feeDetails: details };
    return { fees: '', feeDetails: details };
}

export function mapCreativeWestItem(item, definition = source('creative_west')) {
    const deadline = creativeWestDeadline(item);
    const eligibilityText = htmlToText(item.eligibilityDescription);
    const eligibility = resolveEligibility({
        sourceId: definition.id,
        eligibilityRegion: item.eligibilityRegion,
        eligibilityLocation: item.eligibilityLocation,
        details: eligibilityText.text
    });
    const fee = creativeWestFeeSummary(item);
    const fallback = `${definition.url.replace(/\/$/, '')}/opportunity/${item.id}/${item.source}`;
    const link = item.sourceUrl || fallback || item.applyUrl || '';
    const issue = [deadline.issue, eligibility.issue, eligibilityText.truncated ? 'eligibility details truncated at 10000 characters' : ''].filter(Boolean).join('; ');
    return {
        name: item.name,
        deadline: deadline.deadline,
        link,
        type: mapCreativeWestType(item.type, item.name),
        fees: fee.fees,
        country: eligibility.country,
        hostLocation: [item.city, item.state].filter(Boolean).join(', '),
        feeDetails: fee.feeDetails,
        eligibilityDetails: eligibilityText.text,
        description: htmlToText(item.shortDescription || item.description).text,
        source: definition.name,
        sourceUrl: link,
        confidence: 0.76,
        issue
    };
}

export function parseHyperallergicArticle(html, definition = source('hyperallergic'), articleUrl = definition.url) {
    const $ = cheerio.load(html);
    const rows = [];
    $('p').filter((_, element) => /Deadline\s*:/i.test($(element).text())).each((_, paragraph) => {
        const fragment = cheerio.load(`<div>${$(paragraph).html() || ''}</div>`);
        const strongs = fragment('strong').filter((__, element) => !/^\s*$/.test(fragment(element).text()) && !/Deadline/i.test(fragment(element).text()));
        strongs.each((index, strong) => {
            const name = cleanText(fragment(strong).text());
            const startHtml = fragment.html(strong);
            const nextStrong = strongs.get(index + 1);
            const wholeHtml = fragment('div').html() || '';
            const start = wholeHtml.indexOf(startHtml);
            const end = nextStrong ? wholeHtml.indexOf(fragment.html(nextStrong), start + startHtml.length) : wholeHtml.length;
            const segment = cheerio.load(`<div>${wholeHtml.slice(start, end)}</div>`);
            const text = cleanText(segment.text());
            const deadline = text.match(/Deadline\s*:\s*([^|]{2,60})/i)?.[1]?.trim() || '';
            const links = segment('a').map((__, link) => absoluteUrl(segment(link).attr('href'), articleUrl)).get();
            const canonical = [...links].reverse().find((url) => url && !url.includes('hyperallergic.com')) || links.at(-1) || articleUrl;
            const description = cleanText(text.replace(name, '').replace(/Deadline\s*:.*/i, ''));
            rows.push({
                name,
                deadline,
                link: canonical,
                type: inferType(name, description),
                fees: inferFee(description),
                country: /international|worldwide|anywhere in the world/i.test(description) ? 'International' : '',
                hostLocation: '',
                feeDetails: description.match(/(?:application|entry|submission) fee[^.]{0,70}/i)?.[0] || '',
                description,
                source: definition.name,
                sourceUrl: articleUrl,
                confidence: 0.78
            });
        });
    });
    return uniqueByLinkAndName(rows).slice(0, definition.limit);
}

export function parseTransArtists(html, definition = source('transartists')) {
    const $ = cheerio.load(html);
    const rows = [];
    $('h2 a[href*="/en/news/"]').each((_, element) => {
        const anchor = $(element);
        const card = anchor.closest('article');
        const text = cleanText(card.text());
        const name = cleanText(anchor.text());
        rows.push({
            name,
            deadline: dateFromText(text),
            link: absoluteUrl(anchor.attr('href'), definition.url),
            type: 'Residency',
            fees: inferFee(text),
            country: /international|worldwide/i.test(text) ? 'International' : '',
            hostLocation: '',
            feeDetails: text.match(/(?:application|entry|submission) fee[^.]{0,70}/i)?.[0] || '',
            description: text.slice(0, 1500),
            source: definition.name,
            sourceUrl: definition.url,
            confidence: 0.6
        });
    });
    return uniqueByLinkAndName(rows).slice(0, definition.limit);
}

export async function discoverSource(definition) {
    if (definition.id === 'artwork_archive') return discoverArtworkArchive(definition);
    if (definition.id === 'creative_capital') return discoverCreativeCapital(definition);
    if (definition.id === 'creative_west') return discoverCreativeWest(definition);
    const { text } = await fetchText(definition.url, { delayMs: definition.delayMs || 0 });
    switch (definition.id) {
        case 'transartists': return parseTransArtists(text, definition);
        case 'hyperallergic': {
            const feed = cheerio.load(text, { xmlMode: true });
            const item = feed('item').filter((_, element) => /^Opportunities in /i.test(cleanText(feed(element).find('title').text()))).first();
            const articleUrl = cleanText(item.find('link').text());
            if (!articleUrl) return [];
            const article = await fetchText(articleUrl);
            return parseHyperallergicArticle(article.text, definition, article.finalUrl);
        }
        default: return [];
    }
}

export async function discoverCreativeWest(definition = source('creative_west'), { poster = postJson } = {}) {
    const pageSize = definition.pageSize || 100;
    const maxPages = definition.maxPages || 1;
    const page = async (number) => {
        const response = await poster(definition.apiUrl, {
            operationName: 'GetSearchOpportunities',
            query: CREATIVE_WEST_QUERY,
            variables: {
                input: {
                    type: ['GRANT', 'RESIDENCY', 'COMMISSION'],
                    status: 'OPEN',
                    sort: { field: 'APPLICATION_DEADLINE', direction: 'ASC' },
                    pagination: { page: number, limit: pageSize }
                }
            }
        }, { delayMs: definition.delayMs || 0 });
        if (response.errors?.length) throw new Error(`Creative West GraphQL errors: ${response.errors.map((error) => error.message).join('; ')}`);
        const result = response.data?.searchOpportunities;
        if (!result || !Array.isArray(result.items)) throw new Error('Creative West GraphQL response is missing searchOpportunities items.');
        return result;
    };

    const first = await page(1);
    const total = Number(first.total);
    if (!Number.isInteger(total) || total <= 0) throw new Error(`Creative West API returned invalid total: ${first.total}`);
    const pageCount = Math.ceil(total / pageSize);
    if (pageCount > maxPages) throw new Error(`Creative West API total ${total} exceeds configured page ceiling ${maxPages * pageSize}.`);
    const results = [first, ...await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => page(index + 2)))];
    const items = new Map();
    const allowedTypes = new Set(['GRANT', 'RESIDENCY', 'COMMISSION']);
    for (const result of results) {
        for (const item of result.items) {
            if (!item.id || !item.source) throw new Error('Creative West API returned an opportunity without source or id.');
            if (!allowedTypes.has(item.type)) throw new Error(`Creative West API returned unsupported opportunity type: ${item.type || 'missing'}.`);
            items.set(`${item.source}:${item.id}`, item);
        }
    }
    if (items.size !== total) throw new Error(`Creative West pagination incomplete: collected ${items.size} unique IDs but API reported ${total}.`);
    return [...items.values()].map((item) => mapCreativeWestItem(item, definition));
}

async function discoverCreativeCapital(definition) {
    const rows = await crawlCreativeCapitalListing(definition);
    const typeRows = [];
    for (const typeValue of definition.typeValues || []) {
        typeRows.push(...await crawlCreativeCapitalListing(definition, typeValue));
    }
    const merged = mergeCreativeCapitalTypes([...rows, ...typeRows]);
    if (definition.minExpectedResults && merged.length < definition.minExpectedResults) {
        throw new Error(`Creative Capital discovery returned ${merged.length} opportunities; expected at least ${definition.minExpectedResults}.`);
    }
    return merged;
}

async function crawlCreativeCapitalListing(definition, typeValue = '') {
    const rows = [];
    const seenLinks = new Set();
    let page = 1;
    let maxPage = 1;
    while (page <= maxPage) {
        const result = await fetchText(creativeCapitalPageUrl(definition.url, page, typeValue), {
            delayMs: definition.delayMs || 0
        });
        const pageRows = parseCreativeCapital(result.text, definition, typeValue && labelCreativeCapitalType(typeValue));
        if (!pageRows.length) break;
        if (page === 1) maxPage = creativeCapitalMaxPage(result.text);
        const newRows = pageRows.filter((row) => !seenLinks.has(row.link));
        if (page > 1 && !newRows.length) break;
        for (const row of newRows) seenLinks.add(row.link);
        rows.push(...newRows);
        page += 1;
    }
    return rows;
}

export function creativeCapitalPageUrl(baseUrl, page, typeValue = '') {
    const url = new URL(baseUrl);
    if (page > 1) url.pathname = `${url.pathname.replace(/\/+$/, '')}/page/${page}/`;
    if (typeValue) url.searchParams.set('opportunities_type', typeValue);
    return url.toString();
}

export function creativeCapitalMaxPage(html) {
    const $ = cheerio.load(html);
    const pages = $('[data-page]').map((_, element) => Number($(element).attr('data-page'))).get();
    return Math.max(1, ...pages.filter((page) => Number.isInteger(page) && page > 0));
}

function labelCreativeCapitalType(value) {
    if (value === 'prize') return 'Award';
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function mergeCreativeCapitalTypes(rows) {
    const byLink = new Map();
    for (const row of rows) {
        const existing = byLink.get(row.link);
        if (!existing) {
            byLink.set(row.link, row);
            continue;
        }
        const types = [...new Set([existing.type, row.type].filter(Boolean))];
        byLink.set(row.link, { ...existing, type: types.join(', ') });
    }
    return [...byLink.values()];
}

async function discoverArtworkArchive(definition) {
    const rows = [];
    const visited = new Set();
    let url = definition.url;
    while (url && !visited.has(url)) {
        visited.add(url);
        const result = await fetchText(url, { delayMs: visited.size === 1 ? 0 : definition.delayMs || 0 });
        rows.push(...parseArtworkArchive(result.text, definition));
        url = nextArtworkArchivePage(result.text, result.finalUrl || url);
    }
    return uniqueByLinkAndName(rows);
}

function nextArtworkArchivePage(html, currentUrl) {
    const $ = cheerio.load(html);
    const currentPage = Number(new URL(currentUrl).searchParams.get('page') || 1);
    const candidates = $('a[href*="page="]').map((_, element) => absoluteUrl($(element).attr('href'), currentUrl)).get();
    return candidates.find((candidate) => Number(new URL(candidate).searchParams.get('page')) === currentPage + 1) || '';
}

function mapCreativeWestType(type, name) {
    if (/commission/i.test(type)) return 'Commission';
    if (/residen/i.test(type)) return 'Residency';
    if (/fellow/i.test(type)) return 'Fellowship';
    if (/grant/i.test(type)) return 'Grant';
    if (/award|competition/i.test(type)) return inferType(name, type);
    if (/exhibition|fair|festival/i.test(type)) return 'Exhibition';
    return inferType(name, type);
}

function uniqueByLinkAndName(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        const key = `${row.link}|${row.name.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
