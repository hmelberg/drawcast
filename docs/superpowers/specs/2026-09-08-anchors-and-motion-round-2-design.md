# Design: anchors, flip, morph, trail, flow, and the calculus templates (motion round 2)

Status: agreed Hans + Claude 2026-09-08 ("fortsett" on the assessment
below). Implementation plan:
`docs/superpowers/plans/2026-09-08-anchors-and-motion-round-2.md`.

## 1. The problem

Hans's question (2026-09-08): with primitives, `move` and `pieces` in
place, what else should drawcast have to explain visually in mathematics,
physics, economics and beyond — more primitives, common mathematical
objects as templates, other ways to divide, stack or move things?

The assessment after reading the motion round's code: the biggest gap is
not another shape. It is that the model still has to COMPUTE coordinates at
exactly the places it is worst at — the pivot of a rotation, the
destination of a `to`, the point an arrow should reach — because those
inputs are numbers only. That breaks the founding principle (the model
writes semantics, code computes geometry) at the most error-prone spot.
After that: two verbs are missing from the transformation vocabulary
(reflection, and a shape becoming another shape), two cheap devices with
very wide reach are missing (a moving element leaving its track; something
streaming along a path), attached labels are left behind by a turn or a
scale, and calculus — the one large school subject with no template — has
nothing but a freehand example.

The first round, ranked by value over cost, is:

1. **Anchors** — named points on every element, accepted wherever a verb
   takes a coordinate.
2. **Followers ride the pose change** — labels follow a rotation and a
   scale, not only a translation.
3. **`flip`** — reflection across a line, in the pose model.
4. **`morph`** — a tier-2 outline tweened to new points, another outline,
   or a stretch.
5. **`trail`** on `move` — the track of an anchor during a motion, as an
   element.
6. **`flow`** — dots or dashes streaming along strokes while a sentence
   lands.
7. **`riemann_sum` and `tangent_secant`** — the calculus templates.

Not in this round (see §3): a copies generator, `angle` / `measure`
elements, solids, more `pieces` cuts (rings, triangles, halving), more
`arrange` layouts (sort, align, mirror), rotated text.

## 2. Design

### 2.1 Anchors

**Names.** Every command-addressable id has the universal anchors, read
off its ORIGINAL-frame bounding box: `center`, `top`, `bottom`, `left`,
`right`, `top_left`, `top_right`, `bottom_left`, `bottom_right`. Tier-2
elements add geometric anchors the layout records:

