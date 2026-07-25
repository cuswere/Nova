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

### Sample McDougald House Mural

This record confirms a broader extraction-order problem rather than another isolated marker edge case.

The Creative West API currently supplies structured HTML beginning with a bold budget paragraph, followed later by a PDF link and a second budget section. Nova currently:

1. converts the entire description HTML into Markdown-like plain text;
2. runs `inferAwardInfo()` over that formatted string;
3. splits it with `/[^.!?]+[.!?]?/g` and keeps clauses containing both a money amount and an award/budget label.

That ordering produces both visible defects:

- In `**BUDGET: $6,800.00**`, the period is treated as the end of the clause before the closing `**`, so the selected fragment becomes `**BUDGET: $6,800.` with an unmatched opening marker.
- Text between that first sentence and the next qualifying budget sentence remains part of the next punctuation-delimited clause. If a PDF anchor's visible label is `pdf`, it is therefore retained even though it has no award meaning.

The current API response shows the full PDF URL as the anchor text, while the stored row contains only `pdf`. Nova does not currently reduce a URL to that label, so the exact historical source fragment cannot be reconstructed without a retained raw snapshot. The clause-selection failure is nevertheless deterministic for either form.

### Rosamond Park

Creative West's `eligibilityDescription` contains two useful eligibility sections (`Who May Apply` and `Can a team apply?`), followed by an alternate-format contact paragraph and Denver's civil-rights/language-assistance notice translated into many languages. Nova currently treats the entire upstream field as eligibility prose, so the legal/accessibility footer is published along with the applicant requirements.

This is not an HTML boundary or character-decoding error in Nova. The multilingual paragraphs are present in the Creative West API response. Some replacement-looking glyphs are Unicode private-use characters already embedded in the upstream Burmese and Nepali text, so browsers without the originating font cannot render them correctly.

Filtering must be semantic and structural rather than based on language or non-Latin scripts. Genuine eligibility may itself be multilingual. A safe rule can identify the start of an operational/legal footer from complete blocks (for example, an alternate-format request followed by a nondiscrimination/language-assistance notice), reinforced by repeated organization/contact text across consecutive translated blocks. Those blocks should be excluded from `eligibility_details` while remaining available in retained raw source evidence.

## Backend work to schedule

1. Replace the duplicated HTML-to-prose walkers in `opportunity-pipeline/eligibility.js` and `tools/artwork-archive-collector.js` with one tested serializer contract.
2. Normalize prose before it reaches the Sheet and public JSON:
   - collapse nested equivalent emphasis into one marker pair;
   - remove marker-only blocks and unmatched marker fragments;
   - preserve whitespace adjacent to inline emphasis;
   - retain intended paragraphs, lists, bold, and italics.
3. Extract semantic fields from the HTML tree before serializing display prose. Award inference should operate on block nodes and their plain text, then serialize only the selected complete nodes. It must never slice through formatting markers or join unrelated link blocks to a later budget sentence.
4. Treat standalone link blocks as references, not prose candidates. Exclude anchors whose text is a bare file type, filename, or URL unless the surrounding block itself contains the qualifying award meaning.
5. Segment eligibility into applicant-requirement blocks and operational/legal footer blocks. Do not use script or language alone as an exclusion signal; use footer semantics, block order, repeated contact text, and translated repetition together.
6. Keep the original source HTML or a bounded raw-source evidence field during collection so malformed outputs can be traced to a specific source fragment.
7. Add fixtures for all five records above, including a bold sentence ending in punctuation followed by a PDF link and a later qualifying budget block, plus a legitimate multilingual legal footer following concise eligibility requirements.
8. After the backend normalization is in place, refresh affected source rows so the Sheet and `data/opportunities.json` are repaired rather than merely masked at display time.

## Scope note

Praxis Nova has no server backend. “Backend” here means the collection, normalization, Sheet-upsert, and static-publishing pipeline.
