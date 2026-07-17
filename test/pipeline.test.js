import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    creativeCapitalMaxPage,
    creativeCapitalPageUrl,
    creativeWestDeadline,
    creativeWestFeeSummary,
    discoverCreativeWest,
    mapCreativeWestItem,
    parseArtworkArchive,
    parseCreativeCapital,
    parseHyperallergicArticle
} from '../opportunity-pipeline/adapters.js';
import { enrichCandidate } from '../opportunity-pipeline/enrich.js';
import { htmlToText, resolveEligibility } from '../opportunity-pipeline/eligibility.js';
import { postJson } from '../opportunity-pipeline/http.js';
import {
    canonicalizeUrl,
    formatPublicDeadline,
    inferFee,
    isExpired,
    normalizeCandidate,
    normalizeCountry,
    normalizeDeadline
} from '../opportunity-pipeline/normalize.js';
import { columnLetter, escapeSheetValue, mergeCandidate, rowValues, upsertCandidates } from '../opportunity-pipeline/sheets.js';
import { SHEET_HEADERS } from '../opportunity-pipeline/config.js';
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

test('posts JSON with retry behavior and returns parsed responses', async () => {
    let calls = 0;
    const result = await postJson('https://example.org/graphql', { query: 'query Test' }, {
        retries: 1,
        fetcher: async (_url, request) => {
            calls += 1;
            assert.equal(request.method, 'POST');
            assert.equal(request.headers['content-type'], 'application/json');
            if (calls === 1) return { ok: false, status: 503, statusText: 'Unavailable' };
            return { ok: true, json: async () => ({ data: { ok: true } }) };
        }
    });
    assert.equal(calls, 2);
    assert.deepEqual(result, { data: { ok: true } });
});

function creativeWestItem(overrides = {}) {
    return {
        id: '1',
        source: 'CAFE',
        name: 'Colorado Public Art Commission',
        sourceUrl: 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE',
        applyUrl: 'https://apply.example/1',
        type: 'COMMISSION',
        applicationDeadline: '2026-08-01T03:59:59.000Z',
        originalTimezone: 'EDT',
        rollingDeadline: false,
        eligibilityLocation: 'Local',
        eligibilityDescription: '<p>Open to artists based in Colorado.</p>',
        shortDescription: '<p>A public art project.</p>',
        fees: [{ name: 'Application fee', value: '0.00', type: 'APPLICATION', currency: 'USD' }],
        ...overrides
    };
}