| element | anchors |
|---|---|
| `polygon` | `vertex_1 … vertex_n` (in `points` order; a regular polygon from its top vertex counter-clockwise), `side_1 … side_n` (midpoint of vertex k → k+1, wrapping), `centroid` |
| `sector`, `pieces` sectors | `apex`, `centroid`, `arc` (arc midpoint), `start`, `end` (the arc's two ends) |
| `arc` | `start`, `end`, `mid` |
| `arrow`, `edge` | `tail`, `tip`, `mid` |
| `path` | `start`, `end`, `mid`, `point_1 … point_n` |

`shape`, `point`, `node`, `text`, `label`, `pieces` cells, and every
template id have the universal set only. A `pieces` parent id (the
group) has the universal set of the box around all its pieces.

**Storage.** `Tier2Result.namedAnchors: Record<id, Record<name, Pt>>` →
`LayoutResult.namedAnchors`. The universal anchors are never stored: the
planner derives them from `bboxOf(id)`; tier-2 derives them, when an
arrow endpoint asks, from the points of the referenced element's
pts-based drawables laid out so far (text leaves are skipped — tier-2
has no measurer). `PlanOptions.anchorOf?: (id, name) => Pt | null`
serves the geometric ones (`planOptionsFor` reads `layout.namedAnchors`).

**Current position.** A command resolves an anchor in CURRENT
coordinates: `poseOf(offsets[id], turns[id])(anchorOriginal)`. After a
morph (§2.4) the geometric anchors of a polygon come from its current
points. An unknown anchor name warns and falls back to `center`.

**`PointRef`.** A new schema type accepted wherever a verb takes a point:

```
PointRef = [x, y]                       // as today: domain units when a domain is declared, else logical
         | { ref, anchor? }             // a point on an element (anchor default "center")
         | { x, y }                     // the object form of the same coordinates
```

Schema: `oneOf` of the two-number array and an object
`{ref?, anchor?, x?, y?}` with `additionalProperties: false`. The
schema's header comment says "free of oneOf/anyOf"; that is stale —
`play`, `marks` and drag `items` ship with unions and decode fine under
structured output, and the comment is corrected in this round.

Accepted by `move.to`, `move.pivot`, `arrange.at`, `flip.through`,
`flip.line.from` / `flip.line.to` (§2.3) and `morph.pivot` (§2.4). The
existing `EndRef` (`point.at`, `camera.center`, `arrow.from` / `to`,
`edge.from` / `to`) gains `anchor?` — a laser or a camera aims at the
anchor; an arrow endpoint resolves at LAYOUT time in the original frame
(`{"to": {"ref": "tri", "anchor": "vertex_1"}}` draws to the vertex).

For `move.pivot`, `morph.pivot` and `flip.through`, `ref` may be omitted:
`{"anchor": "vertex_2"}` is the moving element's OWN anchor, resolved per
target when several move together.

**`move.anchor`.** Which anchor of the moving element lands on `to`
(default `center`). Tip-to-tail vector addition is then
`{"move": {"target": "b", "anchor": "tail", "to": {"ref": "a", "anchor":
"tip"}}}`; the planner's delta is `dest − anchorNow(target, anchor)`.

**Prompt.** One rule: never compute a coordinate for a point you can
name — `to`, `pivot`, `at` and arrow endpoints take `{ref, anchor}`. The
anchor names are listed once, in the `PointRef` description the schema
carries into the prompt.

### 2.2 Followers ride the pose change

Today a follower (an attached label and its leader) receives its target's
pure translation, and nothing when the target only turned or scaled — a
triangle scaled ×2 about a corner leaves its side labels where they were,
and a zipped slice leaves its number behind at the circle.

New rule, for every verb that changes a pose (`move`, `arrange`, `flip`):
for each follower f of target T, with T's pose going from P₀ to P₁ (both
original-frame → current maps) and c_f the follower's ORIGINAL-frame
bounding-box centre,

```
offset_f += P₁(c_f) − P₀(c_f)
```

The text itself is neither rotated nor scaled (its own pose stays a
translation). For a pure translation this is exactly today's delta; for a
turn about a vertex the label swings round with its side; for a scale
about a corner the far side's label moves out with the side. `arrange`'s
zipper and fan, which today carry nothing, carry their labels this way
too. A morph moves no followers (there is no affine map to ride).

### 2.3 `flip`

```
flip: { target, axis?: "vertical" | "horizontal", through?: PointRef,
        line?: { from: PointRef, to: PointRef }, duration?, easing? }
```

The mirror line is `line` when given; otherwise the `axis` (default
`vertical`) through `through` (default: each target's own current
`center`). `target` may be a `pieces` id. Duration default 1.2 s.

**Pose model.** `Turn` gains `mirror?: boolean`. The pose becomes

```
x ↦ s·R(deg)·Mᵐ(x − p) + p + offset        M = reflection across the vertical line through p
```

Composing a reflection across the line through current point Q at angle φ
(degrees, counter-clockwise from +x) — since Refl_{Q,φ}(y) =
R(2φ + 180)·M·(y − Q) + Q and M·R(θ) = R(−θ)·M:

```
p       := Q − offset  when the pose is still the identity, else unchanged
deg'    := 2φ + 180 − deg          (mod 360)
mirror' := !mirror
s'      := s
offset' := R(2φ + 180)·M·(p + offset − Q) + Q − p
```

`composeFlip(offset, turn, phiDeg, lineNow)` joins `composeTurn` and
`composeScale` in `src/render/pose.ts`; `poseOf` / `poseCentre` honour
`mirror`; the existing rules are unchanged except that they carry
`mirror` through (a rotation after a mirror obeys the same rule, since
R(δ)·s·R(deg)·M = s·R(deg + δ)·M; scale commutes).

