# Design: freehand figures — relative placement, groups, smooth paths, math and images

Status: agreed Hans + Claude 2026-09-09 (approach C, all five sections
approved in chat). Implementation plan: to be written with the
writing-plans skill after Hans has reviewed this spec.

## 1. The problem

The strategic review of 2026-09-08 (four codebase maps plus a look at
drawcast.app) found the weakest leg of "draw and explain whatever the
user asks for" to be the figure with no template. Without a template the
model has polylines, text and simple shapes. There is no smooth curve in
the spec (`kit.smooth` exists, but only template authors reach it), no
`math` element (MathJax is loaded, but only `equation_steps` uses it), no
`image` element (photos exist only as `portrait` and `source`), no way to
name a sub-assembly, and every coordinate-placed element needs absolute
x/y on the 1000×750 canvas. The compiler prompt gives freehand
composition three lines. Of 44 bundled examples without a template, 20
run code and 12 are Norwegian primary-school geometry; none is a "thing"
with named parts. The repo's answer so far has been to author a template
on demand (about four minutes, several dollars), which does not scale to
"anything".

The anchors round of 2026-09-08 gave every element nine universal anchors
(center, top, bottom, left, right and the four corners) and let
`move`/`flip` take a named point instead of a number. Elements' own
PLACEMENT still takes numbers. This round extends the same idea one
level down: an element can be placed relative to another element, a set
of elements can be named and handled as one thing, and three kinds of
content the engine already knows how to make (smooth strokes, TeX
strokes, photos) become spec elements.

Hans's ruling on the target (2026-09-09): the round is judged on three
kinds of request — schematic THINGS with named parts (a bicycle pump, a
neuron, a heart with its circulation), maths/physics with FORMULAS next
to curves and figures, and ILLUSTRATED explanations with a photo as part
of the figure. Processes and flows (boxes and arrows) are already served
by `node`/`edge` and are out of scope. Images come from Wikimedia Commons
only: no arbitrary URLs, no user files, no built-in icon set this round.
Freehand comes first: the automatic template-on-demand path no longer
fires on a single freehand figure with named parts; a template is an
upgrade the user asks for.

## 2. Approaches considered

- **A. Relative placement + group on the current spec.** Every
  coordinate-placed element accepts `at: {ref, side|anchor, gap}`; a
  `group` element names members and gives them one box; `path` gets
  `smooth`; `math` and `image` become elements. Builds on anchors and
  kit code that exist. The model still picks one absolute position per
  thing.
- **B. Local frame.** A `figure` container with its own normalised
  coordinate system (0–100) that the engine scales into the canvas or a
  box. Frees the model from the canvas entirely, but adds a third
  coordinate notion next to `box` and domain units and a larger layout
  change.
- **C. A plus `group.fit`.** As A, with an optional `fit` on the group
  that scales and translates the members into a named region or box.
  Gives most of B for one field, and the field is last in the build
  order so it can be cut.

Chosen: C.

## 3. Spec additions (what the model writes)

### 3.1 Relative placement: `at`

Every coordinate-placed element — `text`, `shape`, `path`, `polygon`,
`sector`, `arc`, `pieces`, `portrait`, `image`, `math` — accepts `at` in
place of `x`/`y`:

```yaml
at: {ref: pump_body, side: above, gap: 12}
at: {ref: piston, anchor: bottom}
at: {ref: valve, side: right, gap: 8, offset: [0, -10]}
```

- `ref` is any element id with a box after layout: a tier-2 or tier-3
  element, a label, a group, or a template-exported id.
- `side` is one of the eight label sides (`above`, `below`, `left`,
  `right` and the four diagonals) and places the element's box outside
  the reference box on that side, `gap` logical units away (default 8).
- `at.anchor` names a point on the reference (the nine universal
  anchors or a geometric one the element exposes). The element's own
  landing point is the element-level `anchor` field, the same convention
  `move` uses (`to: {ref, anchor}` plus its own `anchor`). Default: the
  side opposite `side` when `side` is given, else `center`.
- `offset: [dx, dy]` is added last, in logical units.
- `x`/`y` together with `at` is a lint error. `at` on an element that is
  also a member of a `fit` group may only reference members of the same
  group.

### 3.2 `group`

```yaml
- id: pump
  type: group
  members: [body, piston, hose, nozzle]
  fit: left            # optional
```

- A group has no geometry of its own. Its box is the union of its
  members' boxes after layout; its anchors are the nine box anchors.
