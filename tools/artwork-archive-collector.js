(async () => {
    if (!/(^|\.)artworkarchive\.com$/.test(location.hostname) || location.pathname.replace(/\/+$/, '') !== '/call-for-entry') {
        throw new Error('Run this from https://www.artworkarchive.com/call-for-entry');
    }

    const pages = [];
    const unresolved = [];
    const visited = new Set();
    let url = new URL('/call-for-entry', location.origin);

    const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isArtworkArchive = (hostname) => /(^|\.)artworkarchive\.com$/i.test(hostname);

    function detailValue(detailPage, label) {
        const term = [...detailPage.querySelectorAll('dt')]
            .find((element) => text(element.textContent).replace(/:$/, '') === label);
        if (term) return text(term.nextElementSibling?.textContent);

        const labelElement = [...detailPage.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,p,span,div')]
            .find((element) => !element.children.length && text(element.textContent).replace(/:$/, '') === label);
        return text(labelElement?.nextElementSibling?.textContent);
    }

    function sectionText(detailPage, heading) {
        const headingElement = [...detailPage.querySelectorAll('h1,h2,h3,h4,h5,h6')]
            .find((element) => text(element.textContent) === heading);
        if (!headingElement) return '';

        const parts = [];
        for (let element = headingElement.nextElementSibling; element; element = element.nextElementSibling) {
            if (/^H[1-6]$/.test(element.tagName)) break;
            parts.push(text(element.textContent));
        }
        return text(parts.join(' '));
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
            description: text([...supportingDetails, about].join(' '))
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

    while (url && !visited.has(url.href)) {
        visited.add(url.href);
        console.log(`Nova: collecting ${url.href}`);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`${response.status} while loading ${url.href}`);

        const documentForPage = new DOMParser().parseFromString(await response.text(), 'text/html');
        const cards = [...documentForPage.querySelectorAll('article')]
            .filter((card) => card.querySelector('a[href^="/call-for-entry/"] h3'));
        if (!cards.length) throw new Error(`No opportunities found on ${url.href}`);

        const exportedCards = [];
        for (const card of cards) {
            const name = text(card.querySelector('h3')?.textContent);
            console.log(`Nova: resolving ${name}`);
            const resolved = await learnMoreUrl(card, url.href);
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
            await pause(250);
        }
        if (!exportedCards.length) throw new Error(`No Learn More links found on ${url.href}`);
        pages.push({ url: url.href, html: exportedCards.map((card) => card.outerHTML).join('\n') });

        const currentPage = Number(url.searchParams.get('page') || 1);
        const next = [...documentForPage.querySelectorAll('a[href*="page="]')]
            .map((link) => new URL(link.getAttribute('href'), url))
            .find((candidate) => Number(candidate.searchParams.get('page')) === currentPage + 1);
        url = next || null;
        if (url) await new Promise((resolve) => setTimeout(resolve, 750));
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