**Backend.** `poseTransform(dx, dy, deg, pivot, scale, mirror)` writes
`translate(P) scale(−s, s) translate(−P)` for a mirrored pose (the
canvas's y-flip commutes with a mirror in x). `RenderedElement.setTransform`
gains `mirror?: boolean`; `swapGeometry` reads `turn.mirror`.

**Tween.** A flip plays as a turn-over. The `transform` step's item carries
both poses; when their `mirror` differs the player does not interpolate
offset / angle / scale (they describe two mirror states of one shape) but
plays two halves: u ∈ [0, ½) shows the FROM pose squashed by k = 1 − 2u
perpendicular to the mirror line, u ∈ [½, 1] the TO pose squashed by
k = 2u − 1. At u = ½ the shape is a line on the axis, so the halves meet.
`setTransform` gains an optional `squash?: { at: Pt, angle: number, k:
number }` (current coordinates, y-up): the affine map
y ↦ Q + Par(y − Q) + k·Perp(y − Q), prefixed to the pose transform. The
item stores the line (`at`, `angle`) for the player. Followers ride the
pose change (§2.2) with a plain linear tween of their offsets.

### 2.4 `morph`

```
morph: { target, to?: [[x, y], …] | { ref }, stretch?: [sx, sy],
         pivot?: PointRef, reset?: boolean, duration?, easing? }
```

Exactly one of `to`, `stretch`, `reset`. `target` is a list of ids or a
`pieces` id. Duration default 1.5 s.

- `to: [[x, y], …]` — the new outline, in canvas coordinates (domain
  units when a domain is declared, like `move.by`).
- `to: { ref }` — the other element's current primary ring (its first
  closed leaf, or its first stroke), mapped through its pose.
- `stretch: [sx, sy]` about `pivot` (default the target's current
  `center`): every current point q ↦ Q + diag(sx, sy)·(q − Q). Non-uniform
  scaling lives here, not in `move.scale`, because the pose model's
  exactness rests on rotation and uniform scale commuting.
- `reset: true` — back to the layout's points.

**What morphs.** Every leaf of the id (`drawablesForId`, so `_wash` and
the like come along) whose drawable is a stroke or area with `pts` and no
`shapeHint`: polygon, path, sector, arc, curve, region, pieces cells,
template outlines. A `shape` circle or rect (exact in the backend) warns
and is skipped — declare a `polygon` instead. Under `to`, each leaf is
resampled by arc length to K = max(len(from), len(to), 24) points and
tweened point-wise to the target ring resampled to K (a closed leaf's
resampling closes the ring first; an open one stays open). Under `stretch`
each leaf's own points go through the affine map, no resampling.

**Frames and state.** Target points are inverse-posed into the element's
original frame, so the pose still applies on top. `SceneState.shapes:
Record<id, Record<leafId, Pt[]>>` holds the current original-frame points
of every morphed leaf; `applyScene` re-applies them (a leaf with no entry
gets its layout points back — the handle keeps its originals), so
scrubbing and step-back are exact. The player's `morph` step tweens the
points and calls `RenderedElement.setPoints(points: Record<leafId,
Pt[]>)` each frame; the backend rebuilds the leaf's node through
`drawLeaf` (rough.js seeds by `hashSeed(d.id)`, so a re-roughened path is
stable from frame to frame). `swapGeometry` takes `shapes` and applies the
same replacement when it rebuilds leaves. The planner's box source for a
morphed id is the box of its current points; a polygon's `vertex_k` /
`side_k` / `centroid` are recomputed from its current primary ring.

### 2.5 `trail` on `move`

```
move: { …, trail?: true | { of?: id, anchor?: string, color?: string, width?: number } }
```

`of` names the ONE target that leaves the track (default: the first
target); `anchor` which of its anchors (default `center`); `color`
defaults to the element's own stroke colour, `width` to 2.5.