- A group id is valid as `ref` in `at`, as `attach_to` for a label, and
  as a target of `draw`, `erase`, `show`, `hide`, `highlight`, `focus`,
  `point`, `move`, `fade`, `flip`.
- `fit` is `"left" | "right" | "top" | "bottom" | "full"` or a box
  `{x, y, w, h}`. The named regions are the halves of the canvas, inset
  by the same margins the code/template split uses. With `fit`, one
  uniform scale and one translation are computed for the whole member
  set and applied to points, radii, widths, font sizes and image widths
  before labels are placed. Aspect ratio is preserved; the members are
  centred in the box.
- Nested groups are allowed (a member may be a group). Cycles, unknown
  members and empty groups are lint errors.

### 3.3 Smooth paths

`path` gains `smooth: true` — a Catmull-Rom curve through the given
points (`kit.smooth`, `kit.smoothClosed` when `closed`) — and honours
`style.fill`. No bezier syntax is added; the model gives waypoints, the
engine gives the curve.

### 3.4 `math`

```yaml
- id: newton
  type: math
  tex: "F = m a"
  size: 32
  at: {ref: cart, side: above, gap: 20}
```

TeX is turned into strokes through the loaded mathjax engine (the same
flattening `equation_steps` uses) and drawn as handwriting, with the
figure's clean/sketchy style. A `math` element is a normal target for
`highlight`, `point`, `erase`, `move`. `label` gains `tex` as an
alternative to `text`, so a curve can be labelled "y = x²" in real
notation.

### 3.5 `image`

```yaml
- id: pump_photo
  type: image
  of: "Bicycle pump"
  width: 220
  at: {ref: pump, side: right, gap: 30}
  reveal: fade         # optional; default fade
```

- Resolved in the ensure phase like a portrait: a Wikipedia summary
  lookup for the thumbnail, falling back to a Wikimedia Commons search
  on the title. The photo is encoded into the element the way portrait
  photos are, so publish and export carry it.
- `credit` (author + licence) is filled in at resolution and drawn as
  small text under the image; results without a licence field are
  rejected.
- No `url`, no icon set. A miss draws nothing and lints a warning
  ("no image found for …") so a repair round can try another title.

## 4. Layout and lint (deterministic code)

1. **Resolution order.** Layout builds a dependency graph from `at.ref`
   and group membership and resolves elements topologically: absolute
   elements first, then relative ones in graph order, then groups after
   their members. An unknown `ref`, a cycle, or a `ref` to an element
   without a box is an error-severity lint (triggers repair).
2. **Boxes for tier-3.** Every coordinate-placed element gets a measured
   box (text through the measure function, math from the MathJax box,
   image from width and aspect), so `side` + `gap` land correctly and
   the overlap lint sees them. Today `text` has only a centre point.
