import * as cheerio from 'cheerio';
import { SOURCE_DEFINITIONS } from './config.js';
import { absoluteUrl, cleanText, fetchText, postJson } from './http.js';
import { htmlToText, resolveEligibility, resolveProseEligibility } from './eligibility.js';
import { canonicalizeUrl, inferFee, inferFeeDetails, inferType } from './normalize.js';

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
    const month = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
    const date = `(?:${month}\\s+\\d{1,2}(?:st|nd|rd|th)?[,]?\\s+20\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${month}[,]?\\s+20\\d{2})`;
    return text.match(new RegExp(`(?:deadline|apply by|applications? close|runs? through|\\bby)[^.!?]{0,50}?(${date})`, 'i'))?.[1] ||
        (/\b(?:rolling deadline|applications? (?:are |is )?(?:accepted )?(?:on an )?ongoing basis|no deadline)\b/i.test(text) ? 'Rolling' : '');
}

function locationFromText(text) {
    const match = text.match(/Location\s*:\s*([^\n|]{2,100})/i);
    return match ? cleanText(match[1]) : '';
}

function labeledDescriptionField(description, label) {
    const labels = 'Organization|Eligibility details|Event dates|Award|Categories';
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return cleanText(String(description || '').match(
        new RegExp(`(?:^|\\s)${escaped}:\\s*(.*?)(?=\\s+(?:${labels}):|$)`, 'i')
    )?.[1]);
}

function artworkArchiveCountry(eligibility, eligibilityDetails) {
    if (/international/i.test(eligibility)) return 'International';
    const proseCountry = resolveProseEligibility(eligibilityDetails).country;
    if (proseCountry) return proseCountry;
    // Artwork Archive uses National as a platform eligibility tier for U.S.-wide
    // calls. Keep this source-specific so foreign uses of "national" stay intact.
    const foreignEvidence = /\b(?:Australia|Australian|Canada|Canadian|Mexico|Mexican|United Kingdom|UK|British|England|New Zealand)\b/i.test(eligibilityDetails);
    if (!foreignEvidence && (/^national$/i.test(eligibility.trim()) ||
        /\bopen (?:to )?(?:all )?(?:artists? )?nationally\b|\bopen to national artists?\b/i.test(eligibilityDetails))) {
        return 'United States';
    }
    return '';
}

function artworkArchiveFeeStatus(fee, description = '') {
    const direct = String(fee || '').trim();
    if (!direct) return inferFee(description);

    // `Entry Fee` is structured source metadata, so it outranks potentially
    // stale or contradictory prose. Artwork Archive sometimes supplies a bare
    // number such as "50" without a currency marker.
    const directStatus = inferFee(direct);
    if (directStatus) return directStatus;
    const amount = direct.match(/(?:USD|AUD|CAD|GBP|EUR)?\s*(?:[$€£]\s*)?(\d[\d,]*(?:\.\d+)?)/i)?.[1];
    if (amount) return Number(amount.replace(/,/g, '')) === 0 ? 'n' : 'y';
    return '';
}

export function parseArtworkArchive(html, definition = source('artwork_archive')) {
    const $ = cheerio.load(html);
    const rows = [];
    $('article').each((_, element) => {
        const card = $(element);
        const anchor = card.find('a[href*="/call-for-entry/"]').first();
        const name = cleanText(card.find('h3').first().text());
        const detail = (key) => String(card.attr(`data-nova-${key}`) || '').replace(/\r\n?/g, '\n').trim();
        const field = (label) => cleanText(card.find('dt').filter((__, term) => cleanText($(term).text()) === label).first().next('dd').text());
        const deadline = detail('deadline') || field('Deadline:');
        const listingUrl = absoluteUrl(anchor.attr('href'), definition.url);
        const canonicalUrl = absoluteUrl(card.attr('data-nova-link') || listingUrl, definition.url);
        if (!name || !listingUrl || !canonicalUrl || !deadline) return;
        const fee = detail('fee-details') || field('Entry Fee:');
        const description = detail('description') || htmlToText(card.find('p').first().html()).text;
        const eligibilityDetails = detail('eligibility-details') ||
            labeledDescriptionField(description, 'Eligibility details') ||
            cleanText(description.match(/(?:^|\s)Eligibility Info\s+(.+)$/i)?.[1]);
        const eligibilityTier = detail('eligibility') || field('Eligibility:');
        const eligibility = eligibilityTier || eligibilityDetails;
        rows.push({
            name,
            deadline,
            link: canonicalUrl,
            sourceListingUrl: absoluteUrl(card.attr('data-nova-source-link') || listingUrl, definition.url),
            type: detail('type') || field('Type:'),
            fees: artworkArchiveFeeStatus(fee, description),
            country: artworkArchiveCountry(eligibility, eligibilityDetails),
            hostLocation: detail('location') || field('Location:'),
            feeDetails: fee,
            awardInfo: detail('award-info') || labeledDescriptionField(description, 'Award'),
            eligibilityDetails,
            eligibilityTier,
            description,
            source: definition.name,
            sourceUrl: absoluteUrl(card.attr('data-nova-source-link') || definition.url, definition.url),
            confidence: 0.68
        });
    });
    return uniqueByLinkAndName(rows);
}

