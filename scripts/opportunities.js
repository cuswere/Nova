import { initSharedPage } from './shared.js';

// Matches the mobile breakpoint the stylesheet switches on (max-width: 700px);
// a full 50-card page is a lot of scrolling once cards stack to one column.
const MOBILE_BREAKPOINT = '(max-width: 700px)';
const pageSize = () => (window.matchMedia(MOBILE_BREAKPOINT).matches ? 25 : 50);
const state = {
    opportunities: [],
    filters: { types: [], hideFees: false, onlyRolling: false },
    page: 1
};

const filterAnimations = new WeakMap();
let titleBackgroundFrame = null;
let titleBackgroundObserver = null;

function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function deadlineTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function isCurrent(opportunity) {
    return deadlineTime(opportunity.deadline) >= startOfToday().getTime();
}

function currentOpportunities() {
    return state.opportunities
        .filter(isCurrent)
        .filter((item) => !state.filters.types.length || state.filters.types.includes(String(item.type || '').toLowerCase()))
        .filter((item) => !state.filters.hideFees || String(item.fees || '').toLowerCase() !== 'y')
        .filter((item) => !state.filters.onlyRolling || /rolling/i.test(String(item.deadline || '')))
        .sort((left, right) => deadlineTime(left.deadline) - deadlineTime(right.deadline) || left.name.localeCompare(right.name));
}

function parseUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    state.filters.types = params.getAll('type')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    state.filters.hideFees = ['1', 'true'].includes(params.get('hideFees'));
    state.filters.onlyRolling = ['1', 'true'].includes(params.get('rolling'));
}

function statusMessage(text) {
    return element('div', 'repo-status-message', text);
}

async function loadOpportunities() {
    const container = document.querySelector('.repobox');
    container.replaceChildren(statusMessage('Loading…'));

    try {
        const response = await fetch('data/opportunities.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.opportunities = await response.json();
        renderCategoryMenu();
        renderFilters();
        renderOpportunities();
    } catch (error) {
        console.error('Error loading opportunities:', error);
        container.replaceChildren(statusMessage("Couldn't load opportunities."));
    }
}

function categoryOptions() {
    return [...new Set(state.opportunities.filter(isCurrent).map((item) => item.type).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}

function setCategoryMenuOpen(open) {
    const menu = document.querySelector('.custom-select');
    const button = menu.querySelector('.custom-selected');
    const list = menu.querySelector('.custom-options');
    menu.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    list.setAttribute('aria-hidden', String(!open));
    if (!open) list.querySelectorAll('[aria-selected="true"]').forEach((item) => item.setAttribute('aria-selected', 'false'));
}

function selectCategory(value) {
    if (value === '__clear__') {
        state.filters.types = [];
    } else if (!state.filters.types.includes(value)) {
        state.filters.types.push(value);
    }
    state.page = 1;
    setCategoryMenuOpen(false);
    renderCategoryMenu();
    renderFilters();
    renderOpportunities();
}

function renderCategoryMenu() {
    const list = document.querySelector('.custom-options');
    const options = categoryOptions()
        .filter((type) => !state.filters.types.includes(type.toLowerCase()))
        .map((type) => ({ value: type.toLowerCase(), label: type, clear: false }));
    if (state.filters.types.length) options.push({ value: '__clear__', label: 'Clear Categories', clear: true });

    const items = options.map(({ value, label, clear }) => {
        const item = element('li', clear ? 'clear-filter-option' : '');
        item.dataset.value = value;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.tabIndex = -1;
        item.appendChild(element('span', 'opt-label', label));
        return item;
    });
    list.replaceChildren(...items);
}

function focusCategory(items, index) {
    items.forEach((item, itemIndex) => {
        const active = itemIndex === index;
        item.tabIndex = active ? 0 : -1;
        item.setAttribute('aria-selected', String(active));
    });
    items[index]?.focus();
}

function setupCategoryMenu() {
    const menu = document.querySelector('.custom-select');
    const button = menu.querySelector('.custom-selected');
    const list = menu.querySelector('.custom-options');

    button.addEventListener('click', () => setCategoryMenuOpen(button.getAttribute('aria-expanded') !== 'true'));
    button.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        setCategoryMenuOpen(true);
        const items = [...list.querySelectorAll('li')];
        focusCategory(items, event.key === 'ArrowDown' ? 0 : items.length - 1);
    });
    list.addEventListener('click', (event) => {
        const item = event.target.closest('li[data-value]');
        if (item) selectCategory(item.dataset.value);
    });
    list.addEventListener('keydown', (event) => {
        const items = [...list.querySelectorAll('li')];
        const index = items.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0
                : event.key === 'End' ? items.length - 1
                    : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            focusCategory(items, next);
        } else if (['Enter', ' '].includes(event.key) && index >= 0) {
            event.preventDefault();
            selectCategory(items[index].dataset.value);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setCategoryMenuOpen(false);
            button.focus();
        }
    });
    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target)) setCategoryMenuOpen(false);
    });
}

