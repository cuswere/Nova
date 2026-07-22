# Prose formatting backend follow-up

## Current mitigation

The frontend normalizes two known malformed emphasis patterns before rendering popup prose:

- nested bold markers such as `****Title****` render as a single bold span;
- lines containing only asterisks such as `**` are removed before paragraph layout.

This was deliberately implemented in the frontend first because it repairs already-published records immediately, without waiting for a source recollection, Sheet refresh, or static-data publish.

## Observed records

- **Barber Park Recreation Center—RFQ** stored headings such as `****Project Description****`. The most likely cause is nested source emphasis, for example `<strong><b>Project Description</b></strong>`, being converted once for each tag into Markdown-like `**` markers.
- **RI Department of Health Laboratories—Call for Art** stored a standalone opening `**` before the first heading. The exact source fragment was not retained, so this is an inference rather than a confirmed cause. Likely possibilities are a literal Markdown marker in the source content, a partial/malformed emphasis fragment, or a source-specific HTML structure that the current text serializer does not model cleanly.
- **Plains Conservation Center—Eagle Nesting Site** previously stored `**All**applications`. Here the source’s spacing was inside the bold element (often as `&nbsp;`), and trimming the inline element removed the boundary space. This whitespace loss has already been corrected in the shared serializer.

## Backend work to schedule

1. Replace the duplicated HTML-to-prose walkers in `opportunity-pipeline/eligibility.js` and `tools/artwork-archive-collector.js` with one tested serializer contract.
2. Normalize prose before it reaches the Sheet and public JSON:
   - collapse nested equivalent emphasis into one marker pair;
   - remove marker-only blocks and unmatched marker fragments;
   - preserve whitespace adjacent to inline emphasis;
   - retain intended paragraphs, lists, bold, and italics.
3. Keep the original source HTML or a bounded raw-source evidence field during collection so malformed outputs can be traced to a specific source fragment.
4. Add fixtures for all three records above, covering nested tags, literal/orphaned markers, and whitespace inside inline tags.
5. After the backend normalization is in place, refresh affected source rows so the Sheet and `data/opportunities.json` are repaired rather than merely masked at display time.

## Scope note

Praxis Nova has no server backend. “Backend” here means the collection, normalization, Sheet-upsert, and static-publishing pipeline.
