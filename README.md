# Praxis Nova

An updating roster of opportunities for artists — grants, exhibitions, residencies, and more. Static site, no build step, no framework: plain HTML/CSS/JS on purpose, so it stays fast to load and easy to change.

## Running locally

The opportunities list is fetched from `data/opportunities.json`, which browsers block over `file://`. Serve the directory instead:

```
npx serve .
```

or

```
python -m http.server
```

then open the printed local URL.

## Data pipeline

Opportunities are discovered twice weekly, reviewed in the [Nova Sources Google Sheet](https://docs.google.com/spreadsheets/d/120ZqG_0qZR76b4kYHdzPK-4OKecjk7MaZcKuQRRLcbI/edit), and published to the site as static JSON. The website still has no database or application server.

```text
source boards -> deterministic extraction -> optional AI enrichment -> Sheet review -> static JSON
```

- `npm run dry-run-opportunities` fetches enabled sources and prints a summary without changing the Sheet.
- `npm run sync-opportunities` upserts candidates into the Sheet. Existing `publish` and `reject` decisions and their six public fields are preserved.
- `npm run publish-data` validates approved rows and regenerates `data/opportunities.json`.
- `npm test` runs parser, normalization, review-preservation, and publishing tests.

The scheduled GitHub workflow runs at 14:00 UTC every Tuesday and Friday and can also be started manually. Configure these repository secrets before enabling it:

1. `GOOGLE_SERVICE_ACCOUNT_JSON`: raw single-line or base64-encoded service-account JSON. Share the Sheet with its `client_email` as an editor.
2. `OPENAI_API_KEY`: used only to fill missing or ambiguous fields from canonical opportunity pages. Without it, discovery still works and unresolved candidates remain in `review`.

The workflow uses `gpt-5.4-nano` with a strict Structured Outputs schema and enriches at most 30 candidates per run by default. Override `AI_ENRICH_LIMIT` to change that cap.

The Sheet's first six columns are the public site contract: `name`, `deadline`, `link`, `type`, `fees`, and `country`. New candidates arrive with `status=review`; set complete rows to `publish` or `reject`. The `fees` field means application/submission fee only, while `country` means applicant eligibility rather than host location.

## Feedback form setup

`feedback.html` posts to a Google Form so responses land in a Sheet you own. To connect it:

1. Create a Google Form with a short-answer "Name" field and a paragraph "Suggestion" field.
2. Open the form's live URL, right-click each field → Inspect, and find its `name="entry.NNNNNNNN"` attribute. (Or use the form's "Get pre-filled link" option, fill in placeholder values, and read the entry IDs out of the generated URL.)
3. Take the form's `/viewform` URL and swap it for `/formResponse`.
4. In [app.js](app.js), fill in:
   ```js
   const FEEDBACK_FORM_ACTION = 'https://docs.google.com/forms/d/e/YOUR_FORM_ID/formResponse';
   const FEEDBACK_ENTRY_NAME = 'entry.111111111';
   const FEEDBACK_ENTRY_SUGGESTION = 'entry.222222222';
   ```

Until these are filled in, the form shows a "not yet connected" notice instead of pretending to submit.

## Mascot (planned)

The site is designed around a future interactive mascot: a small, charmingly simple sprite — flash-animation-esque, spectral, evoking a nova/supernova. It isn't built yet. `index.html` reserves a mount point for it (`#mascot-root`), and the site's palette (black void, silver chrome, a glowing white "nova" wordmark) is meant to be the connective visual tissue until it lands. When it's built, keep it lightweight — CSS/SVG animation, no external libraries — consistent with the rest of the site's "direct and lightweight" design goal.

## Design principles

- No build step, no framework, minimal dependencies — the site should stay fast and easy to reason about.
- Prefer relative links so the site works from any hosting path.
