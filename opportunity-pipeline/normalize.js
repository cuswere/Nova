import crypto from 'node:crypto';
import { ALLOWED_TYPES } from './config.js';

const MONTHS = new Map([
    ['jan', 0], ['january', 0], ['feb', 1], ['february', 1], ['mar', 2], ['march', 2],
    ['apr', 3], ['april', 3], ['may', 4], ['jun', 5], ['june', 5], ['jul', 6],
    ['july', 6], ['aug', 7], ['august', 7], ['sep', 8], ['sept', 8], ['september', 8],
    ['oct', 9], ['october', 9], ['nov', 10], ['november', 10], ['dec', 11], ['december', 11]
]);

export function canonicalizeUrl(value) {
    try {
        const url = new URL(String(value).trim());
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|ref$|ref_|source$|mc_)/i.test(key)) url.searchParams.delete(key);
        }
        url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
        if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
        return url.toString();
    } catch {
        return '';
    }
}

// Returns 'YYYY-MM-DD' only when the components form a real calendar date;
// rejects impossible values (e.g. 2026-02-31) instead of silently rolling them over.
export function validCalendarDate(year, monthIndex, day) {
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return '';
    const date = new Date(year, monthIndex, day);
    if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return '';
    return formatDate(date);
}

export function normalizeDeadline(value) {
    const text = String(value || '').replace(/^deadline\s*:\s*/i, '').trim();
    if (!text) return '';
    if (/rolling|ongoing|no deadline/i.test(text)) return 'Rolling';

    const iso = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (iso) return validCalendarDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
    if (numeric) return validCalendarDate(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]));

    // Date ranges resolve to the end date. Handle these before the general parser,
    // which would otherwise misread strings such as "October 1-29, 2026".
    // Same-month day range: "October 1-29, 2026" -> October 29, 2026.
    const sameMonth = text.match(/\b([A-Za-z]+)\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i);
    if (sameMonth) {
        const month = MONTHS.get(sameMonth[1].toLowerCase());
        // A recognized month-name range is authoritative: reject impossible days rather
        // than letting the general parser roll them over into the next month.
        if (month !== undefined) return validCalendarDate(Number(sameMonth[3]), month, Number(sameMonth[2]));
    }

    // Any full "Month day, year" dates (covers cross-month ranges); the last one wins.
    const fullDates = [...text.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi)];
    if (fullDates.length) {
        const last = fullDates.at(-1);
        const month = MONTHS.get(last[1].toLowerCase());
        if (month !== undefined) return validCalendarDate(Number(last[3]), month, Number(last[2]));
    }

    return '';
}

export function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatPublicDeadline(value) {
    const normalized = normalizeDeadline(value);
    if (!normalized || normalized === 'Rolling') return normalized;
    const [year, month, day] = normalized.split('-').map(Number);
    return `${month}/${day}/${year}`;
}

export function isExpired(deadline, today = new Date()) {
    if (!deadline || deadline === 'Rolling') return false;
    const parsed = new Date(`${deadline}T23:59:59`);
    if (Number.isNaN(parsed.getTime())) return false;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return parsed < start;
}

export function inferType(name = '', description = '') {
    const text = `${name} ${description}`.toLowerCase();
    if (/public art|commission|request for qualifications|\brfq\b/.test(text)) return 'Commission';
    if (/residen|artist colony|studio program/.test(text)) return 'Residency';
    if (/fellowship/.test(text)) return 'Fellowship';
    if (/grant|funding|emergency relief|microgrant/.test(text)) return 'Grant';
    if (/prize|award|competition/.test(text)) return 'Award';
    if (/acquisition|purchase program/.test(text)) return 'Acquisition';
    if (/\bopen call\b|\bcall for\b[^.]{0,40}\b(?:artists?|entries|submissions)\b/.test(text)) return 'Open Call';
    if (/exhibition|biennial|triennial|juried show/.test(text)) return 'Exhibition';
    return '';
}

export function normalizeType(value, name = '', description = '') {
    const raw = String(value || '').trim();
    const direct = ALLOWED_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
    if (direct) return direct;
    const inferred = inferType(name, description);
    // Artwork Archive groups grants and fellowships into one non-public bucket.
    // Prefer an explicit title signal, then use Grant as the conservative fallback.
    if (/^grants?\s*&\s*fellowships?$/i.test(raw)) return inferred || 'Grant';
    return inferred;
}

