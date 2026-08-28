import { element, formatShortDate, loadFeatured } from './featured.js?v=495f6b3e';
import { initSharedPage } from './shared.js?v=31ca9b7b';

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

const SKY_CANDIDATES = 192;
const SKY_TIMELINE_SECONDS = 3600;

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

/* Matches the header mask in styles.css closely enough to score what the eye
   will actually read, rather than counting clouds hidden in its transparent
   margins. */
function skyMaskOpacity(position) {
    if (position < .52 || position > 1) return 0;
    if (position < .64) return (position - .52) / .12;
    if (position <= .90) return 1;
    return (1 - position) / .10;
}

function scoreSky(shift, clouds, width) {
    const visible = clouds.map(({ duration, delay }) => {
        const progress = positiveModulo(shift - delay, duration) / duration;
        const position = .44 + progress * .61;
        return { x: position * width, opacity: skyMaskOpacity(position) };
    }).filter(({ opacity }) => opacity > .15);

    /* Aim for a populated but airy opening frame. Pair penalties ignore height
       on purpose: two vertically separated clouds with the same x-coordinate
       still read as an accidental stack. */
    const readableCount = visible.filter(({ opacity }) => opacity > .45).length;
    const targetCount = Math.max(3, Math.round(clouds.length * .7));
    const preferredGap = Math.min(72, Math.max(34, width * .075));
    const hardGap = Math.min(48, Math.max(30, width * .06));
    let score = -Math.abs(readableCount - targetCount) * 18;

    for (const cloud of visible) score += cloud.opacity * 3;
    for (let left = 0; left < visible.length; left += 1) {
        for (let right = left + 1; right < visible.length; right += 1) {
            const distance = Math.abs(visible[left].x - visible[right].x);
            if (distance >= preferredGap) continue;
            const proximity = 1 - distance / preferredGap;
            const legibility = Math.min(visible[left].opacity, visible[right].opacity);
            score -= proximity * proximity * 90 * legibility;
            if (legibility > .35 && distance < hardGap) {
                score -= 500 * (1 - distance / hardGap);
            }
        }
    }
    return score;
}

/* Generate many shared timeline offsets, rank the resulting compositions, then
   choose randomly among the near-best. This keeps openings different without
   accepting obvious stacks. The one shared offset still preserves even spacing
   inside each depth band; later parallax is free to create natural crossings. */
function setupSky() {
    const sky = document.querySelector('.header-sky');
    if (!sky) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const clouds = [...sky.querySelectorAll('.cloud')].flatMap((cloud) => {
        const styles = getComputedStyle(cloud);
        if (styles.display === 'none') return [];
        return [{
            duration: parseFloat(styles.getPropertyValue('--dur')),
            delay: parseFloat(styles.getPropertyValue('--delay'))
        }];
    });
    const width = sky.clientWidth;
    if (!width || !clouds.length) return;

    const candidates = Array.from({ length: SKY_CANDIDATES }, () => {
        const shift = Math.random() * SKY_TIMELINE_SECONDS;
        return { shift, score: scoreSky(shift, clouds, width) };
    }).sort((left, right) => right.score - left.score);
    const bestScore = candidates[0].score;
    const finalists = candidates.filter(({ score }) => score >= bestScore - 1.5).slice(0, 12);
    const choice = finalists[Math.floor(Math.random() * finalists.length)];
    sky.style.setProperty('--shift', `${choice.shift.toFixed(3)}s`);
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

setupSky();
initSharedPage();
setupOptionDetails();
setupFeatured();
