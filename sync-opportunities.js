#!/usr/bin/env node

import { SOURCE_DEFINITIONS } from './opportunity-pipeline/config.js';
import { discoverArtworkArchiveExport, discoverSource } from './opportunity-pipeline/adapters.js';
import { readArtworkArchiveExport } from './opportunity-pipeline/artwork-archive-export.js';
import { deduplicateCandidates } from './opportunity-pipeline/dedupe.js';
import { candidateImportExclusion, normalizeCandidate, shouldImportCandidate } from './opportunity-pipeline/normalize.js';
import { upsertCandidates } from './opportunity-pipeline/sheets.js';

const dryRun = process.argv.includes('--dry-run');
const sourceArgumentIndex = process.argv.indexOf('--source');
const requestedSource = sourceArgumentIndex >= 0 ? process.argv[sourceArgumentIndex + 1] : (process.env.OPPORTUNITY_SOURCE || 'all');
const exportArgumentIndex = process.argv.indexOf('--artwork-archive-export');
const artworkArchiveExport = exportArgumentIndex >= 0 ? process.argv[exportArgumentIndex + 1] : '';
const now = new Date();

async function main() {
    const enabled = SOURCE_DEFINITIONS.filter((definition) => (definition.enabled ||
        (definition.id === 'artwork_archive' && requestedSource === 'artwork_archive')) &&
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
    const candidates = deduplicateCandidates(normalized.filter(shouldImportCandidate));
    const summary = {
        sourcesSucceeded: settled.filter((result) => result.status === 'fulfilled').length,
        sourcesFailed: failures.length,
        candidates: candidates.length,
        publishableAfterReview: candidates.filter((candidate) => !candidate.issue && candidate.status !== 'expired').length,
        needsReview: candidates.filter((candidate) => candidate.status === 'review').length,
        expired: candidates.filter((candidate) => candidate.status === 'expired').length,
        excludedUntypedCreativeCapital,
        excludedCreativeCapitalSourceDuplicates
    };

    if (dryRun) {
        console.log(JSON.stringify({ summary, sample: candidates.slice(0, 10) }, null, 2));
        return;
    }
    const sheet = await upsertCandidates(candidates);
    console.log(JSON.stringify({ ...summary, sheet }, null, 2));
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
