# Praxis Nova

An updating roster of grants, exhibitions, residencies, and other opportunities for artists. The site is HTML, CSS, and JavaScript; no framework, build step, backend, or database.

## Data pipeline

```text
source boards -> deterministic extraction -> Sheet review -> static JSON
```

- `npm run dry-run-opportunities` fetches enabled sources and prints a summary without writing to Google Sheets.
- `npm run sync-opportunities` refreshes `publish` rows and protects rows explicitly marked `reject` or `manual publish`; `manual publish` rows remain public.
- `npm run publish-data` validates approved rows and regenerates `data/opportunities.json`.
- `npm test` runs the parser, normalization, deduplication, Sheet, and publishing tests.

The refresh workflow checks daily at 14:00 UTC. Scheduled runs are active daily by default; the `AUTOMATION_ACTIVE` and `FREQUENCY_DAYS` repository variables can disable or reduce that cadence. Manual runs always proceed. The separate **Publish opportunities** workflow publishes Sheet edits without crawling sources first.

Google Sheets access uses the `GOOGLE_SERVICE_ACCOUNT_JSON` secret, containing raw single-line or base64-encoded service-account JSON.

AI enrichment remains disabled during beta. Missing or ambiguous fields stay flagged for review rather than triggering model calls.

## Feedback

The feedback form posts to a Google Apps Script endpoint. Deployment instructions are in [docs/feedback.md](docs/feedback.md).