function cancelFilterAnimation(container) {
    const animation = filterAnimations.get(container);
    if (!animation) return;
    window.clearTimeout(animation.delayTimer);
    window.clearTimeout(animation.fallbackTimer);
    if (animation.frame) window.cancelAnimationFrame(animation.frame);
    container.removeEventListener('transitionend', animation.onEnd);
    filterAnimations.delete(container);
}

function animateFilterArea(container, fromHeight, toHeight) {
    if (toHeight <= fromHeight + 0.5 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        container.style.cssText = '';
        return;
    }

    const animation = { delayTimer: null, fallbackTimer: null, frame: null, onEnd: null };
    const finish = () => {
        if (filterAnimations.get(container) !== animation) return;
        window.clearTimeout(animation.fallbackTimer);
        container.removeEventListener('transitionend', animation.onEnd);
        container.style.cssText = '';
        filterAnimations.delete(container);
    };
    animation.onEnd = (event) => {
        if (event.target === container && event.propertyName === 'height') finish();
    };

    container.style.height = `${fromHeight}px`;
    container.style.overflow = 'hidden';
    container.style.transition = 'none';
    filterAnimations.set(container, animation);
    animation.delayTimer = window.setTimeout(() => {
        container.addEventListener('transitionend', animation.onEnd);
        container.style.transition = 'height 200ms steps(4, end)';
        animation.frame = window.requestAnimationFrame(() => { container.style.height = `${toHeight}px`; });
        animation.fallbackTimer = window.setTimeout(finish, 250);
    }, 50);
}

function updateView({ categories = false } = {}) {
    state.page = 1;
    if (categories) renderCategoryMenu();
    renderFilters();
    renderOpportunities();
}

function filterChip(label, className, remove) {
    const chip = element('div', `filter-item active-filter ${className}`.trim());
    const button = element('button', 'remove-filter-btn');
    button.type = 'button';
    button.setAttribute('aria-label', `Remove ${label} filter`);
    button.addEventListener('click', remove);
    chip.append(element('span', '', label), button);
    return chip;
}

function renderFilters() {
    const container = document.querySelector('.applied-filters');
    const fromHeight = container.getBoundingClientRect().height;
    cancelFilterAnimation(container);
    container.style.height = `${fromHeight}px`;
    container.style.overflow = 'hidden';
    container.style.transition = 'none';

    const chips = state.filters.types.map((type) => filterChip(
        type.charAt(0).toUpperCase() + type.slice(1),
        '',
        () => {
            state.filters.types = state.filters.types.filter((candidate) => candidate !== type);
            updateView({ categories: true });
        }
    ));
    if (state.filters.hideFees) chips.push(filterChip('Fee', 'exclude-filter', () => {
        state.filters.hideFees = false;
        document.querySelector('#hide-fees-toggle').checked = false;
        updateView();
    }));
    if (state.filters.onlyRolling) chips.push(filterChip('Rolling Deadline', 'rolling-filter', () => {
        state.filters.onlyRolling = false;
        document.querySelector('#rolling-toggle').checked = false;
        updateView();
    }));

    container.replaceChildren(...(chips.length ? chips : [element('div', 'filter-item', 'none')]));
    container.style.height = 'auto';
    const toHeight = container.getBoundingClientRect().height;
    container.style.height = `${fromHeight}px`;
    animateFilterArea(container, fromHeight, toHeight);
}

function formatCurrencyAmounts(text) {
    return text
        .replace(/\bUSD\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\b/gi, '$$$1')
        .replace(/\$?(\d[\d,]*(?:\.\d+)?)\s*USD\b/gi, '$$$1');
}