export function inferFee(text = '') {
    if (/\b(no|zero)\s+(?:application|entry|submission)?\s*fee\b|(?:application|entry|submission)?\s*fee\s*:\s*\$?0\b|free to (?:apply|enter|submit)/i.test(text)) return 'n';
    // Anchored to the word "fee" so award/stipend amounts are never read as a fee.
    if (/\b(?:application|entry|submission)\s+fee\b[^.\n]{0,40}(?:\$|€|£|CAD|USD|EUR)\s?\d/i.test(text) ||
        /\b(?:application|entry|submission)?\s*fee\s*:?\s*(?:\$|€|£|CAD|USD|EUR)\s?\d/i.test(text) ||
        /(?:\$|€|£)\s?\d[\d,]*\s*(?:application|entry|submission)?\s*fee\b/i.test(text) ||
        /\bfee\b[^.\n]{0,20}(?:\$|€|£)\s?\d/i.test(text)) return 'y';
    return '';
}

export function normalizeCountry(value = '') {
    const text = String(value).trim();
    if (!text) return '';
    if (/international|worldwide|all countries|global/i.test(text)) return 'International';
    if (/^(u\.?s\.?a?|united states of america)$/i.test(text)) return 'United States';
    if (/^u\.?k\.?$/i.test(text)) return 'United Kingdom';
    return text.replace(/\buk\b/gi, 'United Kingdom').replace(/\busa\b/gi, 'United States');
}

export function makeId(candidate) {
    const title = String(candidate.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const key = `${canonicalizeUrl(candidate.link)}|${title}|${candidate.deadline || ''}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
}

export function normalizeCandidate(raw, now = new Date()) {
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
    const link = canonicalizeUrl(raw.link || raw.sourceUrl);
    const deadline = normalizeDeadline(raw.deadline);
    const description = String(raw.description || '').replace(/\s+/g, ' ').trim();
    const candidate = {
        name,
        deadline,
        link,
        type: normalizeType(raw.type, name, description),
        fees: ['y', 'n'].includes(String(raw.fees || '').toLowerCase()) ? String(raw.fees).toLowerCase() : inferFee(`${description} ${raw.feeDetails || ''}`),
        country: normalizeCountry(raw.country),
        award_info: String(raw.awardInfo || raw.award_info || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        status: 'review',
        source: raw.source || '',
        source_url: canonicalizeUrl(raw.sourceUrl || raw.link),
        host_location: String(raw.hostLocation || '').trim(),
        fee_details: String(raw.feeDetails || '').trim(),
        confidence: Number(raw.confidence || 0.55).toFixed(2),
        last_seen: formatDate(now),
        checked_at: now.toISOString(),
        issue: '',
        description,
        eligibility_details: String(raw.eligibilityDetails || raw.eligibility_details || '').trim()
    };
    const issues = String(raw.issue || '').split(';').map((issue) => issue.trim()).filter(Boolean);
    if (!name) issues.push('missing name');
    if (!link) issues.push('invalid link');
    if (!deadline) issues.push('missing deadline');
    if (!candidate.type) issues.push('unresolved type');
    if (!candidate.fees) issues.push('unresolved application fee');
    if (!candidate.country) issues.push('unresolved eligibility');
    candidate.issue = issues.join('; ');
    candidate.id = makeId(candidate);
    if (deadline && isExpired(deadline, now)) candidate.status = 'expired';
    return candidate;
}

export function validatePublishable(row, now = new Date()) {
    const errors = [];
    if (!row.name) errors.push('name');
    if (!canonicalizeUrl(row.link)) errors.push('link');
    if (!normalizeDeadline(row.deadline)) errors.push('deadline');
    if (!ALLOWED_TYPES.some((type) => type.toLowerCase() === String(row.type || '').trim().toLowerCase())) errors.push('type');
    if (!['y', 'n'].includes(String(row.fees).toLowerCase())) errors.push('fees');
    if (!row.country) errors.push('country');
    if (isExpired(normalizeDeadline(row.deadline), now)) errors.push('expired');
    return errors;
}
