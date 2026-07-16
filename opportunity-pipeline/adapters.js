import * as cheerio from 'cheerio';
import { SOURCE_DEFINITIONS } from './config.js';
import { absoluteUrl, cleanText, fetchText } from './http.js';
import { inferFee, inferType } from './normalize.js';

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
    $('a.group.mt-4.block[href*="/call-for-entry/"]').each((_, element) => {
        const anchor = $(element);
        const name = cleanText(anchor.find('h3').text() || anchor.text());
        let container = anchor.parent();
        for (let level = 0; level < 4 && !/Deadline\s*:/i.test(container.text()); level += 1) {
            container = container.parent();
        }
        const text = cleanText(container.text());
        const fee = text.match(/Entry Fee\s*:\s*([^|]{1,50})/i)?.[1] || '';
        const eligibility = text.match(/Eligibility\s*:\s*([^|]{1,80})/i)?.[1] || '';
        rows.push({
            name,
            deadline: dateFromText(text),
            link: absoluteUrl(anchor.attr('href'), definition.url),
            type: text.match(/Type\s*:\s*(.*?)(?=Eligibility\s*:|Location\s*:|Entry Fee\s*:|$)/i)?.[1]?.trim() || '',
            fees: inferFee(`Entry Fee: ${fee}`),
            country: /international/i.test(eligibility) ? 'International' : '',
            hostLocation: locationFromText(text),
            feeDetails: fee,
            description: cleanText(container.find('p').first().text()),
            source: definition.name,
            sourceUrl: definition.url,
            confidence: 0.68
        });
    });
    return uniqueByLinkAndName(rows).slice(0, definition.limit);
}

export function parseCreativeCapital(html, definition = source('creative_capital')) {
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
            type: inferType(name, description),
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
    return uniqueByLinkAndName(rows).slice(0, definition.limit);
}

export function parseCreativeWest(html, definition = source('creative_west')) {
    const $ = cheerio.load(html);
    const rows = [];
    $('a[href^="/opportunity/"]').each((_, element) => {
        const anchor = $(element);
        const text = cleanText(anchor.text());
        const typeLabel = text.match(/^(Grants|Competitions|Commissions|Exhibitions|Fairs\/Festivals|Residencies|Fellowships|Awards)/i)?.[1] || '';
        const fee = text.match(/Application fee\s*:\s*([^|]{1,40})/i)?.[1] || '';
        const body = text.replace(new RegExp(`^${typeLabel}`, 'i'), '').replace(/Application fee\s*:.*/i, '');
        const name = cleanText(anchor.find('h2,h3,h4').first().text()) || cleanText(body);
        if (!name || /See all/i.test(name)) return;
        rows.push({
            name,
            deadline: dateFromText(text),
            link: absoluteUrl(anchor.attr('href'), definition.url),
            type: mapCreativeWestType(typeLabel, name),
            fees: fee ? (/^\$?0(?:\D|$)/.test(fee) ? 'n' : 'y') : '',
            country: /international/i.test(text) ? 'International' : '',
            hostLocation: '',
            feeDetails: fee,
            description: text,
            source: definition.name,
            sourceUrl: definition.url,
            confidence: 0.6
        });
    });
    return uniqueByLinkAndName(rows).slice(0, definition.limit);
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
    const { text } = await fetchText(definition.url, { delayMs: definition.delayMs || 0 });
    switch (definition.id) {
        case 'artwork_archive': return parseArtworkArchive(text, definition);
        case 'creative_capital': return parseCreativeCapital(text, definition);
        case 'creative_west': return parseCreativeWest(text, definition);
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

function mapCreativeWestType(type, name) {
    if (/commission/i.test(type)) return 'Public Art';
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
