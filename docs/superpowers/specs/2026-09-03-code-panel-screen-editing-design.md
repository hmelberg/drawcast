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

## 11. Amendment — the screen is the default and the tray is one surface (2026-09-03, Hans)

Three asks after M3 was live, all shipped the same day; where they conflict
with §5, §7 or M3's Ruling B, this section wins.

1. **`frame` defaults to `screen`, not `panel`.** Code and output happen on a
   computer, so they look like it — **output-only panels included** (Hans,
   asked explicitly: "screen everywhere, but it should be possible to have an
   argument to say none also"). `frame: "none"` is that way out and already
   existed. A data-only element (`show: "none"`) draws nothing and so grows no
   chrome. `frameSpace` already claims the 18 units around and 56 below out of
   the same height budget, so no bundled example gained a lint issue.

2. **Every script on screen is editable while paused — no verb.** The ⊕ always
   lists it, and a **paused click on the screen itself** opens that editor: the
   object's natural action, the affordance §7 deferred. `attachInfoCards`
   stands aside on those ids the way it already does for the piano keys and the
   chessboard, so a card never competes with the editor; the cursor turns to a
   text caret over a code panel while paused. `explore: { code }` remains the
   authored invitation — the beat that STOPS the lesson and hands over the
   keyboard — not what makes editing possible.

3. **One tray, every control.** M3's Ruling B (the editor only when the figure
   has no sliders) is retired. The ⊕ means "what can I do here?", so it shows
   everything at once: activity pills, sliders, and one section per script —
   expanded when the editor is the point (the only control, the beat's own
   `code`, or the screen the viewer clicked), folded behind its own line when it
   shares the tray with sliders. An authored `explore` stays narrow: exactly
   what the beat named (`params` → those sliders, `code` → that editor, both →
   both). The rule is pure and node-tested: `trayPlan` in `ui/tray-model.ts`.

   This needed one piece of machinery. `previewParams` and `previewSpec` each
   repaint from the honest boundary and know nothing of the other, so a tray
   holding both would have discarded the viewer's edited script the moment they
   dragged a slider. The tray now keeps ONE preview state — slider overrides
   plus per-element script patches — and repaints through a single call, with
   the sliders having the last word over the re-substituted token params.
   `settleParams()` is still the only way back.

**Also fixed here, because the screen exposed it:** SVG collapses whitespace,
so every indented Python line was drawn flush left. Mono text now carries
`white-space: pre` (SVG2 renderers ignore the legacy `xml:space`), which
serializes into the video export like any other style.

**New bundled example** — "Five hundred flips": `show: "below"`, the notebook
shape, with stdout and the plot above and the script typed underneath in a
six-line scrolling window.

## 12 — Amendment: the editor comes back to the pane, and the tray keeps its copy (2026-09-05, Hans)

Hans asked whether a script could be edited **where it stands on screen**,
rather than only in the tray under the player — and then: implement it, "men
man kan kanskje beholde den i skuffen også … da kan brukeren velge." So §7's
original placement ships after all, next to M3's tray editor rather than
instead of it. **Ruling A of the M3 ledger is superseded on placement only**;
everything it protected (one gate, one Continue, one preview state) still
holds, because the two surfaces are ONE editor.

**What was added**

1. **The pane rectangle.** `layoutSpec` now publishes `panes[<id>]` beside
   `windows[<id>]`: the rectangle the source lines occupy, in logical y-up
   units — the CONTENT box, not the pane's paper, so a card laid on it covers
   the drawn lines exactly, and a windowed pane's box is the window. Absent
   when the panel draws no code (`show: "output"`, `show: "none"`), which is
   what makes "is there anything to type on?" a question the geometry answers.
   (§7's `__pane_tl`/`__pane_br` anchors were the original wording; anchors do
   not reach the UI — `LayoutResult` carries boxes — so it is one box.)
2. **`src/ui/code-editor.ts`.** The card: a text area in the panel's own mono
   font (`MONO_FONT`, the same string the SVG text nodes get) at the panel's
   own size, with Run, Continue and ✕ in a chin under it. `clientPointFor`
   places it, `window.resize` + a `ResizeObserver` keep it there, and it hides
   itself while the code half is switched off. `editorRect` is the pure half:
   a one-line script still gets six rows to type in, a narrow pane widens to a
   usable width, and a card near the bottom edge lifts so its chin stays on
   the picture.
