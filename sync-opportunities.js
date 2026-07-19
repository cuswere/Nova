#!/usr/bin/env node

import { SOURCE_DEFINITIONS } from './opportunity-pipeline/config.js';
import { discoverSource } from './opportunity-pipeline/adapters.js';
import { deduplicateCandidates } from './opportunity-pipeline/dedupe.js';
import { normalizeCandidate } from './opportunity-pipeline/normalize.js';
import { upsertCandidates } from './opportunity-pipeline/sheets.js';

const dryRun = process.argv.includes('--dry-run');
const requestedSource = process.env.OPPORTUNITY_SOURCE || 'all';
const now = new Date();

async function main() {
    const enabled = SOURCE_DEFINITIONS.filter((definition) => definition.enabled &&
        (requestedSource === 'all' || definition.id === requestedSource));
    if (requestedSource !== 'all' && !SOURCE_DEFINITIONS.some((definition) => definition.id === requestedSource)) {
        throw new Error(`Unknown opportunity source: ${requestedSource}`);
    }
    if (!enabled.length) throw new Error(`Opportunity source is disabled: ${requestedSource}`);
    const settled = await Promise.allSettled(enabled.map(async (definition) => ({
        definition,
        rows: await discoverSource(definition)
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

    const candidates = deduplicateCandidates(raw.map((row) => normalizeCandidate(row, now)));
    const summary = {
        sourcesSucceeded: settled.filter((result) => result.status === 'fulfilled').length,
        sourcesFailed: failures.length,
        candidates: candidates.length,
        publishableAfterReview: candidates.filter((candidate) => !candidate.issue && candidate.status !== 'expired').length,
        needsReview: candidates.filter((candidate) => candidate.status === 'review').length,
        expired: candidates.filter((candidate) => candidate.status === 'expired').length
    };

    if (dryRun) {
        console.log(JSON.stringify({ summary, sample: candidates.slice(0, 10) }, null, 2));
        return;
    }
    const sheet = await upsertCandidates(candidates);
    console.log(JSON.stringify({ ...summary, sheet }, null, 2));
}

main().catch((error) => {
    console.error(`Opportunity sync failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