export function discoverArtworkArchiveExport(payload, definition = source('artwork_archive')) {
    if (payload?.source !== 'artwork_archive' || !Array.isArray(payload.pages)) {
        throw new Error('Not a Nova Artwork Archive export');
    }
    return uniqueByLinkAndName(payload.pages.flatMap((page) => {
        if (typeof page?.html !== 'string') throw new Error('Artwork Archive export page is missing HTML');
        return parseArtworkArchive(page.html, definition);
    }));
}

export function parseCreativeCapital(html, definition = source('creative_capital'), typeOverride = '') {
    const $ = cheerio.load(html);
    const rows = [];
    $('a.item').each((_, element) => {
        const anchor = $(element);
        const name = cleanText(anchor.find('h3').text());
        const description = htmlToText(anchor.find('.item-desc').html()).text;
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
    const shortDescription = htmlToText(item.shortDescription).text;
    const fullDescription = htmlToText(item.description).text;
    const description = fullDescription.length > shortDescription.length ? fullDescription : shortDescription;
    const eligibility = resolveEligibility({
        sourceId: definition.id,
        eligibilityRegion: item.eligibilityRegion,
        eligibilityLocation: item.eligibilityLocation,
        details: eligibilityText.text
    });
    const fee = creativeWestFeeSummary(item);
    const fallback = `${definition.url.replace(/\/$/, '')}/opportunity/${item.id}/${item.source}`;
    const listingUrl = item.sourceUrl || fallback;
    const independentLink = item.independentUrl ||
        (isIndependentOpportunityUrl(item.sourceUrl) ? item.sourceUrl : '') ||
        (isIndependentOpportunityUrl(item.applyUrl) ? item.applyUrl : '');
    const link = independentLink || listingUrl || item.applyUrl || '';
    const issue = [
        deadline.issue,
        eligibility.issue,
        eligibilityText.truncated ? 'eligibility details truncated at 10000 characters' : '',
        !independentLink && /^CAFE$/i.test(item.source) ? 'application platform: CaFÉ' : ''
    ].filter(Boolean).join('; ');
    return {
        name: item.name,
        deadline: deadline.deadline,
        link,
        type: mapCreativeWestType(item.type, item.name, description),
        fees: fee.fees,
        country: eligibility.country,
        hostLocation: [item.city, item.state].filter(Boolean).join(', '),
        feeDetails: fee.feeDetails,
        eligibilityDetails: eligibilityText.text,
        description,
        source: definition.name,
        sourceUrl: listingUrl,
        confidence: 0.76,
        issue
    };
}

function hyperallergicType(section, name, description) {
    if (/residenc|fellowship|workshop/i.test(section)) {
        if (/fellowship/i.test(name)) return 'Fellowship';
        if (/workshop/i.test(name)) return 'Workshop';
        return 'Residency';
    }
    if (/grants?\s*&\s*awards?/i.test(section)) {
        if (/award|prize|competition/i.test(name)) return 'Award';
        if (/grant|fund/i.test(name)) return 'Grant';
        if (/grant|funding|microgrant/i.test(description)) return 'Grant';
        if (/award|prize|competition/i.test(description)) return 'Award';
        return '';
    }
    return inferType(name, description);
}

// The opportunity link must be an absolute HTTP(S) URL on an independent host.
// Hyperallergic's own domain (and its subdomains) is never a valid destination, and
// we never fall back to the roundup URL. A URL that merely mentions "hyperallergic.com"
// in a query string (e.g. a ref parameter) is still valid because we test the hostname.
function hyperallergicOpportunityLink(hrefs, base) {
    const urls = hrefs.map((href) => absoluteUrl(href, base)).filter(Boolean);
    for (const url of [...urls].reverse()) {
        let parsed;
        try { parsed = new URL(url); } catch { continue; }
        if (!/^https?:$/.test(parsed.protocol)) continue;
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'hyperallergic.com' || host.endsWith('.hyperallergic.com')) continue;
        return url;
    }
    return '';
}

// Award value as a display string. Scans sentence by sentence and returns the first
// that pairs a currency amount with award-oriented language (or an "Up to $…"
// construction). Application costs and amounts tied to tuition, residency costs,
// reimbursements, or sales are excluded. Boilerplate is trimmed.
function hyperallergicAwardInfo(lines) {
    const sentences = lines.flatMap((line) => line.split(/(?<=[.!?])\s+/));
    for (const raw of sentences) {
        const sentence = cleanText(raw).replace(/\s*Read more on Hyperallergic\.?$/i, '');
        if (/\bfee\b/i.test(sentence) || !/(?:\$|€|£)\s?\d/.test(sentence)) continue;
        const amountIsCost = /\b(?:tuition|residency costs?|sales? (?:price|value)|reimburse\w*)\b[^.!?]{0,25}(?:\$|€|£)\s?\d|(?:\$|€|£)\s?\d[^.!?]{0,25}\b(?:tuition|residency costs?|sales? (?:price|value)|reimburse\w*)\b/i.test(sentence);
        if (amountIsCost) continue;
        if (/\b(?:award|prize|stipend|grant|honorarium|funding|receiv)/i.test(sentence) || /up to\s*(?:\$|€|£)/i.test(sentence)) {
            return { awardInfo: sentence, issue: '' };
        }
    }
    return { awardInfo: '', issue: '' };
}

export function parseHyperallergicArticle(html, definition = source('hyperallergic'), articleUrl = definition.url) {
    const $ = cheerio.load(html);
    const rows = [];
    const isEntryParagraph = (element) => /Deadline\s*:/i.test($(element).text()) || /\b(?:rolling|ongoing|no deadline)\b/i.test($(element).text());
    $('p').filter((_, element) => isEntryParagraph(element)).each((_, paragraph) => {
        const section = cleanText($(paragraph).prevAll('h2, h3').first().text());
        const fragment = cheerio.load(`<div>${$(paragraph).html() || ''}</div>`);
        const strongs = fragment('strong')
            .filter((__, element) => !/^\s*$/.test(fragment(element).text()) && !/Deadline/i.test(fragment(element).text()))
            .get();
        const wholeHtml = fragment('div').html() || '';
        const entries = [];
        let strongIndex = 0;
        let searchFrom = 0;
        while (strongIndex < strongs.length) {
            const firstHtml = fragment.html(strongs[strongIndex]);
            const start = wholeHtml.indexOf(firstHtml, searchFrom);
            if (start === -1) break;
            let titleEnd = start + firstHtml.length;
            let nextIndex = strongIndex + 1;
            while (nextIndex < strongs.length) {
                const nextHtml = fragment.html(strongs[nextIndex]);
                const nextStart = wholeHtml.indexOf(nextHtml, titleEnd);
                if (nextStart === -1) break;
                const between = wholeHtml.slice(titleEnd, nextStart);
                const separator = cleanText(cheerio.load(`<div>${between}</div>`).text());
                if (/<br\b/i.test(between) || !/^[\s\-–—:|/&+]*$/.test(separator)) break;
                titleEnd = nextStart + nextHtml.length;
                nextIndex += 1;
            }
            const following = nextIndex < strongs.length ? fragment.html(strongs[nextIndex]) : '';
            const end = following ? wholeHtml.indexOf(following, titleEnd) : wholeHtml.length;
            const name = cleanText(cheerio.load(`<div>${wholeHtml.slice(start, titleEnd)}</div>`).text());
            entries.push({ name, html: wholeHtml.slice(start, end) });
            searchFrom = end;
            strongIndex = nextIndex;
        }

        for (const entry of entries) {
            const { name } = entry;
            if (!name) continue;
            const segmentHtml = entry.html;
            const segment = cheerio.load(`<div>${segmentHtml}</div>`);
            const text = cleanText(segment.text());
            const lines = htmlToText(segmentHtml).text.split('\n').map((line) => line.trim()).filter(Boolean);

            const link = hyperallergicOpportunityLink(segment('a').map((__, anchor) => segment(anchor).attr('href')).get(), articleUrl);
            if (!link) continue;

            const deadline = text.match(/Deadline\s*:\s*([^|]{2,60})/i)?.[1]?.trim() ||
                (/\b(?:rolling|ongoing|no deadline)\b/i.test(text) ? 'Rolling' : '');
            const richText = htmlToText(segmentHtml).text;
            const firstBreak = richText.indexOf('\n\n');
            const firstBlock = firstBreak === -1 ? richText : richText.slice(0, firstBreak);
            const withoutTitle = cleanText(firstBlock.replace(/\*+/g, '')) === name
                ? richText.slice(firstBreak === -1 ? richText.length : firstBreak + 2)
                : richText.replace(name, '');
            const description = withoutTitle
                .replace(/Deadline\s*:.*/i, '')
                .replace(/\s*Read more on Hyperallergic(?:\s*\.\s*[A-Z]?\d+)?\.?/gi, ' ')
                .trim();
            const eligibility = resolveProseEligibility(text);
            const award = hyperallergicAwardInfo(lines);
            rows.push({
                name,
                deadline,
                link,
                type: hyperallergicType(section, name, description),
                fees: inferFee(text),
                country: eligibility.country,
                hostLocation: '',
                feeDetails: inferFeeDetails(text),
                awardInfo: award.awardInfo,
                description,
                source: definition.name,
                sourceUrl: articleUrl,
                confidence: 0.78,
                issue: [eligibility.issue, award.issue].filter(Boolean).join('; ')
            });
        }
    });
    return uniqueByNormalizedName(rows);
}

function isIndependentOpportunityUrl(value = '') {
    try {
        const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
        return ![
            'opportunities.wearecreativewest.org',
            'artist.callforentry.org',
            'callforentry.org',
            'zapplication.org',
            'sales.zapplication.org',
            'gosmart.org',
            'publicartarchive.org'
        ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
    } catch {
        return false;
    }
}

export function creativeWestIndependentLink(html, pageUrl) {
    const $ = cheerio.load(html);
    const elements = $('h1,h2,h3,h4,a[href]').get();
    const headingIndex = elements.findIndex((element) =>
        /^contact information$/i.test(cleanText($(element).text()))
    );
    if (headingIndex === -1) return '';

    for (const element of elements.slice(headingIndex + 1)) {
        if (/^h[1-4]$/i.test(element.name)) break;
        if (element.name !== 'a') continue;
        const url = absoluteUrl($(element).attr('href'), pageUrl);
        if (isIndependentOpportunityUrl(url)) return url;
    }
    return '';
}

export async function discoverHyperallergic(definition = source('hyperallergic'), { fetcher = fetchText } = {}) {
    const { text } = await fetcher(definition.url, { delayMs: definition.delayMs || 0 });
    const feed = cheerio.load(text, { xmlMode: true });
    const roundups = feed('item')
        .filter((_, element) => /^Opportunities in /i.test(cleanText(feed(element).find('title').text())))
        .map((index, element) => {
            const time = Date.parse(cleanText(feed(element).find('pubDate').text()));
            return { link: cleanText(feed(element).find('link').text()), index, time: Number.isNaN(time) ? null : time };
        })
        .get()
        .filter((item) => item.link)
        .sort((a, b) => {
            if (a.time === null && b.time === null) return a.index - b.index;
            if (a.time === null) return 1;
            if (b.time === null) return -1;
            return b.time - a.time || a.index - b.index;
        })
        .slice(0, definition.roundupMonths || 3);

    const rows = [];
    for (const item of roundups) {
        const article = await fetcher(item.link, { delayMs: definition.delayMs || 0 });
        rows.push(...parseHyperallergicArticle(article.text, definition, article.finalUrl || item.link));
    }
    return uniqueByNormalizedName(rows);
}

export function parseTransArtists(html, definition = source('transartists')) {
    const $ = cheerio.load(html);
    const rows = [];
    $('h2 a[href*="/en/news/"]').each((_, element) => {
        const anchor = $(element);
        const card = anchor.closest('article');
        const text = htmlToText(card.html()).text;
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

function transArtistsExternalLink($, container, pageUrl) {
    const links = container.find('a[href]').map((_, element) => ({
        url: absoluteUrl($(element).attr('href'), pageUrl),
        label: cleanText($(element).text())
    })).get().filter(({ url }) => {
        try {
            return !/(^|\.)transartists\.org$/i.test(new URL(url).hostname);
        } catch {
            return false;
        }
    });
    return links.find(({ label }) => /apply|application|online|open call|more information/i.test(label))?.url ||
        links.at(-1)?.url || pageUrl;
}

function transArtistsAwardInfo(text) {
    return String(text || '').split(/\r?\n/).flatMap((line) => line.split(/(?<=[.!?])\s+/)).find((sentence) =>
        /(?:\$|€|£|USD|EUR|GBP)\s?\d/i.test(sentence) &&
        /award|prize|stipend|grant|honorarium|production budget|receive/i.test(sentence) &&
        !/application|entry|submission fee/i.test(sentence)
    ) || '';
}

export function parseTransArtistsDetail(html, pageUrl, definition = source('transartists')) {
    const $ = cheerio.load(html);
    const heading = $('main h2').first();
    const container = heading.closest('article').length ? heading.closest('article') : $('main');
    const name = cleanText(heading.text());
    const contentHtml = container.find('p,ul,ol').filter((_, element) =>
        !$(element).parents('ul,ol').length
    ).map((_, element) => $.html(element)).get().join('');
    const description = htmlToText(contentHtml || container.html()).text;
    const eligibility = resolveProseEligibility(description);
    return {
        name,
        deadline: dateFromText(description),
        link: transArtistsExternalLink($, container, pageUrl),
        // TransArtists is a residency-specific feed; title phrases such as
        // "open call" describe the application, not a different opportunity type.
        type: 'Residency',
        fees: inferFee(description),
        country: eligibility.country,
        hostLocation: locationFromText(description),
        feeDetails: description.match(/(?:application|entry|submission) fee[^.]{0,70}/i)?.[0] || '',
        awardInfo: transArtistsAwardInfo(description),
        eligibilityDetails: description.match(/(?:open to|eligible)[^.!?]{0,500}[.!?]/i)?.[0] || '',
        description,
        source: definition.name,
        sourceUrl: pageUrl,
        confidence: 0.68,
        issue: eligibility.issue
    };
}

async function discoverTransArtists(definition, { fetcher = fetchText } = {}) {
    const listing = await fetcher(definition.url, { delayMs: definition.delayMs || 0 });
    const stubs = parseTransArtists(listing.text, definition);
    const rows = [];
    for (const stub of stubs) {
        try {
            const detail = await fetcher(stub.link, { delayMs: definition.delayMs || 0 });
            rows.push(parseTransArtistsDetail(detail.text, detail.finalUrl || stub.link, definition));
        } catch {
            rows.push(stub);
        }
    }
    return rows.filter((row) => row.name && row.link);
}

export async function discoverSource(definition) {
    if (definition.id === 'artwork_archive') return discoverArtworkArchive(definition);
    if (definition.id === 'creative_capital') return discoverCreativeCapital(definition);
    if (definition.id === 'creative_west') return discoverCreativeWest(definition);
    if (definition.id === 'hyperallergic') return discoverHyperallergic(definition);
    if (definition.id === 'transartists') return discoverTransArtists(definition);
    throw new Error(`Unsupported opportunity source: ${definition.id}`);
}

export async function discoverCreativeWest(definition = source('creative_west'), { poster = postJson, fetcher = fetchText } = {}) {
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
    const collected = [...items.values()];
    let cursor = 0;
    const enriched = new Array(collected.length);
    const workers = Array.from({ length: Math.min(6, collected.length) }, async () => {
        while (cursor < collected.length) {
            const index = cursor++;
            const item = collected[index];
            if (!/^CAFE$/i.test(item.source) || !item.sourceUrl) {
                enriched[index] = item;
                continue;
            }
            try {
                const page = await fetcher(item.sourceUrl, { delayMs: definition.delayMs || 0 });
                enriched[index] = {
                    ...item,
                    independentUrl: creativeWestIndependentLink(page.text, page.finalUrl || item.sourceUrl)
                };
            } catch {
                enriched[index] = item;
            }
        }
    });
    await Promise.all(workers);
    return enriched.map((item) => mapCreativeWestItem(item, definition));
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

function mapCreativeWestType(type, name, description = '') {
    // Creative West's API type is authoritative when present. Title and prose
    // inference are only a fallback for missing or unsupported API values.
    if (/commission/i.test(type)) return 'Commission';
    if (/residen/i.test(type)) return 'Residency';
    if (/fellow/i.test(type)) return 'Fellowship';
    if (/grant/i.test(type)) return 'Grant';
    if (/award|competition/i.test(type)) return 'Award';
    if (/exhibition|fair|festival/i.test(type)) return 'Exhibition';
    return inferType(name, description);
}

function uniqueByLinkAndName(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        const name = String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const key = `${canonicalizeUrl(row.link) || row.link}|${name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueByNormalizedName(rows) {
    const seen = new Set();
    return rows.filter((row) => {
        const name = String(row.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
    });
}
