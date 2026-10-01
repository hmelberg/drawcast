# Books — a text pane beside the drawcast — design

2026-10-01 · status: D1–D3 BUILT 2026-10-01 on branch book-layout (see §13 for what differs from the text below) · mock: `dev-casts/book-mock.html`
(git-ignored; `npm run dev`, then `/dev-casts/book-mock.html`, `?part=N`, `?muted=1`)

## 1. What this is for

Text- and math-heavy teaching: definitions, key terms, formulas, derivations,
quotes and tables that today have nowhere to live. The 1000 × 750 stage fills
after a handful of text elements, and the house rule keeps words on the
figure short (a word or three). A **book** puts a scrolling, written text
pane beside the drawing: headings, keywords and formulas are written; the
voice still carries the explanation; the figure still does the showing.

It also makes the text cheap to generate: the text pane is laid out by the
browser, so the model writes Markdown in order and no coordinates, and the
figures carry fewer free-standing labels because the explanation lives in
the text.

Learned from xplainer (`~/Documents/GitHub/xplainer`): the simplicity there
comes from letting the browser lay out text in columns and scroll. We take
that idea, not xplainer's language — xplainer already embeds drawcast
figures the other way round.

## 2. Decided with Hans (2026-09-30 – 10-01)

- **A book is HTML text around ordinary drawcast figures.** Every element
  and template that works in a drawcast works in the figure pane,
  unchanged. Anything that needs a new element or a rebuilt feature is a
  warning sign.
- **`#column`** = two columns, text left (the default); **`#row`** = two
  rows. Both steer the prompt.
- **One figure at a time**, pinned; the text pane scrolls.
- The model decides what to write and what to say. Written: headings,
  keywords, definitions, formulas, quotes, short statements. Not everything
  spoken is written; not everything written is spoken.
- **Look:** clean lines and clean marks, hand-hatched fills, handwritten text
  ("Mixed") is the default. Sketchy and Clean remain choices.
- **Marks on text** are few, and most are temporary.
- **A scratch note** (one kind of temporary text) is allowed; no further
  kinds of text (messages, help, …).