test('Creative West GraphQL collector paginates, deduplicates by source ID, and validates totals', async () => {
    let query;
    const pages = new Map([
        [1, { data: { searchOpportunities: { total: 2, items: [creativeWestItem({ id: '1' })] } } }],
        [2, { data: { searchOpportunities: { total: 2, items: [creativeWestItem({ id: '2', sourceUrl: 'https://opportunities.wearecreativewest.org/opportunity/2/CAFE' })] } } }]
    ]);
    const rows = await discoverCreativeWest({ id: 'creative_west', name: 'Creative West Art Opps', url: 'https://opportunities.wearecreativewest.org', apiUrl: 'https://example.org/graphql', pageSize: 1, maxPages: 2 }, {
        poster: async (_url, body) => {
            query = body.query;
            return pages.get(body.variables.input.pagination.page);
        }
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].link, 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE');
    assert.match(query, /eligibilityRegion/);
    await assert.rejects(() => discoverCreativeWest({ id: 'creative_west', name: 'Creative West Art Opps', apiUrl: 'https://example.org/graphql', pageSize: 100, maxPages: 1 }, {
        poster: async () => ({ errors: [{ message: 'bad query' }] })
    }), /GraphQL errors/);
    await assert.rejects(() => discoverCreativeWest({ id: 'creative_west', name: 'Creative West Art Opps', apiUrl: 'https://example.org/graphql', pageSize: 100, maxPages: 1 }, {
        poster: async () => ({ data: { searchOpportunities: { total: 101, items: [] } } })
    }), /page ceiling/);
    await assert.rejects(() => discoverCreativeWest({ id: 'creative_west', name: 'Creative West Art Opps', apiUrl: 'https://example.org/graphql', pageSize: 1, maxPages: 2 }, {
        poster: async () => ({ data: { searchOpportunities: { total: 2, items: [creativeWestItem()] } } })
    }), /pagination incomplete/);
    await assert.rejects(() => discoverCreativeWest({ id: 'creative_west', name: 'Creative West Art Opps', apiUrl: 'https://example.org/graphql', pageSize: 1, maxPages: 1 }, {
        poster: async () => ({ data: { searchOpportunities: { total: 1, items: [creativeWestItem({ type: 'EXHIBITION' })] } } })
    }), /unsupported opportunity type/);
});

test('Creative West mapper handles allowed types, local deadlines, fees, and review issues', () => {
    for (const [apiType, expected] of [['GRANT', 'Grant'], ['RESIDENCY', 'Residency'], ['COMMISSION', 'Commission']]) {
        assert.equal(mapCreativeWestItem(creativeWestItem({ type: apiType })).type, expected);
    }
    assert.deepEqual(creativeWestDeadline(creativeWestItem()), { deadline: '2026-07-31', issue: '' });
    assert.deepEqual(creativeWestDeadline(creativeWestItem({ rollingDeadline: true })), { deadline: 'Rolling', issue: '' });
    assert.match(creativeWestDeadline(creativeWestItem({ originalTimezone: 'CEST' })).issue, /unknown deadline timezone/);
    const fallback = mapCreativeWestItem(creativeWestItem({ sourceUrl: '', applyUrl: 'https://apply.example/1' }), {
        id: 'creative_west', name: 'Creative West Art Opps', url: 'https://opportunities.wearecreativewest.org'
    });
    assert.equal(fallback.link, 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE');
    const positive = creativeWestFeeSummary(creativeWestItem({ fees: [
        { name: 'Member application fee', value: '25', type: 'APPLICATION', currency: 'USD' },
        { name: 'Non-member application fee', value: '40', type: 'APPLICATION', currency: 'USD' }
    ] }));
    assert.equal(positive.fees, 'y');
    assert.match(positive.feeDetails, /Non-member/);
    assert.equal(creativeWestFeeSummary(creativeWestItem({ fees: [{ name: 'No entry fee', value: '0', type: 'ENTRY', currency: 'USD' }] })).fees, 'n');
    assert.equal(creativeWestFeeSummary(creativeWestItem({ fees: [{ name: 'Jury fee', value: '40', type: 'JURY', currency: 'USD' }] })).fees, '');
    assert.equal(creativeWestFeeSummary(creativeWestItem({ fees: [] })).fees, '');
    assert.equal(creativeWestFeeSummary(creativeWestItem({ fees: [], entryFee: { cost: '15.00' } })).fees, 'y');
});

test('converts eligibility HTML without duplicate nested text and resolves Creative West eligibility conservatively', () => {
    const converted = htmlToText('<div><p>Artists &amp; makers</p><ul><li>Colorado residents</li><li>Age 18+</li></ul><script>ignore()</script><table><tr><td>A</td><td>B</td></tr></table></div>');
    assert.equal(converted.text, 'Artists & makers\nColorado residents\nAge 18+\nA | B |');
    assert.equal(converted.truncated, false);
    assert.equal(htmlToText('Lead<p>Body</p>Tail').text, 'Lead\nBody\nTail');
    assert.equal(htmlToText(`<p>${'x'.repeat(20)}</p>`, 10).truncated, true);
    assert.deepEqual(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'International', details: 'Artists worldwide may apply.' }), { country: 'International', issue: '' });
    assert.deepEqual(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'National', details: 'Artists legally authorized to work in the United States may apply.' }), { country: 'United States', issue: '' });
    assert.deepEqual(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'Local', details: 'Open to artists based in Colorado.' }), { country: 'United States', issue: '' });
    assert.match(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'Regional', details: 'Open to all artists.' }).issue, /does not establish United States/);
    assert.deepEqual(resolveEligibility({ sourceId: 'creative_west', details: 'Artists from any country may apply.' }), { country: 'International', issue: '' });
    assert.deepEqual(resolveEligibility({ sourceId: 'creative_west', details: 'Open to all artists.' }), { country: '', issue: '' });
    assert.match(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'International', details: 'Open to Colorado artists only.' }).issue, /eligibility conflict/);
    assert.match(resolveEligibility({ sourceId: 'creative_west', eligibilityLocation: 'International', details: 'Artists worldwide may apply, except international applicants.' }).issue, /excludes international applicants/);
    assert.deepEqual(resolveEligibility({ sourceId: 'other_source', eligibilityLocation: 'National', details: 'United States artists only.' }), { country: '', issue: '' });
});

