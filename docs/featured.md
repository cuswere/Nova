# Featured articles

The home page carries a **Featured Grants** panel showing the two most recent Praxis blog posts tagged `praxisnova`. Each preview links to `article.html#<slug>`, a reading copy of the post hosted on Nova, with the original always one link away at the foot of the page.

The slug rides in the fragment rather than a query string because `npx serve` — the LAN preview used for phone testing — redirects `/article.html` to `/article` and drops a query string on the way. A fragment survives any redirect. `?slug=` is still honoured for anything linked that way. Worth knowing that the same rewrite silently breaks `opportunities.html?type=grant` deep links under `npx serve`; they are fine on GitHub Pages, which does no such rewriting.

## Why it is a build step and not a fetch

`https://blog.praxiscenterforaesthetics.com/feed/` sends no `Access-Control-Allow-Origin` header and sits behind a Sucuri WAF, so the browser cannot read it from `praxisnova.org`. The feed is fetched server-side and committed as JSON, the same shape as the opportunity catalogue:

```text
blog RSS -> parse to blocks -> data/featured.json -> site
```

## Pieces

- `featured-pipeline/feed.js` — pure parser. `parseFeaturedFeed(xml)` keeps items carrying the `praxisnova` category and converts each post body into blocks of formatted spans. Nothing from the feed is ever handed to an HTML parser in the browser.
- `sync-featured.js` — fetches the feed via `opportunity-pipeline/http.js`, merges with what is already on disk, and writes `data/featured.json`.
- `scripts/featured.js` — shared browser module: loads the JSON, formats dates, builds DOM from blocks.
- `scripts/home.js` — renders the newest two as previews.
- `scripts/article.js` + `article.html` — renders one post by fragment slug.
- `.github/workflows/featured.yml` — Wednesday and Thursday evening refresh.

## Data shape

A paragraph that *is* a listing also carries `listing: true`, which the article page renders as `class="article-listing"` so it can be outlined. Both that flag and the `opportunities` roster below come from one function — `readListing` in `featured-pipeline/feed.js` — so the paragraphs the article outlines are always exactly the ones the home page lists. A test asserts the two agree.

Each record also carries `opportunities`: up to three `{ title, deadline }` pairs, which is what the home-page preview lists under the title. They come from the shape these posts always take — one paragraph per opportunity, opening with a link carrying the name and closing with the deadline in bold. A paragraph missing either is the article's own prose and is skipped, which is what keeps the closing Praxis Center paragraph out of the roster. If a post ever breaks that shape the list comes back empty rather than wrong.

A block is `{ type, spans }` for `p`, `h2`, `h3`, and `blockquote`; `{ type: 'ul' | 'ol', items }` where each item is a span list; `{ type: 'img', src, alt }`; or `{ type: 'hr' }`. A span is `{ text }` plus optional `bold`, `italic`, and `href`. Element types the parser does not recognise degrade to paragraphs rather than disappearing, so a new tag in the feed costs formatting, never content. Only `http:` and `https:` links survive — checked when the JSON is written and again when the DOM is built.

## Archive

The feed window holds ten posts, roughly a fortnight, and only some carry the tag. A quiet week would otherwise age a still-current article out of the roster and break any article page already linked, so `sync-featured.js` merges rather than replaces and keeps the newest twelve. The home page shows two; the rest exist so their pages keep resolving. The feed wins on a slug it already has, so an edited post refreshes.

## Notes

- Scheduled workflows only run from the default branch, and `workflow_dispatch` only appears once the workflow file is there.
- Dates are formatted in UTC so they always read as the date the blog published under.
- `npm run sync-featured` refreshes the JSON by hand.
