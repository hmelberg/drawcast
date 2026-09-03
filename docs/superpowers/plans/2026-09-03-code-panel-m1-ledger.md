# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-panel-m1-layouts-window.md

Spec: docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md (§2–§4, §8–§9). Branch: main (Hans 2026-09-03: "approve"; the standing push-always rule). Base at start: fe7c6e5 (the spec commit). Another session commits to the same checkout in parallel (the charts round); every commit here adds named files only.

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| T2 ↔ T4 | the code lines are TOP-LEVEL drawables (`<id>_line_i`), not children of the panel group, so a scroll is an offset per line id — exactly what the move verb stores in every state | the plan writes per-line offsets; no sub-group, no new step kind |
| T2 ↔ T3 | `SvgElementHandle.setOffset` puts the transform on the leaf's own `<g>`; a clip on that same `<g>` would move with it | **→ Ruling A** |
| T4 ↔ T5 | `renderUpTo` already applies a state's offsets outright; only live playback needs a tween | the player tweens offsets that differ between a step's before and after states for non-move steps |
| T1 | `tests/text-style.test.ts` (another round's) builds `LayoutResult` literals | `windows` is optional on `LayoutResult`, required on `Tier2Result` |
| T2 self | `stackLines` gives each block `center` and `height = rows × ROW_H × fontSize`, gap `LINE_GAP × fontSize` between blocks | the window's height is `rows × ROW_H + (rows − 1) × LINE_GAP` in font units; a line's bottom is `center + height / 2` |

Ruling A: the clip is rendered on a STATIC wrapper `<g clip-path>` around the leaf's group; the offset transform stays on the inner group. One `<clipPath clipPathUnits="userSpaceOnUse">` per distinct rect, in a `<defs>` the exporter serializes with the drawing. Cost if wrong: none seen — the smoke shows one clipPath serving all ten lines.

Ruling B (found by the smoke): lines beyond the window sit below the pane in the static layout, so the label-on-stroke lint saw them on the panel's frame (and a 30-line script would put them off the canvas). A clipped text whose bbox is not wholly inside its clip rect is exempt from the overlap and out-of-canvas rules — it is never painted there. Cost if wrong: a text with a clip that really does overflow its clip would go unlinted; only windowed code lines carry a clip.

Ruling C: the output tail (newest rows kept behind a leading "…") applies only with `lines` set; unwindowed panels keep the head-and-count truncation.

## Progress

- T1 — 18de968: `show` = output | left | right | above | below | code | none; `lines` (integer ≥ 3); `split` retired in schema, types, lint, prompt, few-shots, examples, tests; the narrow-pane lint reads left/right; a new lint asks for `lines` on a stacked layout over 12 lines.
- T2 — 1b2bd6e: four layouts (side-by-side 55/45 with a vertical divider; stacked full-width with a horizontal one), stacked height budget, the window (clip per line, `windows[id] = { ids, bottoms, height }` published through tier2 → LayoutResult), `clip` on the drawable base type, the output tail.
- T4 — 0c1d493: the plan's `applyScroll()` after every visibility change writes `[0, max(0, maxVisibleBottom − height)]` onto every line of a windowed element (hidden ones too, so a later line arrives in place); `render/index.ts` passes `layout.windows`.
- T3 — a92706a: the backend's clipPath wrapper (Ruling A).
- T5 — 4f91658: `Player.tweenScroll` — 250 ms ease-in-out over the offsets that differ between before/after states, before a draw, after an erase, around show/hide.
- Ruling B — 988c1dd + this commit (out-of-canvas exemption).

## Smoke (controller, Playwright vs dev :5178, Chromium)

Ten-line Brython script, `show: left`, `lines: 4`, one line per beat, then `_out`, then `erase` of line 10:

1. Instant mode via `renderUpTo(n)`: after 4 steps (lines 1–5 visible) every line carries `translate(0 −27.2)` = line 5's bottom (130) − window (103); after 9 steps `−163.2`; after the erase `−136.0` (back to line 9); stepping back to 3 steps → no transform. The plan's states hold the same numbers. One `<clipPath>` in `<defs>`, every line wrapped in a `clip-path` group; `_out` untouched.
2. Silent playback at 8× speed: 21 distinct intermediate transforms sampled (the ease), no errors, final transform equals the state's.
3. `above` and `below`: render, code above/below the output at full width. Lint flagged a clipped-away line on the frame → Ruling B; clean after.
4. Regression: "The law of large numbers, live" (now `left`), "Hours and scores, in R" (`code`), "GDP per capita, light Python" (`left`) render with zero lint issues and successful envelopes.

Not exercised: an exported clip. The exporter serializes the same `<svg>` (defs and transforms included) and the state offsets drive every frame, so nothing new is on that path; noted for Hans's own export test.

## Final verification

`npm test` green (3966 + this commit's test), `tsc` clean, both builds clean.

## Notes for M2

- `frame` chrome must reserve its space from the same `h`/`yTop` the panel uses; the window's clip rect is the code pane's interior, not the frame's.
- The typed reveal wants the reveal clock the backend already runs per leaf (`setProgress(t)`), with `textContent` = the first `round(t·n)` characters; wrapped rows as one string with the row breaks respected.
