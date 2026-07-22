# AGENTS.md — Praxis Nova

Canonical engineering guidance for this project. Update it when the architecture changes, not for routine data updates.

## Architecture

Praxis Nova is a static artist-opportunity catalogue built with plain HTML, CSS, and JavaScript. It intentionally has no framework, build step, backend, or database. Browser modules in `scripts/` load `data/opportunities.json` directly.

```text
source boards -> deterministic extraction -> Google Sheet review -> static JSON -> site
```

The scheduled workflow runs `sync-opportunities`, then `publish-data`. New clean candidates from sources marked `autoPublish` enter as `publish`; incomplete or expired candidates still require review. Existing `publish` rows refresh from later source imports while retaining their publish decision. Rows marked `reject` or `manual publish` preserve all editorial content, advancing only bookkeeping timestamps. The legacy `manual` status remains protected but is not public.

`publish-data` keeps valid `publish` and `manual publish` rows, removes non-public types, writes the configured public and extra fields, sorts by deadline, and replaces `data/opportunities.json`. The manual publish-only workflow skips source collection.

## Commands

- `npm test` — run parser, normalization, deduplication, Sheet, and publishing tests.
- `npm run dry-run-opportunities` — fetch enabled sources without writing to the Sheet.
- `npm run sync-opportunities` — fetch and upsert candidates.
- `npm run publish-data` — regenerate the public JSON from approved rows.
- Serve locally with `npx serve .` or `python -m http.server`; browser fetches do not work over `file://`.

## Key files

- `scripts/opportunities.js` — catalogue loading, filtering, rendering, pagination, and detail popups.
- `opportunity-pipeline/config.js` — source definitions and Sheet/public field contracts.
- `opportunity-pipeline/normalize.js` — inference, normalization, and publish validation.
- `opportunity-pipeline/sheets.js` — Sheet reads, writes, and editorial-decision preservation.
- `opportunity-pipeline/adapters.js` — source adapter entrypoint.
- `sync-opportunities.js` — collection and upsert entrypoint.
- `publish.js` — static JSON publisher.

The leading Sheet columns are the public contract. `fees` means application or submission fee only; blank means unknown. `country` means applicant eligibility, not host location. `PUBLISHED_EXTRA_FIELDS` carries fee, award, and eligibility details used by the frontend without changing the leading Sheet-column contract.

## Sources

Creative Capital, Creative West, and Hyperallergic are automated. Artwork Archive is collected manually with the browser tool in `tools/`; see `docs/artwork-archive.md`. TransArtists is currently disabled.

AI enrichment is intentionally disabled during beta. Missing or ambiguous fields stay flagged for review; the dormant enrichment module and dependency remain available.

## Conventions

- Work directly on `main`; ask before creating a feature branch.
- Preserve the no-build, no-framework architecture and minimal dependencies.
- Prefer relative links so the site works from any hosting path.
- simple edits do not require a browser preview; be economical with usage until an issue is reported.
