/* Shared by the home-page preview and the article page. The JSON it reads is
   written by sync-featured.js from the Praxis blog feed; see docs/featured.md. */

const FEATURED_DATA = 'data/featured.json';

export async function loadFeatured() {
    const response = await fetch(FEATURED_DATA);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const articles = await response.json();
    return Array.isArray(articles) ? articles : [];
}

/* Both formats read the date in UTC so it always shows as the one the blog
   published under, rather than sliding a day for readers west of it. */
export function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

// dd/mm/yy for the home-page card, where the line has to stay short.
export function formatShortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return [pad(date.getUTCDate()), pad(date.getUTCMonth() + 1), pad(date.getUTCFullYear() % 100)].join('/');
}

// The build step already refuses anything else, but this is the boundary that
// actually turns a string into a navigable link, so it checks again.
function isWebUrl(value) {
    try {
        const { protocol } = new URL(value, window.location.href);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

export function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/* Built from text nodes and createElement rather than markup, so nothing the
   feed carries can arrive as anything but words. */
function spanNode(span) {
    let node = document.createTextNode(span.text || '');

    if (span.italic) node = wrap('em', node);
    if (span.bold) node = wrap('strong', node);
    if (span.href && isWebUrl(span.href)) {
        const link = document.createElement('a');
        link.href = span.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        // Routes the hop off the site through the shared confirm dialog.
        link.dataset.confirmExit = '';
        link.append(node);
        node = link;
    }
    return node;
}

function wrap(tag, child) {
    const node = document.createElement(tag);
    node.append(child);
    return node;
}

// Sentence punctuation, which must not be left standing alone on a line.
const TRAILING_PUNCTUATION = /^[.,;:!?]+/;

// The anchor's final run of text, however deep: a link may carry its words inside
// an em or a strong, and the stop belongs beside whatever comes last.
function lastTextNode(node) {
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child.nodeType === Node.TEXT_NODE && child.textContent) return child;
        if (child.nodeType === Node.ELEMENT_NODE) {
            const found = lastTextNode(child);
            if (found) return found;
        }
    }
    return null;
}

/* Puts the stop beside the link's last word rather than merely at the end of the
   anchor. .link-tail is an inline-block, and a line may break immediately before an
   atomic inline the way it may before an image — so a link whose text fills its box
   to the edge leaves the stop to fall onto a line of its own inside the anchor,
   which is the same floating punctuation one level further in. Bound to the word
   ahead of it, the nearest break moves back to the space before that word and the
   two travel together. */
function appendTail(link, glue) {
    const tail = element('span', 'link-tail', glue);
    const text = lastTextNode(link);
    if (!text) {
        link.append(tail);
        return;
    }

    const pair = element('span', 'nowrap');
    const value = text.textContent;
    const cut = value.lastIndexOf(' ');
    // One unbroken run: all of it travels with the stop, there being no earlier
    // space to break at in any case.
    if (cut === -1) {
        pair.append(document.createTextNode(value), tail);
        text.replaceWith(pair);
        return;
    }

    text.textContent = value.slice(0, cut + 1);
    pair.append(document.createTextNode(value.slice(cut + 1)), tail);
    text.after(pair);
}

function spanNodes(spans) {
    const nodes = [];
    // Copied because gluing punctuation onto one span consumes it from the next.
    const queue = (spans || []).map((span) => ({ ...span }));

    for (let index = 0; index < queue.length; index += 1) {
        const span = queue[index];
        if (!span.text) continue;

        const node = spanNode(span);
        const next = queue[index + 1];
        const isLink = node.tagName === 'A';
        /* Two reasons, and every link needs one of them. A listing's links are
           inline-blocks, sized to the width available rather than to their own
           longest line, so a line may break between one and whatever follows and
           strand the sentence's full stop by itself. Prose links are inline and
           cannot do that — but their hover outline is drawn 2px outside the box,
           and the stop after a link starts at the box's very edge, so the outline
           lands on top of it. Punctuation held inside the anchor answers both: it
           cannot be left behind, and it sits inside the outline rather than under
           it. */
        const glue = (span.bold || isLink) && next && next.text && !next.href
            ? (next.text.match(TRAILING_PUNCTUATION) || [''])[0]
            : '';

        if (!glue) {
            nodes.push(node);
            continue;
        }

        /* Inside the anchor rather than beside it: a listing link's box spans the
           whole column, so the only line with room left is the link's own last one,
           and a prose link's outline is drawn outside a box the stop would then be
           sitting under. .link-tail is what keeps it from reading, or behaving, as
           part of the link. A deadline is short enough to sit next to its stop and
           carries no outline, so that one stays a plain nowrap pair. */
        if (isLink) {
            appendTail(node, glue);
            nodes.push(node);
        } else {
            const pair = element('span', 'nowrap');
            pair.append(node, document.createTextNode(glue));
            nodes.push(pair);
        }
        next.text = next.text.slice(glue.length);
    }

    return nodes;
}

export function renderBlocks(blocks) {
    const fragment = document.createDocumentFragment();

    for (const block of blocks || []) {
        if (block.type === 'hr') {
            fragment.append(document.createElement('hr'));
            continue;
        }
        if (block.type === 'img') {
            if (!isWebUrl(block.src)) continue;
            const image = element('img', 'article-image');
            image.src = block.src;
            image.alt = block.alt || '';
            image.loading = 'lazy';
            fragment.append(image);
            continue;
        }
        if (block.type === 'ul' || block.type === 'ol') {
            const list = element(block.type, 'article-list');
            for (const item of block.items || []) list.append(wrapAll('li', spanNodes(item)));
            fragment.append(list);
            continue;
        }

        const tag = ['h2', 'h3', 'blockquote'].includes(block.type) ? block.type : 'p';
        const node = wrapAll(tag, spanNodes(block.spans));
        // Set by the pipeline: a linked opportunity name plus a bolded deadline.
        if (block.listing) node.className = 'article-listing';
        fragment.append(node);
    }

    return fragment;
}

function wrapAll(tag, children) {
    const node = document.createElement(tag);
    node.append(...children);
    return node;
}
