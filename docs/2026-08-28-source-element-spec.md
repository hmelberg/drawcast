# Source element — papers and books as first-class figures

Status: specification, ready to implement. Written 2026-08-28 after live
CORS probing of every source listed below. Implementer: read this whole
file first; it is self-contained but assumes the drawcast repo.

## 1. What this is

A new tier-2 element type `source` that puts a **book cover, a paper's
title page, or a specific page of a paper/book** on the canvas as a
framed, paper-tinted image — exactly the visual family of the existing
`portrait` photo look — with three uses:

1. **Further reading** — a cover/title-page beside the figure, clickable.
2. **Reference** — "see here for the proof": the actual page of the work.
3. **Quotation** — a page image with the quoted passage **highlighted by a
   drawcast-drawn marker sweep that animates in narration rhythm**, not
   baked into the pixels. Clicking opens the full PDF in the in-app viewer.

It is an element + resolver feature following the `portrait` precedent
(`src/render/portrait.ts`). It is NOT a template: no manifest, no engine
entry, no catalog weight.

## 2. Core decision: dynamic resolution, not embedded data

The spec carries only the **reference** (title / DOI / ISBN / archive id /
URL + page + quote). All fetching, PDF rendering, and image processing
happens at run time in the ensure phase, cached in IndexedDB. This mirrors
portraits ("the NAME is the regenerable source of truth") and was decided
deliberately:

**Pro dynamic (why it wins):**
- The model can neither produce nor round-trip data URIs; blob-hoisting
  (`src/llm/hoist.ts`) exists precisely because embedded pixels must never
  reach the model. A page image at readable resolution is 50–150 KB of
  JPEG — embedding several would dwarf the whole spec.
- IndexedDB cache = one fetch per browser, same as portraits.
- `TRACE_VERSION`-style versioning lets a better renderer re-resolve old
  specs for free.
- Specs stay small, readable, diffable, and cheap to store/share.

**Contra dynamic (accepted risks):**
- Link rot / API death breaks old drawcasts at play time. Mitigation: the
  same embed-on-pin escape hatch portraits already have — a resolved
  element keeps its encoded image in `strokes` (photo encoding,
  `encodePhoto` in `src/spec/trace.ts`), so a pinned/exported spec can
  carry it; hoisting strips it from model round-trips.
- First-play latency: an arXiv PDF is 1–3 MB and pdf.js render adds
  ~0.5–2 s. Mitigation: cache + the existing placeholder degradation
  (portraits already draw a placeholder on failure) + resolution runs in
  the ensure phase BEFORE layout, so playback never stalls mid-figure and
  video export always has the image (`src/render/index.ts:94` pattern).

## 3. Non-goals (v1)

- No paywalled/publisher PDFs (no CORS; a Netlify proxy is a policy
  decision for later — do not build one).
- No Google Books images (no CORS header; canvas would taint). Google
  Books URLs remain fine as `link:` click-throughs.
- No Semantic Scholar (429s anonymous callers; OpenAlex covers it).
- No new template, no interaction-manifest entry, no proxy functions.
- No full-text search inside PDFs — the quote is located verbatim-ish
  (see §7), never discovered.

## 4. Element shape

Extend `SpecElement` (`src/spec/types.ts`) — reuse existing fields where
they exist (`url`, `strokes`, `source`, `look`, `reveal`, `link`, `at`,
`width`):

```jsonc
{
  "id": "smith_wn",
  "type": "source",
  // exactly ONE of these four references:
  "of": "The Wealth of Nations",        // title → Wikipedia summary thumbnail
  "doi": "10.48550/arXiv.1706.03762",   // DOI → OpenAlex/Unpaywall → OA PDF
  "isbn": "9780691137285",              // ISBN → Open Library cover
  "archive": "theoryofmoralsen00smit",  // Internet Archive scan id
  // optional:
  "page": 4,          // pdf: 1-based page. archive: IIIF leaf index (see §13)
  "quote": "led by an invisible hand",  // passage to highlight (needs page)
  "link": ["https://…"],                // extra links; the resolved PDF/source
                                        // URL is ALWAYS auto-appended (§8)
  "width": 220,       // on-canvas width; default ~200 (larger than a portrait
                      // corner fixture — these are meant to be readable)
  "reveal": "wipe"    // same reveal vocabulary as portrait photos
}
```

Behavioral notes:
- Like portraits, the element draws a centered `__name`-style caption
  automatically (title or short citation) — the model must NOT add a
  separate label. Reuse the portrait caption mechanism.
- `cameo` is NOT supported on `source` (cameo is a person-entrance
  gesture); reject in lint with a warning, render as normal.
- Unresolved element (bad DOI, offline, CORS failure): draw the
  placeholder frame, report via the existing `PortraitResolution`-style
  result — never throw, never block playback.

