import crypto from 'node:crypto';
import { ALLOWED_TYPES, SOURCE_DEFINITIONS } from './config.js';
import { htmlToText } from './eligibility.js';

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
            if (/^(?:utm_|ref$|ref_|source$|mc_|gclid$|gbraid$|fbclid$|msclkid$|gad_|hsa_)/i.test(key)) url.searchParams.delete(key);
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

    // Google Sheets stores dates as days since 1899-12-30. Older USER_ENTERED
    // imports can therefore be read back as values such as 46236.
    if (/^\d{5}$/.test(text)) {
        const serial = Number(text);
        if (serial >= 30_000 && serial <= 80_000) {
            return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
        }
    }

    const iso = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
    if (iso) return validCalendarDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const numeric = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})$/);
    if (numeric) return validCalendarDate(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]));

    const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(20\d{2})\b/i);
    if (dayFirst) {
        const month = MONTHS.get(dayFirst[2].toLowerCase());
        if (month !== undefined) return validCalendarDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
    }

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
    const title = String(name).toLowerCase();
    const text = `${name} ${description}`.toLowerCase();
    if (/public art|commission|request for qualifications|\brfq\b|\bmural\b|artist pool/.test(text)) return 'Commission';
    if (/\bopen[- ]call\b|\bcall for\b[^.]{0,40}\b(?:artists?|entries|submissions)\b/.test(title)) return 'Open Call';
    // Do not match the "residen" stem: it appears in ordinary eligibility
    // prose such as "Rhode Island residents". Require actual program terms.
    if (/\b(?:residency|residencies|artist[- ]in[- ]residence|artist colony|studio program)\b/.test(text)) return 'Residency';
    if (/fellowship/.test(text)) return 'Fellowship';
    if (/grant|funding|emergency relief|microgrant/.test(text)) return 'Grant';
    if (/prize|award|competition/.test(text)) return 'Award';
    if (/acquisition|purchase program/.test(text)) return 'Acquisition';
    if (/\bopen call\b|\bcall for\b[^.]{0,40}\b(?:artists?|entries|submissions)\b/.test(text)) return 'Open Call';
    if (/exhibition|biennial|triennial|juried show/.test(text)) return 'Exhibition';
    if (/\bworkshop\b|\bcourse\b|\btuition\b|training program|development year/.test(text)) return 'Workshop';
    return '';
}

export function inferTitleType(name = '') {
    const title = String(name).toLowerCase();
    // A title can contain more than one valid category word. Treat the final
    // explicit opportunity key as the tie-breaker: "Grant Wood Fellowship" is
    // a fellowship, while "Open Call: Mural Commission" is a commission. This
    // deliberately excludes a bare "course", which is often part of a venue
    // name (for example, a golf course) rather than an opportunity type.
    const signals = [
        ['Commission', /public art|commission|request for (?:qualifications|proposals)|\brfq\b|\bmural\b|artist pool/g],
        ['Grant', /\b(?:emergency relief|microgrant|grants?)\b/g],
        ['Fellowship', /\bfellowship\b/g],
        ['Residency', /\b(?:artist[- ]in[- ]residence|residenc(?:y|ies))\b/g],
        ['Award', /\b(?:prize|award)\b/g],
        ['Open Call', /\bopen[- ]call\b|\bcall for\b[^.]{0,40}\b(?:artists?|entries|submissions)\b/g],
        ['Exhibition', /\b(?:exhibition|biennial|triennial|juried show)\b/g],
        ['Workshop', /\bworkshop\b|\btraining (?:course|program)\b|\b(?:online|intensive|development) course\b/g]
    ];
    let result = '';
    let lastIndex = -1;
    for (const [type, pattern] of signals) {
        for (const match of title.matchAll(pattern)) {
            if (match.index > lastIndex) {
                result = type;
                lastIndex = match.index;
            }
        }
    }
    return result;
}

