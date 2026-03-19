// Opportunities array - will be populated from JSON
let opportunities = [];
let activeFilters = {
    type: [],
    hideFees: false
};

// Track whether a pointer is currently pressed so expand can wait for release
let pointerIsDown = false;
document.addEventListener('pointerdown', () => { pointerIsDown = true; }, { capture: true });
document.addEventListener('pointerup', () => { pointerIsDown = false; }, { capture: true });

// Animate the `.applied-filters` container when filters are added/removed.
function animateFilterArea(container, startingHeight) {
    if (!container) return;
    const duration = 200; // ms (matches CSS)
    const MAX = 165; // px - same as CSS

    // compute current content height after DOM updates
    const contentHeight = container.scrollHeight;

    // Check if we're transitioning between filter states or truly expanding from nothing
    const isTransition = startingHeight && startingHeight > 0;

    // clamp startingHeight so we never momentarily expand past MAX when overflowing
    const startingClamped = isTransition ? Math.min(startingHeight, MAX) : 0;

    const target = Math.min(contentHeight, MAX);
    container.style.overflow = 'hidden';

    // Only animate padding when expanding from nothing, not during transitions
    const transitionStr = isTransition 
        ? `max-height ${duration}ms steps(4,end)`
        : `max-height ${duration}ms steps(3,end), padding ${Math.max(120, duration - 20)}ms steps(3,end)`;
    // add a short JS delay before starting the expand animation when truly expanding from nothing
    const expandDelay = isTransition ? 0 : 120; // ms
    // start with no transition so the element can stay collapsed during the delay
    container.style.transition = 'none';
    
    if (isTransition) {
        // Transitioning between filter states - smooth resize from current height
        // ensure we don't start larger than MAX (prevents divider jumping down past max)
        container.style.maxHeight = startingClamped + 'px';
        // Don't change padding for transitions
    } else {
        // Truly expanding from nothing
        container.style.paddingTop = '0px';
        container.style.paddingBottom = '0px';
        container.style.maxHeight = '0px';
    }
    
    // force layout
    container.getBoundingClientRect();
    
    // start the transition only after the user releases pointer (pointerup),
    // with a timeout fallback so it still runs if pointerup doesn't fire.
    let cleanupTimer = null;
    const scheduleCleanup = () => {
        // cleanup after the transition duration
        cleanupTimer = window.setTimeout(() => {
            if (contentHeight > MAX) {
                container.style.overflow = 'auto';
                container.style.maxHeight = MAX + 'px';
            } else {
                container.style.overflow = '';
                container.style.maxHeight = contentHeight + 'px';
            }
            container.style.transition = '';
        }, duration + 20);
    };

    const startExpand = () => {
        // avoid double-start
        if (startExpand._started) return;
        startExpand._started = true;
        // enable the transition then set the target height to animate
        container.style.transition = transitionStr;
        requestAnimationFrame(() => {
            container.style.maxHeight = target + 'px';
            if (!isTransition) {
                container.style.paddingTop = '4px';
                container.style.paddingBottom = '4px';
            }
        });
        scheduleCleanup();
    };

    if (isTransition) {
        // Transitioning between filter states - run immediately with transition enabled
        container.style.transition = transitionStr;
        // start from the clamped starting height so we don't visually exceed MAX
        container.style.maxHeight = startingClamped + 'px';
        requestAnimationFrame(() => { container.style.maxHeight = target + 'px'; });
        scheduleCleanup();
    } else {
        // Truly expanding from nothing: wait a fixed post-click delay, then enable transition and expand
        window.setTimeout(() => { startExpand(); }, expandDelay);
    }
}