## 5. Resolution chain (all endpoints live-probed 2026-08-28 with an
`Origin:` header; ✓ = `access-control-allow-origin: *` on the response)

| Reference | Endpoint | CORS |
|---|---|---|
| `of` (title) | `https://en.wikipedia.org/api/rest_v1/page/summary/<Title>` → `thumbnail.source` (reuse `wikiSummaryUrl`/`thumbFromSummary` from portrait.ts verbatim — verified it resolves book titles, e.g. On_the_Origin_of_Species → title-page image) | ✓ |
| `isbn` | `https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg` (no key; a 1×1 pixel response means "no cover" — detect and fall through to `of` if present) | ✓ |
| `archive` (+`page`) | `https://iiif.archive.org/iiif/<id>$<leaf>/full/600,/0/default.jpg` (public-domain scans, any page, any width) | ✓ |
| `doi` | `https://api.openalex.org/works/doi:<doi>` → `best_oa_location.pdf_url` / `primary_location`; fallback `https://api.unpaywall.org/v2/<doi>?email=<user email from settings>` → `best_oa_location.url_for_pdf` | ✓ both APIs |
| arXiv PDFs (the common `doi`/`link` result) | `https://arxiv.org/pdf/<id>` serves `application/pdf` with CORS ✓ — pdf.js can fetch it directly | ✓ |
| direct `url` | image URL → straight to raster; `.pdf` URL → pdf.js path | host-dependent; taint throws a clear error (existing behavior) |

Resolution order when several could apply: explicit `url` > `archive` >
`doi` > `isbn` > `of`. A `page`/`quote` is only meaningful on the pdf and
archive paths; lint warns otherwise.

## 6. Rendering the image

- Cover/title-page/IIIF path: exactly the portrait photo pipeline —
  `loadRaster` → `styledPhotoDataUri` → `encodePhoto` → framed drawable.
- PDF path: lazy-load `pdfjs-dist` the way engines lazy-load
  (`src/scenes/engines.ts` dynamic-import pattern; Vite worker via
  `pdfjs-dist/build/pdf.worker.min.mjs?url`). `getDocument(url)` →
  `getPage(page)` → render into a canvas → feed that raster through
  `styledPhotoDataUri`.
- **New look constant**: `LOOK_DIM.page = 640` (longest side). The
  portrait `photo` cap of 240 px renders text as mush; a page must stay
  legible. Accept the larger data URI; it lives in IndexedDB, not the spec.
- The photo tint/contrast constants are shared with portraits — a page
  should look like it sits on the same paper as everything else.

## 7. Quote highlighting — the drawcast-native part

On the pdf.js path with `quote` set:

1. `page.getTextContent()` → items with `str` and `transform`
   (`transform[4]/[5]` = x/y in PDF user space, bottom-left origin).
2. Normalize both the quote and the page text: collapse whitespace,
   strip soft hyphens, and de-hyphenate line breaks (`word-\nrest` →
   `wordrest`) before substring search. Track item index ranges so the
   match maps back to items.
3. Union the matched items' rectangles (via
   `viewport.convertToViewportRectangle` to get canvas space), merge into
   one rect per text line.
4. **Do not paint the highlight into the JPEG.** Convert each line rect
   into the element's logical coordinates and emit them as child drawables
   /anchors of the source element (ids `<id>_quote`, `<id>_quote_2`, …),
   drawn in the marker/highlight style, so:
   - the draw command can time the sweep to the narration beat,
   - `annotation` elements can target `<id>_quote`,
   - reveal/erase play them like any other ink.
5. Quote not found → resolve the page image normally, report a warning in
   the resolution result (same channel as portrait failures), draw no
   highlight. Never fail the element for a missed quote.

Store the highlight rects WITH the cached encoding (extend the cached
value to a small JSON envelope `{photo, rects?}` — bump the cache
version prefix accordingly) so the text layer is not re-parsed per play.

## 8. Click-through

The in-app link layer (R7) already kind-sniffs URLs (`src/ui/link-model.ts`:
`.pdf` and `arxiv.org/pdf/*` → the framed PDF viewer with escape). The
resolver must auto-append the resolved source URL (PDF URL, archive.org
details page, or Open Library page) to the element's `link` array at
resolution time if not already present, so every source element is
clickable with zero model effort. The R9 rule applies unchanged: hit-tests
filter to the visible set.

## 9. Caching, versioning, hoisting

- Same IndexedDB store as portraits or a sibling store; key
  `s<VERSION>|<reference>|p<page>|q<hash(quote)>`. Introduce
  `SOURCE_VERSION = 1` (do NOT reuse `TRACE_VERSION`; the two pipelines
  version independently).
- `resolveSources(spec)` runs in the ensure phase beside
  `resolvePortraits` (`src/render/index.ts`), same never-throw contract.
