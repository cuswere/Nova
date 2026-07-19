#!/usr/bin/env node

import { SOURCE_DEFINITIONS } from './opportunity-pipeline/config.js';
import { discoverArtworkArchiveExport, discoverSource } from './opportunity-pipeline/adapters.js';
import { readArtworkArchiveExport } from './opportunity-pipeline/artwork-archive-export.js';
import { deduplicateCandidatesWithSummary } from './opportunity-pipeline/dedupe.js';
import { candidateImportExclusion, inferFee, normalizeCandidate, shouldImportCandidate } from './opportunity-pipeline/normalize.js';
import { upsertCandidates } from './opportunity-pipeline/sheets.js';

const dryRun = process.argv.includes('--dry-run');
const sourceArgumentIndex = process.argv.indexOf('--source');
const requestedSource = sourceArgumentIndex >= 0 ? process.argv[sourceArgumentIndex + 1] : (process.env.OPPORTUNITY_SOURCE || 'all');
const exportArgumentIndex = process.argv.indexOf('--artwork-archive-export');
const artworkArchiveExport = exportArgumentIndex >= 0 ? process.argv[exportArgumentIndex + 1] : '';
const now = new Date();

async function main() {
    const includeLocalArtworkArchive = requestedSource === 'artwork_archive' ||
        (requestedSource === 'all' && process.env.GITHUB_ACTIONS !== 'true');
    const enabled = SOURCE_DEFINITIONS.filter((definition) => (definition.enabled ||
        (definition.id === 'artwork_archive' && includeLocalArtworkArchive)) &&
        (requestedSource === 'all' || definition.id === requestedSource));
    if (requestedSource !== 'all' && !SOURCE_DEFINITIONS.some((definition) => definition.id === requestedSource)) {
        throw new Error(`Unknown opportunity source: ${requestedSource}`);
    }
    if (!enabled.length) throw new Error(`Opportunity source is disabled: ${requestedSource}`);
    const settled = await Promise.allSettled(enabled.map(async (definition) => ({
        definition,
        rows: await discover(definition)
    })));

    const raw = [];
    const failures = [];
    for (const result of settled) {
        if (result.status === 'fulfilled') {
            raw.push(...result.value.rows);
            console.log(`${result.value.definition.name}: discovered ${result.value.rows.length}`);
        } else {
            failures.push(result.reason?.message || String(result.reason));
            console.warn(`Source failed: ${result.reason?.message || result.reason}`);
        }
    }
    if (!raw.length) throw new Error(`No opportunities discovered. ${failures.join(' | ')}`);

    const normalized = raw.map((row) => normalizeCandidate(row, now));
    const exclusionReasons = normalized.map(candidateImportExclusion);
    const excludedUntypedCreativeCapital = exclusionReasons.filter((reason) => reason === 'untyped_creative_capital').length;
    const excludedCreativeCapitalSourceDuplicates = exclusionReasons.filter((reason) => reason === 'duplicate_source_creative_capital').length;
    const deduplicated = deduplicateCandidatesWithSummary(normalized.filter(shouldImportCandidate));
    const candidates = deduplicated.candidates;
    const summary = {
        sourcesSucceeded: settled.filter((result) => result.status === 'fulfilled').length,
        sourcesFailed: failures.length,
        candidates: candidates.length,
        publishableAfterReview: candidates.filter((candidate) => !candidate.issue && candidate.status !== 'expired').length,
        needsReview: candidates.filter((candidate) => candidate.status === 'review').length,
        expired: candidates.filter((candidate) => candidate.status === 'expired').length,
        excludedUntypedCreativeCapital,
        excludedCreativeCapitalSourceDuplicates,
        excludedDuplicatesByReason: deduplicated.excludedByReason
    };

    if (dryRun) {
        console.log(JSON.stringify({ summary, audit: auditCandidates(candidates), sample: candidates.slice(0, 10) }, null, 2));
        return;
    }
    const sheet = await upsertCandidates(candidates);
    console.log(JSON.stringify({ ...summary, sheet }, null, 2));
}

function auditCandidates(candidates) {
    const describe = (candidate, reason) => ({
        name: candidate.name,
        source: candidate.source,
        reason
    });
    const audit = {
        unexpectedSources: [],
        missingRequired: [],
        malformedDeadlines: [],
        trackingLinks: [],
        cafeFallbackLinks: [],
        knownFeeBlanks: [],
        countryContradictions: [],
        reviewIssues: []
    };
    const approvedSourceIds = new Set(['artwork_archive', 'creative_capital', 'creative_west', 'hyperallergic']);
    const approvedSources = new Set(SOURCE_DEFINITIONS
        .filter((definition) => approvedSourceIds.has(definition.id))
        .map((definition) => definition.name));
    const trackingParameter = /[?&](?:gclid|gbraid|fbclid|msclkid|gad_[^=&#]*|hsa_[^=&#]*)=/i;
    const foreignEligibility = /\b(?:Australia|Australian|United Kingdom|UK-based|Canada|Canadian|New Zealand|European Union|EU residents?)\b/i;

    for (const candidate of candidates) {
        if (!approvedSources.has(candidate.source)) {
            audit.unexpectedSources.push(describe(candidate, candidate.source || 'blank source'));
        }
        const missing = ['name', 'link', 'deadline', 'description', 'type'].filter((field) => !String(candidate[field] || '').trim());
        if (missing.length) audit.missingRequired.push(describe(candidate, missing.join(', ')));
        if (!/^(?:Rolling|\d{4}-\d{2}-\d{2})$/.test(candidate.deadline || '')) {
            audit.malformedDeadlines.push(describe(candidate, candidate.deadline || 'blank'));
        }
        if (trackingParameter.test(candidate.link || '')) {
            audit.trackingLinks.push(describe(candidate, candidate.link));
        }
        if (/https?:\/\/(?:[^/]+\.)?(?:callforentry\.org|zapplication\.org)(?:\/|$)/i.test(candidate.link || '')) {
            audit.cafeFallbackLinks.push(describe(candidate, candidate.link));
        }
        if (!candidate.fees && inferFee(`${candidate.description || ''} ${candidate.fee_details || ''}`)) {
            audit.knownFeeBlanks.push(describe(candidate, 'fee prose was deterministically recognizable'));
        }
        if (candidate.country === 'United States' && foreignEligibility.test(candidate.eligibility_details || candidate.description || '')) {
            audit.countryContradictions.push(describe(candidate, 'United States conflicts with foreign applicant prose'));
        }
        if (candidate.issue) audit.reviewIssues.push(describe(candidate, candidate.issue));
    }
    return audit;
}

async function discover(definition) {
    if (definition.id !== 'artwork_archive') return discoverSource(definition);
    const { filename, payload } = readArtworkArchiveExport(artworkArchiveExport || undefined);
    console.log(`Artwork Archive: using ${filename}`);
    return discoverArtworkArchiveExport(payload, definition).map((row) => ({
        ...row,
        identityUrl: row.sourceListingUrl
    }));
}

main().catch((error) => {
    console.error(`Opportunity sync failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
