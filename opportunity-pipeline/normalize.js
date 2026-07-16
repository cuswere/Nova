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

export function normalizeDeadline(value) {
    const text = String(value || '').replace(/^deadline\s*:\s*/i, '').trim();
    if (!text) return '';
    if (/rolling|ongoing|no deadline/i.test(text)) return 'Rolling';
    const iso = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const native = new Date(text);
    if (!Number.isNaN(native.getTime())) return formatDate(native);

    const match = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/);
    if (!match) return '';
    const month = MONTHS.get(match[1].toLowerCase());
    if (month === undefined) return '';
    return formatDate(new Date(Number(match[3]), month, Number(match[2])));
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
    if (/public art|commission|request for qualifications|\brfq\b/.test(text)) return 'Public Art';
    if (/residen|artist colony|studio program/.test(text)) return 'Residency';
    if (/fellowship/.test(text)) return 'Fellowship';
    if (/grant|funding|emergency relief|microgrant/.test(text)) return 'Grant';
    if (/prize|award|competition/.test(text)) return 'Award';
    if (/acquisition|purchase program/.test(text)) return 'Acquisition';
    if (/exhibition|biennial|triennial|juried show|open call/.test(text)) return 'Exhibition';
    return 'Other';
}

export function normalizeType(value, name = '', description = '') {
    const raw = String(value || '').trim();
    const direct = ALLOWED_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
    if (direct) return direct;
    if (raw) return raw;
    return inferType(name, `${value || ''} ${description}`);
}

export function inferFee(text = '') {
    if (/\b(no|zero) (application|entry|submission) fee\b|application fee\s*:\s*\$?0\b|free to apply/i.test(text)) return 'n';
    if (/\b(application|entry|submission) fee\b[^.\n]{0,40}(\$|€|£|CAD|USD|EUR)\s?\d|application fee\s*:\s*(?!\$?0\b)/i.test(text)) return 'y';
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

export function isVisualArtsCore(candidate) {
    const text = `${candidate.name || ''} ${candidate.description || ''}`.toLowerCase();
    if (/\b(job|employment|degree program|workshop|class|course)\b/.test(text)) return false;
    if (/writer|writing|poetry|literary|dance|theat(?:er|re)|music|composer/.test(text) &&
        !/visual|artist|art |arts |media|film|photograph|design|curator|sculpt|paint|craft/.test(text)) return false;
    return /artist| art|arts|visual|media|film|photograph|design|curator|sculpt|paint|craft|residen|grant|exhibition|fellowship|award|prize|public/.test(text);
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
    const description = String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const candidate = {
        name,
        deadline,
        link,
        type: normalizeType(raw.type, name, description),
        fees: ['y', 'n'].includes(String(raw.fees || '').toLowerCase()) ? String(raw.fees).toLowerCase() : inferFee(`${description} ${raw.feeDetails || ''}`),
        country: normalizeCountry(raw.country),
        status: 'review',
        source: raw.source || '',
        source_url: canonicalizeUrl(raw.sourceUrl || raw.link),
        host_location: String(raw.hostLocation || '').trim(),
        fee_details: String(raw.feeDetails || '').trim(),
        confidence: Number(raw.confidence || 0.55).toFixed(2),
        last_seen: formatDate(now),
        checked_at: now.toISOString(),
        issue: '',
        description
    };
    const issues = [];
    if (!name) issues.push('missing name');
    if (!link) issues.push('invalid link');
    if (!deadline) issues.push('missing deadline');
    if (!candidate.fees) issues.push('unresolved application fee');
    if (!candidate.country) issues.push('unresolved eligibility');
    if (!isVisualArtsCore(candidate)) issues.push('outside visual-arts scope');
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
    if (!String(row.type || '').trim()) errors.push('type');
    if (!['y', 'n'].includes(String(row.fees).toLowerCase())) errors.push('fees');
    if (!row.country) errors.push('country');
    if (isExpired(normalizeDeadline(row.deadline), now)) errors.push('expired');
    return errors;
}