// Load opportunities from static JSON file
async function loadOpportunities() {
    try {
        const response = await fetch('data/opportunities.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        opportunities = await response.json();
        // Apply any filters passed via URL before rendering
        applyFiltersFromUrl();
        populateTypeDropdown();
        updateAppliedFiltersDisplay();
        populateOpportunitiesMainTable();
    } catch (error) {
        console.error('Error loading opportunities:', error);
    }
}

// Read URL query parameters and apply initial filters.
// Supported: `type` (comma-separated or single) and `hideFees` (true/1)
function applyFiltersFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const types = [];
        if (params.has('type')) {
            const raw = params.getAll('type').join(',');
            raw.split(',').map(s => s.trim()).filter(Boolean).forEach(t => types.push(t.toLowerCase()));
        }
        if (types.length > 0) activeFilters.type = types;
        if (params.has('hideFees')) {
            const v = params.get('hideFees');
            activeFilters.hideFees = (v === '1' || v === 'true');
        }
    } catch (err) {
        // ignore URL parsing errors
    }
}
// Populate type dropdown with unique types from opportunities
function populateTypeDropdown() {
    const dropdown = document.querySelector('select[name="type"]');
    if (!dropdown) return;

    // Extract unique types from the currently visible pool (respecting
    // expiration and the hide-fees toggle) so expired opportunities don't
    // contribute categories.
    const source = getVisibleOpportunities();
    const types = [...new Set(source.map(opp => opp.type).filter(Boolean))].sort();

    // Remove all options except the first one (disabled "Type")
    while (dropdown.options.length > 1) {
        dropdown.remove(1);
    }

    // Add type options, skip those already selected
    types.forEach(type => {
        if (!activeFilters.type.includes(type.toLowerCase())) {
            const option = document.createElement('option');
            option.value = type.toLowerCase();
            option.textContent = type;
            dropdown.appendChild(option);
        }
    });

    // Add clear option at the end only if any type filter is active
    if (activeFilters.type.length > 0) {
        const clearOption = document.createElement('option');
        clearOption.value = '__clear__';
        clearOption.textContent = 'Clear Categories';
        clearOption.className = 'clear-filter-option';
        dropdown.appendChild(clearOption);
    }
    // sync custom UI (if present)
    try { syncCustomSelectFromNative(dropdown); } catch (err) { /* ignore */ }
}

