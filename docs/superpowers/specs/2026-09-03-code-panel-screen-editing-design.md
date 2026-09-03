# Code panel — layouts, the scrolling window, the screen frame, typed reveal, and editing while paused

Date: 2026-09-03. Status: draft for review.

## 1. Goal

Three things Hans asked for on 2026-09-03, evaluated against the element as
built (spec `2026-09-02-code-element-design.md`; runtimes
`2026-09-03-code-runtimes-design.md`):

1. **Flexible layout.** Code beside, above or below its output, or output
   alone; long scripts shown through a window that scrolls as the storyboard
   steps through the lines.
2. **A screen.** Optional chrome around the panel so the code and its output
   appear to happen on a computer: a window bar, a monitor, a laptop with a
   keyboard.
3. **Editing while paused.** The viewer edits the script, or types a new one,
   runs it in the same runtime, and sees the result — output pane and any
   template the script feeds.

The house rules hold throughout: every part of the panel stays SVG ink (line
stepping, scrub, step-back and the video export stay exact); anything live
is an HTML enhancement positioned over the SVG that movies and embeds skip;
nothing in the core grows a special case for code.

## 2. Vocabulary (the whole model-facing surface)

Four additions, all single tokens the compiler learns from the schema:

| Where | Field | Values | Meaning |
|---|---|---|---|
| code element | `show` | `output` (default), `left`, `right`, `above`, `below`, `code`, `none` | where the CODE sits relative to the output; `split` is retired (renamed to `left` in examples, few-shots and the prompt — no compatibility shim) |
| code element | `lines` | integer ≥ 3 | the code pane is a window this many lines tall; stepping past it scrolls. Absent = show every line (today) |
| code element | `frame` | `panel` (default), `window`, `screen`, `laptop`, `none` | chrome drawn around the panel |
| code element | `draw.mode` | gains `type` (beside `sketch`, `instant`) | code lines appear character by character at typing speed, with a blinking cursor |
| command | `explore` | gains `code: "<id>"` beside `params` | opens the code editor on that element and waits for Continue |

Everything else (`width`, `x`, `y`, `font_size`, `figures`, the `_line_i`,
`_out`, `_fig_k` ids) is unchanged.

## 3. Layouts (`show`)

`left` is today's split: code pane 55 % of the width, output pane the rest,
a 14-unit gap. `right` mirrors it. `above` and `below` stack the two panes
at full width with the same gap; the code pane's height is the window
height (§4) or the wrapped line count when no window is set, and the output
pane gets what remains of the height budget.

Height budget, all layouts: the panel may not exceed the canvas minus 40
units (as today). For the stacked layouts the output budget is that cap
minus the code pane height, the gap and the paddings; when it falls below
three text rows the layout emits the existing "panel too tall" warning and
truncates the output first (figures shrink to fit, then stdout rows), never
the code — the code is the narrated thing.

Without `lines`, `above`/`below` with more than about twelve source lines
leaves too little room for a plot on the 750-unit canvas; the lint says so
("code panel: N lines above the output leave H units for it — set lines")
so the compiler learns to pair the stacked layouts with a window.

## 4. The window (`lines`)

The code pane shows at most `lines` source lines. The window follows the
storyboard: when a beat draws `<id>_line_k` with `k > lines`, the pane
scrolls so line `k` is the bottom row. A wrapped line counts by its rows.

Mechanics, all inside existing machinery:

- **Layout** puts the source lines in a sub-group `<id>__code` positioned
  at their natural rows, adds a clip rect the size of the pane on that
  group (a new optional `clip` on group drawables, rendered as an SVG
  `clipPath`; the export serializes it like any other node), and publishes
  the row pitch on the group as `scroll: { step, window }`.
- **Plan** (`render/plan.ts`) derives an implicit move: after each `draw`
  step it computes, per windowed code element, the highest visible line
  index `k` and sets the offset of `<id>__code` to `[0, +(k − lines) · step]`
  for `k > lines`, else `[0, 0]`. The plan already records per-id offsets in
  every state, so scrub and step-back restore the scroll exactly, and the
  player tweens it with the `move` machinery (250 ms, ease-in-out) when it
  changes between consecutive steps. No new verb, no player state.
- **Output tail.** With `lines` set, the output pane keeps the LAST rows
  that fit and prefixes a "…" row — terminal semantics — instead of today's
  head-and-ellipsis truncation. Without `lines`, unchanged.

What it is not: real scrolling by the viewer. That is a paused-player
affordance and lives in §7 (later).

## 5. The frame (`frame`)

Chrome is drawables in the panel group, sketched with the panel, sized from
the element's box, and they claim their own space so neighbours never
collide:

| value | drawn | extra space |
|---|---|---|
| `panel` | today's light frame | none |
| `window` | frame + a 28-unit title bar with three small circles at the left (`<id>__bar`) | 28 above |
| `screen` | a bezel 18 units outside the panel (`<id>__bezel`, rounded corners, thicker stroke) + a stand: a short neck and a base line (`<id>__stand`) | 18 around, 56 below |
| `laptop` | the bezel + a keyboard slab below it: a rounded rect with four rows of small rounded key rects and a wide space bar, one stroke each (`<id>__keys`, a group) | 18 around, 120 below |
| `none` | no frame at all — code and output on bare paper | none |

