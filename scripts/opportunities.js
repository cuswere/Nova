import { initSharedPage } from './shared.js';

const PAGE_SIZE = 50;
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
    return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
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
    const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((part) => part.trim());
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

    const pageCount = Math.ceil(rows.length / PAGE_SIZE);
    state.page = Math.max(1, Math.min(state.page, pageCount));
    const pageRows = rows.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
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

function setupDetailsPopups() {
    const box = document.querySelector('.repobox');

    const place = (cell) => {
        const popup = cell.querySelector('.details-popup');
        const fold = cell.querySelector('.detail-token-fold');
        const tail = popup?.querySelector('.details-popup-tail');
        if (!popup) return;

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
    };

    const setPinned = (cell, pinned) => {
        cell.classList.toggle('popup-pinned', pinned);
        cell.setAttribute('aria-pressed', String(pinned));
        cell.querySelector('.detail-token-fold').textContent = pinned ? '×' : '+';
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
    };

    const tokenFrom = (event) => event.target.closest?.('.detail-token.has-details');
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

function init() {
    initSharedPage();
    parseUrlFilters();
    setupCategoryMenu();
    setupFilterInputs();
    setupPagination();
    setupDetailsPopups();
    loadOpportunities();
}

init();
