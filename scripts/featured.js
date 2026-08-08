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

function spanNodes(spans, listing = false) {
    const nodes = [];
    // Copied because gluing punctuation onto one span consumes it from the next.
    const queue = (spans || []).map((span) => ({ ...span }));

    for (let index = 0; index < queue.length; index += 1) {
        const span = queue[index];
        if (!span.text) continue;

        const node = spanNode(span);
        const next = queue[index + 1];
        // Only a listing's links are inline-blocks; in prose they are inline
        // again and end their last line wherever the words do, so the stop after
        // one needs no help staying with them.
        const isLink = listing && node.tagName === 'A';
        /* A bolded deadline and a listing's links render as an inline-block, and
           an inline-block is sized to the width available rather than to its own
           longest line — so a line may break between it and whatever follows,
           stranding the sentence's full stop by itself on the next line. Taking
           the punctuation out of the following text removes the opportunity. */
        const glue = (span.bold || isLink) && next && next.text && !next.href
            ? (next.text.match(TRAILING_PUNCTUATION) || [''])[0]
            : '';

        if (!glue) {
            nodes.push(node);
            continue;
        }

        /* A link's box spans the whole column, so no outer wrapper can hold the
           stop beside it — the only line with room left is the link's own last
           one, which means inside the anchor. .link-tail is what keeps it from
           reading, or behaving, as part of the link. A deadline is short enough
           to sit next to its stop, so that one stays a plain nowrap pair. */
        if (isLink) {
            node.append(element('span', 'link-tail', glue));
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
        const node = wrapAll(tag, spanNodes(block.spans, Boolean(block.listing)));
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
