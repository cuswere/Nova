import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { ALLOWED_TYPES, DEFAULT_MODEL } from './config.js';
import { cleanText, fetchText } from './http.js';
import { canonicalizeUrl, normalizeCountry, normalizeDeadline, normalizeType } from './normalize.js';

const OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['deadline', 'type', 'fees', 'country', 'host_location', 'fee_details', 'canonical_link', 'confidence', 'issue'],
    properties: {
        deadline: { type: 'string' },
        type: { type: 'string', enum: ALLOWED_TYPES },
        fees: { type: 'string', enum: ['y', 'n', 'unknown'] },
        country: { type: 'string' },
        host_location: { type: 'string' },
        fee_details: { type: 'string' },
        canonical_link: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        issue: { type: 'string' }
    }
};

export async function enrichCandidate(candidate, { client, fetcher = fetchText } = {}) {
    if (!client && !process.env.OPENAI_API_KEY) return candidate;
    const openai = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let evidence;
    try {
        evidence = await fetcher(candidate.link);
    } catch (error) {
        return { ...candidate, issue: appendIssue(candidate.issue, `canonical page fetch failed: ${error.message}`) };
    }
    const page = pageEvidence(evidence.text);
    const response = await openai.responses.create({
        model: DEFAULT_MODEL,
        reasoning: { effort: 'none' },
        input: [
            {
                role: 'system',
                content: 'Extract only facts explicitly supported by the supplied opportunity page. The fees field means application, entry, or submission fee only; ignore tuition, travel, residency, participation, and exhibition costs. The country field means applicant eligibility: use International only when applicants from any country are explicitly allowed. Return empty strings or unknown when unsupported.'
            },
            {
                role: 'user',
                content: `Candidate name: ${candidate.name}\nCurrent URL: ${candidate.link}\nSource description: ${candidate.description}\n\nPage evidence:\n${page}`
            }
        ],
        text: {
            format: {
                type: 'json_schema',
                name: 'opportunity_enrichment',
                strict: true,
                schema: OUTPUT_SCHEMA
            }
        }
    });
    const extracted = JSON.parse(response.output_text);
    return {
        ...candidate,
        deadline: normalizeDeadline(extracted.deadline) || candidate.deadline,
        type: normalizeType(extracted.type, candidate.name, candidate.description),
        fees: extracted.fees === 'unknown' ? candidate.fees : extracted.fees,
        country: normalizeCountry(extracted.country) || candidate.country,
        host_location: extracted.host_location || candidate.host_location,
        fee_details: extracted.fee_details || candidate.fee_details,
        link: canonicalizeUrl(extracted.canonical_link) || canonicalizeUrl(evidence.finalUrl) || candidate.link,
        confidence: Number(extracted.confidence || candidate.confidence).toFixed(2),
        issue: appendIssue(candidate.issue, extracted.issue)
    };
}

export function pageEvidence(html) {
    const $ = cheerio.load(html);
    $('script,style,noscript,svg,nav,footer').remove();
    return cleanText($('main,article').first().text() || $('body').text()).slice(0, 14_000);
}

function appendIssue(current, next) {
    return [current, next].filter(Boolean).join('; ');
}
