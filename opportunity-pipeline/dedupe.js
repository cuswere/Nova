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

export function areSameOpportunity(left, right) {
    const leftTitle = normalizedTitle(left.name);
    const rightTitle = normalizedTitle(right.name);
    if (!leftTitle || !rightTitle) return false;

    const leftLink = canonicalizeUrl(left.link);
    const rightLink = canonicalizeUrl(right.link);
    const leftDeadline = normalizeDeadline(left.deadline);
    const rightDeadline = normalizeDeadline(right.deadline);
    const compatibleDeadlines = !leftDeadline || !rightDeadline || leftDeadline === rightDeadline ||
        leftDeadline === 'Rolling' || rightDeadline === 'Rolling';
    if (leftTitle === rightTitle && leftDeadline && leftDeadline === rightDeadline) return true;
    if (leftLink && rightLink && leftLink === rightLink && compatibleDeadlines &&
        (leftTitle === rightTitle || titleOverlap(left.name, right.name) >= 0.65)) return true;

    // Hyperallergic regenerates short links between monthly roundups. Within that
    // source, an exact normalized title is the stable identity.
    if (isHyperallergic(left) && isHyperallergic(right) && leftTitle === rightTitle) return true;

    // Cross-source roundups can title the same dated opportunity slightly
    // differently (for example Bennett Prize cycle/edition labels). Apply the
    // relaxed comparison only when Hyperallergic is one side and deadlines match.
    if (isHyperallergic(left) !== isHyperallergic(right) &&
        leftDeadline && leftDeadline === rightDeadline) {
        const leftCore = titleCore(left.name);
        const rightCore = titleCore(right.name);
        if (leftCore && leftCore.split(' ').length >= 2 && leftCore === rightCore) return true;
    }

    return false;
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
    return informationScore(right) >= informationScore(left) ? right : left;
}

export function deduplicateCandidates(rows) {
    const selected = [];
    for (const row of rows) {
        const index = selected.findIndex((current) => areSameOpportunity(current, row));
        if (index === -1) selected.push(row);
        else selected[index] = preferCandidate(selected[index], row);
    }
    return selected;
}