test('Creative West eligibility classifies applicant restrictions separately from false-positive locations', () => {
    const resolve = (eligibilityRegion, eligibilityLocation, details) => resolveEligibility({ sourceId: 'creative_west', eligibilityRegion, eligibilityLocation, details });
    assert.deepEqual(resolve('INTERNATIONAL', 'LOCAL', 'HMVC Gallery New York will host the exhibition. International artists may apply.'), { country: 'International', issue: '' });
    assert.deepEqual(resolve('NATIONAL', 'REGIONAL', 'Open to artists across the United States. Preference will be given to Kansas City artists.'), { country: 'United States', issue: '' });
    assert.deepEqual(resolve('INTERNATIONAL', '', 'International artists receiving payment must submit a W-8BEN tax form.'), { country: 'International', issue: '' });
    assert.deepEqual(resolve('NATIONAL', '', 'United States artists are eligible, excluding applicants from specified California counties.'), { country: 'United States', issue: '' });
    assert.match(resolve('INTERNATIONAL', '', 'Only Colorado residents are eligible.').issue, /eligibility conflict/);
    assert.match(resolve('NATIONAL', '', 'Only Canadian residents are eligible.').issue, /eligibility conflict/);
    assert.deepEqual(resolve('LOCAL', '', 'Colorado residents only.'), { country: 'United States', issue: '' });
    assert.match(resolve('LOCAL', '', 'Preference for Colorado artists.').issue, /does not establish United States/);
    assert.match(resolve('REGIONAL', '', 'The project location is Austin, Texas.').issue, /does not establish United States/);
    assert.deepEqual(resolve('UNSPECIFIED', '', 'Open to artists from any country.'), { country: 'International', issue: '' });
    assert.deepEqual(resolve('UNSPECIFIED', '', 'Open to artists from Canada.'), { country: 'Canada', issue: '' });
    assert.match(resolve('INTERNATIONAL', '', 'This call is not open to international applicants.').issue, /excludes international applicants/);
    const mapped = mapCreativeWestItem(creativeWestItem({
        eligibilityRegion: 'INTERNATIONAL',
        eligibilityLocation: 'LOCAL',
        eligibilityDescription: '<p>HMVC Gallery New York will host the exhibition.</p>'
    }));
    assert.equal(mapped.country, 'International');
});

test('normalization retains specific eligibility issues and Sheet values follow the derived 18-column schema safely', () => {
    const row = normalizeCandidate({
        name: 'Conflicted Eligibility', deadline: 'August 1, 2026', link: 'https://example.org/conflict', type: 'Grant', fees: 'n',
        issue: 'eligibility conflict: region=INTERNATIONAL; text restricts applicants to Colorado', eligibilityDetails: 'Colorado only'
    }, today);
    assert.match(row.issue, /eligibility conflict/);
    assert.match(row.issue, /unresolved eligibility/);
    assert.equal(row.eligibility_details, 'Colorado only');
    assert.equal(SHEET_HEADERS.length, 18);
    assert.equal(columnLetter(18), 'R');
    assert.equal(columnLetter(27), 'AA');
    assert.equal(escapeSheetValue('=HYPERLINK("https://bad")'), "'=HYPERLINK(\"https://bad\")");
    assert.equal(escapeSheetValue('plain text'), 'plain text');
    const values = rowValues({ ...Object.fromEntries(SHEET_HEADERS.map((header) => [header, 'x'])), name: '=danger' });
    assert.equal(values.length, 18);
    assert.equal(values[0], "'=danger");
});

test('Sheet writes use the schema-derived R column and keep manual public values', async () => {
    const calls = { updates: [], appends: [] };
    const sheet = {
        spreadsheets: {
            values: {
                get: async ({ range }) => ({ data: { values: range.endsWith('1:1') ? [SHEET_HEADERS] : [SHEET_HEADERS] } }),
                batchUpdate: async (value) => calls.updates.push(value),
                append: async (value) => calls.appends.push(value)
            },
            get: async () => ({ data: { sheets: [{ properties: { title: 'Opportunities', sheetId: 1 } }] } }),
            batchUpdate: async () => {}
        }
    };
    await upsertCandidates([{ ...Object.fromEntries(SHEET_HEADERS.map((header) => [header, 'value'])), id: 'new-id', name: '=formula' }], {
        sheets: sheet, spreadsheetId: 'test', sheetName: 'Opportunities'
    });
    assert.equal(calls.appends[0].range, "'Opportunities'!A:R");
    assert.equal(calls.appends[0].requestBody.values[0].length, 18);
    assert.equal(calls.appends[0].requestBody.values[0][0], "'=formula");
    const current = { name: 'Editor title', deadline: '2026-08-01', link: 'https://example.org/editor', type: 'Grant', fees: 'n', country: 'United States', status: 'publish' };
    assert.equal(mergeCandidate(current, { ...current, name: 'Crawler title', status: 'review' }).name, 'Editor title');
});