- Hoisting: extend `hoistPortraitStrokes` (or add a sibling) so `strokes`
  on source elements is also replaced by the sentinel before any model
  round-trip and restored after. This is mandatory, not optional — the
  blob-hoisting invariant is "encoded pixels never reach the model".

## 10. Model-facing changes (schema + prompt)

- `schema.ts`: add `"source"` to the type enum and the new fields, with
  descriptions in the same voice as portrait's (see lines ~138–161 for
  tone). Key rules to encode in the descriptions:
  - Use sparingly: a source element earns its place ONLY as further
    reading, a proof/reference pointer, or a quotation that the narration
    actually uses. One per figure is the norm, never a gallery.
  - `of` (title) is the PREFERRED reference — resolution verifies it
    against Wikipedia, so a wrong title fails visibly.
  - **Never invent a DOI, ISBN, archive id, or URL.** Copy identifiers
    only from the user's request (or a curated exemplar). This is the
    fabrication hazard: a wrong-but-existing DOI resolves to the wrong
    paper silently. Titles fail loudly; identifiers fail silently.
  - `quote` must be verbatim text the user supplied or that is certain to
    appear on that page; a paraphrase will simply not highlight.
- `compiler-v1.md`: a short section mirroring the portrait section, with
  one worked example (e.g. Smith invisible-hand quote on an archive.org
  scan, or an arXiv paper title page as further reading).
- 1–2 exemplars in the examples well ONLY if a template pack's topic
  invites it; otherwise leave to the prompt. Exemplar requests must carry
  the real identifiers (R8 lesson: link URLs must ride in the request).

## 11. Lint

- `source` with `quote` but no `page` (pdf path) → warning.
- `cameo` on source → warning, ignored.
- More than 2 source elements in one figure → warning (gallery smell).
- Existing visible-set and label lints apply; the auto-caption must obey
  the same "never a separate label" rule as portraits.

## 12. Implementation phases (each lands green: `npx vitest run`)

1. **Cover/title-page path** — element type, schema, resolver for
   `of`/`isbn`/`archive`/`url`(image), caching, caption, placeholder,
   link auto-append, lint, hoisting. No pdf.js yet. Tests: resolver chain
   with fetch mocked (the in-memory cache fallback already supports
   headless tests), cache keys, hoist round-trip, lint cases, schema
   accepts/rejects.
2. **PDF page path** — lazy pdfjs-dist, `page` rendering, `LOOK_DIM.page`,
   doi→OpenAlex/Unpaywall chain. Tests: inject a fake pdf.js module the
   way chessplay tests inject the Chess ctor; never download in tests.
3. **Quote highlighting** — text matching (normalization + hyphenation),
   rect union, child drawables/anchors, cache envelope. Tests: matcher on
   synthetic textContent fixtures (hyphenated line break, cross-line
   quote, miss), rect mapping, anchor ids.
4. **Prompt + exemplar + live smoke** — compiler-v1.md section, one
   exemplar, manual e2e against arXiv + archive.org + Open Library, video
   export includes the page image and the animated highlight.

## 13. Gotchas (verified or inherited — do not rediscover)

- Internet Archive IIIF `$n` is the **leaf index** of the scan, not the
  printed page number; they usually differ by front matter. Expose it
  honestly as a leaf index in the description; the model/user supplies it.
- Open Library returns a **1×1 GIF/JPEG placeholder** for missing covers
  instead of a 404 — check natural dimensions before accepting.
- pdf.js in Vite: import the worker with `?url` and set
  `GlobalWorkerOptions.workerSrc`; a missing worker fails silently-ish.
- PDF user space is bottom-left origin; always go through
  `viewport.convertToViewportRectangle`, never hand-flip Y.
- `getImageData` on a tainted canvas throws — that IS the CORS signal;
  keep the existing clear error message pattern from `loadRaster`.
- arXiv: `/abs/` URLs are HTML; only `/pdf/` serves the PDF. Normalize.
- Semantic Scholar 429s anonymously — do not add it "as a fallback".
- Ensure phase must complete before layout (layout is synchronous) and
  before export recording starts — both already true for portraits; keep
  `resolveSources` in the same await block.
- Bump `SOURCE_VERSION` whenever tint, dimensions, or the cache envelope
  change; stale entries must miss, not corrupt.
- The user's contact email for Unpaywall comes from settings/env — never
  hardcode one in the repo.

## 14. Open questions (default answers chosen; Hans may override)

- Caption format for papers: title only (default) vs author-year.
- Should `width` default larger (260?) when `page`/`quote` is set, since
  page text drives the size need? Default chosen: yes, 260 for pages,
  200 for covers.
- Whether the quote highlight should also pulse on click (nice, cheap,
  but new behavior — default: no, v1 keeps highlight as plain ink).