// Build/sync the custom dropdown UI from the native select options
function syncCustomSelectFromNative(nativeSelect) {
    if (!nativeSelect) return;
    const wrapper = nativeSelect.previousElementSibling && nativeSelect.previousElementSibling.classList && nativeSelect.previousElementSibling.classList.contains('custom-select') ? nativeSelect.previousElementSibling : null;
    if (!wrapper) return;

    const selectedDiv = wrapper.querySelector('.custom-selected');
    const ul = wrapper.querySelector('.custom-options');
    if (!selectedDiv || !ul) return;

    // Clear existing options and rebuild list (skip placeholder)
    ul.innerHTML = '';
    Array.from(nativeSelect.options).forEach(opt => {
        if (opt.disabled || opt.value === 'TYPE_LABEL') return;
        const li = document.createElement('li');
        // wrap visible text in a span so we can scale the text without
        // affecting the li's border/outline layout
        const span = document.createElement('span');
        span.className = 'opt-label';
        span.textContent = opt.textContent;
        li.appendChild(span);
        li.dataset.value = opt.value;

        // copy any classes present on the native <option> (e.g. clear-filter-option)
        if (opt.className) {
            opt.className.split(/\s+/).forEach(c => { if (c) li.classList.add(c); });
        }

        if (opt.disabled) li.classList.add('disabled');
        li.setAttribute('role', 'option');
        li.tabIndex = -1;
        ul.appendChild(li);
    });
    // keep a live reference to option elements on the wrapper so handlers can access updated list
    wrapper._optionEls = Array.from(ul.querySelectorAll('li'));



    // init interactivity once
    if (wrapper._inited) return;
    wrapper._inited = true;

    // helpers to access the current option elements (kept in wrapper._optionEls)
    const getOptionEls = () => wrapper._optionEls || Array.from(ul.querySelectorAll('li'));
    getOptionEls().forEach(li => li.setAttribute('aria-selected', 'false'));

    let activeIndex = -1;
    const setActive = (idx) => {
        const optionEls = getOptionEls();
        if (activeIndex >= 0 && optionEls[activeIndex]) {
            optionEls[activeIndex].setAttribute('aria-selected', 'false');
            optionEls[activeIndex].tabIndex = -1;
        }
        activeIndex = idx;
        if (activeIndex >= 0 && optionEls[activeIndex]) {
            const el = optionEls[activeIndex];
            el.setAttribute('aria-selected', 'true');
            el.tabIndex = 0; // make programmatically focusable
            try { el.focus(); } catch (err) { /* ignore */ }
        }
    };

    const open = (isOpen) => {
        wrapper.querySelector('.custom-selected').setAttribute('aria-expanded', String(isOpen));
        ul.setAttribute('aria-hidden', String(!isOpen));
        if (isOpen) ul.style.display = 'block'; else ul.style.display = 'none';
        // reflect open state as a class so styling can target "open"
        if (isOpen) wrapper.classList.add('open'); else wrapper.classList.remove('open');
        if (!isOpen) {
            // reset active index when closed
            if (activeIndex >= 0 && optionEls[activeIndex]) {
                optionEls[activeIndex].setAttribute('aria-selected', 'false');
                optionEls[activeIndex].tabIndex = -1;
            }
            activeIndex = -1;
        }
    };

    // track whether the open came from keyboard (so we know whether to auto-focus first option)
    let openedViaKeyboard = false;
    selectedDiv.addEventListener('click', (e) => {
        const isOpen = ul.getAttribute('aria-hidden') === 'false';
        openedViaKeyboard = false;
        open(!isOpen);
        if (!isOpen && openedViaKeyboard) {
            const firstIdx = getOptionEls().findIndex(el => !el.classList.contains('disabled'));
            if (firstIdx !== -1) setActive(firstIdx);
        }
    });

    selectedDiv.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            openedViaKeyboard = true;
            open(true);
            const firstIdx = getOptionEls().findIndex(el => !el.classList.contains('disabled'));
            if (firstIdx !== -1) setActive(firstIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            openedViaKeyboard = true;
            open(true);
            const optionEls = getOptionEls();
            const lastIdx = optionEls.length - 1 - [...optionEls].reverse().findIndex(el => !el.classList.contains('disabled'));
            if (lastIdx >= 0) setActive(lastIdx);
        } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            const isOpen = ul.getAttribute('aria-hidden') === 'false';
            openedViaKeyboard = true;
            open(!isOpen);
            if (!isOpen) {
                const firstIdx = getOptionEls().findIndex(el => !el.classList.contains('disabled'));
                if (firstIdx !== -1) setActive(firstIdx);
            }
        } else if (e.key === 'Escape') {
            open(false);
        }
    });

    // keyboard navigation and selection when focus is on option list
    ul.addEventListener('keydown', (e) => {
        const optionEls = getOptionEls();
        if (activeIndex === -1) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            let next = activeIndex + 1;
            while (next < optionEls.length && optionEls[next].classList.contains('disabled')) next++;
            if (next < optionEls.length) setActive(next);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            let prev = activeIndex - 1;
            while (prev >= 0 && optionEls[prev].classList.contains('disabled')) prev--;
            if (prev >= 0) setActive(prev);
        } else if (e.key === 'Home') {
            e.preventDefault();
            const firstIdx = optionEls.findIndex(el => !el.classList.contains('disabled'));
            if (firstIdx !== -1) setActive(firstIdx);
        } else if (e.key === 'End') {
            e.preventDefault();
            const lastIdx = optionEls.length - 1 - [...optionEls].reverse().findIndex(el => !el.classList.contains('disabled'));
            if (lastIdx >= 0) setActive(lastIdx);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const li = optionEls[activeIndex];
            if (!li || li.classList.contains('disabled')) return;
            li.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            open(false);
            try { selectedDiv.focus(); } catch (err) { /* ignore */ }
        }
    });

    // delegate clicks on options
    ul.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (!li || li.classList.contains('disabled')) return;
        const val = li.dataset.value;
        // set native select and trigger change
        nativeSelect.value = val;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        // keep the visible label as 'Type' and close
        setLabel('Type');
        open(false);
        try { selectedDiv.focus(); } catch (err) { /* ignore */ }
    });

    // close when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) open(false);
    });

    // when native select changes (e.g., programmatically), update custom UI
    nativeSelect.addEventListener('change', () => {
        const sel2 = nativeSelect.options[nativeSelect.selectedIndex];
        // keep visible label as placeholder 'Type' (per earlier behavior)
        setLabel('Type');
    });
}

