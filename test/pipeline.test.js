import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArtworkArchive, parseCreativeCapital, parseHyperallergicArticle } from '../opportunity-pipeline/adapters.js';
import { enrichCandidate } from '../opportunity-pipeline/enrich.js';
import {
    canonicalizeUrl,
    formatPublicDeadline,
    inferFee,
    isExpired,
    normalizeCandidate,
    normalizeCountry,
    normalizeDeadline
} from '../opportunity-pipeline/normalize.js';
import { mergeCandidate } from '../opportunity-pipeline/sheets.js';
import { buildPublishedRows } from '../publish.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');
const today = new Date(2026, 6, 16);

test('normalizes URLs, dates, countries, and application fees', () => {
    assert.equal(canonicalizeUrl('https://www.Example.com/call/?utm_source=x#apply'), 'https://example.com/call');
    assert.equal(normalizeDeadline('Deadline: October 29, 2026'), '2026-10-29');
    assert.equal(formatPublicDeadline('2026-10-29'), '10/29/2026');
    assert.equal(normalizeCountry('USA'), 'United States');
    assert.equal(inferFee('There is no application fee.'), 'n');
    assert.equal(inferFee('The residency costs $900, but applications are free to apply.'), 'n');
    assert.equal(isExpired('2026-07-15', today), true);
});

test('parses Artwork Archive fixture', () => {
    const [row] = parseArtworkArchive(fixture('artwork-archive.html'));
    assert.equal(row.name, 'Test Studio Residency');
    assert.equal(row.deadline, 'August 10, 2026');
    assert.equal(row.type, 'Residency');
    assert.equal(row.country, 'International');
});

test('parses Creative Capital fixture', () => {
    const [row] = parseCreativeCapital(fixture('creative-capital.html'));
    assert.equal(row.name, 'Visual Artist Project Grant');
    assert.equal(row.fees, 'n');
    assert.equal(row.country, 'International');
});

test('parses Hyperallergic fixture', () => {
    const [row] = parseHyperallergicArticle(fixture('hyperallergic.html'), undefined, 'https://hyperallergic.com/opportunities-in-october-2026/');
    assert.equal(row.name, 'International Painting Prize');
    assert.equal(row.deadline, 'October 29, 2026');
    assert.equal(row.fees, 'y');
    assert.equal(row.country, 'International');
});

test('normalization records unresolved fields instead of guessing', () => {
    const row = normalizeCandidate({
        name: 'Test Exhibition',
        deadline: 'August 1, 2026',
        link: 'https://example.org/open-call',
        type: 'Exhibition',
        description: 'A juried visual art show.',
        source: 'Fixture',
        sourceUrl: 'https://example.org'
    }, today);
    assert.match(row.issue, /unresolved application fee/);
    assert.match(row.issue, /unresolved eligibility/);
    assert.equal(row.status, 'review');
});

test('upsert merge preserves manual public fields and decisions', () => {
    const current = { name: 'Editor Title', link: 'https://example.org/a', deadline: '8/1/2026', type: 'Grant', fees: 'n', country: 'United States', status: 'publish' };
    const incoming = { name: 'Crawler Title', link: 'https://example.org/b', deadline: '2026-08-02', type: 'Award', fees: 'y', country: 'International', status: 'review', last_seen: '2026-07-16' };
    const merged = mergeCandidate(current, incoming);
    assert.equal(merged.status, 'publish');
    assert.equal(merged.name, 'Editor Title');
    assert.equal(merged.last_seen, '2026-07-16');
    assert.equal(mergeCandidate({ ...current, status: 'review' }, { ...incoming, status: 'expired' }).status, 'expired');
});

test('AI enrichment uses structured evidence without inventing unsupported costs', async () => {
    let request;
    const client = {
        responses: {
            create: async (value) => {
                request = value;
                return {
                    output_text: JSON.stringify({
                        deadline: 'August 20, 2026',
                        type: 'Residency',
                        fees: 'n',
                        country: 'International',
                        host_location: 'Lisbon, Portugal',
                        fee_details: 'No application fee',
                        canonical_link: 'https://example.org/residency?utm_source=board',
                        confidence: 0.94,
                        issue: ''
                    })
                };
            }
        }
    };
    const result = await enrichCandidate({
        name: 'Test Residency',
        link: 'https://board.example/listing',
        description: 'A visual arts residency.',
        type: 'Residency',
        fees: '',
        country: '',
        confidence: '0.50',
        issue: ''
    }, {
        client,
        fetcher: async () => ({ text: '<main>International visual artists may apply by August 20, 2026. No application fee.</main>', finalUrl: 'https://board.example/listing' })
    });
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    assert.equal(result.deadline, '2026-08-20');
    assert.equal(result.fees, 'n');
    assert.equal(result.link, 'https://example.org/residency');
});

test('publisher exports only valid approved rows and keeps browser-safe dates', () => {
    const result = buildPublishedRows([
        { name: 'Good Grant', deadline: '2026-08-01', link: 'https://example.org/good', type: 'Grant', fees: 'n', country: 'International', status: 'publish' },
        { name: 'Needs Review', deadline: '2026-08-02', link: 'https://example.org/review', type: 'Grant', fees: 'n', country: 'International', status: 'review' },
        { name: 'Bad Fee', deadline: '2026-08-03', link: 'https://example.org/bad', type: 'Grant', fees: '', country: 'International', status: 'publish' },
        { name: 'Expired', deadline: '2026-07-01', link: 'https://example.org/expired', type: 'Grant', fees: 'n', country: 'International', status: 'publish' }
    ], today);
    assert.deepEqual(result.published, [{ name: 'Good Grant', deadline: '8/1/2026', link: 'https://example.org/good', type: 'Grant', fees: 'n', country: 'International' }]);
    assert.equal(result.rejected.length, 2);
});