export function normalizeType(value, name = '', description = '', source = '') {
    const raw = String(value || '').trim();
    // Artwork Archive uses this category for civic commissions and public-art
    // calls. It is valid source metadata but not a public Nova type label.
    const sourceMappedType = /^artwork archive$/i.test(String(source).trim()) &&
        /^public art\s*(?:&|and)\s*proposals?$/i.test(raw) ? 'Commission' : '';
    const direct = sourceMappedType || ALLOWED_TYPES.find((type) => type.toLowerCase() === raw.toLowerCase());
    const titleType = inferTitleType(name);
    if (direct) {
        // Artwork Archive, Creative West, and other sources provide usable
        // type metadata. Preserve it. Creative Capital is the deliberate
        // exception: its reviewed categories are often broad or incorrect,
        // so a direct, explicit title signal may correct it.
        if (/^creative capital$/i.test(String(source).trim()) && titleType && titleType !== direct) return titleType;
        return direct;
    }
    const inferred = inferType(name, description);
    // Artwork Archive groups grants and fellowships into one non-public bucket.
    // Prefer an explicit title signal, then use Grant as the conservative fallback.
    if (/^grants?\s*&\s*fellowships?$/i.test(raw)) return titleType || inferred || 'Grant';
    return titleType || inferred;
}

export function inferFee(text = '') {
    if (/\b(?:no|zero)\b[^.\n]{0,25}\b(?:application|entry|submission|jury)(?:\s+\w+){0,2}\s+fees?\b|\b(?:no|zero)\s+(?:application|entry|submission)?\s*fees?\b|(?:application|entry|submission)?\s*fee\s*:\s*\$?0\b|free to (?:apply|enter|submit)/i.test(text)) return 'n';
    // Anchored to the word "fee" so award/stipend amounts are never read as a fee.
    if (/\b(?:application|entry|submission)\s+fee\b[^.\n]{0,40}(?:\$|€|£|CAD|USD|EUR)\s?\d/i.test(text) ||
        /\b(?:application|entry|submission)?\s*fee\s*:?\s*(?:\$|€|£|CAD|USD|EUR)\s?\d/i.test(text) ||
        /(?:\$|€|£)\s?\d[\d,]*\s*(?:application|entry|submission)?\s*fee\b/i.test(text) ||
        /\bfee\b[^.\n]{0,20}(?:\$|€|£)\s?\d/i.test(text)) return 'y';
    if (/\b(?:application|entry|submission)\s+fee\b[^.\n]{0,30}\d[\d,.]*\s+(?:US Dollars?|USD|Canadian Dollars?|CAD|Euros?|EUR|Pounds?|GBP)\b/i.test(text)) return 'y';
    return '';
}

export function inferFeeDetails(text = '') {
    const amount = String.raw`(?:(?:USD|AUD|CAD|GBP|EUR)\s*(?:[$€£]\s*)?\d[\d,.]*|[$€£]\s*\d[\d,.]*(?:\s*(?:USD|AUD|CAD|GBP|EUR))?|\d[\d,.]*\s+(?:US Dollars?|USD|Australian Dollars?|AUD|Canadian Dollars?|CAD|Euros?|EUR|Pounds?|GBP)(?:\s*\([^)]*\))?)`;
    const label = String.raw`(?:(?:application|entry|submission)\s+)?fees?`;
    const patterns = [
        new RegExp(`(${amount}\\s+${label}\\b)`, 'i'),
        new RegExp(`(${label}\\b[^.!?\\n]{0,40}?${amount})`, 'i')
    ];
    for (const pattern of patterns) {
        const match = String(text || '').match(pattern)?.[1];
        if (match) return match.replace(/\s+/g, ' ').replace(/[.,;:]$/, '').trim();
    }
    return '';
}

function normalizeMultilineText(value = '') {
    return htmlToText(value).text;
}

