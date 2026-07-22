(async () => {
    if (!/(^|\.)artworkarchive\.com$/.test(location.hostname) || location.pathname.replace(/\/+$/, '') !== '/call-for-entry') {
        throw new Error('Run this from https://www.artworkarchive.com/call-for-entry');
    }

    const pages = [];
    const unresolved = [];
    const visited = new Set();
    let url = new URL('/call-for-entry', location.origin);

    const DETAIL_CONCURRENCY = 3;
    const DETAIL_START_STAGGER_MS = 100;
    const LISTING_PAGE_DELAY_MS = 750;
    const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isArtworkArchive = (hostname) => /(^|\.)artworkarchive\.com$/i.test(hostname);

    function prose(element) {
        if (!element) return '';
        const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR']);
        function render(node) {
            if (node.nodeType === Node.TEXT_NODE) return node.data;
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            if (node.tagName === 'BR') return '\n';
            let content = [...node.childNodes].map(render).join('');
            if (['STRONG', 'B'].includes(node.tagName) && content.trim()) content = `**${content.trim()}**`;
            if (['EM', 'I'].includes(node.tagName) && content.trim()) content = `*${content.trim()}*`;
            if (/^H[1-6]$/.test(node.tagName) && content.trim()) content = `**${content.trim()}**`;
            if (node.tagName === 'LI') return `- ${content.trim()}\n`;
            if (['UL', 'OL'].includes(node.tagName)) return `\n${content.trim()}\n`;
            if (blocks.has(node.tagName)) return `\n\n${content.trim()}\n\n`;
            return content;
        }
        return render(element)
            .replace(/\u00a0/g, ' ')
            .split('\n')
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function detailValue(detailPage, label) {
        const term = [...detailPage.querySelectorAll('dt')]
            .find((element) => text(element.textContent).replace(/:$/, '') === label);
        if (term) return prose(term.nextElementSibling);

        const labelElement = [...detailPage.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,p,span,div')]
            .find((element) => !element.children.length && text(element.textContent).replace(/:$/, '') === label);
        return prose(labelElement?.nextElementSibling);
    }

    function sectionText(detailPage, heading) {
        const headingElement = [...detailPage.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .find((element) => text(element.textContent) === heading);
        if (!headingElement) return '';

        const parts = [];
        for (let element = headingElement.nextElementSibling; element; element = element.nextElementSibling) {
            if (/^H[1-6]$/.test(element.tagName)) break;
            parts.push(prose(element));
        }
        return parts.filter(Boolean).join('\n\n');
    }

    function detailFields(detailPage) {
        const about = sectionText(detailPage, 'About this opportunity');
        const eligibilityInfo = sectionText(detailPage, 'Eligibility Info');
        const fields = {
            deadline: detailValue(detailPage, 'Submission Deadline'),
            feeDetails: detailValue(detailPage, 'Entry Fee'),
            type: detailValue(detailPage, 'Type'),
            eligibility: detailValue(detailPage, 'Eligibility'),
            location: detailValue(detailPage, 'Location'),
            organization: detailValue(detailPage, 'Organization'),
            eventDates: detailValue(detailPage, 'Event Dates'),
            awardInfo: detailValue(detailPage, 'Award Info'),
            categories: detailValue(detailPage, 'Categories')
        };
        const supportingDetails = [
            fields.organization && `Organization: ${fields.organization}`,
            eligibilityInfo && `Eligibility details: ${eligibilityInfo}`,
            fields.eventDates && `Event dates: ${fields.eventDates}`,
            fields.awardInfo && `Award: ${fields.awardInfo}`,
            fields.categories && `Categories: ${fields.categories}`
        ].filter(Boolean);
        return {
            ...fields,
            eligibilityDetails: eligibilityInfo,
            description: [...supportingDetails, about].filter(Boolean).join('\n\n')
        };
    }

    async function learnMoreUrl(card, pageUrl) {
        const listingAnchor = card.querySelector('a[href^="/call-for-entry/"] h3')?.closest('a');
        if (!listingAnchor) return null;

        const listingUrl = new URL(listingAnchor.getAttribute('href'), pageUrl).href;
        const response = await fetch(listingUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`${response.status} while loading ${listingUrl}`);

        const detailPage = new DOMParser().parseFromString(await response.text(), 'text/html');
        const learnMore = [...detailPage.querySelectorAll('a[href]')].find((anchor) => {
            const labels = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.getAttribute('title')]
                .map(text)
                .filter(Boolean);
            return labels.some((label) => /^learn more(?:\s*[→›»])?$/i.test(label));
        });
        if (!learnMore) return { listingUrl, externalUrl: '' };

        const externalUrl = new URL(learnMore.getAttribute('href'), listingUrl).href;
        return {
            listingUrl,
            externalUrl: isArtworkArchive(new URL(externalUrl).hostname) ? '' : externalUrl,
            details: detailFields(detailPage)
        };
    }

    async function mapWithConcurrency(items, limit, mapper) {
        const results = new Array(items.length);
        let nextIndex = 0;
        async function worker(workerIndex) {
            while (nextIndex < items.length) {
                const index = nextIndex;
                nextIndex += 1;
                /* Stagger starts within the small worker pool so the source
                   does not receive a burst of identical detail-page requests. */
                if (workerIndex) await pause(workerIndex * DETAIL_START_STAGGER_MS);
                results[index] = await mapper(items[index], index);
            }
        }
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, (_, index) => worker(index)));
        return results;
    }

    while (url && !visited.has(url.href)) {
        visited.add(url.href);
        console.log(`Nova: collecting ${url.href}`);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`${response.status} while loading ${url.href}`);

        const documentForPage = new DOMParser().parseFromString(await response.text(), 'text/html');
        const cards = [...documentForPage.querySelectorAll('article')]
            .filter((card) => card.querySelector('a[href^="/call-for-entry/"] h3'));
        if (!cards.length) throw new Error(`No opportunities found on ${url.href}`);

        const resolvedCards = await mapWithConcurrency(cards, DETAIL_CONCURRENCY, async (card) => {
            const name = text(card.querySelector('h3')?.textContent);
            console.log(`Nova: resolving ${name}`);
            const resolved = await learnMoreUrl(card, url.href);
            return { card, name, resolved };
        });

        const exportedCards = [];
        for (const { card, name, resolved } of resolvedCards) {
            if (!resolved?.externalUrl) {
                unresolved.push({ name, listingUrl: resolved?.listingUrl || '' });
                continue;
            }
            const exported = card.cloneNode(true);
            exported.setAttribute('data-nova-link', resolved.externalUrl);
            exported.setAttribute('data-nova-source-link', resolved.listingUrl);
            for (const [key, value] of Object.entries(resolved.details)) {
                if (value) exported.setAttribute(`data-nova-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value);
            }
            exportedCards.push(exported);
        }
        if (!exportedCards.length) throw new Error(`No Learn More links found on ${url.href}`);
        pages.push({ url: url.href, html: exportedCards.map((card) => card.outerHTML).join('\n') });

        const currentPage = Number(url.searchParams.get('page') || 1);
        const next = [...documentForPage.querySelectorAll('a[href*="page="]')]
            .map((link) => new URL(link.getAttribute('href'), url))
            .find((candidate) => Number(candidate.searchParams.get('page')) === currentPage + 1);
        url = next || null;
        if (url) await pause(LISTING_PAGE_DELAY_MS);
    }

    const payload = {
        source: 'artwork_archive',
        captured_at: new Date().toISOString(),
        pages,
        unresolved
    };
    const collectedCount = pages.reduce((total, page) => total + new DOMParser()
        .parseFromString(page.html, 'text/html')
        .querySelectorAll('article').length, 0);
    const downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), {
        href: downloadUrl,
        download: `nova-artwork-archive-${new Date().toISOString().slice(0, 10)}.json`
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1_000);
    alert(`Nova collected ${collectedCount} opportunities from ${pages.length} pages.${unresolved.length ? ` ${unresolved.length} had no external Learn More link and were skipped.` : ''}`);
})().catch((error) => {
    console.error(error);
    alert(`Nova collection failed: ${error.message}`);
});