The panel's background stays paper; the bezel's interior is a slightly
darker wash so the "screen" reads as a surface. Each piece has an id, so a
storyboard may draw the laptop first and the code later (`draw:
["demo__keys"]` is legal), but `draw: [demo]` draws everything, as today.

## 6. Typed reveal (`draw: { mode: "type" }`) and the cursor

A code element with `draw.mode: type` reveals each `_line_i` character by
character at a fixed 28 characters per second (a 40-character line ≈ 1.4 s,
the same order as a sketch stroke), driven by the same progress clock the
backend uses for dash-offset reveals: at progress `t` the text node shows
the first `round(t · n)` characters. Wrapped rows reveal in reading order.
Speech pairs with it as with any draw: the narrated line and the typing
start together.

The cursor: a small filled rect (`<id>__cursor`, 0.55 em wide, one row
tall) that sits after the last revealed character of the most recently
drawn line and blinks at 1 Hz. Its on/off state is a pure function of
time, so the exporter renders the same frames a viewer sees. The cursor
exists only in `type` mode; it moves when the next line starts and hides
when `_out` (or the first `_fig_k`) is drawn — the program "ran".

Other draw modes are untouched; `type` on a non-code element falls back to
`sketch` with a lint warning.

## 7. Editing while paused (`explore: { code }`)

**The verb.** `explore: { code: "sim" }` is the authored "now change the
script yourself" moment, placed like the sliders' explore. The player
reaches the step and calls the explore gate; the tray wiring sees `code`
and opens the code editor instead of the sliders. Movies, embeds and bare
players skip the whole step as explore does today.

**The editor.** An HTML text area in the panel's mono font, placed exactly
over the code pane's rectangle (layout publishes the pane corners as
anchors `<id>__pane_tl` / `<id>__pane_br`; the tray converts them with
`clientPointFor`, as the quiz card and the chess overlay do), with two
buttons below it: Run and Continue. The SVG lines beneath stay as they are;
the text area covers them while open. No syntax highlighting.

**Run.** The tray calls the facade — `runCode({ language, code, paths })`
with the element's language and the same token paths the resolver used —
so an unchanged script is a cache hit and an edited one runs in the same
runtime with the same envelope. The result is previewed in place:

- the player gains `previewSpec(patch)` beside `previewParams`: the
  reprojector's `frame` re-lays out with the patched elements (the edited
  `code` and the fresh `code_result` stamped on a clone) plus, when the
  element feeds tokens, the re-substituted params (`substituteDataTokens`
  with the new envelope), with `revealNew` so new output rows and figures
  show. A chart fed by the script redraws with the viewer's numbers — the
  data bridge at work.
- an error envelope draws the existing error panel; the editor stays open.
- Continue (or a scrub, or Play) settles the honest authored geometry
  through `settleParams`, exactly as the sliders do. Viewer edits never
  persist into the document.

**Clicking to edit.** Later: with the player paused, a click inside a code
pane opens the same editor without a verb (the controls layer already
routes stage clicks through `logicalPoint`). Ships after the verb.

**Limits, stated.** Brython and MicroPython run on the page's thread and
pyodide/webR cannot be interrupted without cross-origin isolation, so a
viewer's `while True:` freezes the tab; the editor shows a one-line notice
and the RunQueue watchdog still bounds async waits. A worker for the light
tiers is the fix, later. The trust model is the one already accepted:
the viewer's own code, in the viewer's own browser sandbox.

## 8. Isolation

| File | Change |
|---|---|
| `src/spec/types.ts`, `src/spec/schema.ts` | `show` enum, `lines`, `frame`, `draw.mode` value, `explore.code` — additive |
| `src/layout/code.ts` | layouts, window, frame drawables, pane anchors, cursor |
| `src/layout/model.ts` | optional `clip` and `scroll` on group drawables; `"type"` in the draw mode union |
| `src/render/svg-backend.ts` | render `clip`; the `type` reveal for text leaves |
| `src/render/plan.ts` | implicit scroll offsets after draw steps |
| `src/render/player.ts`, `src/render/index.ts` | `previewSpec(patch)` through the reprojector |
| `src/ui/tray.ts` + **new** `src/ui/code-editor.ts` | the gate branch and the editor overlay |
| `src/llm/prompts/compiler-v1.md`, examples, few-shots | `split` → `left`; one sentence each for `lines`, `frame`, `type`, `explore.code` |

No runtime module changes; the facade is used as is.

## 9. Testing

Node: layout geometry per `show` value (pane rects, gap, budget), window
math (offset per highest visible line, wrapped rows, output tail), frame
ids and reserved space, cursor position, `type` fallback lint; plan states
carry the scroll offsets and restore them on step-back; schema and lint
for every new value; `previewSpec` on a fake reprojector. Live smoke: the
scroll tween, the typed reveal and cursor in the player and in an exported
clip, the editor gate (edit, run in each of the four runtimes, an error, a
token-fed chart updating, Continue restoring).

## 10. Milestones

- **M1 — layouts and the window.** `show` values, `lines`, output tail,
  clip, plan offsets, lint. Layout and plan only.
- **M2 — the screen.** `frame` values, `draw.mode: type`, the cursor.
- **M3 — editing.** `explore.code`, `previewSpec`, the editor overlay.
- Later, by appetite: per-block incremental output (the REPL feel; the
  script runs once per line prefix, cached), wheel scrolling while paused,
  key flashes on the laptop keyboard in time with typing, a worker for the
  light tiers.
