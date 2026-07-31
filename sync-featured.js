#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchText } from './opportunity-pipeline/http.js';
import { compareByRecency, FEATURED_TAG, FEED_URL, parseFeaturedFeed } from './featured-pipeline/feed.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.join(directory, 'data', 'featured.json');

/* The feed holds ten posts, a fortnight or so of publishing, and only some of
   them are tagged. A quiet week would otherwise drop a still-current article out
   of the roster, and would break the article page of anything already linked, so
   what has been seen is kept. The home page shows the newest two regardless. */
export const ARCHIVE_LIMIT = 12;

function readExisting(destination) {
    try {
        const parsed = JSON.parse(fs.readFileSync(destination, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function mergeArticles(existing, incoming, { limit = ARCHIVE_LIMIT } = {}) {
    const bySlug = new Map(existing.map((article) => [article.slug, article]));
    // The feed is the live copy: a post edited after publication should win.
    for (const article of incoming) bySlug.set(article.slug, article);
    return [...bySlug.values()].sort(compareByRecency).slice(0, limit);
}

export async function syncFeatured({ destination = outputFile, fetcher = fetchText, url = FEED_URL, tag = FEATURED_TAG } = {}) {
    const { text } = await fetcher(url);
    const incoming = parseFeaturedFeed(text, { tag });
    const merged = mergeArticles(readExisting(destination), incoming);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(merged, null, 2)}\n`);
    return { incoming, merged };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    syncFeatured().then(({ incoming, merged }) => {
        console.log(`Found ${incoming.length} article(s) tagged ${FEATURED_TAG}; wrote ${merged.length} to ${outputFile}`);
        if (!incoming.length) console.warn('No tagged articles in the current feed window; kept the existing roster.');
    }).catch((error) => {
        console.error(`Featured sync failed: ${error.stack || error.message}`);
        process.exitCode = 1;
    });
}
