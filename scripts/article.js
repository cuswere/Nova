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
}

initSharedPage();
renderArticle();
// Changing only the fragment never reloads the page, so the swap has to be made here.
window.addEventListener('hashchange', renderArticle);
