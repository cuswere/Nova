import { element, formatDate, loadFeatured, renderBlocks } from './featured.js';
import { initSharedPage } from './shared.js';

function notFound(message) {
    const fragment = document.createDocumentFragment();
    fragment.append(element('p', 'article-status', message));
    const home = element('a', 'article-return', 'Back to Praxis Nova');
    home.href = 'index.html';
    fragment.append(home);
    return fragment;
}

/* The foot of a long read is where someone is most likely to be done, and the
   only way back from here is the small Home button up in the title bar. */
function returnLink() {
    const footer = element('p', 'article-source');
    const link = element('a', '', 'Back to Home');
    link.href = 'index.html';
    footer.append(link);
    return footer;
}

// Line weight, how far past the fragment the elbow turns, and the smallest
// channel between two lines worth threading a connector through.
const BRIDGE_WEIGHT = 2;
const BRIDGE_REACH = 12;
const BRIDGE_MIN_CHANNEL = 1;
// Daylight kept between the turn and a listing paragraph's outline. Clearing it
// by the line's own weight is enough not to touch, but reads as a near miss.
const BRIDGE_CLEARANCE = 8;

function bridgeLeg(container, left, top, width, height) {
    // Which edge carries the dash: the long axis of the leg. A leg is only ever
    // drawn as a run or a drop, so the wider of the two dimensions decides.
    const leg = element('span', `link-bridge ${width >= height ? 'link-bridge-h' : 'link-bridge-v'}`);
    leg.setAttribute('aria-hidden', 'true');
    leg.style.left = `${left}px`;
    leg.style.top = `${top}px`;
    leg.style.width = `${width}px`;
    leg.style.height = `${height}px`;
    container.append(leg);
}

/* Ties the two halves of a wrapped link together: out from the right edge of the
   first, down into the channel between the lines, back across, and down onto the
   top-right corner of the second.

   Drawn from measured rects and positioned out of flow, never inserted into the
   text — a real character would change the width that decided where the line
   broke, and moving the break would move the mark that caused it. */
function drawLinkConnectors(container) {
    container.querySelectorAll('.link-bridge').forEach((leg) => leg.remove());
    // The stylesheet draws the dash; it reads its weight from here so changing
    // BRIDGE_WEIGHT alone keeps the line and its box the same thickness.
    container.style.setProperty('--bridge-weight', `${BRIDGE_WEIGHT}px`);
    /* The legs are positioned against the article's padding box, which is now its
       own scroll container — that origin scrolls away with the content while
       getClientRects stays in viewport coordinates. Adding back what is scrolled
       off keeps a redraw mid-article landing in the same place as one at the top. */
    const box = container.getBoundingClientRect();
    const originX = box.left - container.scrollLeft;
    const originY = box.top - container.scrollTop;
    const half = BRIDGE_WEIGHT / 2;

    for (const link of container.querySelectorAll('a')) {
        const rects = [...link.getClientRects()];

        /* How far right the turn may go. The article's own padding box is the outer
           stop, but a listing paragraph draws an outline in that padding — well
           inside the article edge — and the elbow would cut straight through it.
           Whichever boundary comes first wins. Paragraphs with no outline compute a
           width of 0 and keep the article edge. */
        const paragraph = link.closest('p');
        const paragraphStyle = paragraph && getComputedStyle(paragraph);
        let limit = container.clientWidth - BRIDGE_WEIGHT;
        if (paragraphStyle && parseFloat(paragraphStyle.outlineWidth) > 0) {
            const paragraphRight = paragraph.getBoundingClientRect().right - originX;
            limit = Math.min(limit, paragraphRight + parseFloat(paragraphStyle.outlineOffset) - BRIDGE_CLEARANCE);
        }

        for (let index = 0; index < rects.length - 1; index += 1) {
            const from = rects[index];
            const to = rects[index + 1];
            // A tight line-height leaves the two boxes overlapping; there is
            // nowhere to route, so nothing is drawn rather than something wrong.
            if (to.top - from.bottom < BRIDGE_MIN_CHANNEL) continue;

            const startX = from.right - originX;
            const startY = from.top + from.height / 2 - originY;
            const endX = to.right - originX;
            /* The return runs at the corner's own height, not down the middle of
               the channel. Halfway would leave it passing a few pixels clear of
               the corner and needing a stub to jog down onto it, which reads as
               the line overshooting and doubling back. */
            const cornerY = to.top - originY;
            /* The turn has to clear both ends, not just the one it starts from: a
               link wrapping across three lines has a middle fragment filling the
               whole column, whose right edge lies further out than the fragment
               above it. Turning short of it would give the return leg a negative
               width and it would not be drawn at all. Where the fragment already
               ends past the limit there is no room to turn at all, and the elbow
               collapses to a straight drop at the fragment's edge. */
            const reach = Math.max(startX, endX);
            const elbowX = Math.max(reach, Math.min(reach + BRIDGE_REACH, limit));

            bridgeLeg(container, startX, startY - half, elbowX - startX + BRIDGE_WEIGHT, BRIDGE_WEIGHT);
            bridgeLeg(container, elbowX, startY - half, BRIDGE_WEIGHT, cornerY - startY + BRIDGE_WEIGHT);
            bridgeLeg(container, endX, cornerY, elbowX - endX + BRIDGE_WEIGHT, BRIDGE_WEIGHT);
        }
    }
}

/* The fragment is what the home page links with, because it is the only part of
   a URL no server rewrite can take away; ?slug= is still honoured for anything
   linked that way. */
function requestedSlug() {
    const fragment = window.location.hash.replace(/^#/, '');
    if (fragment) return decodeURIComponent(fragment);
    return new URLSearchParams(window.location.search).get('slug') || '';
}

async function renderArticle() {
    const container = document.querySelector('[data-article]');
    if (!container) return;

    const slug = requestedSlug();
    if (!slug) {
        container.replaceChildren(notFound('No article was requested.'));
        return;
    }

    let articles;
    try {
        articles = await loadFeatured();
    } catch (error) {
        console.error('Error loading featured articles:', error);
        container.replaceChildren(notFound("Couldn't load this article."));
        return;
    }

    const article = articles.find((candidate) => candidate.slug === slug);
    if (!article) {
        container.replaceChildren(notFound('That article is no longer featured.'));
        return;
    }

    document.title = `${article.title} — Praxis Nova`;

    const fragment = document.createDocumentFragment();
    fragment.append(element('h1', 'article-title', article.title));

    const byline = formatDate(article.date);
    if (byline) fragment.append(element('p', 'article-byline', byline));

    fragment.append(renderBlocks(article.blocks));
    fragment.append(returnLink());
    container.replaceChildren(fragment);
    drawLinkConnectors(container);
}

/* Every break moves when the column resizes, so the elbows are redrawn from
   scratch. Deferred to an animation frame so a drag of the window edge redraws
   once a frame rather than once an event. */
function watchReflow() {
    const container = document.querySelector('[data-article]');
    if (!container) return;

    let pending = 0;
    const redraw = () => {
        pending = 0;
        drawLinkConnectors(container);
    };
    window.addEventListener('resize', () => {
        if (!pending) pending = window.requestAnimationFrame(redraw);
    });
    // Web fonts and text autosizing can settle after first paint and rewrap the
    // column under the elbows already drawn.
    document.fonts?.ready.then(() => drawLinkConnectors(container));
}

initSharedPage();
renderArticle();
watchReflow();
// Changing only the fragment never reloads the page, so the swap has to be made here.
window.addEventListener('hashchange', renderArticle);
