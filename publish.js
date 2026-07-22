#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { NON_PUBLIC_TYPES, PUBLIC_FIELDS, PUBLISHED_EXTRA_FIELDS } from './opportunity-pipeline/config.js';
import { formatPublicDeadline, normalizeDeadline, validatePublishable } from './opportunity-pipeline/normalize.js';
import { readRows } from './opportunity-pipeline/sheets.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.join(directory, 'data', 'opportunities.json');

export function buildPublishedRows(rows, now = new Date()) {
    const published = [];
    const rejected = [];
    for (const row of rows) {
        const status = String(row.status).trim().toLowerCase();
        if (!['publish', 'manual publish'].includes(status)) continue;
        const normalized = { ...row, deadline: normalizeDeadline(row.deadline), fees: String(row.fees).toLowerCase() };
        if (NON_PUBLIC_TYPES.some((type) => type.toLowerCase() === String(normalized.type || '').toLowerCase())) {
            rejected.push({ name: row.name || '(unnamed)', errors: ['type is not yet public'] });
            continue;
        }
        const errors = validatePublishable(normalized, now);
        if (errors.length) {
            rejected.push({ name: row.name || '(unnamed)', errors });
            continue;
        }
        normalized.deadline = formatPublicDeadline(normalized.deadline);
        const publishedFields = [...PUBLIC_FIELDS, ...PUBLISHED_EXTRA_FIELDS];
        published.push(Object.fromEntries(publishedFields.map((field) => [field, normalized[field]])));
    }
    published.sort((left, right) => {
        if (left.deadline === 'Rolling') return 1;
        if (right.deadline === 'Rolling') return -1;
        return new Date(left.deadline) - new Date(right.deadline) || left.name.localeCompare(right.name);
    });
    return { published, rejected };
}

export async function publish({ rows, destination = outputFile, now = new Date() } = {}) {
    const sourceRows = rows || await readRows();
    const result = buildPublishedRows(sourceRows, now);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(result.published, null, 2)}\n`);
    return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    publish().then(({ published, rejected }) => {
        console.log(`Published ${published.length} opportunities to ${outputFile}`);
        if (rejected.length) console.warn(`Skipped ${rejected.length} invalid publish rows: ${JSON.stringify(rejected)}`);
    }).catch((error) => {
        console.error(`Publishing failed: ${error.stack || error.message}`);
        process.exitCode = 1;
    });
}