// Return the current set of opportunities that should be visible to the
// user based on expiration and the hide-fees toggle. This deliberately
// does NOT apply the `type` filter because the dropdown shows available
// types to choose from.
function getVisibleOpportunities() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return opportunities.filter(opp => {
        // hide by fees if requested
        if (activeFilters.hideFees && ((opp.fees || '').toLowerCase() === 'y')) return false;
        // hide expired
        const d = new Date(opp.deadline);
        if (!isNaN(d) && d < todayStart) return false;
        return true;
    });
}

// Populate opportunities table
function populateOpportunitiesMainTable() {
    const container = document.querySelector('.repobox');
    if (!container) return;

    // Clear existing content
    container.innerHTML = '';

    // Filter opportunities based on active filters
    let filtered = opportunities;
    if (activeFilters.type && activeFilters.type.length > 0) {
        filtered = filtered.filter(opp => activeFilters.type.includes((opp.type || '').toLowerCase()));
    }

    // Optionally hide fee-charged opportunities when the toggle is enabled
    if (activeFilters.hideFees) {
        filtered = filtered.filter(opp => ((opp.fees || '').toLowerCase() !== 'y'));
    }

    // Filter out opportunities whose deadline is before today and sort by
    // nearest deadline first. Treat invalid/missing deadlines as keepers
    // and place them at the end when sorting.
    (function filterAndSortByDeadline() {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        filtered = filtered.filter(opp => {
            const d = new Date(opp.deadline);
            if (isNaN(d)) return true; // keep items with no/invalid deadline
            return d >= todayStart;
        });

        filtered.sort((a, b) => {
            const da = new Date(a.deadline);
            const db = new Date(b.deadline);
            const ta = isNaN(da) ? Infinity : da.getTime();
            const tb = isNaN(db) ? Infinity : db.getTime();
            return ta - tb;
        });
    })();

    filtered.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'opportunity-card';

        // Title column (left)
        const titleColumnDiv = document.createElement('div');

        const link = document.createElement('a');

        // Ensure link has a protocol
        let href = item.link || '#';
        if (href && href !== '#' && !href.startsWith('http')) {
            href = 'https://' + href;
        }

        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        // Create wrapper span for link content to allow proper outline
        const linkContent = document.createElement('span');
        linkContent.className = 'link-text';

        // Split title into words and keep last word with icon
        const words = item.name.split(' ');
        const lastWord = words.pop();

        if (words.length > 0) {
            linkContent.textContent = words.join(' ') + ' ';
        }

        // SVG external link icon (inline, small)
        const iconSpan = document.createElement('span');
        iconSpan.style.whiteSpace = 'nowrap';
        iconSpan.textContent = lastWord;
        iconSpan.style.marginLeft = '0px';

        const icon = document.createElement('span');
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 20 20" fill="none" style="margin-left:4px;display:inline;vertical-align:middle"><path d="M14.5 2.5H17.5V5.5" stroke="#00ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 10L17.5 2.5" stroke="#00ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 10.5V17.5H2.5V2.5H9.5" stroke="#00ff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        iconSpan.appendChild(icon);
        linkContent.appendChild(iconSpan);
        link.appendChild(linkContent);
        titleColumnDiv.appendChild(link);
        card.appendChild(titleColumnDiv);

        // Type and Fee grid (top right 2x2 grid)
        const topRightGrid = document.createElement('div');
        topRightGrid.className = 'top-right-grid';

        const typeCell = document.createElement('div');
        typeCell.className = 'grid-cell field type-cell';
        typeCell.innerHTML = `${item.type || '-'}`;
        topRightGrid.appendChild(typeCell);

        // Normalize fees to make comparisons case-insensitive
        const feeFlag = (item.fees || '').toLowerCase();
        // Only show fee cell when fees is not 'n' (don't display for 'n')
        if (feeFlag !== 'n') {
            const feeCell = document.createElement('div');
            feeCell.className = 'grid-cell field fee-cell';

            if (feeFlag === 'y') {
                feeCell.classList.add('fee-charged');
                feeCell.innerHTML = 'fee';
            } else {
                feeCell.innerHTML = '-';
            }

            topRightGrid.appendChild(feeCell);
        }

        card.appendChild(topRightGrid);

        // Format date as "Feb 2, '26'" when possible; otherwise display raw text
        let deadlineText = '-';
        if (item.deadline !== undefined && item.deadline !== null && item.deadline !== '') {
            const parsed = new Date(item.deadline);
            if (isNaN(parsed)) {
                // Non-parseable text (e.g. "Not specified") — show as-is
                deadlineText = item.deadline;
            } else {
                const month = parsed.toLocaleDateString('en-US', { month: 'short' });
                const day = parsed.getDate();
                const year = parsed.getFullYear().toString().slice(-2);
                deadlineText = `${month} ${day}, '${year}`;
            }
        }

        // Deadline column (left, new row)
        const deadlineColumnDiv = document.createElement('div');
        deadlineColumnDiv.className = 'field date-cell';
        deadlineColumnDiv.innerHTML = `<strong>Deadline: </strong> ${deadlineText}`;
        card.appendChild(deadlineColumnDiv);

        container.appendChild(card);
    });
}

