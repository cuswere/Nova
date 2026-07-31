import * as cheerio from 'cheerio';
import { cleanText } from '../opportunity-pipeline/http.js';

export const FEED_URL = 'https://blog.praxiscenterforaesthetics.com/feed/';
export const FEATURED_TAG = 'praxisnova';
// How many opportunities the home-page preview lists out of one article.
const MAX_OPPORTUNITIES = 3;

/* WordPress emits the post body as a small, stable set of tags. Anything outside
   this map degrades to a paragraph rather than vanishing, so a future heading or
   pull quote still reaches the page even before this list learns about it. */
const BLOCK_TYPES = new Map([
    ['p', 'p'],
    ['h1', 'h2'], ['h2', 'h2'], ['h3', 'h3'], ['h4', 'h3'], ['h5', 'h3'], ['h6', 'h3'],
    ['blockquote', 'blockquote']
]);
const LIST_TYPES = new Map([['ul', 'ul'], ['ol', 'ol']]);

// The feed is a third party; a link out of it may not become a page navigation
// unless it is plain web traffic. Checked again at render time in scripts/article.js.
export function safeHref(value, base) {
    if (!value) return '';
    try {
        const url = new URL(value, base);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
    } catch {
        return '';
    }
}

function collapse(value) {
    return String(value).replace(/ /g, ' ').replace(/\s+/g, ' ');
}

/* Walks the inline tree carrying formatting down, so nesting like a bold word
   inside a link arrives as one span wearing both marks. Adjacent spans that
   ended up identical are merged, which keeps the JSON — and the DOM built from
   it — close to the number of runs a reader can actually see. */
function collectSpans($, node, inherited = {}) {
    const spans = [];

    const push = (text, marks) => {
        if (!text) return;
        const previous = spans[spans.length - 1];
        if (previous && previous.bold === marks.bold && previous.italic === marks.italic && previous.href === marks.href) {
            previous.text += text;
            return;
        }
        spans.push({ ...marks, text });
    };

    for (const child of $(node).contents().toArray()) {
        if (child.type === 'text') {
            push(collapse(child.data), inherited);
            continue;
        }
        if (child.type !== 'tag') continue;

        const name = child.name.toLowerCase();
        // No block in this feed uses <br> for meaning; a space keeps the sentence
        // reading correctly without teaching the renderer about line breaks.
        if (name === 'br') {
            push(' ', inherited);
            continue;
        }

        const marks = { ...inherited };
        if (name === 'strong' || name === 'b') marks.bold = true;
        if (name === 'em' || name === 'i') marks.italic = true;
        if (name === 'a') {
            const href = safeHref($(child).attr('href'), FEED_URL);
            if (href) marks.href = href;
        }

        for (const span of collectSpans($, child, marks)) push(span.text, span);
    }

    return spans;
}

function trimSpans(spans) {
    const trimmed = spans.map((span) => ({ ...span }));
    if (trimmed.length) {
        trimmed[0].text = trimmed[0].text.replace(/^\s+/, '');
        trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/\s+$/, '');
    }
    return trimmed.filter((span) => span.text);
}

export function parseArticleBody(html) {
    const $ = cheerio.load(`<div id="body">${html || ''}</div>`);
    const blocks = [];

    $('#body').children().each((_, element) => {
        const name = element.name.toLowerCase();

        if (LIST_TYPES.has(name)) {
            // Plain array mapping, not cheerio's: its .map flattens an array the
            // callback returns, which would spill every item's spans into one list.
            const items = $(element).children('li').toArray()
                .map((item) => trimSpans(collectSpans($, item)))
                .filter((spans) => spans.length);
            if (items.length) blocks.push({ type: LIST_TYPES.get(name), items });
            return;
        }

        if (name === 'hr') {
            blocks.push({ type: 'hr' });
            return;
        }

        // Images arrive either bare or wrapped in a <figure>; both are worth
        // keeping, and the CDN serves them cross-origin without complaint. A
        // caption follows as its own paragraph rather than being dropped with it.
        const image = name === 'img' ? $(element) : $(element).find('img').first();
        if (image.length) {
            const src = safeHref(image.attr('src'), FEED_URL);
            if (src) blocks.push({ type: 'img', src, alt: cleanText(image.attr('alt') || '') });
            image.remove();
        }

        const spans = trimSpans(collectSpans($, element));
        if (spans.length && !isPhotoCredit(spans)) blocks.push({ type: BLOCK_TYPES.get(name) || 'p', spans });
    });

    // Flagged here rather than at render time so the article page and the
    // home-page roster are reading the same decision, not two copies of the rule.
    for (const block of blocks) if (readListing(block)) block.listing = true;

    return blocks;
}