3. **Two doors, one editor.** A paused click on the screen now opens the card
   (the object's natural action, §11.2, finally where the object is); the ⊕
   still opens the tray's text area, which grew an `✎ On the screen` button.
   The tray keeps ONE draft per script and every mounted surface is told when
   it changes, so typing in one and finishing in the other is one edit, and a
   Run started at either door reports its progress at both. Continue and the
   drafts are shared with the preview state: `settleParams` still restores the
   lesson, and nothing a viewer typed persists.
4. **Falls back, never fails.** A panel with no pane (output-only, or the code
   half switched off, or not drawn yet at this boundary) sends the viewer to
   the tray's copy instead — the editor that needs no geometry at all.

**Not changed:** `explore: { code }` still opens the tray (one gate, and the
card is one button away). The card is an HTML overlay like the veil, so movies
and `<drawcast-figure>` — which mount no control bar — can never contain it.

**Measured in the live smoke** (micropython, `show: "left"`, `frame: "screen"`):
the text area's first character lands within 1 px of the drawn line's, at the
drawn type size; a Run through the card re-ran the script and repainted the
panel's output; growing the script from 4 to 13 lines moved and grew the card
with the re-laid-out pane; Escape, Continue and playing from the bar each left
the stage thawed and the authored script back on screen.

## 13 — Amendment: the keyboard (2026-09-05, Hans)

"1. make tab work 2. add some rudimentary autosuggest" — both text areas, since
they are one editor. The rules are pure (`src/ui/code-complete.ts`), the DOM is
`src/ui/code-typing.ts`, and `attachCodeTyping` is called by the card and by the
tray's section alike.

- **Tab** indents to the next tab stop (four spaces for the Python runtimes,
  two for R), a selection spanning lines shifts every line it touches, and
  **Shift-Tab** takes one level off. A code area keeps Tab, so **Escape, then
  Tab** is the way to leave the field.
- **Enter** keeps the block: the new line starts at the current indentation,
  one level deeper after a `:` (or a `{` in R). Without it Tab is half a
  keyboard — every new line would start back at column 0.
- **The word list** follows the caret after two characters (or on Ctrl-Space):
  the words already in the script first, then that language's builtins and
  keywords. ↑/↓ moves, Tab or Enter accepts, Escape dismisses the list without
  closing the editor (the card's own Escape is spent on the list first —
  `stopImmediatePropagation`, and the typing handler is attached before the
  card's). It says nothing inside a comment or a string, offers only the
  script's own words after a dot (an attribute is never a keyword).
- Edits go through `execCommand("insertText")` where the browser still offers
  it, because splicing `.value` by hand wipes the text area's undo stack;
  ctrl-Z was checked in the live smoke.
- The list is `position: fixed` on the document — nothing clips it — and moves
  into `document.fullscreenElement` when there is one, since a fullscreen
  element paints only its own descendants.
- `.cs-tray-code` stopped soft-wrapping: code lines are lines, and the caret
  geometry counts rows.

**Measured in the live smoke:** Enter after `for i in range(10):` opened four
spaces; `tot` listed `total` "in this script" and Tab accepted it; Tab at
column 9 moved to column 12 and Shift-Tab took the level off; ctrl-Z undid it;
the first Escape closed the list and the second closed the card; the same three
behaviours in the tray's area, with the list unclipped; and a completion
accepted on the card arrived in the tray's text area, since it is one draft.

### 13.1 — microdata's own vocabulary (same day, Hans: "så det er ikke autosuggest i microdata editoren?")

It had the script's own words and nothing else. It is the language that needs
the list MOST — the commands are its whole surface and its variable names are
28 characters long — so it now has all three, none of them hand-kept:

| what | where it comes from |
|---|---|
| 79 **commands** (`create-dataset`, `regress-panel-diff`) | derived from the vendored `m2py.py` — its `cmd == '…'` dispatch plus `_COND_FILTER_COMMANDS`/`_CONTROL_COMMANDS` |
| 85 **expression functions** (`rowmean`, `invchi2tail`) | the emulator's own `get_microdata_functions()` registry in `functions.py` |
| 736 **FDB variables** (`INNTEKT_WLONN`) | the boot that already parsed `variable_metadata.json`, published through the new dependency-free `src/code/vocabulary.ts` |

The two lists are literals in `code-complete.ts` — and
`tests/microdata-vocabulary.test.ts` re-derives both from the snapshot on disk
and asserts equality, so a re-synced `mdlib` that adds a command fails a test
instead of quietly suggesting yesterday's language. The variables are not a
list at all: `code/microdata.ts` calls `publishMicrodataVariables` after its
boot, and `ui/code-typing.ts` reads them. Reading never starts a runtime, so a
panel whose script has not run simply has no variables to offer — and in a
lesson the panel has always drawn its output before the viewer can click it.

Three rules the language needed that the others did not:
- **A line starts with a command**, so half of them are hyphenated. The hyphen
  counts as part of the word in that one position and nowhere else — mid-line
  it is a minus sign (`generate y = x - crea` offers nothing).
- **Anywhere else** the caret is in an expression or an argument, where the
  variables and the functions live — including after the `fd/` of an `import`,
  since a slash is not a word character.
- **A comment is `//`**, not `#` (m2py.py:638).

**Measured live** in a real microdata panel (the emulator booted, 736 variables
published): `create-data` → `create-dataset [command]`; `import fd/INNT` → six
real FDB variables; `generate x = rowme` → `rowmean`, `rowmedian [function]`;
`generate y = crea` → nothing.