The planner samples the anchor's current position at 60 uniform steps u
of the motion — `pathPosition(path, u)` for a plain translation along
waypoints, offset / angle / scale linear in u for a pose change — and
mints an element `<id>_trail` (`<id>_trail_2` for a second trailed move
of the same id): a stroke drawable in `Plan.trails: { id, pts, color,
width }[]`. `render()` appends the trails to the layout (`withTrails`) —
both to the plan-time layout and to every `layoutFor()` result, so a
remount after `animate` keeps them — hidden until their step. The `move`
or `transform` step carries `trails: { id, lengthAt: number[] }[]`:
`lengthAt[k]` is the fraction of the trail's total length reached at
u = k/60, and per frame the player calls `setProgress(lengthAt(ease(t)))`
on the trail's handle, so the pen tip sits under the anchor for any
easing. After the step the trail id is in `visible`, so `erase`, `fade`,
`highlight`, `camera` and `point` take it like any element. The planner
adds the id to its known set when it mints it. Trails are runtime
elements, so lint never sees them. `arrange` and `flip` take no trail
this round.

### 2.6 `flow`

```
flow: { along: id | [ids], duration?, speed?, spacing?, kind?: "dots" | "dashes",
        color?, reverse?: boolean }
```

A gesture like `highlight`: transient, and with a paired `speak` and no
`duration` it runs until the voice ends. Defaults: duration 3 s, speed 120
logical units per second, spacing 24, kind dots, colour the element's own.
`along` names stroke elements — arrow, edge, path, curve, arc, template
strokes; a target with no stroke leaf warns.

