import { element, formatShortDate, loadFeatured } from './featured.js';
import { initSharedPage } from './shared.js';

// How many of the archived articles the home page shows; the rest stay in the
// JSON so their article pages keep resolving.
const FEATURED_ON_HOME = 2;

function setupOptionDetails() {
    document.querySelectorAll('.option-btn .info').forEach((toggle) => {
        const details = document.getElementById(toggle.getAttribute('aria-controls'));
        if (!details) return;

        toggle.addEventListener('click', () => {
            const open = details.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.textContent = open ? '−' : '+';
        });
    });
}

/* One random offset, shared by every cloud in the header, so no two visits open
   on the same sky. It's a single time offset rather than a fresh random phase
   per cloud because the spacing in styles.css was solved across an hour of
   drift: sliding the whole set along that hour lands on an arrangement that was
   already checked, where independent rolls would sooner or later pile them up or
   empty the bar. An hour is also long enough that the repeat is unreachable. */
function setupSky() {
    const sky = document.querySelector('.header-sky');
    if (!sky) return;
    sky.style.setProperty('--shift', `${(Math.random() * 3600).toFixed(1)}s`);
}

/* The whole card is the link, not just the title, so the opportunities listed
   under it are part of the target rather than dead text beside it. */
function preview(article) {
    const item = element('a', 'featured-item');
    // The slug rides in the fragment, not a query: `npx serve` redirects
    // /article.html to /article and drops a query string on the way, which would
    // break the link on the LAN preview. A fragment survives any redirect.
    item.href = `article.html#${encodeURIComponent(article.slug)}`;

    const date = formatShortDate(article.date);
    // Without this the link announces its whole contents, deadlines included.
    item.setAttribute('aria-label', date ? `${article.title} - ${date}` : article.title);

    const heading = element('p', 'featured-line');
    heading.append(element('span', 'featured-title', article.title));
    if (date) heading.append(element('span', 'featured-date', ` - ${date}`));
    item.append(heading);

    if (article.opportunities?.length) {
        const list = element('ul', 'featured-opportunities');
        for (const opportunity of article.opportunities) {
            const row = element('li');
            row.append(element('span', 'featured-opportunity-name', opportunity.title));
            // Its own element rather than a pseudo-element: the leader has to be a
            // flex item to take up the slack between the two, and a ::after inside
            // the name would only ever stretch within the name.
            const leader = element('span', 'featured-opportunity-leader');
            leader.setAttribute('aria-hidden', 'true');
            row.append(leader);
            row.append(element('span', 'featured-opportunity-deadline', opportunity.deadline));
            list.append(row);
        }
        item.append(list);
    }

    return item;
}

/* The rest of the page must not wait on this or break with it: the feed is a
   third party, and the two buttons beside it are the reason people are here. */
async function setupFeatured() {
    const list = document.querySelector('[data-featured-list]');
    if (!list) return;

    try {
        const articles = await loadFeatured();
        if (!articles.length) {
            list.replaceChildren(element('p', 'featured-status', 'Nothing featured just yet.'));
            return;
        }
        list.replaceChildren(...articles.slice(0, FEATURED_ON_HOME).map(preview));
    } catch (error) {
        console.error('Error loading featured articles:', error);
        list.replaceChildren(element('p', 'featured-status', "Couldn't load featured grants."));
    }
}

initSharedPage();
setupSky();
setupOptionDetails();
setupFeatured();