export function inferAwardInfo(text = '') {
    // Keep source line breaks inside a qualifying clause. Creative West often
    // represents headings and benefit lists as block elements without terminal
    // punctuation; excluding newlines here would discard that useful structure.
    const clauses = String(text || '').match(/[^.!?]+[.!?]?/g) || [];
    const amount = /(?:USD|AUD|CAD|GBP|EUR)?\s*(?:\$|£|€)\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:USD|AUD|CAD|GBP|EUR)\b/i;
    const label = /\b(?:award|budget|grant|stipend|honorarium|prize|project funds?|commission budget)\b/i;
    return clauses
        .map(normalizeMultilineText)
        .filter((clause) => amount.test(clause) && label.test(clause))
        .filter((clause) => !/\b(?:tuition|residency cost|for sale|sales price)\b/i.test(clause) || /\b(?:award|stipend|honorarium|grant)\b/i.test(clause))
        .slice(0, 2)
        .join('\n\n');
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
    const name = String(raw.name || '').replace(/\s+/g, ' ').trim()
        .replace(/^CC\/AA\s+/i, '')
        .replace(/\bHV award\b/i, (match) => /\bVH AWARD\b/i.test(String(raw.description || '')) ? match.replace(/HV/i, 'VH') : match);
    const link = canonicalizeUrl(raw.link || raw.sourceUrl);
    const deadline = normalizeDeadline(raw.deadline);
    const rawDescription = String(raw.description || '');
    const description = normalizeMultilineText(rawDescription);
    const candidate = {
        name,
        deadline,
        link,
        type: normalizeType(raw.type, name, description, raw.source),
        fees: (['y', 'n'].includes(String(raw.fees || '').toLowerCase()) ?
            String(raw.fees).toLowerCase() : inferFee(`${description} ${raw.feeDetails || ''}`)),
        country: normalizeCountry(raw.country),
        award_info: normalizeMultilineText(raw.awardInfo || raw.award_info || inferAwardInfo(rawDescription)),
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
        eligibility_details: normalizeMultilineText(raw.eligibilityDetails || raw.eligibility_details),
        eligibility_tier: String(raw.eligibilityTier || raw.eligibility_tier || '').trim()
    };
    const issues = String(raw.issue || '').split(';').map((issue) => issue.trim()).filter(Boolean);
    if (!name) issues.push('missing name');
    if (!link) issues.push('invalid link');
    if (!deadline) issues.push('missing deadline');
    if (!candidate.type) issues.push('unresolved type');
    candidate.issue = issues.join('; ');
    // Some sources supply a stable listing URL separately from the public link.
    // Artwork Archive's public Learn More destination can change, while its detail
    // URL remains the correct identity for updating an existing Sheet row.
    candidate.id = makeId({ ...candidate, link: raw.identityUrl || candidate.link });
    if (deadline && isExpired(deadline, now)) {
        candidate.status = 'expired';
    } else if (!candidate.issue && isAutoPublishSource(candidate.source)) {
        candidate.status = 'publish';
    }
    return candidate;
}

// Trusted, high-confidence sources skip manual review entirely for candidates
// that came through clean (no extraction issue). A row still flagged with an
// issue goes to review regardless of source, since that's exactly the case
// review exists to catch.
export function isAutoPublishSource(sourceName) {
    return SOURCE_DEFINITIONS.some((definition) => definition.name === sourceName && definition.autoPublish);
}

export function validatePublishable(row, now = new Date()) {
    const errors = [];
    if (!row.name) errors.push('name');
    if (!canonicalizeUrl(row.link)) errors.push('link');
    if (!normalizeDeadline(row.deadline)) errors.push('deadline');
    if (!ALLOWED_TYPES.some((type) => type.toLowerCase() === String(row.type || '').trim().toLowerCase())) errors.push('type');
    if (row.fees && !['y', 'n'].includes(String(row.fees).toLowerCase())) errors.push('fees');
    if (isExpired(normalizeDeadline(row.deadline), now)) errors.push('expired');
    return errors;
}

const CREATIVE_CAPITAL_DUPLICATE_SOURCE_HOSTS = [
    'artworkarchive.com',
    'wearecreativewest.org',
    'creativewest.org',
    'callforentry.org',
    'zapplication.org',
    'gosmart.org',
    'publicartarchive.org'
];

function matchesHost(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function candidateImportExclusion(candidate) {
    if (!/^creative capital$/i.test(String(candidate.source || '').trim())) return '';
    if (!candidate.type) return 'untyped_creative_capital';
    const link = canonicalizeUrl(candidate.link);
    if (!link) return '';
    const hostname = new URL(link).hostname;
    if (CREATIVE_CAPITAL_DUPLICATE_SOURCE_HOSTS.some((domain) => matchesHost(hostname, domain))) {
        return 'duplicate_source_creative_capital';
    }
    return '';
}

export function shouldImportCandidate(candidate) {
    return !candidateImportExclusion(candidate);
}
