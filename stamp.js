/* Cache busting. Every runtime asset URL carries a short hash of its own bytes,
   so a file that changed lands at an address no browser has a cached copy of.
   Browsers key their cache on the exact URL and are free to keep an entry well
   past its max-age — a client was once served a four-month-old
   data/opportunities.json — so freshness has to live in the address itself.

   Run after anything writes to styles.css, scripts/ or data/; see docs/stamp.md. */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

const STAMP = /\?v=[0-9a-f]{8}/g;
// Every quoted string in the file; the ones that resolve to an asset get stamped,
// which covers href=, src=, import ... from, and fetch() without parsing each.
const QUOTED = /(['"])([^'"\n]+?)\1/g;

const absolute = (file) => path.join(root, ...file.split('/'));
const read = (file) => fs.readFileSync(absolute(file), 'utf8');

function list(dir, extension) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full)
        .filter((name) => name.endsWith(extension))
        .map((name) => (dir === '.' ? name : `${dir}/${name}`))
        .sort();
}

/* The HTML files are deliberately absent: they are the entry point, so nothing
   upstream can rename them. They stay on plain revalidation, which is the one
   cache behaviour that has proven reliable. */
const assets = new Set(['styles.css', ...list('scripts', '.js'), ...list('data', '.json')]);
const containers = [...list('.', '.html'), ...list('scripts', '.js')];

const original = new Map(containers.map((file) => [file, read(file)]));
// Strip old stamps first so hashes describe the source, not the last run's output.
const cleaned = new Map(containers.map((file) => [file, original.get(file).replace(STAMP, '')]));
const stamped = new Map();
const hashes = new Map();

/* An import specifier resolves against the importing module, everything else
   (fetch, href, src) against the document at the site root — same as the browser. */
function resolveRef(fromFile, spec) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//') || spec.startsWith('#')) return null;
    const base = spec.startsWith('.') ? path.posix.dirname(fromFile) : '.';
    const resolved = path.posix.normalize(path.posix.join(base, spec.split('?')[0]));
    return resolved.startsWith('..') ? null : resolved;
}

function stampText(file, text) {
    return text.replace(QUOTED, (match, quote, spec) => {
        const target = resolveRef(file, spec);
        if (!target || !assets.has(target)) return match;
        return `${quote}${spec}?v=${hashOf(target)}${quote}`;
    });
}

/* Post-order by construction: a container is hashed only after the references
   inside it have been resolved, since stamping them changes its own bytes. */
function hashOf(file) {
    if (hashes.has(file)) {
        const known = hashes.get(file);
        if (known === null) throw new Error(`Circular asset reference at ${file}`);
        return known;
    }
    hashes.set(file, null);

    const content = cleaned.has(file)
        ? stampText(file, cleaned.get(file))
        : fs.readFileSync(absolute(file));
    if (cleaned.has(file)) stamped.set(file, content);

    const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
    hashes.set(file, hash);
    return hash;
}

export function stamp() {
    containers.forEach(hashOf);

    const written = [];
    for (const [file, text] of stamped) {
        if (text === original.get(file)) continue;
        fs.writeFileSync(absolute(file), text);
        written.push(file);
    }
    return { written, hashes: new Map([...hashes].filter(([file]) => assets.has(file))) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const { written, hashes: assetHashes } = stamp();
        for (const [file, hash] of assetHashes) console.log(`  ${hash}  ${file}`);
        console.log(written.length ? `Stamped ${written.length} file(s): ${written.join(', ')}` : 'Already up to date.');
    } catch (error) {
        console.error(`Stamping failed: ${error.stack || error.message}`);
        process.exitCode = 1;
    }
}