function feeDetails(item) {
    const details = String(item.fee_details || '').trim();
    return /\d/.test(details) ? formatCurrencyAmounts(details) : '';
}

function awardDetails(item) {
    const details = String(item.award_info || '').trim();
    return details ? formatCurrencyAmounts(details) : '';
}

function eligibilityDetails(item) {
    const details = String(item.eligibility_details || '').trim();
    if (details) return { text: details, label: 'Eligibility details' };
    const tier = String(item.eligibility_tier || '').trim();
    return tier ? { text: tier, label: 'Eligibility tier' } : null;
}

function plainProse(text) {
    return normalizeDisplayProse(text)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1');
}

function normalizeDisplayProse(text) {
    return String(text || '')
        .replace(/(\*{4,})([^*\n]+)\1/g, '**$2**')
        .replace(/^[ \t]*\*+[ \t]*(?:\r?\n|$)/gm, '');
}

function appendInlineProse(parent, text) {
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        parent.append(text.slice(cursor, match.index));
        parent.appendChild(element(match[2] ? 'strong' : 'em', '', match[2] || match[3]));
        cursor = match.index + match[0].length;
    }
    parent.append(text.slice(cursor));
}

function proseContent(text) {
    const wrapper = element('span', 'details-popup-text');
    const paragraphs = normalizeDisplayProse(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((part) => part.trim());
    for (const paragraphText of paragraphs) {
        const paragraph = element('span', 'details-popup-paragraph');
        const lines = paragraphText.split('\n');
        lines.forEach((line, index) => {
            if (index) paragraph.appendChild(document.createElement('br'));
            appendInlineProse(paragraph, line);
        });
        wrapper.appendChild(paragraph);
    }
    return wrapper;
}

function detailToken(className, labelText, details, ariaPrefix) {
    const cell = element('div', `grid-cell field ${className} detail-token has-details`);
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-pressed', 'false');
    cell.setAttribute('aria-label', `${ariaPrefix}: ${plainProse(details)}`);

    const label = element('span', 'detail-token-label', labelText);
    const fold = element('span', 'detail-token-fold', '+');
    fold.setAttribute('aria-hidden', 'true');
    const popup = element('span', 'details-popup');
    popup.setAttribute('role', 'tooltip');
    const tail = element('span', 'details-popup-tail');
    tail.setAttribute('aria-hidden', 'true');
    const content = element('span', 'details-popup-content');
    content.appendChild(proseContent(details));
    popup.append(tail, content);
    cell.append(label, fold, popup);
    return cell;
}

function opportunityTitle(item) {
    const title = element('div', 'opportunity-title');
    const link = document.createElement('a');
    const rawLink = String(item.link || '');
    link.href = rawLink && !/^https?:/i.test(rawLink) ? `https://${rawLink}` : rawLink || '#';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const content = element('span', 'link-text');
    const words = String(item.name || 'Untitled opportunity').split(/\s+/);
    const lastWord = words.pop();
    if (words.length) content.append(`${words.join(' ')} `);
    const finalWord = element('span');
    finalWord.style.whiteSpace = 'nowrap';
    finalWord.append(lastWord, externalLinkIcon());
    content.appendChild(finalWord);

    const backgrounds = element('span', 'link-line-backgrounds');
    backgrounds.setAttribute('aria-hidden', 'true');
    link.append(content, backgrounds);
    title.appendChild(link);
    return title;
}

function externalLinkIcon() {
    const icon = element('span');
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="margin-left:4px;display:inline;vertical-align:middle"><path d="M14.5 2.5H17.5V5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 10L17.5 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 10.5V17.5H2.5V2.5H9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return icon;
}

function formatDeadline(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${date.getDate()}, '${String(date.getFullYear()).slice(-2)}`;
}

function opportunityCard(item) {
    const card = element('div', 'opportunity-card');
    const main = element('div', 'opportunity-main-column');
    main.appendChild(opportunityTitle(item));

    const deadline = element('div', 'field date-cell');
    deadline.append(element('strong', '', 'Deadline: '), formatDeadline(item.deadline));
    main.appendChild(deadline);

    const details = element('div', 'opportunity-details-column');
    const summaryGrid = element('div', 'top-right-grid');
    const summary = element('div', 'details-summary-row');
    summary.appendChild(element('div', 'grid-cell field type-cell', item.type || '-'));

    const feeFlag = String(item.fees || '').toLowerCase();
    if (feeFlag && feeFlag !== 'n') {
        const feeText = feeFlag === 'y' ? 'fee' : '-';
        const feeCell = feeDetails(item)
            ? detailToken('fee-cell', feeText, feeDetails(item), 'Fee details')
            : element('div', 'grid-cell field fee-cell', feeText);
        if (feeFlag === 'y') feeCell.classList.add('fee-charged');
        summary.appendChild(feeCell);
    }
    summaryGrid.appendChild(summary);
    details.appendChild(summaryGrid);

    const tokenRow = element('div', 'detail-token-row');
    const award = awardDetails(item);
    if (award) tokenRow.appendChild(detailToken('award-cell', 'Award Info', award, 'Award info'));
    const eligibility = eligibilityDetails(item);
    if (eligibility) tokenRow.appendChild(detailToken('eligibility-cell', 'Eligibility', eligibility.text, eligibility.label));
    if (tokenRow.childElementCount) details.appendChild(tokenRow);

    card.append(main, details);
    return card;
}

function renderOpportunities() {
    const container = document.querySelector('.repobox');
    const rows = currentOpportunities();
    if (!rows.length) {
        state.page = 1;
        updatePagination(1, 1);
        container.replaceChildren(statusMessage('Nothing matches these filters.'));
        return;
    }

    const size = pageSize();
    const pageCount = Math.ceil(rows.length / size);
    state.page = Math.max(1, Math.min(state.page, pageCount));
    const pageRows = rows.slice((state.page - 1) * size, state.page * size);
    container.replaceChildren(...pageRows.map(opportunityCard));
    updatePagination(state.page, pageCount);
    observeTitleBackgrounds(container);
    scheduleTitleBackgrounds(container);
}

function updatePagination(page, pageCount) {
    document.querySelector('.pagination-tab').textContent = `Pg. ${page}`;
    document.querySelector('.page-prev').disabled = page <= 1;
    document.querySelector('.page-next').disabled = page >= pageCount;
}

function setupPagination() {
    const changePage = (offset) => {
        state.page += offset;
        renderOpportunities();
        document.querySelector('.repobox').scrollTop = 0;
    };
    document.querySelector('.page-prev').addEventListener('click', () => changePage(-1));
    document.querySelector('.page-next').addEventListener('click', () => changePage(1));
}

const CONNECTOR_X = 75;
const CONNECTOR_CLEARANCE = 12;

/* The connector runs up the title at a fixed column and is hidden wherever the
   title's own background covers it, so it reads as meeting whichever line it
   first disappears behind. When that column lands within a hair of a line's
   right edge the meeting looks like a miss instead — the line grazes the corner
   and carries on past it. Pull the column a clear 12px inside that edge so it
   plainly terminates on the line, or if the line is too short to take it, push
   12px clear so it plainly passes and meets the next one up. Re-checking after
   each nudge catches the case where the new column grazes a different line. */
function connectorOffset(lines, linkLeft) {
    let x = CONNECTOR_X;
    for (let pass = 0; pass < lines.length; pass += 1) {
        const edges = lines.map((line) => ({ left: line.left - linkLeft - 8, right: line.right - linkLeft + 8 }));
        const grazed = edges.find((edge) => Math.abs(edge.right - x) < CONNECTOR_CLEARANCE);
        if (!grazed) break;
        const inside = grazed.right - CONNECTOR_CLEARANCE;
        x = inside >= grazed.left + CONNECTOR_CLEARANCE ? inside : grazed.right + CONNECTOR_CLEARANCE;
    }
    return Math.max(x, 0);
}

function drawTitleBackground(link) {
    const content = link.querySelector('.link-text');
    const layer = link.querySelector('.link-line-backgrounds');
    if (!content || !layer) return;

    const range = document.createRange();
    range.selectNodeContents(content);
    const linkRect = link.getBoundingClientRect();
    const lines = [];
    for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 1);
        if (line) {
            line.left = Math.min(line.left, rect.left);
            line.right = Math.max(line.right, rect.right);
            line.top = Math.min(line.top, rect.top);
            line.bottom = Math.max(line.bottom, rect.bottom);
        } else {
            lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
        }
    }

    layer.replaceChildren(...lines.map((line) => {
        const background = element('span', 'link-line-background');
        background.style.left = `${line.left - linkRect.left - 8}px`;
        background.style.top = `${line.top - linkRect.top - 8}px`;
        background.style.width = `${line.right - line.left + 16}px`;
        background.style.height = `${line.bottom - line.top + 16}px`;
        return background;
    }));
    link.classList.toggle('line-background-ready', Boolean(lines.length));

    const title = link.closest('.opportunity-title');
    if (title && lines.length) title.style.setProperty('--connector-x', `${connectorOffset(lines, linkRect.left)}px`);
}