- **Captions off** by default in a book (the CC button still works).
- **Narration connects sentence to sentence** ("To see it, take…", "Back in
  our formula, that is why…") — a rule for books and for all drawcasts.
- **Mark where a line meets the axes** by default (values at the ends of a
  point's guides); later steps may take them away if the figure gets busy.
- **Recording (video export) is not a concern yet.**

## 3. Shape

### 3.1 A book is a multi-part cast

One spec holds one figure (one `template`, or free elements). A book is
therefore a **multi-part cast** — the existing `#playlist` / `#parts=N` /
chapters machinery (`src/llm/multi.ts`, `src/playlist/`) — where:

- each part's figure plays in the figure pane, and the next part's figure
  replaces it (with a transition, §6.3);
- the text pane **carries across parts**; a chapter (or an explicit clear)
  empties it.

### 3.2 Placement norm

| Pane | Holds |
|---|---|
| Text | Markdown only: headings, paragraphs, lists, quotes, `$…$` / `$$…$$` math, tables, static code listings (with a precomputed output) |
| Figure | Every drawcast element and template: curves, templates, `bar_race`, `data_table`, running `code`, images, maps, … |

A table can go in either pane: Markdown in the text, or the `data_table`
template in the figure (drawn row by row, highlightable). No free mixing —
the simple split is what keeps it cheap to build and easy to generate.

## 4. Spec additions

### 4.1 The `book` field (on every part)

```yaml
book:
  layout: columns      # columns (#column) | rows (#row)
  text: first          # first = left / top · second = right / bottom
  share: 40            # text pane, % of width (columns) or height (rows); 0–100
  transition: tv       # how a pane empties / a figure changes: tv | fade | slide | wipe
  look: mixed          # mixed | sketchy | clean
```

Stamped by the app on every part from the tags (like `level`); a part may
override `share`. Defaults: columns 40, rows 28. `share: 100` is a text-only
part; `share: 0` is an ordinary drawcast.

### 4.2 Commands — one new verb, the rest reused

The rule: **reuse the existing verbs with a text block's id as the target**,
so the model learns one new thing, `write`.

| Want | Command | Notes |
|---|---|---|
| Write a block | `write: "…markdown…"` or `write: {id, text}` | Rides on the same command as a `speak` (appears with the sentence, as a `draw` does). Ids default to `w1, w2, …` in order. |
| Scratch note | `write: {text, temp: true}` | Pencil grey, smaller; leaves *before* the next block arrives. |
| Temporary mark | `highlight: {target: w4, part?, effect}` | effect: `light` (highlighter), `underline`, `circle`, `box`. Gone when the next block is written. |
| Permanent mark | `highlight: {…, keep: true}` | Stays; re-placed if the pane re-wraps. |
| Strike | `highlight: {target: w3, effect: strike, keep: true}` | Text dims, a line through it. |
| Erase | `erase: [w3]` | The block collapses away. |
| Look back | `point: {at: {ref: w4}}` | Scrolls back to that block and flashes it; the next write returns to the newest. |
| Zoom | `view: text \| figure \| both` | Eased; see §6.4. |
| Clear | `clear: {pane: notes \| figure \| both}` | Default `figure` — today's `clear`, unchanged. |

`part` on a text target is verbatim text inside the block (as `part` already
is for a code line), or a formula's TeX.

Text-block ids share the lint's id namespace with elements (no clashes).

### 4.3 Planner

`write` becomes a plan step with no canvas effect (like `label`); marks,
erase and point on a text id become steps the book shell performs. The
**text pane's state is a pure function of (part, step)**: seeking replays
every write/mark/erase/clear up to that point without animation — the same
promise the figure's scrubbing keeps.

## 5. The text pane

- **Markdown subset:** `#`, `##`, paragraphs, `-` lists, `>` quotes,
  `**bold**` (accent-coloured ink — not a highlighter stripe), `*italic*`,
  tables (numeric columns right-aligned), fenced code listings
  (` ```python ` … with ` ```output ` below), `$inline$`, `$$display$$`.
- **Math** through the engine's own MathJax 4 in Fira Math
  (`engines.mathjax.layoutTeX`), drawn as inline SVG on the text's baseline —
  the same font the figures use. (A separate MathJax from a CDN clashed.)
- **Listings** are static: the figures' monospace, light colour-coding, the
  output computed at authoring time. Code that *runs* belongs in the figure.
- **Indent** under a heading.
- **Appearance:** each block wipes on left to right, time by length
  (≈ 22 ms a character, 0.35–1.4 s).
- **Fonts:** handwriting (Patrick Hand) in Mixed and Sketchy; a clean sans
  in Clean. Size from the screen height (height / 40, 15–26 px).
- **Marks** in Mixed/Clean are clean strokes; in Sketchy, rough.js (the
  figures' own library). The highlighter sits *behind* the text and covers
  the whole line height; circles and boxes leave clear room around the ink.

## 6. Layout

### 6.1 Sizing follows the screen height

- **Columns:** the figure is as tall as the book (4:3, so its width
  follows); the text column is `share / (100 − share)` of the figure's width
  beside it. If that is wider than the screen, both shrink together.
- **Rows:** the figure takes `(100 − share)` % of the height; the column is
  exactly as wide as the figure; the text gets the rest of the height — so
  the figure is always whole and text lines never run wider than the plot.
- Either way the book is centred: a wide screen gets wide margins.
- **Phones:** columns stack — figure pinned on top, text below.

### 6.2 Scrolling

"Fill": write down the page; when the newest block would come within 15 %
of the bottom, scroll so it sits at 45 % — half a page of room, so the next
few blocks need no scrolling. Cubic ease-in-out, 0.5–1.4 s by distance; a
newer scroll takes over smoothly. ("Middle" — always centre the newest —
was tried and is not the default.)

### 6.3 Transitions

When a pane empties (`clear`) or a figure changes between parts:
**TV** (the picture squeezes to a bright line, then a dot, then goes out;
the default), fade, slide, wipe.

### 6.4 Zoom (`view`)

The panes glide (≈ 1.1 s, slow in and out); nothing reflows mid-glide — the
figure is sized once and scaled from old to new (FLIP), the text keeps its
line width and fades out rather than re-wrapping. In columns the figure
gains little (it already fills the height), so the model should zoom to the
figure mainly in rows, and use the figure's own `camera` in columns. A zoom
must have something happening (an `animate`, a highlight) or it is dead
time.

## 7. The figure pane

- **The app's normal player** for each part — not the bare engine embed —
  so the explore tray, sliders, click questions and quizzes work as in any
  drawcast (they are wired by `src/ui/controls.ts` / `src/playlist/session.ts`,
  which the embed lacks).
- Fitted 4:3, centred in its pane.
- **Code:** the existing `code` element as the figure, unchanged — stepping
  (`<id>_line_N`), permanent `marks`, temporary `highlight {part}`, staged
  charts with `figures: N` (`<id>_fig_N`). Script trust works as in any
  published drawcast (author scripts wait for "Run it").
- **Quizzes** stay where they are today.

## 8. Engine additions (small, each useful beyond books)

1. **Staged charts cross-fade.** `src/layout/code.ts`: each `<id>_fig_N`
   slide's opaque `__ground` is drawn instantly while its image fades in
   over 0.9 s, so the old chart vanishes behind a blank panel — the blink
   Hans saw. Fade the ground with the image.
2. **A spec-wide line style.** Mixed today is per-element `style.roughness: 0`
   (a stroke then draws clean even in the sketchy renderer, and hatched
   fills stay hatched), but a template's own parts take no per-element
   style. Add a spec-level default (e.g. `line: clean`) that the renderer
   applies to strokes, leaving fills hatched.
3. **Values on guides.** `guides: true` on a point (`src/layout/tier2.ts`)
   draws the dashed lines to both axes but not the numbers; add
   `guides: {values: true}` (or make values the default) so 60 and 30 are
   written where the lines land. Check what `supply_demand`'s equilibrium
   guides do and match.
4. **A caption mode that never grows the stage.**
   `src/render/caption-place.ts` moves captions *below* the drawing when it
   thinks there is room and grows the stage to fit; in a fixed-size pane
   that pushed the figure past its box after a zoom. Books start with
   captions off; with CC on, the pane must pin the caption over the drawing
   (or in a strip inside it).

## 9. Generation

- **Tags:** `#column` and `#row` in the `structure` group
  (`src/llm/tags.ts`), exclusive with each other; they route to the
  multi-part path and stamp `book` on every part.
- **Prompt section** (compiler and outline):
  - write vs speak: write headings, key terms, definitions, formulas,
    quotes and short statements — about 12 words a block, except
    definitions and quotes; never write out what you say, except a
    definition or quote read word for word;
  - connect the sentences (§2);
  - marks sparingly, mostly temporary; a scratch note for working that does
    not belong in the book;
  - Markdown only in the text; everything drawn goes in the figure;
  - short words on the figure (the existing rule), guides with values where
    a line meets an axis;
  - `#row`: fewer, shorter blocks (the text row is short).
- **Lint:** words per block; marks per part; text ids that exist; `write`
  outside a book (warn); a figure element named in a text target (error).

## 10. Not now

- **Wide figures for rows.** The engine is fixed at 1000 × 750 and the spec
  schema rejects `canvas`; on a landscape screen a 4:3 figure in a row is
  small. Build columns first; rows ship with 4:3 figures or wait.
- **Code left, output right** (the script in the text pane, stepping in sync
  with its output in the figure) — attractive, medium work; after D3.
- **Printed output in stages** (one printed line after one code line, more
  after the next): printed output is one block today; charts already stage.
- **Video export of the text pane** (draw it into the frames, as captions
  are), the `<drawcast-figure>` embed and the standalone viewer.
- **Free mixing** of elements across panes.

## 11. Deliveries

1. **D1 — the engine additions (§8).** Independent of books and useful
   now; the cross-fade and guide values especially.
2. **D2 — the book player.** Text pane (Markdown, math, listings, tables),
   layout and sizing, scroll, transitions, `view`, the text verbs, seeking,
   the figure pane as the app player, captions off. Acceptance: the mock's
   six-part elasticity lesson, hand-written as a real book, plays, seeks
   and zooms without a blink or a jump.
3. **D3 — generation.** Tags, prompt section, lint, three bundled examples;
   then a blind prompt-lab comparison against standard casts on three
   text-led topics (a derivation, a definition-heavy concept, a history
   built on quotes), recording cost and repair rounds.
4. **D4 — later (§10).**

## 12. Decisions on the open questions (Hans, 2026-10-01)

1. **Text-block ids:** every block gets an automatic id (`w1, w2, …`,
   running across the whole book, not restarting per part); a block the
   model will come back to gets an explicit id (`write: {id: formula, …}`).
   Lint warns when a command targets an automatic id — inserting a block
   renumbers them.
2. **`view` means the same everywhere** (resize the panes). The prompt says:
   in columns, look closer with the figure's `camera`. Lint warns when
   `view: figure` would enlarge the figure by less than 15 % (the columns
   case).
3. **Transitions:** TV between chapters (both panes cleared) and for a
   `clear` of the text pane; a short cross-fade (≈ 0.4 s) between parts
   within a chapter. The author can override (`book.transition`).
4. **No card over the figure in a book:** the part's title is written into
   the text pane as a heading (`#` for a chapter's first part, `##` for a
   part). If the model writes the same heading itself, the automatic one is
   skipped.

## 13. As built (2026-10-01)

D1–D3 are in, on branch `book-layout`. Where the build departs from the
design above:

- **The mixed look is a render style, not a spec field** (§8.2). `mixed`
  joins `clean` and `sketchy` (svg-backend's `mixedRenderer`: the sketchy
  renderer with every stroke drawn clean, fills hatched). It applies to a
  template's own parts too, which a spec field read per element could not.
  A book picks it through `book.look` (default `mixed`); Settings, `&style=`
  and `<drawcast-figure look>` offer it everywhere.
- **Guide values are opt-in, not the default** (§8.3): `guides: true` is
  unchanged (every existing cast keeps its look); `guides: {values: true}`
  writes the numbers, `{x, y}` writes given text. The compiler prompt asks
  for values whenever the voice names a point's numbers.
- **Automatic block ids are per part** (§12.1): `w1, w2, …` count the blocks
  of one part — the planner sees one part at a time. Named blocks reach
  across parts (`point` back to a block from part 1), and lint warns on a
  command aimed at an automatic id.
- **Headings**: book title `#`, chapter `##`, part `###` under a chapter
  (`##` without one).
- **Rows put the text under the figure** by default (§4.1) — what
  `#row` promises.
- **Captions**: the fixed-pane mode (§8.4) is a class, `cs-caption-fixed`,
  on the pane: never "below"; strip and overlay remain.
- **Brief controls**: a fourth control, Format (Drawcast / Book / Book,
  text under), is the checkbox of the original idea.
- **Lint**: `book-block-long` (over 40 words, quotes excepted),
  `book-auto-id`, `book-marks` (more than three in a part).

Where it lives: `src/book/` (markdown, math, layout, ops, pane, shell,
transitions, css, stamp); the session's `book` hook
(`src/playlist/session.ts`); the plan's `text` step and the Player's
`textHook`; three bundled books in `docs/examples/books/`, copied into the
app's examples by `scripts/add-book-examples.mjs`; the repo skill's
`references/book.md`.

Not built (§10 stands): wide figures for rows, code left / output right,
printed output in stages, the text pane in video export, the embed and a
book in fullscreen (fullscreen shows the figure only).