/* The posts sign off with a credit for a photo that lives in the WordPress
   featured-image slot, never in the body — so it arrives here crediting a picture
   this page was never going to show. */
function isPhotoCredit(spans) {
    return /^(photo|image)\s+credit\b/i.test(spans.map((span) => span.text).join('').trim());
}

function slugFromLink(link) {
    try {
        const segments = new URL(link).pathname.split('/').filter(Boolean);
        return segments[segments.length - 1] || '';
    } catch {
        return '';
    }
}

/* These posts follow one shape: a paragraph per opportunity, opening with a link
   carrying the name and closing with the deadline in bold. A paragraph missing
   either of those is the article's own prose, not a listing — which is what keeps
   the closing Praxis Center paragraph out of the roster.

   The one definition of "this paragraph is a listing": the home-page roster and
   the article page's outlining both read it, so the two can't drift apart. */
export function readListing(block) {
    if (block.type !== 'p') return null;
    const named = block.spans.find((span) => span.href);
    const dated = block.spans.find((span) => span.bold);
    if (!named || !dated) return null;

    const title = named.text.trim();
    // The bold run is the date alone, but the sentence around it sometimes
    // pulls its punctuation inside.
    const deadline = dated.text.trim().replace(/^[.,;:]+|[.,;:]+$/g, '').trim();
    return title && deadline ? { title, deadline } : null;
}

export function extractOpportunities(blocks, { limit = MAX_OPPORTUNITIES } = {}) {
    const found = [];

    for (const block of blocks) {
        const listing = readListing(block);
        if (!listing) continue;
        found.push(listing);
        if (found.length >= limit) break;
    }

    return found;
}

export function parseFeaturedFeed(xml, { tag = FEATURED_TAG } = {}) {
    const feed = cheerio.load(xml, { xmlMode: true });
    const wanted = tag.trim().toLowerCase();

    return feed('item')
        .map((index, element) => {
            const item = feed(element);
            const tags = item.find('category').map((__, node) => cleanText(feed(node).text()).toLowerCase()).get();
            if (!tags.includes(wanted)) return null;

            const link = safeHref(cleanText(item.find('link').first().text()));
            const title = cleanText(item.find('title').first().text());
            const slug = slugFromLink(link);
            if (!link || !title || !slug) return null;

            const published = Date.parse(cleanText(item.find('pubDate').first().text()));
            const blocks = parseArticleBody(item.find('content\\:encoded').first().text());
            if (!blocks.length) return null;

            return {
                slug,
                title,
                link,
                date: Number.isNaN(published) ? '' : new Date(published).toISOString(),
                author: cleanText(item.find('dc\\:creator').first().text()),
                opportunities: extractOpportunities(blocks),
                blocks,
                // Feed order is the tiebreaker whenever two posts share a timestamp
                // or one is missing a parseable date; it is already newest-first.
                index
            };
        })
        .get()
        .filter(Boolean)
        .sort(compareByRecency)
        .map(({ index, ...article }) => article);
}

export function compareByRecency(left, right) {
    const leftTime = Date.parse(left.date);
    const rightTime = Date.parse(right.date);
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return (left.index ?? 0) - (right.index ?? 0);
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime || (left.index ?? 0) - (right.index ?? 0);
}