function scheduleTitleBackgrounds(container) {
    if (titleBackgroundFrame) window.cancelAnimationFrame(titleBackgroundFrame);
    titleBackgroundFrame = window.requestAnimationFrame(() => {
        titleBackgroundFrame = null;
        container.querySelectorAll('.opportunity-card a').forEach(drawTitleBackground);
    });
}

function observeTitleBackgrounds(container) {
    if (!window.ResizeObserver) return;
    titleBackgroundObserver?.disconnect();
    titleBackgroundObserver = new ResizeObserver(() => scheduleTitleBackgrounds(container));
    titleBackgroundObserver.observe(container);
}

/* The stylesheet sets line-height as a unitless 1.4, and what getComputedStyle
   hands back for that is not agreed on between engines: a pixel value, the bare
   multiplier, or "normal". Read as pixels, a multiplier makes an allowance of
   "two lines" mean 2.8px, which no real overflow ever fits inside — the box then
   scrolls for a single spare line and the fit looks broken on that engine only.
   Any figure smaller than the font itself cannot be a line height in pixels, so
   it is treated as the multiplier it is. */
/* How much overflow a popup may absorb rather than scroll, in lines. Two was too
   tight in practice: a phone-width popup wraps the same text into more lines, so
   a tail that reads as one spare line on screen measures nearer three. */
