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
source boards -> deterministic extraction -> Sheet review -> static JSON
```

- `npm run dry-run-opportunities` fetches enabled sources and prints a summary without changing the Sheet.
- `npm run sync-opportunities` upserts candidates into the Sheet. Existing `publish` and `reject` decisions and their seven public fields are preserved.
- `npm run publish-data` validates approved rows and regenerates `data/opportunities.json`.
- `npm test` runs parser, normalization, review-preservation, and publishing tests.

The scheduled GitHub workflow runs at 14:00 UTC every Tuesday and Friday and can also be started manually. It refreshes the HTTP-friendly sources; Artwork Archive is collected manually from a normal browser session. Configure this repository secret before enabling it:

1. `GOOGLE_SERVICE_ACCOUNT_JSON`: raw single-line or base64-encoded service-account JSON. Share the Sheet with its `client_email` as an editor.
AI enrichment is intentionally disabled during the beta. Missing or ambiguous fields remain marked for human review rather than triggering paid model calls.

To test one HTTP source at a time, open the workflow in GitHub Actions, click **Run workflow**, and choose its source from the `source` dropdown. Scheduled runs continue to refresh all enabled HTTP sources.

### Artwork Archive browser collection

Artwork Archive is intentionally excluded from GitHub Actions. Open its call-for-entry page normally in Vivaldi, then open DevTools (`F12`) and create a reusable **Sources > Snippets** snippet containing [tools/artwork-archive-collector.js](tools/artwork-archive-collector.js). Run the snippet with `Ctrl+Enter`. It uses the current browser session to collect every results page, follows each Artwork Archive detail page, and saves the external **Learn More** destination as the opportunity `link` in a dated `nova-artwork-archive-*.json` download. The existing `source_url` field is set to that individual Artwork Archive detail page for investigation. It also prefers the detail page's deadline, type, entry fee, eligibility, location, and richer description (including organization, award, categories, and event dates). Entries without an external Learn More link are reported and skipped.

Check the downloaded file without changing the Sheet:

```
npm run import-artwork-archive -- "C:\path\to\nova-artwork-archive-YYYY-MM-DD.json" --dry-run
```

Then upsert it into Nova Sources:

```
npm run import-artwork-archive -- "C:\path\to\nova-artwork-archive-YYYY-MM-DD.json"
```

The importing Windows account needs `GOOGLE_SERVICE_ACCOUNT_JSON` set as a user environment variable. The browser export contains only listing-card HTML and is parsed, normalized, deduplicated, and written by Nova's existing pipeline.

For a two-click manual flow, run the Vivaldi collector and then double-click [Import Latest Artwork Archive.cmd](tools/Import%20Latest%20Artwork%20Archive.cmd). The launcher selects the newest `nova-artwork-archive-*.json` file in Downloads, loads the service-account key from Downloads only when the environment variable is absent, and imports it. Add `-DryRun` to the accompanying PowerShell script when you want to validate an export without writing to the Sheet.

DevTools Snippets cannot be launched by a desktop shortcut. To avoid DevTools, run [Copy Artwork Archive Collector Bookmarklet.cmd](tools/Copy%20Artwork%20Archive%20Collector%20Bookmarklet.cmd) once, create a Vivaldi bookmark named `Nova Collect`, and paste the copied value in its URL field. Clicking that bookmark while on the call-for-entry page runs the same collector in the normal Vivaldi session.

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
