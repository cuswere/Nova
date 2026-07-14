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

Opportunities are curated in a Google Sheet and published to the site as static JSON — no database, no server.

```
node publish.js
```

(or `npm run publish-data`) downloads the sheet as CSV and writes `data/opportunities.json`, which `app.js` fetches at page load. Edit the source URL in `publish.js` if the sheet changes. Commit the regenerated JSON to deploy new listings.

Each entry has: `name`, `deadline`, `link`, `type`, `fees` (`y`/`n`), `country`.

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
