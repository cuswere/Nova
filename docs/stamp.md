# Cache stamping

`stamp.js` appends a content hash to every runtime asset URL:

```html
<link rel="stylesheet" href="styles.css?v=d89d0ecf">
```

Run it with `npm run stamp`. The publish and sync scripts run it automatically.

## Why

Browsers cache by exact URL. GitHub Pages serves everything with
`Cache-Control: max-age=600` and gives us no way to change that, but `max-age`
is advice about freshness, not a promise to evict: a client was once served a
`data/opportunities.json` from four months earlier while their HTML, CSS and JS
were all current.

Data loaded by `fetch()` is the worst case. An ordinary reload revalidates the
document and the resources the parser finds — the stylesheet, the module
scripts — but not requests JavaScript issues later. That is why the stale data
survived a soft refresh and only gave way to Ctrl+Shift+R, which no visitor
thinks to press.

A hash in the URL sidesteps all of it. Change the file and its address changes,
so the browser has nothing filed under the new address and must fetch. Leave the
file alone and the address is stable, so the cached copy is still used — the
caching we want is kept, the staleness is not.

Stale data fails quietly here, which is what made it hard to notice:
`deadlineTime` maps an unparseable deadline to `Infinity`, so an old file decays
into a nearly empty page that still looks like a working site rather than an
error.

## What is stamped

`styles.css`, everything in `scripts/`, and everything in `data/` — including
the imports *between* modules, since `./shared.js` and `./featured.js` are
separate cache entries from the entry point that imports them.

The four HTML files are not stamped and cannot be: they are the entry point, so
nothing upstream can rename them. They rely on revalidation, which is the cache
behaviour that has proven reliable, and they become the single source of truth
for which version a visitor gets. The 10-minute window still applies to them.

## How it works

Hashes are per file, so a CSS tweak does not force everyone to re-download the
190KB opportunities data.

The script strips existing `?v=` stamps before hashing, so it describes the
source rather than the last run and is safe to run repeatedly — a second run
reports `Already up to date`.

Files are hashed in dependency order. A module's hash covers the stamps written
inside it, so editing `shared.js` changes the hash of every module importing it,
and those modules' new hashes propagate into the HTML. Anything not on that path
keeps its old hash and stays cached.

## Caveats

- Stamps live in tracked files, so `git diff` shows them churning on every
  publish. Expected.
- Hand-editing `styles.css` or a script without re-running the stamp leaves that
  file's old URL in the HTML — visitors keep the cached copy. Run `npm run
  stamp` before committing; the sync scripts cover the data path automatically.