// Update applied filters display
function updateAppliedFiltersDisplay() {
    const container = document.querySelector('.applied-filters');
    if (!container) return;

    // Capture current height before modifying DOM (for smooth expand transitions)
    const startingHeight = container.scrollHeight;

    // If no filters (including hideFees), show "no filters"
    const hasFilters = (activeFilters.type && activeFilters.type.length > 0) || activeFilters.hideFees;
    
    if (!hasFilters) {
        // Just collapse instantly without animation
        // Clear any leftover inline styles from previous animation
        container.style.transition = '';
        container.style.maxHeight = '';
        container.style.overflow = '';
        container.innerHTML = '';
        const noFiltersItem = document.createElement('div');
        noFiltersItem.className = 'filter-item';
        noFiltersItem.textContent = 'none';
        container.appendChild(noFiltersItem);
        return;
    }

    // For the hasFilters case, update DOM and animate expansion
    container.innerHTML = '';

    // Display active type filters with remove button
    if (activeFilters.type && activeFilters.type.length > 0) {
        activeFilters.type.forEach(typeValue => {
            const filterItem = document.createElement('div');
            filterItem.className = 'filter-item active-filter';

            const filterText = document.createElement('span');
            filterText.textContent = typeValue.charAt(0).toUpperCase() + typeValue.slice(1);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.className = 'remove-filter-btn';
            removeBtn.onclick = () => {
                activeFilters.type = activeFilters.type.filter(t => t !== typeValue);
                populateTypeDropdown();  // Refresh dropdown options
                updateAppliedFiltersDisplay();
                populateOpportunitiesMainTable();
            };

            filterItem.appendChild(filterText);
            filterItem.appendChild(removeBtn);
            container.appendChild(filterItem);
        });
    }

    // Display hide-fees active filter (rendered as an exclusion token)
    if (activeFilters.hideFees) {
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item active-filter exclude-filter';

        const filterText = document.createElement('span');
        filterText.textContent = 'Fee';

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'remove-filter-btn';
        removeBtn.onclick = () => {
            activeFilters.hideFees = false;
            const cb = document.querySelector('#hide-fees-toggle');
            if (cb) cb.checked = false;
            updateAppliedFiltersDisplay();
            populateOpportunitiesMainTable();
        };

        filterItem.appendChild(filterText);
        filterItem.appendChild(removeBtn);
        container.appendChild(filterItem);
    }
    // animate expand, passing startingHeight for smooth transitions
    // preserve the previous height immediately so the surrounding divider doesn't jump
    if (startingHeight) {
        const MAX = 165; // keep in sync with animateFilterArea
        const startClamped = Math.min(startingHeight, MAX);
        container.style.transition = 'none';
        container.style.maxHeight = startClamped + 'px';
        container.style.overflow = 'hidden';
    }
    // add a short delay so the animation begins after the user interaction finishes
    window.setTimeout(() => { animateFilterArea(container, startingHeight); }, 120);
}