3. **Group box and fit.** Union of member boxes; anchors from the box.
   With `fit`, the scale and translation are applied to all members in
   one pass before labels are placed. A font size below 18 after
   scaling is a warning naming the group and the box ("fit box too
   small for the text in <group>").
4. **Labels.** `attach_to: <group>` uses the group box as anchor and the
   members as obstacles. The existing collision solver is unchanged.
5. **New lint rules.** `placement` (unknown ref, cycle, x/y with at, fit
   outside the canvas, at across a fit boundary) — error. `group-empty`
   (missing member, empty group) — error. The overlap lint skips pairs
   that are both members of the same group when that group has `fit`,
   since a composed thing deliberately touches itself.
6. **Unchanged behaviour.** Elements without `at` and outside any group
   lay out exactly as before. No template changes.

## 5. Runtime: planner, renderer, export, on-demand

1. **Group as a command target.** The planner expands a group id in
   `target`/`draw` to its members, the mechanism `pieces` already uses
   through `pieceGroups`. `draw: [pump]` draws members in spec order;
   `move`, `fade`, `highlight` act on all; the pivot of `move.rotate` on
   a group is the group's centre. Per-boundary scene state is unchanged,
   so seek and step-back stay exact.
2. **Math.** Strokes are made in layout (synchronous) after the mathjax
   engine is loaded in the ensure phase, drawn with the same dash-offset
   handwriting as `equation_steps`.
3. **Image.** Resolved in the ensure phase; encoded into the element;
   `reveal` reuses the portrait effects with `fade` as default (`wipe`
   is for faces). Export and the viewer get the image the way they get
   portraits today. No new eager chunk in the app, viewer or engine
   builds.
4. **Attribution.** `credit` is drawn under the image in the figure and
   written into the subtitle file on export.
5. **On-demand trigger.** `templateWorthy` no longer starts automatic
   authoring in the single-figure flow. The freehand result is shown and
   the status line offers "Author a template (~4 min)" as a button. In a
   course run, automatic authoring is kept only when the on-demand brief
   step (which already produces a template id per freehand part) yields
   the same id for two or more parts; otherwise freehand.

## 6. Prompt, exemplars and cost

1. **Composition guide.** The tier-2/tier-3 bullets in the compiler
   prompt are replaced by a "Freehand figures" section of about 25
   lines: build a thing as a group of named parts; place the first part
   absolutely and the rest with `at`; give the thing its place with
   `fit`; smooth closed `path` for organic shapes, `polygon`/`shape` for
   mechanical ones; `math` for formulas beside curves; at most one
   `image` per figure, as illustration, never instead of the drawing.
   Named anti-patterns: computing coordinates per element, text without
   `attach_to`, more than one image, formulas typed as `text`.
2. **Exemplars.** Three new few-shots, one per target: a schematic thing
   with parts (bicycle pump or neuron), a formula-plus-curve (free fall
   with F = ma and s(t)), an illustrated explanation with one Commons
   image. Six new bundled examples with the same split, all with
   question-shaped requests (STYLE rule of 2026-09-07). The existing
   client–server few-shot is rewritten to use `at`.
3. **Schema and tokens.** New fields go into the schema with short
   descriptions. Budget: at most 1.5k tokens added to the schema and 1k
   to the prompt, measured before and after with the script that gave
   48.3k. Compensation: the 12k-character `code` bullet moves into a
   conditional block sent only when the request or tags mention code, R,
   Python, microdata or C64. Net: the system prompt must be smaller than
   today.
4. **Router.** Unchanged. Requests that already get `none_fits` go
   straight to freehand with the new guide.
5. **STYLE.md.** A dated entry: figures of things are built as named
   parts, because that is what makes the "Find the part" drill and
   click-to-explain possible without a template.

## 7. Testing and evidence

1. **Unit tests (vitest)** per part: dependency graph and topological
   order including cycle and unknown ref; `side` + `gap` boxes for all
   eight sides; group box and anchors; `fit` preserves aspect and scales
   font sizes; Catmull-Rom passes through every point and closes; math
   strokes from a known TeX string have a box and a stroke count; image
   resolution against a stubbed API with a hit, a miss and a missing
   licence; planner expansion of a group for every verb; the
   `placement` and `group-empty` lint rules.
2. **Tests that can fail.** For each new rule, first a red test showing
   the rule is missing, and at least one mutation check where the
   expected answer is flipped, so the suite demonstrably reacts (the
   lesson of space round 3).
3. **Lint sweep.** `sweep:round` over all new examples: no errors, no
   new overlap warnings. Prompt token measurement before and after, with
   the numbers in the ledger.
4. **Generation against the live API.** A 12-request eval set (four per
   target, half in Norwegian), run with a script modelled on
   `selector-eval.mjs`: records template choice, repair rounds, lint
   result, time and cost, and saves the specs for reading. Run once
   before the prompt change (baseline) and once after. Pass: no
   error-severity lint, at least three of four per target use the new
   fields, median time under 90 s.
5. **Hans's smoke test.** A checklist in docs with four figures to ask
   for in the app, what to see (parts named, formula handwritten, image
   with credit, group moving as one) and what to click (the Find-the-part
   drill on a freehand thing). Merge condition, as in earlier rounds.
6. **No browser tests** this round. The repo has no jsdom; introducing
   it is a separate decision.

## 8. Build order

1. Boxes for tier-3 elements and `at` resolution (graph, sides, anchors,
   lint `placement`).
2. `group` without `fit` (box, anchors, label attach, planner expansion,
   lint `group-empty`).
3. `path.smooth` and fill.
4. `math` element and `label.tex`.
5. `image` element with Commons resolution and credit.
6. `group.fit` (last; cuttable).
7. On-demand trigger change.
8. Prompt section, conditional `code` block, schema descriptions, token
   measurement.
9. Few-shots and bundled examples, STYLE entry, lint sweep.
10. Live eval before/after, smoke checklist, ledger.

## 9. Out of scope

Processes and flows (already `node`/`edge`); arbitrary image URLs; user
image files; a built-in icon set; bezier control points; a local
coordinate frame beyond `group.fit`; browser tests; changes to any
existing template.
