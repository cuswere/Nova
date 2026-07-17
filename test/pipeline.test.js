import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { creativeCapitalMaxPage, creativeCapitalPageUrl, parseArtworkArchive, parseCreativeCapital, parseHyperallergicArticle } from '../opportunity-pipeline/adapters.js';
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
import { candidatesFromArtworkArchiveExport } from '../import-artwork-archive.js';

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

test('uses Commission as the public-art category and flags unknown types for review', () => {
    const commission = normalizeCandidate({
        name: 'Downtown Public Art RFQ',
        deadline: 'August 1, 2026',
        link: 'https://example.org/rfq',
        fees: 'n',
        country: 'United States'
    }, today);
    assert.equal(commission.type, 'Commission');

    const unknown = normalizeCandidate({
        name: 'Unclassified opportunity',
        deadline: 'August 1, 2026',
        link: 'https://example.org/unknown',
        type: 'Public Art & Proposals',
        fees: 'n',
        country: 'United States'
    }, today);
    assert.equal(unknown.type, '');
    assert.match(unknown.issue, /unresolved type/);
});

test('parses Artwork Archive fixture', () => {
    const [row] = parseArtworkArchive(fixture('artwork-archive.html'));
    assert.equal(row.name, 'Test Studio Residency');
    assert.equal(row.deadline, 'August 11, 2026');
    assert.equal(row.type, 'Fellowship');
    assert.equal(row.country, 'International');
    assert.equal(row.hostLocation, 'Seattle, United States');
    assert.equal(row.feeDetails, '$35');
    assert.match(row.description, /Test Arts Council/);
});

test('imports a browser-collected Artwork Archive export', () => {
    const rows = candidatesFromArtworkArchiveExport({
        source: 'artwork_archive',
        pages: [{ url: 'https://www.artworkarchive.com/call-for-entry', html: fixture('artwork-archive.html') }]
    }, today);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Test Studio Residency');
    assert.equal(rows[0].link, 'https://example.org/apply/test-studio-residency');
    assert.equal(rows[0].source_url, 'https://artworkarchive.com/call-for-entry/test-residency-2026');
    assert.equal(rows[0].source, 'Artwork Archive');
});

test('keeps Artwork Archive detail URLs as identity while using Learn More links', () => {
    const html = fixture('artwork-archive.html');
    const oldExport = candidatesFromArtworkArchiveExport({
        source: 'artwork_archive',
        pages: [{ url: 'https://www.artworkarchive.com/call-for-entry', html: html.replace(/ data-nova-(?:link|source-link)="[^"]+"/g, '') }]
    }, today);
    const correctedExport = candidatesFromArtworkArchiveExport({
        source: 'artwork_archive',
        pages: [{ url: 'https://www.artworkarchive.com/call-for-entry', html }]
    }, today);
    assert.equal(correctedExport[0].id, oldExport[0].id);
    assert.equal(correctedExport[0].link, 'https://example.org/apply/test-studio-residency');
});

test('parses Creative Capital fixture', () => {
    const [row] = parseCreativeCapital(fixture('creative-capital.html'));
    assert.equal(row.name, 'Visual Artist Project Grant');
    assert.equal(row.fees, 'n');
    assert.equal(row.country, 'International');
});

test('builds Creative Capital GET pagination URLs and bounds pages from data attributes', () => {
    const base = 'https://creative-capital.org/artist-resources/artist-opportunities/';
    assert.equal(creativeCapitalPageUrl(base, 1), base);
    assert.equal(creativeCapitalPageUrl(base, 2, 'grant'), `${base}page/2/?opportunities_type=grant`);
    assert.equal(creativeCapitalMaxPage('<nav><a href="#" data-page="0">Previous</a><a href="#" data-page="1">1</a><a href="#" data-page="6">6</a></nav>'), 6);
    assert.equal(creativeCapitalMaxPage('<nav></nav>'), 1);
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
        { name: 'Future Job Listing', deadline: '2026-08-02', link: 'https://example.org/job', type: 'Job', fees: 'n', country: 'International', status: 'publish' },
        { name: 'Needs Review', deadline: '2026-08-02', link: 'https://example.org/review', type: 'Grant', fees: 'n', country: 'International', status: 'review' },
        { name: 'Bad Fee', deadline: '2026-08-03', link: 'https://example.org/bad', type: 'Grant', fees: '', country: 'International', status: 'publish' },
        { name: 'Expired', deadline: '2026-07-01', link: 'https://example.org/expired', type: 'Grant', fees: 'n', country: 'International', status: 'publish' }
    ], today);
    assert.deepEqual(result.published, [{ name: 'Good Grant', deadline: '8/1/2026', link: 'https://example.org/good', type: 'Grant', fees: 'n', country: 'International' }]);
    assert.equal(result.rejected.length, 3);
    assert.deepEqual(result.rejected.find((row) => row.name === 'Future Job Listing')?.errors, ['type is not yet public']);
});