// Setup filter event listeners
function setupFilterListeners() {
    const typeDropdown = document.querySelector('select[name="type"]');
    if (typeDropdown) {
        // Track whether the last interaction was via pointer (mouse/touch)
        let lastWasPointer = false;
        typeDropdown.addEventListener('pointerdown', () => { lastWasPointer = true; });
        typeDropdown.addEventListener('touchstart', () => { lastWasPointer = true; }, { passive: true });
        typeDropdown.addEventListener('keydown', () => { lastWasPointer = false; });

        typeDropdown.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val && val !== 'TYPE_LABEL') {
                if (val === '__clear__') {
                    activeFilters.type = [];
                } else if (!activeFilters.type.includes(val)) {
                    activeFilters.type.push(val);
                }
            }
            populateTypeDropdown();  // Refresh dropdown options
            updateAppliedFiltersDisplay();
            populateOpportunitiesMainTable();
            e.target.value = 'TYPE_LABEL';  // Reset dropdown to show "Type" label

            // If the user selected via pointer, remove focus so :focus-visible is reset.
            if (lastWasPointer) {
                setTimeout(() => {
                    try { typeDropdown.blur(); } catch (err) { /* ignore */ }
                    lastWasPointer = false;
                }, 0);
            }
        });
    }

    // Wire up hide-fees checkbox here so it's initialized alongside other listeners
    const hideFeesCheckbox = document.querySelector('#hide-fees-toggle');
    if (hideFeesCheckbox) {
        hideFeesCheckbox.checked = Boolean(activeFilters.hideFees);
        hideFeesCheckbox.addEventListener('change', (e) => {
            activeFilters.hideFees = e.target.checked;
            updateAppliedFiltersDisplay();
            populateOpportunitiesMainTable();
        });
    }
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadOpportunities();
        setupFilterListeners();
    });
} else {
    loadOpportunities();
    setupFilterListeners();
}

