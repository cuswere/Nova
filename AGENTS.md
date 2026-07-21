# AGENTS.md — Praxis Nova

Shared guidance for AI coding agents (Claude Code, Codex, etc.). This is the
canonical project memory: read it instead of re-deriving the workflow. Keep it
current when the **architecture** changes (not for every data update).

## What this is

A static site — an updating roster of artist opportunities (grants, residencies,
exhibitions, commissions…). Plain HTML/CSS/JS, **no build step, no framework, no
backend, no database**. That minimalism is intentional (see README "Design
principles"). The frontend just does a client-side `fetch('data/opportunities.json')`
in `app.js`.

## Commands

- `npm test` — parser / normalization / review-preservation / publish tests (`node --test`).
- `npm run dry-run-opportunities` — fetch enabled sources, print a summary, **no Sheet writes**.
- `npm run sync-opportunities` — upsert candidates into the Sheet.
- `npm run publish-data` — validate `publish` rows → regenerate `data/opportunities.json`.
- `npm run import-artwork-archive` — manual Artwork Archive import.
- Serve locally: `npx serve .` or `python -m http.server` (the JSON fetch is blocked over `file://`).

## Data pipeline (the important part)

```
source boards → deterministic extraction → Google Sheet review → static JSON → site
```

1. **Discovery** — GitHub Action `.github/workflows/opportunities.yml` (cron 14:00 UTC,
   gated by repo vars `AUTOMATION_ACTIVE` + `FREQUENCY_DAYS`) runs `sync-opportunities`,
   upserting new rows into the **"Nova Sources"** Google Sheet as `status=review` by
   default. Sources flagged `autoPublish: true` in `SOURCE_DEFINITIONS` (currently the
   four verified tier-1 sources: Artwork Archive, Creative Capital, Creative West,
   Hyperallergic) skip review instead — a brand-new candidate from one of them lands
   as `status=publish` directly, unless it has an extraction `issue` (missing name,
   link, deadline, or type) or is already past its deadline, in which case it still
   goes to `review`/`expired` for a human to look at. This only applies at first
   collection; a `review` row from one of these sources that already exists in the
   Sheet does not get retroactively promoted on a later re-fetch. Existing
   `publish`/`reject` rows are left fully intact regardless of source — a re-fetch
   that matches one only advances its `last_seen`/`checked_at` bookkeeping, never its
   content.
2. **Human curation** — a reviewer sets each `review` row to `publish` or `reject` in the Sheet.
3. **Publish** — the same Action runs `publish-data` (`publish.js`): keeps only
   `status=publish` rows that pass `validatePublishable` (needs name, link, deadline,
   an allowed `type`, not expired, not a `NON_PUBLIC_TYPES` value) → strips to the 7
   public fields plus the `PUBLISHED_EXTRA_FIELDS` (`fee_details`,
   `eligibility_details` — carried into the JSON for the frontend, e.g. the
   fee-details hover popup, but not part of the leading Sheet-column contract) →
   sorts by deadline → overwrites `data/opportunities.json`, commits, pushes.
   To push Sheet curation live without re-fetching sources (no wait, no risk of a
   scrape rate-limit or transient failure mid-review), run the manual-only
   `.github/workflows/publish-only.yml` Action instead — it skips `sync-opportunities`
   and just runs `publish-data` + commit.
4. **Frontend** — `app.js` fetches that JSON. No backend.

**Key files**
- `opportunity-pipeline/config.js` — `PUBLIC_FIELDS` (`name, deadline, link, type, fees, country, award_info`), `PUBLISHED_EXTRA_FIELDS` (`fee_details, eligibility_details`), `SHEET_HEADERS`, `NON_PUBLIC_TYPES` (`['Job']`).
- `opportunity-pipeline/normalize.js` — extraction/inference + `validatePublishable`.
- `opportunity-pipeline/sheets.js` — Sheet read/write, review-decision preservation.
- `publish.js` — `buildPublishedRows`, `publish`.
- `sync-opportunities.js` — source fetch + upsert entry point.

**The Sheet** — "Nova Sources" (Drive id `120ZqG_0qZR76b4kYHdzPK-4OKecjk7MaZcKuQRRLcbI`).
Two tabs: an Opportunities tab (candidate rows) and a sources-config tab
(`source, url, tier, enabled, adapter, last_checked, notes`). The first 6 Sheet
columns are the **public site contract**. `fees` = application fee only (blank = unknown,
which the MVP frontend may render as free). `country` = applicant eligibility, optional.

> **Gotcha:** a candidate reaches the website only after a human flips it to
> `status=publish` **and** `publish-data` runs. An empty `data/opportunities.json`
> almost always means "nothing curated to publish yet," **not** a bug.

## Sources

Automated (`enabled=y`): **Creative Capital, Creative West, Hyperallergic**. **Artwork
Archive** is collected manually via a DevTools/bookmarklet snippet in `tools/`
(deliberately excluded from Actions — needs a real browser session). Others
(TransArtists, NYFA, Res Artis, LMCC, Masdearte, Arte Informado, Artenda) are disabled
/ deferred — some blocked (HTTP 403, client-rendered JS), some phase-two.

## AI enrichment

Intentionally **disabled** during beta. Missing/ambiguous fields stay flagged for human
review rather than triggering paid model calls. (`openai` is a dependency but dormant.)

## Conventions

- **Work directly on `main`; ask before creating feature branches.**
- No build step / no framework / minimal deps — keep it that way.
- Prefer relative links so the site works from any hosting path.

## Snapshot (2026-07-20 — VOLATILE, re-check before trusting)

127 candidate rows, **all `status=review`** (0 publish, 0 reject) → the site currently
serves `[]`. Extraction looks healthy (avg confidence ~0.72, 1 row issue-flagged). To
get opportunities live, curate rows to `publish` in the Sheet, then run `publish-data`.
To verify current numbers, read the Sheet or count `publish` rows — do not trust this
paragraph's counts.