Plan step `{ kind: "flow", ids, seconds, speed, spacing, kind, color?,
reverse, untilNarrationEnd? }`, executed through
`BackendEffects.setFlow(ids, t, opts)` / `endFlow(ids)` (abort and scrub
safety exactly as `endHighlight`). Backend: for each target's stroke
leaves (not an arrow's head leaf) an overlay `<path>` with the leaf's
precise polyline (`pathFromPts` of the drawable's `pts`), `fill: none`,
round caps, `stroke-dasharray` "0.1 spacing" at width 7 for dots or
"spacing/2 spacing/2" at width 4 for dashes, and
`stroke-dashoffset = ∓(t·seconds·speed) mod spacing` (sign from
`reverse`). The overlay is appended INSIDE the leaf's own `<g>` so it
inherits the element's pose and fade, and removed at t ≥ 1. Marks fade in
over the first 10 % and out over the last 10 % of the step. Export works
because the effect is per-frame DOM, like every gesture.

### 2.7 The calculus templates (mathlogic pack)

Both templates map a domain [x_from, x_to] × [0, y_max] onto
`kit.plotArea()` with the L-shaped axes and `kit.axisLabel` captions of
`generic_axes_diagram`, sample the curve with `kit.expr` + `kit.sample`
(the same expression syntax tier-2 `curve.expr` uses), and keep every
numeric param inside slider bounds so the explore tray and `animate`
both work. `y_max` defaults to 1.1 × the curve's maximum over the domain.

**`riemann_sum`** — "what an integral is".

- Params: `expr` (string, y = f(x), default `"x*x/10 + 1"`), `x_from` /
  `x_to` (default 0 / 10), `a` / `b` (the interval summed, default the
  domain), `n` (integer 1–200, default 6), `rule` (`left` | `right` |
  `midpoint`, default left), `show_area` (the exact region, default true),
  `show_sum` (default true), `x_label` / `y_label`.
- Ids: `axes`, `curve`, `area` (wash under the curve on [a, b]),
  `bar_1 … bar_n` (closed rectangles with washes — every one an element
  `fade` / `highlight` / `arrange` can name), `label_a`, `label_b`,
  `sum_label` ("Σ ≈ 33.2"), `exact_label` ("∫ ≈ 34.0", 2000-sample
  numeric integral).
- `animate: {n: 40}` refines the cut (a fractional n rounds); the sum text
  re-computes every frame.

**`tangent_secant`** — "what a derivative is".

- Params: `expr` (default as above), `x_from` / `x_to`, `at` (x₀,
  default 4), `h` (default 4, minimum 0.01, maximum the domain's span),
  `show_tangent` (default true), `show_triangle` (default true),
  `x_label` / `y_label`.
- Ids: `axes`, `curve`, `point_a`, `point_b`, `secant` (through A and B,
  extended both ways), `tangent` (dashed, the true tangent at A by central
  difference), `run` and `rise` (the slope triangle's legs), `label_dx`
  ("Δx = 4"), `label_dy` ("Δy = 5.6"), `slope_label` ("slope ≈ 1.40"),
  `derivative_label` ("f′(4) = 0.80").
- `animate: {h: 0.05}` slides B into A; the secant turns into the tangent
  and the slope label converges on the derivative.

Both: two manifest examples each, lint-clean at rest and across the
animate range (tests at n ∈ {1, 6, 40, 200}; h ∈ {4, 1, 0.05}).

### 2.8 Prompt and bundled examples

The compiler prompt (`src/llm/prompts/compiler-v1.md`): the `move` bullet
gains anchors and `trail`; new bullets for `flip`, `morph`, `flow`; the
"attached labels follow a translation" phrase becomes "attached labels
follow their element's move, turn and scale (the text itself never
rotates)"; the approach list names the two calculus templates beside
`circle_sectors`. Details live in the schema descriptions, which the
prompt embeds.

Bundled examples in `src/examples.json`, every request a question (STYLE
ledger 2026-09-07):

1. Vector addition tip to tail (`move.anchor` + `to: {ref, anchor}`).
2. A triangle's area as half a parallelogram: a copy turned 180° about
   `{"anchor": "side_2"}` — the pivot is a name, not a number.
3. The cycloid: a wheel rolling one turn (`rotate: −360`, `by: [2πr, 0]`,
   `pivot: {ref: "wheel"}`), a dot on the rim leaving its `trail`; the
   narration notes it travelled 2πr.
4. The circular flow of income: households and firms, money and goods
   `flow`ing along the edges while the sentence lands.
5. Symmetry: a triangle `flip`ped across a drawn line and back.
6. Shearing: a parallelogram `morph`ed into the rectangle of the same base
   and height (the stack of cards), then `stretch: [2, 1]` — twice the
   width, twice the area.
7. + 8. "Hva er egentlig et integral?" on `riemann_sum` (animate n 4 → 40)
   and "Hva er den deriverte?" on `tangent_secant` (animate h → 0.05).

## 3. What this does not do (yet)

- No copies generator (`pieces: {of: "copies"}`) — four congruent
  triangles are four declared polygons.
- No `angle` or `measure` elements, no solids, no `ellipse` / `line`
  primitives.
- No new `pieces` cuts (rings, triangles from a vertex, halving, Riemann
  strips under a tier-2 curve — the template covers the last).
- No new `arrange` layouts (sort, align, mirror, nest).
- Text still never rotates; a follower is positioned, never turned.
- Template ids expose only the universal anchors.
- `flow` is transient; a flow that persists across steps is not offered.
- `morph` skips `shape` circles and rects (exact in the backend); a
  `polygon` morphs.
- `trail` rides `move` only.

## 4. Verification

Unit (vitest, node): pose (`composeFlip` against hand-derived cases, a
double flip is the identity, a flip then a turn), anchors (layout's
`namedAnchors` for every tier-2 kind; the planner resolving `to`, `pivot`,
`at`, `anchor`, `EndRef.anchor` in current coordinates after a move),
followers (rotation and scale carry a label by the rule in §2.2), `flip`
plan (state, two-half tween items), `morph` plan (state, inverse pose,
resampling, stretch, reset), `trail` (sampled points match the pose math;
`lengthAt` is monotone 0 → 1; the id is known to later commands), `flow`
plan step and `setFlow` against the mini-DOM (overlay inside the leaf's
group, dasharray and offset attributes), backend `setTransform` with
`mirror` and `squash`, `setPoints` rebuilding leaves, both templates
lint-clean across their ranges, and the examples test on every bundled
example. `npx tsc --noEmit`, the full `npx vitest run`, `npm run build`
and `npm run build:engine` green.

Live (Playwright, the controller): the four seams node tests cannot reach
— a flip mid-tween, a morph mid-tween, the flow overlay moving, a trail
under a rolling wheel — screenshotted mid-step.
