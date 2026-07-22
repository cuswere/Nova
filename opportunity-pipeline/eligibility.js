import * as cheerio from 'cheerio';

const US_STATES_AND_TERRITORIES = [
    'Alabama', 'Alaska', 'American Samoa', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
    'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Guam', 'Hawaii', 'Idaho', 'Illinois', 'Indiana',
    'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
    'New York', 'North Carolina', 'North Dakota', 'Northern Mariana Islands', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Puerto Rico', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
    'Vermont', 'Virgin Islands', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];
const STATE_PATTERN = new RegExp(`\\b(${US_STATES_AND_TERRITORIES.join('|')})\\b`, 'i');
const OTHER_COUNTRIES = ['Canada', 'Canadian', 'Mexico', 'Mexican', 'United Kingdom', 'UK', 'England', 'British', 'Australia', 'Australian', 'New Zealand'];
const COUNTRY_PATTERN = new RegExp(`\\b(${OTHER_COUNTRIES.join('|')})\\b`, 'i');

function canonicalCountry(label) {
    if (/^canadian$/i.test(label)) return 'Canada';
    if (/^mexican$/i.test(label)) return 'Mexico';
    if (/^(?:uk|united kingdom|england|british)$/i.test(label)) return 'United Kingdom';
    if (/^australian$/i.test(label)) return 'Australia';
    return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function htmlToText(html = '', maxLength = 10_000) {
    const source = String(html || '');
    if (!/<\/?[a-z][^>]*>/i.test(source)) {
        const text = source
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return { text: text.slice(0, maxLength), truncated: text.length > maxLength };
    }

    const $ = cheerio.load(`<body>${String(html || '')}</body>`, { decodeEntities: true });
    $('script,style,noscript').remove();
    const root = $('body').get(0);
    const blockTags = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr']);

    function inline(content, marker) {
        const leading = content.match(/^\s*/)?.[0] || '';
        const trailing = content.match(/\s*$/)?.[0] || '';
        const value = content.trim();
        return value ? `${leading}${marker}${value}${marker}${trailing}` : content;
    }

    function render(node) {
        if (node.type === 'text') return node.data;
        if (node.type !== 'tag' && node.type !== 'root') return '';
        const name = String(node.name || '').toLowerCase();
        if (name === 'br') return '\n';
        let content = (node.children || []).map(render).join('');
        if (name === 'strong' || name === 'b') content = inline(content, '**');
        if (name === 'em' || name === 'i') content = inline(content, '*');
        if (/^h[1-6]$/.test(name)) content = inline(content, '**');
        if (name === 'li') return `- ${content.trim()}\n`;
        if (name === 'td' || name === 'th') return `${content.trim()} | `;
        if (name === 'ul' || name === 'ol') return `\n${content.trim()}\n`;
        if (blockTags.has(name)) return `\n\n${content.trim()}\n\n`;
        return content;
    }
    const text = render(root)
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .join('\n');
    const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
    return { text: normalized.slice(0, maxLength), truncated: normalized.length > maxLength };
}

function normalizeRegion(value = '') {
    const valueUpper = String(value).trim().toUpperCase();
    if (valueUpper.includes('INTERNATIONAL')) return 'INTERNATIONAL';
    if (valueUpper.includes('NATIONAL')) return 'NATIONAL';
    if (valueUpper.includes('LOCAL')) return 'LOCAL';
    if (valueUpper.includes('REGIONAL')) return 'REGIONAL';
    return 'UNSPECIFIED';
}

function clausesFromDetails(text) {
    return String(text || '')
        .split(/(?:\r?\n|[.!?]+)+/)
        .map((clause) => clause.trim())
        .filter(Boolean);
}

function classifyClause(clause) {
    if (/\b(?:not open to|excluding|except(?: for)?|ineligible)\b/i.test(clause)) return 'exclusion';
    if (/\b(?:preference|priority|encouraged|strong consideration)\b/i.test(clause)) return 'preference';
    if (/\b(?:w-?8ben|tax forms?|contract|payment|shipping|venue|gallery|project location|site location|environmental requirements?|weather|hurricane|heat|sun)\b/i.test(clause)) return 'administrative';
    if (/\b(?:artists?|applicants?|residents?|participants?)\b[^.!?]{0,90}\b(?:chicago[- ]based|sf bay area counties|southern california counties|yolo county|hays county|grand junction\s+co|the midwest)\b|\b(?:chicago[- ]based|sf bay area counties|southern california counties|yolo county|hays county|grand junction\s+co|the midwest)\b[^.!?]{0,90}\b(?:artists?|applicants?|residents?|participants?)\b/i.test(clause)) return 'restriction';
    if (/\b(?:only|limited to|must\s+(?:reside|live|work|be based|be residents? of|be (?:an? )?\w+(?:-based)? resident)|eligible applicants?|open to\s+(?:artists?|applicants?)\s+(?:from|in|based in)|artists?\s+(?:from|in|residing in).{0,40}\bmay apply|residents?\s+(?:only|of)|based artists?|authorized to work)\b/i.test(clause) ||
        /\b(?:nyc|new york city)[- ]based\b[^.!?]{0,50}\b(?:artists?|applicants?|residents?|participants?)\b/i.test(clause)) return 'restriction';
    return 'other';
}

function applicantLocationInClause(clause, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const place = `(?:the\\s+(?:state|province)\\s+of\\s+)?${escaped}`;
    return new RegExp(
        `\\b(?:only|limited to)\\b[^.!?]{0,55}\\b(?:artists?|applicants?|residents?|participants?)\\b[^.!?]{0,55}\\b${place}\\b|` +
        `\\b(?:only|limited to)\\s+${place}\\s+(?:artists?|applicants?|residents?)\\b|` +
        `\\b(?:artists?|applicants?|residents?|participants?)\\b[^.!?]{0,55}\\b(?:must\\s+)?(?:reside|residing|live|living|work|working|be based|based|from|in)\\s+(?:in\\s+)?${place}\\b|` +
        `\\b(?:eligible applicants?|open to\\s+(?:artists?|applicants?))\\b[^.!?]{0,55}\\b(?:from|in|based in)\\s+${place}\\b|` +
        `\\b${place}\\s+(?:residents?|based artists?|artists?)\\b`,
        'i'
    ).test(clause);
}

function hardRestriction(text) {
    for (const clause of clausesFromDetails(text)) {
        const explicitForeign = clause.match(new RegExp(
            `\\b(?:artists?|applicants?|creatives?|residents?|participants?)\\b[^.!?]{0,55}\\b(?:from|in|across|throughout|based in)\\s+(?:the\\s+)?${COUNTRY_PATTERN.source}|` +
            `${COUNTRY_PATTERN.source}[- ]based\\s+(?:artists?|applicants?|creatives?|residents?|participants?)\\b|` +
            `\\b(?:open to\\s+)?${COUNTRY_PATTERN.source}\\s+(?:artists?|applicants?|creatives?|residents?|participants?)\\b|` +
            `\\b${COUNTRY_PATTERN.source}\\s+(?:artists?|applicants?|creatives?|residents?|participants?)\\b[^.!?]{0,55}\\b(?:eligible|may apply)\\b`,
            'i'
        ));
        const foreignLabel = explicitForeign?.[1] || explicitForeign?.[2] || explicitForeign?.[3] || explicitForeign?.[4];
        if (foreignLabel) return { country: canonicalCountry(foreignLabel), label: foreignLabel };
        if (classifyClause(clause) !== 'restriction') continue;
        if (/\b(?:nyc|new york city)[- ]based\b[^.!?]{0,50}\b(?:artists?|applicants?|residents?|participants?)\b|\b(?:artists?|applicants?|residents?|participants?)\b[^.!?]{0,55}\b(?:based|reside|live|work)\s+(?:in\s+)?(?:nyc|new york city)\b/i.test(clause)) {
            return { country: 'United States', label: 'New York City' };
        }
        const state = clause.match(STATE_PATTERN)?.[1];
        if (state && (applicantLocationInClause(clause, state) ||
            new RegExp(`\\b(?:must be (?:an? )?|open to (?:all )?)${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[- ]?(?:based )?(?:artists?|applicants?|residents?)\\b`, 'i').test(clause))) {
            return { country: 'United States', label: state };
        }
        if (/\b(?:artists?|applicants?|residents?|participants?)\b[^.!?]{0,65}\b(?:chicago[- ]based|sf bay area counties|southern california counties|yolo county|hays county|grand junction\s+co|the midwest)\b|\b(?:chicago[- ]based|sf bay area counties|southern california counties|yolo county|hays county|grand junction\s+co|the midwest)\b[^.!?]{0,65}\b(?:artists?|applicants?|residents?|participants?)\b/i.test(clause)) {
            return { country: 'United States', label: 'United States locality' };
        }
        if (/\b(?:artists?|applicants?|residents?|participants?)\b[^.!?]{0,70}\b(?:united states|u\.?s\.?a?)\b|\b(?:united states|u\.?s\.?a?)[- ]?(?:based|resident|citizen)s?\b|\bauthorized to work in (?:the )?united states\b/i.test(clause)) {
            return { country: 'United States', label: 'United States' };
        }
        const country = clause.match(COUNTRY_PATTERN)?.[1];
        if (country && applicantLocationInClause(clause, country)) {
            return {
                country: canonicalCountry(country),
                label: country
            };
        }
    }
    return null;
}

function explicitWorldwide(text) {
    return clausesFromDetails(text).some((clause) => classifyClause(clause) !== 'exclusion' &&
        /artists? from any countr(?:y|ies)|open to (?:artists?|applicants?) (?:from )?(?:any country|worldwide|around the world)|regardless of geographic location|(?:artists?|applicants?) worldwide/i.test(clause));
}

function excludesInternational(text) {
    return clausesFromDetails(text).some((clause) => classifyClause(clause) === 'exclusion' &&
        /(?:not open to|excluding|except)\s+(?:international|worldwide|artists? from outside)/i.test(clause));
}

// The public country field is scalar. When applicant prose explicitly names
// multiple eligible countries, keep the full restriction in eligibility_details
// and leave the descriptor blank instead of publishing one country as exhaustive.
function hasMultipleApplicantCountries(text) {
    return clausesFromDetails(text).some((clause) => {
        if (classifyClause(clause) !== 'restriction') return false;
        const namesApplicants = /\b(?:artists?|applicants?|residents?|participants?|creatives?)\b/i.test(clause);
        const namesUnitedStates = /\b(?:united states|u\.s\.a?|us)\b/i.test(clause);
        return namesApplicants && namesUnitedStates && COUNTRY_PATTERN.test(clause);
    });
}

// Source-neutral eligibility from free prose. Conservative by design: a country is
// only resolved on a clear applicant restriction or explicit worldwide eligibility;
// conflicting signals resolve to blank with an issue, and everything else stays blank.
export function resolveProseEligibility(text = '') {
    const value = String(text || '');
    if (hasMultipleApplicantCountries(value)) return { country: '', issue: '' };
    const restriction = hardRestriction(value);
    const worldwide = explicitWorldwide(value);
    if (restriction && worldwide) {
        return { country: '', issue: `eligibility conflict: text restricts applicants to ${restriction.label} and allows applicants worldwide` };
    }
    if (restriction) return { country: restriction.country, issue: '' };
    if (worldwide) return { country: 'International', issue: '' };
    return { country: '', issue: '' };
}

export function resolveEligibility({ sourceId = '', eligibilityRegion = '', eligibilityLocation = '', details = '' } = {}) {
    if (sourceId !== 'creative_west') return { country: '', issue: '' };
    const region = normalizeRegion(eligibilityRegion || eligibilityLocation);
    const text = String(details || '');
    if (hasMultipleApplicantCountries(text)) return { country: '', issue: '' };
    const restriction = hardRestriction(text);
    const worldwide = explicitWorldwide(text);
    const excludesInternationalApplicants = excludesInternational(text);
    const conflict = (message) => ({ country: '', issue: `eligibility conflict: region=${region}; ${message}` });

    if (region === 'INTERNATIONAL') {
        if (restriction) return conflict(`text restricts applicants to ${restriction.label}`);
        if (excludesInternationalApplicants) return conflict('text excludes international applicants');
        return { country: 'International', issue: '' };
    }
    if (region === 'NATIONAL') {
        if (restriction && restriction.country !== 'United States') return conflict(`text restricts applicants to ${restriction.label}`);
        if (worldwide) return conflict('text allows applicants worldwide');
        return { country: 'United States', issue: '' };
    }
    if (region === 'LOCAL' || region === 'REGIONAL') {
        if (restriction) return { country: restriction.country, issue: '' };
        return { country: '', issue: '' };
    }
    return resolveProseEligibility(text);
}
