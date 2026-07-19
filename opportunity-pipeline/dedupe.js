import { canonicalizeUrl, normalizeDeadline } from './normalize.js';

function normalizedTitle(value = '') {
    return String(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleCore(value = '') {
    return normalizedTitle(value)
        .split(' ')
        .filter((token) => token &&
            !/^(?:the|20\d{2}|\d+|annual|award|cycle|edition|round|call|for|applications?)$/.test(token))
        .map((token) => token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.replace(/s$/, ''))
        .join(' ');
}

function titleOverlap(left, right) {
    const leftTokens = new Set(titleCore(left).split(' ').filter(Boolean));
    const rightTokens = new Set(titleCore(right).split(' ').filter(Boolean));
    if (!leftTokens.size || !rightTokens.size) return 0;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return shared / Math.min(leftTokens.size, rightTokens.size);
}

function isHyperallergic(row) {
    return /^hyperallergic$/i.test(String(row.source || '').trim());
}

function isArtworkArchive(row) {
    return /^artwork archive$/i.test(String(row.source || '').trim());
}

function contentOverlap(left, right) {
    const tokens = (value) => new Set(String(value || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(' ')
        .filter((token) => token.length >= 5 && !/^(?:artist|artists|application|opportunity|program|eligible|eligibility)$/.test(token)));
    const leftTokens = tokens(`${left.description || ''} ${left.eligibility_details || ''}`);
    const rightTokens = tokens(`${right.description || ''} ${right.eligibility_details || ''}`);
    if (!leftTokens.size || !rightTokens.size) return 0;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return shared / Math.min(leftTokens.size, rightTokens.size);
}

function hostKey(value = '') {
    try {
        const labels = new URL(value).hostname.replace(/^www\./, '').split('.');
        const label = labels.length > 2 && /^(?:apply|forms?|opportunities|artist)$/.test(labels[0]) ? labels[1] : labels[0];
        return label.replace(/(?:foundation|project|gallery|museum|arts?|studio|residency)$/i, '');
    } catch {
        return '';
    }
}

function distinctApplicantTracks(left, right) {
    const labels = ['national', 'regional', 'international', 'spanish', 'teaching', 'community', 'photography', 'music'];
    const leftLabels = labels.filter((label) => new RegExp(`\\b${label}\\b`, 'i').test(left.name));
    const rightLabels = labels.filter((label) => new RegExp(`\\b${label}\\b`, 'i').test(right.name));
    return leftLabels.length && rightLabels.length && !leftLabels.some((label) => rightLabels.includes(label));
}

export function duplicateReason(left, right) {
    const leftTitle = normalizedTitle(left.name);
    const rightTitle = normalizedTitle(right.name);
    if (!leftTitle || !rightTitle) return '';
    const leftLink = canonicalizeUrl(left.link);
    const rightLink = canonicalizeUrl(right.link);
    const leftDeadline = normalizeDeadline(left.deadline);
    const rightDeadline = normalizeDeadline(right.deadline);
    const compatibleDeadlines = !leftDeadline || !rightDeadline || leftDeadline === rightDeadline ||
        leftDeadline === 'Rolling' || rightDeadline === 'Rolling';
    const exactDeadline = leftDeadline && leftDeadline === rightDeadline;
    const titleScore = titleOverlap(left.name, right.name);
    const evidenceScore = contentOverlap(left, right);
    const sameHost = hostKey(leftLink) && hostKey(leftLink) === hostKey(rightLink);
    const sameSource = String(left.source || '').trim().toLowerCase() === String(right.source || '').trim().toLowerCase();

    if (isArtworkArchive(left) && isArtworkArchive(right)) {
        const leftIdentity = canonicalizeUrl(left.source_url || left.sourceListingUrl);
        const rightIdentity = canonicalizeUrl(right.source_url || right.sourceListingUrl);
        if (leftIdentity && rightIdentity && leftIdentity === rightIdentity) return 'same_source_identity';
        if (distinctApplicantTracks(left, right)) return '';
        if (leftLink && leftLink === rightLink && compatibleDeadlines && (titleScore >= 0.55 || evidenceScore >= 0.8)) return 'same_source_content';
        if (sameHost && compatibleDeadlines && titleScore >= 0.8) return 'same_source_program';
        if (sameHost && compatibleDeadlines && (leftDeadline === 'Rolling') !== (rightDeadline === 'Rolling') && titleScore >= 0.5) return 'dated_cycle_supersedes_rolling';
        if (exactDeadline && evidenceScore >= 0.92) return 'same_source_content';
        return '';
    }

    if (sameSource && distinctApplicantTracks(left, right)) return '';
    if (leftTitle === rightTitle && compatibleDeadlines) return 'exact_title';
    // Shared organizer/application pages are common within a source. Require
    // substantially stronger evidence than a shared URL before collapsing them.
    if (sameSource) {
        if (leftLink && leftLink === rightLink && compatibleDeadlines && (titleScore >= 0.75 || evidenceScore >= 0.85)) return 'same_source_content';
        if (sameHost && compatibleDeadlines && titleScore >= 0.85) return 'same_source_program';
        return '';
    }
    if (leftLink && leftLink === rightLink && compatibleDeadlines && (titleScore >= 0.4 || evidenceScore >= 0.5)) return 'exact_link';
    if (sameHost && compatibleDeadlines && titleScore >= 0.65) return 'same_program';
    const shorterTitle = leftTitle.length <= rightTitle.length ? leftTitle : rightTitle;
    const longerTitle = leftTitle.length > rightTitle.length ? leftTitle : rightTitle;
    if (exactDeadline && shorterTitle.split(' ').length >= 3 && longerTitle.includes(shorterTitle)) return 'cross_source_title';
    const sharedCoreTokens = titleCore(left.name).split(' ').filter((token) => titleCore(right.name).split(' ').includes(token));
    if (exactDeadline && titleScore >= 0.75 && sharedCoreTokens.length >= 2) return 'cross_source_title';

    if (isHyperallergic(left) && isHyperallergic(right) && leftTitle === rightTitle) return 'hyperallergic_title';
    if (isHyperallergic(left) !== isHyperallergic(right) && exactDeadline) {
        const leftCore = titleCore(left.name);
        const rightCore = titleCore(right.name);
        if (leftCore && leftCore.split(' ').length >= 2 && leftCore === rightCore) return 'cross_source_title';
    }
    return '';
}

export function areSameOpportunity(left, right) {
    return Boolean(duplicateReason(left, right));
}

function informationScore(row) {
    const populated = [
        'deadline', 'type', 'fees', 'country', 'award_info', 'host_location',
        'fee_details', 'eligibility_details', 'description'
    ].reduce((total, field) => total + (String(row[field] || '').trim() ? 1 : 0), 0);
    const evidenceLength = String(row.description || '').length + String(row.eligibility_details || '').length;
    const sourcePreference = /^creative capital$/i.test(String(row.source || '').trim()) ? -10_000 : 0;
    return sourcePreference + populated * 1_000 + Math.min(evidenceLength, 999);
}

export function preferCandidate(left, right) {
    const leftDeadline = normalizeDeadline(left.deadline);
    const rightDeadline = normalizeDeadline(right.deadline);
    if (leftDeadline === 'Rolling' && rightDeadline && rightDeadline !== 'Rolling') return right;
    if (rightDeadline === 'Rolling' && leftDeadline && leftDeadline !== 'Rolling') return left;
    return informationScore(right) >= informationScore(left) ? right : left;
}

export function deduplicateCandidates(rows) {
    return deduplicateCandidatesWithSummary(rows).candidates;
}

export function deduplicateCandidatesWithSummary(rows) {
    const selected = [];
    const excludedByReason = {};
    for (const row of rows) {
        const index = selected.findIndex((current) => duplicateReason(current, row));
        if (index === -1) selected.push(row);
        else {
            const reason = duplicateReason(selected[index], row);
            excludedByReason[reason] = (excludedByReason[reason] || 0) + 1;
            selected[index] = preferCandidate(selected[index], row);
        }
    }
    return { candidates: selected, excludedByReason };
}
