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
    creativeWestIndependentLink,
    discoverCreativeWest,
    discoverHyperallergic,
    mapCreativeWestItem,
    parseArtworkArchive,
    parseCreativeCapital,
    parseHyperallergicArticle,
    parseTransArtistsDetail
} from '../opportunity-pipeline/adapters.js';
import { areSameOpportunity, deduplicateCandidates } from '../opportunity-pipeline/dedupe.js';
import { enrichCandidate } from '../opportunity-pipeline/enrich.js';
import { htmlToText, resolveEligibility, resolveProseEligibility } from '../opportunity-pipeline/eligibility.js';
import { postJson } from '../opportunity-pipeline/http.js';
import {
    canonicalizeUrl,
    formatPublicDeadline,
    inferFee,
    inferType,
    isExpired,
    normalizeCandidate,
    normalizeCountry,
    normalizeDeadline,
    normalizeType
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

test('keeps commissions and open calls distinct and resolves grouped grant categories', () => {
    const commission = normalizeCandidate({
        name: 'Downtown Public Art RFQ',
        deadline: 'August 1, 2026',
        link: 'https://example.org/rfq',
        fees: 'n',
        country: 'United States'
    }, today);
    assert.equal(commission.type, 'Commission');

    assert.equal(inferType('Call for Latino Artists', 'An ongoing artist directory.'), 'Open Call');
    assert.equal(inferType('Call for Artists: Downtown Public Art RFQ'), 'Commission');
    assert.equal(normalizeType('Grants & Fellowships', 'Studio Fellowship'), 'Fellowship');
    assert.equal(normalizeType('Grants & Fellowships', 'Artist Support Program'), 'Grant');

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

test('normalization preserves full descriptions and does not apply automatic relevance rejection', () => {
    const description = `A visual arts course and commission. ${'x'.repeat(900)}`;
    const row = normalizeCandidate({
        name: 'Hospital Artwork Commission',
        deadline: 'August 1, 2026',
        link: 'https://example.org/hospital-art',
        type: 'Commission',
        fees: 'n',
        country: 'United States',
        description
    }, today);
    assert.equal(row.description, description);
    assert.doesNotMatch(row.issue, /outside visual-arts scope/);
});

test('parses Artwork Archive fixture', () => {
    const [row] = parseArtworkArchive(fixture('artwork-archive.html'));
    assert.equal(row.name, 'Test Studio Residency');
    assert.equal(row.deadline, 'August 11, 2026');
    assert.equal(row.type, 'Fellowship');
    assert.equal(row.country, 'International');
    assert.equal(row.hostLocation, 'Seattle, United States');
    assert.equal(row.feeDetails, '$35');
    assert.equal(row.eligibilityDetails, 'Open internationally to artists at any career stage.');
    assert.equal(row.awardInfo, '$5,000 stipend and studio access');
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
    assert.equal(rows[0].eligibility_details, 'Open internationally to artists at any career stage.');
    assert.equal(rows[0].award_info, '$5,000 stipend and studio access');
});

test('backfills Artwork Archive structured fields from older collector descriptions', () => {
    const html = fixture('artwork-archive.html')
        .replace(/ data-nova-eligibility-details="[^"]*"/, '')
        .replace(/ data-nova-award-info="[^"]*"/, '');
    const [row] = parseArtworkArchive(html);
    assert.equal(row.eligibilityDetails, 'Open internationally.');
    assert.equal(row.awardInfo, '$5,000. A detailed opportunity description.');
    assert.equal(row.country, 'International');
});

test('parses TransArtists detail pages instead of publishing listing stubs', () => {
    const html = `<main><article><h2>TED and POSCA Residency</h2>
      <p>Selected artists receive USD $15,000 in fees and production support.</p>
      <p>The call is open to artists from around the world. Apply <a href="https://fineacts.co/residency">online</a>
      with a deadline of <strong>31 July 2026</strong>.</p></article></main>`;
    const row = parseTransArtistsDetail(html, 'https://transartists.org/en/news/test');
    assert.equal(row.deadline, '31 July 2026');
    assert.equal(row.link, 'https://fineacts.co/residency');
    assert.equal(row.country, 'International');
    assert.equal(row.awardInfo, 'Selected artists receive USD $15,000 in fees and production support.');
    assert.equal(parseTransArtistsDetail(html.replace('deadline of <strong>31 July 2026</strong>', 'materials are due by <strong>14 August 2026</strong>'), 'https://transartists.org/en/news/test').deadline, '14 August 2026');
    assert.equal(parseTransArtistsDetail(html.replace('deadline of <strong>31 July 2026</strong>', 'deadline information is forthcoming; ongoing collaborations continue'), 'https://transartists.org/en/news/test').deadline, '');
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

test('interprets Hyperallergic roundup sections, awards, fees, rolling deadlines, eligibility, and link rules', () => {
    const rows = parseHyperallergicArticle(fixture('hyperallergic-roundup.html'), undefined, 'https://hyperallergic.com/opportunities-in-july-2026/');
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    assert.deepEqual(rows.map((row) => row.name).sort(), [
        'Big Prize',
        'Budget Only Grant',
        'Hyundai Motor Group – The 7th VH Award',
        'New York Fellowship',
        'Tuition Trap Grant',
        'Vermont Studio Center Residency'
    ]);

    // Section-derived type: residency section, name without "fellowship" -> Residency.
    const vermont = byName['Vermont Studio Center Residency'];
    assert.equal(vermont.type, 'Residency');
    assert.equal(vermont.country, 'International');
    assert.equal(normalizeDeadline(vermont.deadline), '2026-10-01');
    assert.equal(vermont.awardInfo, '');

    // Named fellowship in the same section -> Fellowship; US restriction; rolling deadline.
    const fellowship = byName['New York Fellowship'];
    assert.equal(fellowship.type, 'Fellowship');
    assert.equal(fellowship.country, 'United States');
    assert.equal(normalizeDeadline(fellowship.deadline), 'Rolling');
    assert.match(fellowship.awardInfo, /\$5,000 stipend/);

    // The source's Grants & Awards section drives the category.
    assert.equal(byName['Hyundai Motor Group – The 7th VH Award'].type, 'Award');

    // Bare "Fee:" label -> fee y; award line captured; same-month range -> end date;
    // external host valid even with "hyperallergic.com" inside the query string.
    const prize = byName['Big Prize'];
    assert.equal(prize.type, 'Award');
    assert.equal(prize.fees, 'y');
    assert.equal(prize.awardInfo, 'Up to $90,000 awarded to winners.');
    assert.equal(normalizeDeadline(prize.deadline), '2026-10-29');
    assert.equal(prize.link, 'https://bigprize.org/enter?ref=hyperallergic.com');

    // Ambiguous currency remains in the row description and is flagged for review.
    assert.equal(byName['Budget Only Grant'].awardInfo, '');
    assert.match(byName['Budget Only Grant'].issue, /ambiguous award amount/);
    assert.equal(byName['Tuition Trap Grant'].awardInfo, '');
    assert.match(byName['Tuition Trap Grant'].issue, /ambiguous award amount/);

    // Entries without an independent external link (missing / internal) are dropped.
    assert.ok(!rows.some((row) => row.name === 'No Link Award'));
    assert.ok(!rows.some((row) => row.name === 'Internal Only'));
});

test('Hyperallergic merges split strong titles and removes roundup boilerplate', () => {
    const [row] = parseHyperallergicArticle(`
        <article><h2>Grants &amp; Awards</h2><p>
        <strong>Hyundai Motor Group</strong> – <strong>The 7th VH Award</strong><br>
        A global award for emerging media artists. Read more on Hyperallergic.R391<br>
        Deadline: July 21, 2026 | <a href="https://bit.ly/new-vh-link">Apply</a>
        </p></article>
    `, undefined, 'https://hyperallergic.com/opportunities-in-july-2026/');
    assert.equal(row.name, 'Hyundai Motor Group – The 7th VH Award');
    assert.equal(row.description, 'A global award for emerging media artists.');
});

test('discoverHyperallergic reads the latest roundups newest-first, skips non-roundups, and dedupes', async () => {
    const feedXml = fixture('hyperallergic-feed.xml');
    const article = fixture('hyperallergic-roundup.html');
    const fetched = [];
    const fetcher = async (url) => {
        fetched.push(url);
        if (url.includes('/feed/')) return { text: feedXml, finalUrl: url };
        if (url.includes('july')) return { text: article, finalUrl: url };
        const variant = article
            .replace('<strong>Big Prize</strong>', '<strong>BIG   PRIZE</strong>')
            .replace('https://bigprize.org/enter?ref=hyperallergic.com', 'https://www.bigprize.org/enter/?utm_source=older')
            .replace('https://example.org/vh-award', 'https://bit.ly/older-vh-link');
        return { text: variant, finalUrl: url };
    };
    const definition = { id: 'hyperallergic', name: 'Hyperallergic', url: 'https://hyperallergic.com/tag/opportunities/feed/', roundupMonths: 3 };
    const rows = await discoverHyperallergic(definition, { fetcher });

    // One feed request plus exactly three roundup articles, valid pubDates newest-first;
    // the pubDate-less "May" roundup sorts last and is excluded, the non-roundup item is skipped.
    assert.deepEqual(fetched, [
        'https://hyperallergic.com/tag/opportunities/feed/',
        'https://hyperallergic.com/opportunities-in-july-2026/',
        'https://hyperallergic.com/opportunities-in-june-2026/',
        'https://hyperallergic.com/opportunities-in-april-2026/'
    ]);
    // Canonical URL/name variants across roundups collapse with the newest row winning.
    assert.deepEqual(rows.map((row) => row.name).sort(), [
        'Big Prize',
        'Budget Only Grant',
        'Hyundai Motor Group – The 7th VH Award',
        'New York Fellowship',
        'Tuition Trap Grant',
        'Vermont Studio Center Residency'
    ]);
    assert.equal(rows.find((row) => row.name === 'Big Prize').sourceUrl, 'https://hyperallergic.com/opportunities-in-july-2026/');
    assert.equal(rows.find((row) => /7th VH Award/.test(row.name)).link, 'https://example.org/vh-award');
});

test('normalizeDeadline resolves ranges to the end date and rejects impossible dates', () => {
    assert.equal(normalizeDeadline('October 29, 2026'), '2026-10-29');
    assert.equal(normalizeDeadline('2026-10-29'), '2026-10-29');
    assert.equal(normalizeDeadline('October 1-29, 2026'), '2026-10-29');
    assert.equal(normalizeDeadline('October 1 to 29, 2026'), '2026-10-29');
    assert.equal(normalizeDeadline('October 1–29, 2026'), '2026-10-29');
    assert.equal(normalizeDeadline('between February 16 and March 6, 2026'), '2026-03-06');
    assert.equal(normalizeDeadline('October 1, 2026 - November 5, 2026'), '2026-11-05');
    assert.equal(normalizeDeadline('February 29, 2028'), '2028-02-29');
    assert.equal(normalizeDeadline('February 29, 2026'), '');
    assert.equal(normalizeDeadline('2026-02-31'), '');
    assert.equal(normalizeDeadline('8/1/2026'), '2026-08-01');
    assert.equal(normalizeDeadline('31 July 2026'), '2026-07-31');
    assert.equal(normalizeDeadline('46236'), '2026-08-02');
    assert.equal(normalizeDeadline('02/31/2026'), '');
    assert.equal(normalizeDeadline('rolling'), 'Rolling');
});

test('inferFee recognizes bare fee labels and free applications without misreading awards', () => {
    assert.equal(inferFee('Fee: $40'), 'y');
    assert.equal(inferFee('The application fee is $40.'), 'y');
    assert.equal(inferFee('$10 application fee'), 'y');
    assert.equal(inferFee('Free to enter.'), 'n');
    assert.equal(inferFee('No fee.'), 'n');
    assert.equal(inferFee('Six artists will receive $1,800 stipends.'), '');
});

test('resolveProseEligibility resolves country conservatively and flags conflicts', () => {
    assert.deepEqual(resolveProseEligibility('Open to artists worldwide.'), { country: 'International', issue: '' });
    assert.deepEqual(resolveProseEligibility('Open only to artists based in New York.'), { country: 'United States', issue: '' });
    assert.deepEqual(resolveProseEligibility('Critics may submit essays.'), { country: '', issue: '' });
    assert.match(resolveProseEligibility('Only Colorado residents are eligible. Artists from any country may apply.').issue, /eligibility conflict/);
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

test('source-aware deduplication prefers detailed non-Creative-Capital records', () => {
    const creativeCapital = {
        name: 'Artists Accelerator Program Fall 2026',
        deadline: 'Rolling',
        link: 'https://artist.callforentry.org/festivals_unique_info.php?ID=17654',
        source: 'Creative Capital',
        description: 'Short summary.'
    };
    const creativeWest = {
        ...creativeCapital,
        deadline: '2026-07-17',
        source: 'Creative West Art Opps',
        fees: 'n',
        country: 'United States',
        eligibility_details: 'Only Sonoma County artists may apply.',
        description: 'A much more complete source description.'
    };
    assert.equal(areSameOpportunity(creativeCapital, creativeWest), true);
    assert.deepEqual(deduplicateCandidates([creativeCapital, creativeWest]), [creativeWest]);
    assert.equal(
        mergeCandidate({ ...creativeCapital, status: 'review' }, { ...creativeWest, status: 'review' }).source,
        'Creative West Art Opps'
    );
});

test('cross-source Hyperallergic deduplication handles regenerated links and cycle labels', () => {
    const hyperallergic = {
        name: 'The Bennett Prize – 2026/2027 Award Cycle',
        deadline: 'September 19, 2026',
        link: 'https://bit.ly/generated-link',
        source: 'Hyperallergic',
        description: 'Brief roundup copy.'
    };
    const creativeWest = {
        name: 'The Bennett Prize 5',
        deadline: '2026-09-19',
        link: 'https://artist.callforentry.org/festivals_unique_info.php?ID=16813',
        source: 'Creative West Art Opps',
        fees: 'y',
        country: 'United States',
        eligibility_details: 'Full eligibility details.',
        description: 'Detailed prize description.'
    };
    assert.equal(areSameOpportunity(hyperallergic, creativeWest), true);
    assert.deepEqual(deduplicateCandidates([hyperallergic, creativeWest]), [creativeWest]);
    const artworkArchive = {
        name: 'The Bennett Prize',
        deadline: '46284',
        link: 'https://thebennettprize.org/',
        source: 'Artwork Archive',
        description: 'Less complete listing copy.'
    };
    const directCreativeWest = { ...creativeWest, link: 'https://thebennettprize.org/' };
    assert.equal(areSameOpportunity(artworkArchive, directCreativeWest), true);
    assert.deepEqual(deduplicateCandidates([artworkArchive, directCreativeWest]), [directCreativeWest]);
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
        { name: 'Good Grant', deadline: '2026-08-01', link: 'https://example.org/good', type: 'Grant', fees: 'n', country: 'International', award_info: 'Up to $10,000', status: 'publish' },
        { name: 'Future Job Listing', deadline: '2026-08-02', link: 'https://example.org/job', type: 'Job', fees: 'n', country: 'International', status: 'publish' },
        { name: 'Needs Review', deadline: '2026-08-02', link: 'https://example.org/review', type: 'Grant', fees: 'n', country: 'International', status: 'review' },
        { name: 'Bad Fee', deadline: '2026-08-03', link: 'https://example.org/bad', type: 'Grant', fees: '', country: 'International', status: 'publish' },
        { name: 'Bad Type', deadline: '2026-08-03', link: 'https://example.org/bad-type', type: 'Other', fees: 'n', country: 'International', status: 'publish' },
        { name: 'Expired', deadline: '2026-07-01', link: 'https://example.org/expired', type: 'Grant', fees: 'n', country: 'International', status: 'publish' }
    ], today);
    assert.deepEqual(result.published, [{ name: 'Good Grant', deadline: '8/1/2026', link: 'https://example.org/good', type: 'Grant', fees: 'n', country: 'International', award_info: 'Up to $10,000' }]);
    assert.equal(result.rejected.length, 4);
    assert.deepEqual(result.rejected.find((row) => row.name === 'Future Job Listing')?.errors, ['type is not yet public']);
    assert.deepEqual(result.rejected.find((row) => row.name === 'Bad Type')?.errors, ['type']);
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
        },
        fetcher: async (url) => ({ text: '<main>No contact link</main>', finalUrl: url })
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].link, 'https://apply.example/1');
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
        assert.equal(mapCreativeWestItem(creativeWestItem({ name: 'Regional Artist Opportunity', type: apiType })).type, expected);
    }
    assert.equal(mapCreativeWestItem(creativeWestItem({ name: '2026 National Juried Photography Exhibition', type: 'GRANT' })).type, 'Exhibition');
    assert.equal(mapCreativeWestItem(creativeWestItem({ name: 'The Bennett Prize 5', type: 'GRANT' })).type, 'Award');
    assert.equal(mapCreativeWestItem(creativeWestItem({ name: 'Winter Issue: Open Call for Submissions', type: 'GRANT' })).type, 'Open Call');
    assert.equal(mapCreativeWestItem(creativeWestItem({ name: 'Call for Artists: Pediatric Hospital', type: 'COMMISSION' })).type, 'Commission');
    assert.deepEqual(creativeWestDeadline(creativeWestItem()), { deadline: '2026-07-31', issue: '' });
    assert.deepEqual(creativeWestDeadline(creativeWestItem({ rollingDeadline: true })), { deadline: 'Rolling', issue: '' });
    assert.match(creativeWestDeadline(creativeWestItem({ originalTimezone: 'CEST' })).issue, /unknown deadline timezone/);
    const fallback = mapCreativeWestItem(creativeWestItem({ sourceUrl: '', applyUrl: '' }), {
        id: 'creative_west', name: 'Creative West Art Opps', url: 'https://opportunities.wearecreativewest.org'
    });
    assert.equal(fallback.link, 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE');
    assert.match(fallback.issue, /application platform: CaFÉ/);
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

test('Creative West extracts an independent organizer link from Contact Information', () => {
    const page = `
        <main>
            <a href="https://artist.callforentry.org/apply/1">Apply on CaFÉ</a>
            <h2>Contact Information</h2>
            <p><a href="https://organizer.example/opportunity">Independent organizer</a></p>
            <h2>Requirement Overview</h2>
        </main>
    `;
    assert.equal(
        creativeWestIndependentLink(page, 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE'),
        'https://organizer.example/opportunity'
    );
    const mapped = mapCreativeWestItem(creativeWestItem({ independentUrl: 'https://organizer.example/opportunity' }));
    assert.equal(mapped.link, 'https://organizer.example/opportunity');
    assert.equal(mapped.sourceUrl, 'https://opportunities.wearecreativewest.org/opportunity/1/CAFE');
    assert.doesNotMatch(mapped.issue, /application platform/);
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

test('normalization retains specific eligibility issues and Sheet values follow the derived 19-column schema safely', () => {
    const row = normalizeCandidate({
        name: 'Conflicted Eligibility', deadline: 'August 1, 2026', link: 'https://example.org/conflict', type: 'Grant', fees: 'n',
        issue: 'eligibility conflict: region=INTERNATIONAL; text restricts applicants to Colorado', eligibilityDetails: 'Colorado only'
    }, today);
    assert.match(row.issue, /eligibility conflict/);
    assert.match(row.issue, /unresolved eligibility/);
    assert.equal(row.eligibility_details, 'Colorado only');
    assert.equal(SHEET_HEADERS.length, 19);
    assert.equal(columnLetter(19), 'S');
    assert.equal(columnLetter(27), 'AA');
    assert.equal(escapeSheetValue('=HYPERLINK("https://bad")'), "'=HYPERLINK(\"https://bad\")");
    assert.equal(escapeSheetValue('plain text'), 'plain text');
    const values = rowValues({ ...Object.fromEntries(SHEET_HEADERS.map((header) => [header, 'x'])), name: '=danger' });
    assert.equal(values.length, 19);
    assert.equal(values[0], "'=danger");
});

test('Sheet writes use the schema-derived S column and keep manual public values', async () => {
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
    assert.equal(calls.appends[0].range, "'Opportunities'!A:S");
    assert.equal(calls.appends[0].requestBody.values[0].length, 19);
    assert.equal(calls.appends[0].requestBody.values[0][0], "'=formula");
    assert.equal(calls.appends[0].valueInputOption, 'RAW');
    const current = { name: 'Editor title', deadline: '2026-08-01', link: 'https://example.org/editor', type: 'Grant', fees: 'n', country: 'United States', status: 'publish' };
    assert.equal(mergeCandidate(current, { ...current, name: 'Crawler title', status: 'review' }).name, 'Editor title');
});

test('upsert skips brand-new already-expired candidates but still flags existing rows that expire', async () => {
    const calls = { updates: [], appends: [] };
    const existingRow = SHEET_HEADERS.map((header) => {
        if (header === 'name') return 'Still Open Grant';
        if (header === 'link') return 'https://example.org/still-open';
        if (header === 'deadline') return '2026-01-01';
        if (header === 'status') return 'review';
        if (header === 'id') return 'existing-id';
        return 'value';
    });
    const sheet = {
        spreadsheets: {
            values: {
                get: async ({ range }) => ({ data: { values: range.endsWith('1:1') ? [SHEET_HEADERS] : [SHEET_HEADERS, existingRow] } }),
                batchUpdate: async (value) => calls.updates.push(value),
                append: async (value) => calls.appends.push(value)
            },
            get: async () => ({ data: { sheets: [{ properties: { title: 'Opportunities', sheetId: 1 } }] } }),
            batchUpdate: async () => {}
        }
    };
    const brandNewExpired = normalizeCandidate({
        name: 'Already Closed Call', deadline: 'January 1, 2026', link: 'https://example.org/closed', type: 'Grant', fees: 'n', country: 'International', source: 'Hyperallergic'
    }, today);
    // Same identity (link/name/deadline) as the sheet's existing row, so it matches via
    // fingerprint and takes the merge/update path rather than the new-append path.
    const stillOpenUpdate = normalizeCandidate({
        name: 'Still Open Grant', deadline: 'January 1, 2026', link: 'https://example.org/still-open', type: 'Grant', fees: 'n', country: 'International', source: 'Hyperallergic'
    }, today);
    const result = await upsertCandidates([brandNewExpired, stillOpenUpdate], {
        sheets: sheet, spreadsheetId: 'test', sheetName: 'Opportunities'
    });
    assert.equal(calls.appends.length, 0);
    assert.equal(result.added, 0);
    assert.equal(result.skippedExpired, 1);
    assert.equal(result.updated, 1);
});
