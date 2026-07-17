#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArtworkArchive } from './opportunity-pipeline/adapters.js';
import { SOURCE_DEFINITIONS } from './opportunity-pipeline/config.js';
import { makeId, normalizeCandidate } from './opportunity-pipeline/normalize.js';
import { upsertCandidates } from './opportunity-pipeline/sheets.js';

const definition = SOURCE_DEFINITIONS.find((source) => source.id === 'artwork_archive');

export function candidatesFromArtworkArchiveExport(payload, now = new Date()) {
    if (payload?.source !== 'artwork_archive' || !Array.isArray(payload.pages)) {
        throw new Error('Not a Nova Artwork Archive export');
    }

    const candidates = payload.pages.flatMap((page) => {
        if (typeof page?.html !== 'string') throw new Error('Export page is missing HTML');
        return parseArtworkArchive(page.html, definition).map((row) => {
            const candidate = normalizeCandidate(row, now);
            // Keep the Artwork Archive detail URL as identity so replacing its public
            // link with Learn More's external destination updates existing Sheet rows.
            if (row.sourceListingUrl) candidate.id = makeId({ ...candidate, link: row.sourceListingUrl });
            return candidate;
        });
    });
    return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

async function main() {
    const filename = process.argv[2];
    const dryRun = process.argv.includes('--dry-run');
    if (!filename || filename === '--dry-run') {
        throw new Error('Usage: npm run import-artwork-archive -- <export.json> [--dry-run]');
    }

    const payload = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const candidates = candidatesFromArtworkArchiveExport(payload);
    if (!candidates.length) throw new Error('The export contains no parseable opportunities');

    if (dryRun) {
        console.log(JSON.stringify({ candidates: candidates.length, sample: candidates.slice(0, 10) }, null, 2));
        return;
    }

    const sheet = await upsertCandidates(candidates);
    console.log(JSON.stringify({ candidates: candidates.length, sheet }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`Artwork Archive import failed: ${error.stack || error.message}`);
        process.exitCode = 1;
    });
}