const FIT_ALLOWANCE_LINES = 3;

function lineHeightOf(element) {
    const styles = getComputedStyle(element);
    const fontSize = parseFloat(styles.fontSize) || 14;
    const parsed = parseFloat(styles.lineHeight);
    if (parsed >= fontSize) return parsed;
    return fontSize * (parsed > 0 ? parsed : 1.4);
}

function setupDetailsPopups() {
    const box = document.querySelector('.repobox');

    /* A line or two poking past the cap isn't worth a scrollbar — the bar costs
       about as much room as it saves, and reads as far more content waiting below
       than there is. Let the box absorb an overflow that small and only scroll
       once it is genuinely substantial. Returns whether it ended up fitting.

       One measurement is enough because the marker's gutter is reserved on every
       popup rather than appearing with the scrollbar — see the stylesheet. Were
       it conditional, growing the box would re-wrap the text and change the very
       height this reads. */
    const fitContent = (popup) => {
        const content = popup.querySelector('.details-popup-content');
        if (!content) return false;

        // A popup's text never changes after render, so the verdict only depends
        // on its width. Once fitted at this width, reuse the answer — repeat
        // opens and desktop hover-tracking then never touch the classes below,
        // and never pay the rebuilds.
        if (popup.dataset.fitWidth === String(popup.offsetWidth)) return popup.dataset.fitVerdict !== 'scroll';

        // iOS WebKit lays this popup out reliably on first display and
        // unreliably on any in-place change — the same engine fault behind the
        // dismissal ghost-borders: computed style reads back grown while the box
        // keeps its capped height and the text spills past it. So the grown
        // state is never changed on a live box; every toggle yanks the popup
        // through display:none and back, discarding its boxes and rebuilding
        // them the one way that engine gets right. Synchronous within one frame,
        // so nothing flickers. That applies to removal too — an in-place
        // declassing wouldn't shrink the box either, and the measurement below
        // would read the grown geometry as "fits".
        const rebuild = () => {
            popup.style.display = 'none';
            void popup.offsetHeight;
            popup.style.display = '';
        };

        // The growth is a class swap (max-height: none + overflow-y: visible in
        // the stylesheet), not an inline max-height raise WebKit can quietly drop.
        if (content.classList.contains('is-grown')) {
            content.classList.remove('is-grown');
            rebuild();
        }

        const line = lineHeightOf(content);
        const overflow = content.scrollHeight - content.clientHeight;
        const allowance = line * FIT_ALLOWANCE_LINES;
        let verdict = 'fits';

        if (overflow > 0) {
            if (overflow > allowance) {
                verdict = 'scroll';
            } else {
                content.classList.add('is-grown');
                rebuild();
                verdict = 'grew';
            }
        }

        popup.dataset.fitWidth = String(popup.offsetWidth);
        popup.dataset.fitVerdict = verdict;
        return verdict !== 'scroll';
    };

    const place = (cell) => {
        const popup = cell.querySelector('.details-popup');
        const fold = cell.querySelector('.detail-token-fold');
        const tail = popup?.querySelector('.details-popup-tail');
        // A hidden popup measures as a zero rect, which yields a bogus shift that
        // stays applied until the next placement. Touch devices make that visible:
        // focusin lands on the tap while the popup is still display: none, and the
        // corrected placement only arrives with the click that pins it.
        if (!popup || !popup.offsetWidth) return;

        fitContent(popup);

        const boxRect = box.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const spaceAbove = cellRect.top - boxRect.top;
        const spaceBelow = boxRect.bottom - cellRect.bottom;
        const openUp = !(spaceAbove < popup.offsetHeight + 14 && spaceBelow > spaceAbove);
        cell.classList.toggle('popup-up', openUp);
        cell.classList.toggle('popup-down', !openUp);

        popup.style.setProperty('--popup-shift-x', '0px');
        const popupRect = popup.getBoundingClientRect();
        const contentLeft = boxRect.left + box.clientLeft;
        const contentRight = contentLeft + box.clientWidth;
        const inset = 8;
        let shift = cell.classList.contains('eligibility-cell') || popupRect.right > contentRight - inset
            ? contentRight - inset - popupRect.right
            : 0;

        const foldRect = fold?.getBoundingClientRect();
        if (foldRect && tail) {
            const maxFromRight = Math.max(popupRect.width / 6, tail.offsetWidth);
            const overshoot = popupRect.right + shift - (foldRect.left + foldRect.width / 2) - maxFromRight;
            if (overshoot > 0) shift -= overshoot;
        }
        if (popupRect.left + shift < contentLeft + inset) shift = contentLeft + inset - popupRect.left;
        popup.style.setProperty('--popup-shift-x', `${shift}px`);

        if (foldRect && tail) {
            const finalRect = popup.getBoundingClientRect();
            const rawLeft = foldRect.left + foldRect.width / 2 - finalRect.left - tail.offsetWidth / 2;
            const tailLeft = Math.max(1, Math.min(rawLeft, finalRect.width - tail.offsetWidth - 1));
            popup.style.setProperty('--tail-left', `${tailLeft}px`);
        }

        markScrollable(popup);
    };

    // Flags a popup that still has text below the fold, which the marker in the
    // stylesheet renders. Keyed on what is left rather than on whether the box
    // scrolls at all, so it retires once the reader reaches the end. The 2px
    // tolerance is for sub-pixel rounding: an expanded box can report a stray
    // pixel of overflow it cannot actually scroll, and the marker would sit there
    // pointing at nothing.
    const markScrollable = (popup) => {
        const content = popup.querySelector('.details-popup-content');
        if (!content) return;
        const remaining = content.scrollHeight - content.clientHeight - content.scrollTop;
        popup.classList.toggle('has-more', remaining > 2);
    };

    /* A closed popup can leave its border painted across the cards it covered.
       The popup is placed with a transform inside a composited scroller, and the
       region WebKit invalidates on hide doesn't reliably cover where it actually
       drew — so those pixels are simply never asked to repaint. Nothing in the
       page will ask on its own either, since the cards underneath haven't
       changed. Touching opacity on the scroller invalidates the whole thing for
       one frame, which repaints the stale region along with everything else.
       This is a workaround for an engine bug, not a fix for our own logic: it is
       scoped to dismissal on touch, where the artifact appears, so the common
       paths stay clean. Assigning opacity does not disturb scrollTop. */
    const repaintBox = () => {
        if (!window.matchMedia('(pointer: coarse)').matches) return;
        box.style.opacity = '0.999';
        window.requestAnimationFrame(() => { box.style.opacity = ''; });
    };

    const setPinned = (cell, pinned) => {
        cell.classList.toggle('popup-pinned', pinned);
        cell.setAttribute('aria-pressed', String(pinned));
        cell.querySelector('.detail-token-fold').textContent = pinned ? '×' : '+';
        if (!pinned) repaintBox();
    };

    const togglePinned = (cell) => {
        if (cell.classList.contains('popup-pinned')) {
            setPinned(cell, false);
            cell.classList.add('popup-dismissed');
            cell.blur();
            return;
        }
        box.querySelectorAll('.detail-token.popup-pinned').forEach((other) => setPinned(other, false));
        cell.classList.remove('popup-dismissed');
        setPinned(cell, true);
        place(cell);
        // The popup is measured in the same tick it is revealed. Re-place once the
        // frame has actually been laid out, so anything that settled late is
        // measured against what is really on screen. place() is idempotent, so on
        // the common path this just confirms the first answer.
        window.requestAnimationFrame(() => { if (cell.classList.contains('popup-pinned')) place(cell); });
    };

    const tokenFrom = (event) => event.target.closest?.('.detail-token.has-details');
    // Capture, because scroll does not bubble — one listener covers every popup.
    box.addEventListener('scroll', (event) => {
        const content = event.target.closest?.('.details-popup-content');
        if (content) markScrollable(content.closest('.details-popup'));
    }, true);
    box.addEventListener('mouseover', (event) => { const cell = tokenFrom(event); if (cell) place(cell); });
    box.addEventListener('focusin', (event) => { const cell = tokenFrom(event); if (cell) place(cell); });
    box.addEventListener('click', (event) => {
        if (event.target.closest('.details-popup')) return;
        const cell = tokenFrom(event);
        if (cell) togglePinned(cell);
    });
    box.addEventListener('keydown', (event) => {
        const cell = tokenFrom(event);
        if (!cell) return;
        if (['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            togglePinned(cell);
        } else if (event.key === 'Escape' && cell.classList.contains('popup-pinned')) {
            event.preventDefault();
            togglePinned(cell);
        }
    });
    box.addEventListener('mouseout', (event) => {
        const cell = tokenFrom(event);
        if (cell && !cell.contains(event.relatedTarget)) cell.classList.remove('popup-dismissed');
    });
    document.addEventListener('click', (event) => {
        const selected = tokenFrom(event);
        box.querySelectorAll('.detail-token.popup-pinned').forEach((cell) => {
            if (cell !== selected) setPinned(cell, false);
        });
    });
}

function setupFilterInputs() {
    const fees = document.querySelector('#hide-fees-toggle');
    const rolling = document.querySelector('#rolling-toggle');
    fees.checked = state.filters.hideFees;
    rolling.checked = state.filters.onlyRolling;
    fees.addEventListener('change', () => { state.filters.hideFees = fees.checked; updateView(); });
    rolling.addEventListener('change', () => { state.filters.onlyRolling = rolling.checked; updateView(); });
}

/* Publishes the room left below the results box as --repobox-fit, which the
   mobile stylesheet caps its height against. Measured from the document rather
   than the viewport so the answer describes the page scrolled to the top — the
   position where the box is meant to read as a whole, framed object — and stays
   put no matter where the reader has since scrolled to. Desktop never reads the
   var; the work here is cheap enough not to bother gating it. */
function fitRepoHeight() {
    const repo = document.querySelector('.repo');
    if (!repo) return;
    const box = repo.querySelector('.repobox');
    const documentTop = repo.getBoundingClientRect().top + window.scrollY;
    // The var sizes .repobox, so the frame .repo wraps around it comes off the top.
    const frame = box ? repo.offsetHeight - box.offsetHeight : 0;
    const room = window.innerHeight - documentTop - frame - 8;
    repo.style.setProperty('--repobox-fit', `${Math.max(room, 200)}px`);
}

function setupRepoFit() {
    fitRepoHeight();
    window.addEventListener('resize', fitRepoHeight);
    window.addEventListener('orientationchange', fitRepoHeight);
    // On mobile the filters stack above the box, so their applied-chip list
    // growing pushes it further down the page.
    const filters = document.querySelector('.filters');
    if (filters && window.ResizeObserver) new ResizeObserver(fitRepoHeight).observe(filters);
}

function init() {
    initSharedPage();
    parseUrlFilters();
    setupCategoryMenu();
    setupFilterInputs();
    setupPagination();
    setupDetailsPopups();
    setupRepoFit();
    // Re-page only on an actual breakpoint crossing, not every resize pixel.
    window.matchMedia(MOBILE_BREAKPOINT).addEventListener('change', renderOpportunities);
    loadOpportunities();
}

init();