document.querySelectorAll('a.info').forEach(infoLink => {
    const optionBtnContainer = infoLink.closest('.option-btn-container');
    if (!optionBtnContainer) return;
    const optionDetails = optionBtnContainer.querySelector('.option-details');
    const prevLink = infoLink.previousElementSibling;
    if (!optionDetails) return;

    // Determine whether details are initially hidden (computed display none)
    const initiallyHidden = window.getComputedStyle(optionDetails).display === 'none';
    // Remove any inline display so CSS controls layout (we'll manage max-height)
    optionDetails.style.display = '';

    // helper to hide/restore only the inner content nodes (keep container border visible)
    // Use opacity + pointer-events so layout/scrollHeight is unaffected.
    const setInnerContentHidden = (hide) => {
        Array.from(optionDetails.children).forEach((ch) => {
            try {
                ch.style.transition = 'opacity 0ms linear';
                ch.style.opacity = hide ? '0' : '';
                ch.style.pointerEvents = hide ? 'none' : '';
            } catch (err) { /* ignore */ }
        });
    };

    if (initiallyHidden) {
        // Start collapsed: keep the container present but hide its inner text
        optionDetails.classList.remove('open');
        optionDetails.style.maxHeight = '0px';
        optionDetails.style.overflow = 'hidden';
        // hide only the content so the border/background remains visible
        setInnerContentHidden(true);
        infoLink.textContent = '+';
        infoLink.setAttribute('aria-expanded', 'false');
    } else {
        // Start visible: reveal immediately without animation and avoid clipping
        optionDetails.classList.add('open');
        const prevTransition = optionDetails.style.transition;
        optionDetails.style.transition = 'none';
        // set explicit maxHeight with a small buffer so the bottom won't clip
        optionDetails.style.maxHeight = (optionDetails.scrollHeight + 8) + 'px';
        optionDetails.style.overflow = '';
        // ensure inner content is visible when starting open
        setInnerContentHidden(false);
        // Force layout then restore transition so future toggles animate
        optionDetails.getBoundingClientRect();
        requestAnimationFrame(() => { optionDetails.style.transition = prevTransition; });
        infoLink.textContent = '−';
        infoLink.setAttribute('aria-expanded', 'true');
    }

    infoLink.setAttribute('role', 'button');

    infoLink.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = infoLink.getAttribute('aria-expanded') === 'true';

        if (isOpen) {
            // close: hide inner text during collapse so border stays visible
            setInnerContentHidden(true);
            optionDetails.style.overflow = 'hidden';
            optionDetails.style.maxHeight = (optionDetails.scrollHeight + 8) + 'px';
            requestAnimationFrame(() => {
                optionDetails.classList.remove('open');
                optionDetails.style.maxHeight = '0px';
            });
            infoLink.textContent = '+';
            infoLink.setAttribute('aria-expanded', 'false');

            optionDetails.addEventListener('transitionend', function onClose(e) {
                if (e.propertyName !== 'max-height' && e.propertyName !== 'maxHeight') return;
                optionDetails.style.overflow = '';
                optionDetails.removeEventListener('transitionend', onClose);
            }, { once: true });
        } else {
            // open: hide inner text until expand animation finishes
            setInnerContentHidden(true);
            optionDetails.classList.add('open');
            optionDetails.style.overflow = 'hidden';
            optionDetails.style.maxHeight = '0px';
            requestAnimationFrame(() => {
                optionDetails.style.maxHeight = (optionDetails.scrollHeight + 8) + 'px';
            });
            infoLink.textContent = '−';
            infoLink.setAttribute('aria-expanded', 'true');

            // Restore inner content when the expand transition finishes. Accept
            // multiple propertyName variants and use a timeout fallback. Wait an
            // extra frame before clearing maxHeight to avoid a bounce where the
            // element shrinks and cuts off content.
            (function() {
                const DURATION = 240; // ms — slightly longer than CSS 200ms
                let timer = null;
                const cleanup = (fromEvent) => {
                    // reveal inner text
                    setInnerContentHidden(false);
                    // measure the new content height and lock maxHeight to avoid
                    // an instantaneous shrink/bounce when we clear the inline
                    // maxHeight. Then clear it after a short delay so the
                    // element becomes auto-sized.
                    const newH = optionDetails.scrollHeight;
                    optionDetails.style.maxHeight = newH + 'px';
                    optionDetails.style.overflow = '';
                    // give browser a moment to reflow with revealed content,
                    // then clear the fixed maxHeight so natural layout resumes.
                    requestAnimationFrame(() => {
                        window.setTimeout(() => {
                            // use 'none' so the element is not constrained by max-height
                            // (clearing to '' would fall back to the stylesheet's
                            // `max-height: 0` and cause a shrink)
                            optionDetails.style.maxHeight = 'none';
                        }, 40);
                    });
                    if (timer) { clearTimeout(timer); timer = null; }
                };

                const onOpen = (e) => {
                    if (!e || !e.propertyName || e.propertyName === 'max-height' || e.propertyName === 'maxHeight') {
                        cleanup(true);
                    }
                };

                optionDetails.addEventListener('transitionend', onOpen, { once: true });
                timer = window.setTimeout(() => { cleanup(false); }, DURATION);
            })();
        }
    });

    infoLink.addEventListener('mouseenter', () => { if (prevLink) prevLink.style.borderRightColor = 'red'; });
    infoLink.addEventListener('mouseleave', () => { if (prevLink) prevLink.style.borderRightColor = 'blue'; });
});
