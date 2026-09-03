# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-panel-m2-screen.md

Spec: docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md (§2, §5, §6). Branch: main (same pre-authorization as M1). Base at start: bfa9953 (M1 pushed).

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| T1 ↔ every caller of `resolveDrawOpts` | the frame, the output rows, the figures all resolve through it with `el.draw` | so "type" must normalise to sketch there, and only the code lines set `{ mode: "type" }` directly |
| T2 ↔ layout text | a wrapped line is ONE `<text>` with a `<tspan>` per row; the leaf's `text` is the rows joined by spaces | the handle reads the DOM's tspans, so rows type in order and the cursor sits on the row being typed |
| T3 ↔ M1 | the window's clip rect and the plan's bottoms are computed from the pane's top, which the chrome moves | `yTop` is derived after the chrome's reserved space, so clip, bottoms and anchors follow |
| T3 self | the chrome must not eat the output budget | `maxH` subtracts the chrome's above+below before the output budget is computed |

Ruling A (spec §6 deviation, recorded in the plan): the cursor shows WHILE a line types and disappears at `p = 1`; a steady cursor after the last typed line would need cross-leaf state (the previous line must lose it when the next starts) and is not worth a player change. Erase runs `p` from 1 to 0, so a line untypes with the cursor walking back. Cost if wrong: no idle cursor between beats.

Ruling B: `draw.mode: "type"` on any non-code element validates (the schema enum is shared) but draws as sketch, with a lint warning naming it — the schema's `draw` object is one shape for every element, and a per-type enum would break structured output's flat schema.

## Progress

- T1 — 543d42d: `frame` (panel | window | screen | laptop | none), `draw.mode` gains `type`, `DrawResolved.mode` too, `resolveDrawOpts` normalises, lint warns on a non-code `type`.
- T2 — 98b56e4: the backend's typed reveal (prefix of `round(p·n)` characters, cursor glyph `▌` while typing, `.cs-typing` class as a hook).
- T3 — 469554d: chrome drawables (`__bar` + dots, `__bezel` + wash, `__stand`, `__keys` with 3 × 13 keys and a space bar), reserved space centred on `y`, `maxH` shrunk by the chrome, typed line durations at 28 characters per second (400 ms floor), `frame: none` drops the paper and the frame.
- T4 — 32b5724: prompt sentence; bundled example "Typed on a laptop" (`show: above`, `lines: 5`, `frame: laptop`, `draw: {mode: type}`, Brython).

## Smoke (controller, Playwright vs dev :5178, Chromium)

1. "Typed on a laptop", silent playback at 2×: bezel, wash, slab, keys and the panel frame all mounted; line 4 sampled every 25 ms: `""` → `" ▌"` → `"    ▌"` → `"    ch▌"` … → the full line with no cursor (33 distinct cursor states seen); the script ran (stdout "day-on-day %: [4.0, -4.8, 11.1, 4.5] / average: 3.7 / 11.1"); lint clean; no errors.
2. `frame: screen` with an erase: line 2 typed to "beta = 2" then untyped through "beta▌", "b▌".
3. `frame: window` renders with zero lint issues (`__bar` pinned by the node test).

## Final verification

`npm test` 3971 green, `tsc` clean, both builds clean.

## Notes for M3

- The editor overlay needs the code pane's rectangle: layout can publish `<id>__pane` corners as anchors alongside the window's height (already in `windows`).
- Re-laying out with a patched element (new `code` and `code_result`) goes through the reprojector's `frame` path, which today takes params only; `layoutFor` in `render/index.ts` closes over the spec — it needs an elements override.
