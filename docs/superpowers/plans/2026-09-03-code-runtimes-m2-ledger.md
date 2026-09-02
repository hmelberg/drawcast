# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-runtimes-m2-r.md

Spec: docs/superpowers/specs/2026-09-03-code-runtimes-design.md (§3–§5, §7–§9, §11). Branch: main (Hans 2026-09-03: "approve. implement all (I will be away so you implement recommended solutions)" — main + push pre-authorized by the standing push-always rule). Base at start: 2fb3b38 (the spec commit).

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| T1 ↔ T4 | `RUNTIMES.r` points at `./not-yet` until `webr.ts` exists; the node dispatch test expects `runtimeUnavailable` either way | ordered, both satisfy it |
| T1 ↔ T5 | the prompt-drift test lives in the T1 test file but needs T5's sentence | **CONFLICT → Ruling A** |
| T1 self | plan named the schema object `SPEC_SCHEMA`; the export is `specSchema` | fixed in the test as written |
| T3 self | R strings as TS template literals need doubled backslashes | **→ Ruling B** |
| T4 ↔ webR 0.6.0 | `EvalROptions.captureGraphics` accepts `{width, height, pointsize?, bg?}`; `throwJsException` default true; `RCharacter.toArray()` | verified from the published `.d.ts` before writing |
| T6 | examples.json is 1-space indented, fewshots.json 2-space | append script matches each |

Ruling A: the prompt sentence moves into Task 1 so every commit keeps `npm test` green — the sentence is one line and has no other dependency. Cost if wrong: none (T5 still owns the few-shot and example).

Ruling B: the R sources are `String.raw` template literals, so a backslash in R is a backslash in the TS file; the JSON-escaper test pins the R text verbatim. Cost if wrong: none — the local Rscript run proves the escaper.

Ruling C (found by the local Rscript run): a top-level `stop("x")` reports `eval(ei, envir)` — the wrapper's own plumbing — as its call. The console says plain `Error: x`, so calls beginning `eval(`, `withVisible(`, `withAutoprint(` or `source(` are dropped from the message. Cost if wrong: a user function named `eval` loses its name in an error message.

Ruling D (found by the browser smoke): `library(dplyr)` and `library(data.table)` emit "Attaching package … masked from" banners as `packageStartupMessage` conditions, which flooded the output pane with a dozen stderr lines and overlap warnings. They are console furniture, not the script's output — muffled silently; ordinary `message()` and `warning()` still reach stderr. Cost if wrong: a package whose only diagnostic is a startup message goes unseen.

Ruling E (plot sizing, spec §5.4's open item): the canvas device is 1000 × 640 at pointsize 20 (bitmaps come back at 2×, 2000 × 1280, from the device itself), and the ggplot2 hook sets `theme_gray(base_size = 24)`. At 1400 × 900 / 24 / 22 both plots read as fine print once fitted; at these values base-graphics text is the size of matplotlib's dpi-110 output and ggplot2's grey axis text matches it. PNGs shrank from ~230 KB to ~105–150 KB each. The hook is verified live: `theme_get()$text$size` reports the base size after `library(ggplot2)`.

## Progress

- T1 — a793853: `languages.ts`, dispatch table, `not-yet.ts`, check across languages, schema enum/need, prompt sentence, `tests/code-runtimes.test.ts` (10 tests).
- T2 — e4e13d4: `plotly-render.ts`, `png.ts`; `pyodide.ts` imports the shared renderer.
- T3 — 2379d83: `harvest-r.ts` + `tests/code-r.test.ts` (8 tests). Local Rscript (R 4.6.0, jsonlite present) run of the wrapper: console semantics, invisible silent, trailing data.frame → table JSON with `NA` → "" and quotes escaped, data bridge (vector, named vector → object, data frame, column, list of vectors, over-cap, missing name/column), error with warning kept, message + warning to stderr, parse error.
- T4 — 91b146d: `webr.ts`; `r` dispatches to it; both builds emit a `webr-*` chunk (8 kB).
- T5 — 3a8beeb: R few-shot (dplyr → tibble table) and bundled example (ggplot2 histogram, stepped); prompt sentence already in T1.
- Fixes from the smoke — 5ec071e (Ruling D), 39410f2 (Ruling E).

## Smoke (controller, Playwright vs dev :5178, webR 0.6.0 live, Chromium, after 3a8beeb)

Harness: `render(spec, div)` from `/src/render/index.ts` with the data pack enabled; `code_result` read back per element; `layout.order`, `layout.warnings`, `lint()` recorded. Also `runCode` directly for the harvest contract.

1. Base plot + console semantics — `summary(x)` mid-script printed, 1 figure, no stderr, order `r1, r1_line_1..3, r1_out`, lint clean. 1.9 s including boot (webR files from HTTP cache).
2. ggplot2 via `library()` auto-install (the shim + pre-scan; "Installing ggplot2…" phase) — `cat` line in stdout, 1 figure; a second element's trailing `data.frame` with `NA` → table `[["1.5","p"],["2.0","q"],["","s"]]`. 3.2 s.
3. dplyr pipe → tibble as table (`group/mean_x/n`), data.table → table. Startup banners → Ruling D; re-smoked after: stderr empty, tables unchanged.
4. Warning `as.numeric("a")` → stderr "Warning: NAs introduced by coercion"; `message()` → stderr; `stop("no way")` → `ok: false`, error "Error: no way", stdout keeps the earlier `[1] NaN`, stderr keeps the earlier warning.
5. `figures: 2` with two `plot()` → two figures, `f1_fig_1`, `f1_fig_2` in order.
6. Tokens: `bar_chart` `values: "{r1.frames}"` from `list(df$y2010, df$y2020)` → substituted `[[87,52,58],[67,52,61]]`, stage animate; `scatter_plot` `x: "{r2.df.h}"`, `y: "{r2.df.s}"` from data-frame columns → 12 points + fit; direct harvest: named vector → `{a:1,b:2}`, factor → strings, over-cap → per-path error, missing → "no variable nope". Lint clean, no warnings.
7. Bundled example "The law of large numbers, in R" renders (order `sim, sim_line_1..5, sim_out`, lint clean).
8. Pyodide regression: "The law of large numbers, live" still renders after the plotly extraction (2.4 s, 1 figure).
9. Plot sizing: one downscaled JPEG per plot inspected before/after Ruling E.

Cold-network timing was not measured: the browser had webR's files cached from the first boot. R.wasm is 11.8 MB uncompressed on the wire (spec §6.6); a first-ever viewer pays that once.

Console: only webR's own notice "using PostMessage communication channel" (expected without COOP/COEP; spec §4.6).

## Final verification

`npm test` 3535 green, `tsc` clean, `npm run build` and `npm run build:engine` clean (both emit `webr-*.js` and `pyodide-*.js` chunks; the engine smoke passes).

## Deferred / notes for M3–M4

- The R cache tag does not encode plot sizing; a future size change needs a version bump to miss the cache (no R envelopes exist in the wild yet).
- `installPackages` on an already-present package: fast in the smoke (repeat runs with `library(ggplot2)` cost nothing visible) — spec §11 item closed.
- `getHook(packageEvent("ggplot2", "onLoad"))` reported two hooks in one page; harmless (the theme is set twice), noted for a later look.
