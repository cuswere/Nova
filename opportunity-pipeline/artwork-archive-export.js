import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverArtworkArchiveExport } from './adapters.js';
import { SOURCE_DEFINITIONS } from './config.js';
import { normalizeCandidate } from './normalize.js';

const EXPORT_FILENAME = /^nova-artwork-archive-\d{4}-\d{2}-\d{2}(?: \(\d+\))?\.json$/i;

export function artworkArchiveDownloadsDirectory(homeDirectory = os.homedir()) {
    return path.join(homeDirectory, 'Downloads');
}

export function findLatestArtworkArchiveExport(downloadsDirectory = artworkArchiveDownloadsDirectory()) {
    let entries;
    try {
        entries = fs.readdirSync(downloadsDirectory, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }

    const exports = entries
        .filter((entry) => entry.isFile() && EXPORT_FILENAME.test(entry.name))
        .map((entry) => {
            const filename = path.join(downloadsDirectory, entry.name);
            return { filename, modifiedAt: fs.statSync(filename).mtimeMs };
        })
        .sort((left, right) => right.modifiedAt - left.modifiedAt || right.filename.localeCompare(left.filename));
    return exports[0]?.filename || '';
}

export function readArtworkArchiveExport(filename = findLatestArtworkArchiveExport()) {
    if (!filename) {
        throw new Error(`No Artwork Archive export found in ${artworkArchiveDownloadsDirectory()}`);
    }
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read Artwork Archive export ${filename}: ${error.message}`);
    }
    if (payload?.source !== 'artwork_archive' || !Array.isArray(payload.pages)) {
        throw new Error(`${filename} is not a Nova Artwork Archive export`);
    }
    return { filename, payload };
}

export function candidatesFromArtworkArchiveExport(payload, now = new Date()) {
    if (payload?.source !== 'artwork_archive' || !Array.isArray(payload.pages)) {
        throw new Error('Not a Nova Artwork Archive export');
    }

    const definition = SOURCE_DEFINITIONS.find((source) => source.id === 'artwork_archive');
    return [...new Map(discoverArtworkArchiveExport(payload, definition).map((row) => {
        const candidate = normalizeCandidate({ ...row, identityUrl: row.sourceListingUrl }, now);
        return [candidate.id, candidate];
    })).values()];
}
