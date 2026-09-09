# Design: ghosts, angle and measure, three more cuts, ellipse and line (motion round 3)

Status: agreed Hans + Claude 2026-09-09 ("gjør som anbefalt" on the round-3
proposal). Implementation plan:
`docs/superpowers/plans/2026-09-09-ghost-angle-measure.md`.

## 1. The problem

Hans's idea (2026-09-08): when a figure is cut up and its pieces animate
away — the circle whose sectors zip into a rectangle — it is often useful
to keep the original on screen, faded, while the new shape forms. Sometimes
the original should change instead. That should be a choice, default off.

The round-2 assessment left a second tier of gaps: no `angle` or `measure`
element (the two things a geometry lesson writes on the figure and wants
to see change when the figure changes), only three `pieces` cuts, and no
`ellipse` or `line` primitive. Two leftovers from round 2's final review
ride along: the "is this point explicit" test written three times in the
planner, and an examples gate that ignores geometry after an `animate`.

## 2. Design

The founding principle holds: the model writes semantics, code computes
geometry. Every mechanism below reuses round 2's: minted elements
(trails), the pose model, `shapes` state, `PointRef`.

### 2.1 Ghosts — `keep`, and `ghost` on the motion verbs

**Minted elements generalise trails.** `Plan.trails` becomes `Plan.minted:
MintedSpec[]`, a union of `{ kind: "trail", … }` (as today) and `{ kind:
"ghost", id, sourceId, offset, turn, shapes, opacity, params }`. `render()`
applies `withMinted(layout, plan.minted, layoutAt)` wherever it applied
`withTrails` (the mounted layout and every `layoutFor()` return). A ghost
is materialised from its SOURCE's drawables: for a tier-2 source, the
leaves `drawablesForId(layout.drawables, sourceId)`; for a template source
under `animate`, the leaves of `layoutAt(params)` at the boundary BEFORE
the animate. Each leaf is copied with its points mapped through the
source's current pose (`poseOf(offset, turn)` on `pts`, on a text's `pos`,
on a circle hint's centre with radius × scale; a rect hint becomes the
four mapped corners as a closed stroke), morphed `shapes` applied first,
re-id'd `<ghost>` for the primary leaf and `<ghost>_<suffix>` for a
sub-suffixed leaf (so `drawablesForId` finds them), `style.opacity`
multiplied by the ghost opacity (default 0.3), `drawOpts` instant, and
inserted in `order` right BEFORE the source so it paints under it. The
planner records the ghost's box as the source's current box (the
`trailBoxes` map becomes `mintedBoxes`), adds the id to `known` and
`mentioned`, and makes it visible in the same step, so later `erase`,
`fade`, `highlight`, `point` and `camera` take it.

**`keep`** — `{ keep: { target, opacity? } }` — mints a ghost of every
target as it is now and shows it instantly (a `show` step, so a paired
`speak` reads over it). Ids `<id>_ghost`, then `<id>_ghost_2`, …. `target`
may be a pieces id.

**`ghost` on `move`, `arrange`, `flip`, `morph`, `animate`** — `true`
(every target; for `animate`, every id visible at that boundary), a list
of ids, or `{ of?: string[], opacity?: number }`. The ghosts are minted
before the motion is composed, from the pre-motion state, and appear as the
step starts. Default absent: nothing is kept, as today.

### 2.2 `angle` element

`{ type: "angle", at: PointRef, from: PointRef | number, to: PointRef |
number, radius?: number, label?: "auto" | string | false, right?: boolean }`.
`at` is the vertex; `from` and `to` are points on the two arms (a
`PointRef`, resolved at layout time like an arrow endpoint) or absolute
directions in degrees. The angle is swept counter-clockwise from the
`from` arm to the `to` arm, in (0, 360] — the model orders the arms. Radius
default 40. Drawables: `<id>` — the arc (`sectorPts` without the apex) or,
when `right` is true or the angle is within 0.5° of 90 and `right` is not
false, the right-angle square; `<id>_text` — the label, default the
rounded degrees ("62°"), placed on the bisector at radius + 22 with a
font of 22. Anchors: `vertex`, `arc` (the bisector point on the arc).
Static at layout, like every derived element.

### 2.3 `measure` element — a value that follows the figure

`{ type: "measure", of?: id, what?: "length" | "width" | "height" |
"area" | "perimeter", from?: PointRef, to?: PointRef, label?: string,
unit?: string, scale?: number, decimals?: number, side?: Side, offset?:
number }`. Either `of` (an element) or `from` + `to` (a segment). `what`
defaults to `length` for a segment, an arrow or a path, `area` for a
polygon, sector, ellipse or pieces cell. `label` is a template with
`{value}` (default `"{value}"`, e.g. `"b = {value}"`); `unit` is appended
("cm"); `scale` is logical units per unit (default 1); `decimals` default
0 when the value is ≥ 100, else 1.

Drawables: for `length`, `width` and `height` a dimension line `<id>` with
end ticks, offset `offset` (default 24) to the `side` of the measured
segment (default: away from the element's centroid), and the value as a
text element with the id `label_<id>` (the `label_<id>` convention, so it
is an attached follower of `<id>`); for `area` and `perimeter` only the
text `label_<id>`, at the ring's centroid (area) or beside the ring
(perimeter). The layout records `LayoutResult.measures[id] = { of?,
what, from?, to?, format }` for the planner.

**The value follows.** `SceneState.texts: Record<id, Record<leafId,
string>>` joins `shapes`; `RenderedElement.setText(texts)` rewrites a text
leaf's content (same-reference no-op, like `setPoints`); `applyScene` and
`swapGeometry` carry it. After any step that changes the measured
element's pose (`move`, `arrange`, `flip`) or shape (`morph`), the planner
recomputes the value from the element's CURRENT geometry — the current
leaf points mapped through the current pose (`poseOf`) — with pure
functions in a new `src/layout/measures.ts` (`segmentLength`,
`ringArea` by the shoelace formula, absolute so a mirror does not negate
it, `ringPerimeter`, `boxWidth`/`boxHeight` of the mapped points), formats
it, and appends `texts` to that step (applied when the step settles, and
in the boundary state). So "double the side" on a square shows the area go
×4, and a morph shows the area of whatever shape it became.

**The line is re-pointed, not posed.** `measures[id]` also records
`deps` — the ids whose motion changes the value: `of`, or the `ref`s of
`from`/`to` — and the anchors used. After a step that moves or morphs a
dep, the planner recomputes the measured segment's endpoints from the
CURRENT geometry (`anchorNow` for a `from`/`to` ref; the current mapped
ring for `of`), sets the dimension line's points through the `shapes`
state (a `MorphItem` on `<id>`, tweened with the step), moves the text
`label_<id>` by its centre to the new midpoint (a follower item), and
writes the new value into `texts`. One uniform rule for `of` and for
`from`/`to`; nothing rides a pose, so a mirrored or turned element keeps a
readable, unrotated dimension.

### 2.4 Three more cuts, and `unroll`

- `pieces: { of: "rings", x, y, radius, n }` — n concentric annuli of equal
  width, `<id>_1` the innermost. Each is an area with a hole
  (`AreaDrawable.holes`) plus a closed stroke for each circle
  (`<id>_k` = the outer circle stroke, `<id>_k_body` = the inner). The
  layout records `pieces[id].ring = { rIn, rOut }` beside `apex`
  (= the centre) and `radius` (= rOut).
- `arrange: { layout: "unroll", at? }` — for ring pieces: each ring becomes
  a straight strip of length 2π·r_mid and height (rOut − rIn), stacked
  bottom-up (innermost at the bottom) and centred on `at`; the strips'
  left ends align — the staircase that becomes the triangle of base 2πr
  and height r as n grows. Implemented as a `morph` of each ring's outer
  and inner outlines to the strip's rectangle (the morph machinery: the
  step carries `MorphItem`s) plus the translation. A non-ring target
  warns and is laid out as a `row`.
- `pieces: { of: "triangles", x, y, radius, sides, n?, from? }` or with
  `points` — a regular polygon (or the given polygon) fanned into
  triangles from the centre (default for a regular polygon) or from
  `vertex_k` (`from: "vertex_1"`, the default for `points`). Each triangle
  carries sector-like geometry (apex, midAngle, halfAngle, radius) so
  `fan` and `zipper` take them: zipping the triangles of a regular polygon
  gives the parallelogram of base half the perimeter and height the
  apothem — the polygon's area, and the limit that is the circle's.
- `pieces: { of: "halving", x, y, width, height, n }` — a rectangle halved
  n times, alternately vertically and horizontally: `<id>_1` the left half,
  `<id>_2` the top-right quarter, `<id>_3` the next eighth, …, and
  `<id>_rest` the remainder — the picture of 1/2 + 1/4 + 1/8 + … = 1.
  Plain boxes for `arrange`, `fade`, `highlight`.

### 2.5 `ellipse` and `line`

- `{ type: "ellipse", x, y, rx, ry, rotation? }` — a closed outline with a
  wash (`filledOutline`, 48 points), so it morphs and takes `move.scale`.
  Universal anchors, plus `focus_1`/`focus_2` (the foci on the major axis).
- `{ type: "line", through: [PointRef, PointRef] }` or `{ through:
  [PointRef], slope?: number, angle?: number }` — an infinite line clipped
  to the plot box (when a domain is declared, slope is in domain units)
  or the canvas: tangents, asymptotes, mirror axes. Style `dash` for the
  usual look. Anchors `start`, `end`, `mid` (the clipped ends and their
  midpoint), and `point_1`/`point_2` for the through-points.

### 2.6 Round-2 leftovers

- `isExplicitPointRef(p)` in `src/render/plan.ts` replaces the three
  copies of the array/ref/x-without-anchor test (move, flip, morph).
- `tests/examples.test.ts` passes `bboxesFor` (as `render()` does) so
  geometry after an `animate` inside one example is checked against the
  post-animate boxes.

### 2.7 Prompt and bundled examples

Prompt: a `keep`/`ghost` bullet ("keep the original faded while the pieces
move"), `angle` and `measure` in the tier-2 element list with one example
each, the three cuts and `unroll` on the `pieces`/`arrange` lines,
`ellipse` and `line` in the primitives list. Every new verb goes to all
seven enumeration sites (schema `ACTION_VERBS`, `commandSchema.description`,
`normalizeSpec`, plan `ACTION_KEYS`, lint `ACTION_KEYS`, `subtitles.ts`,
the prompt's inventory line).

Bundled examples (every request a question):

1. "Hvorfor er arealet av en sirkel πr² — ringversjonen?": `pieces` of
   `rings` (n 8), `keep` of the ringed circle, `arrange: unroll` into the
   staircase, and the narration names the triangle it approaches (base
   2πr, height r); a `measure` of the stack's height and of the longest
   strip.
2. The existing "Hvorfor er arealet av en sirkel πr²?" template example
   gains `ghost: true` on its `animate: {t: 1}` — Hans's original case.
3. "Hvorfor er arealet av en regulær mangekant halve omkretsen ganger
   apotemet?": `pieces` of `triangles` (a hexagon), `keep`, `arrange:
   zipper`.
4. "Hvorfor er 1/2 + 1/4 + 1/8 + … = 1?": `pieces` of `halving` (n 6),
   pieces drawn one at a time with the running sum spoken, `<id>_rest`
   highlighted at the end.
5. "Hva skjer med arealet når sidene dobles?": a square with `measure`
   area and `measure` length of one side, `move.scale: 2` about a corner
   — the numbers change on screen.
6. "Hvorfor er ytre vinkel lik summen av de to motstående?": a triangle,
   three `angle` elements, an extended side as a `line`, the exterior
   `angle`, `keep` of the two interior angles slid (`move`) onto the
   exterior one.
7. "Hva er en ellipse?": an `ellipse`, its two foci as `point`s, a `line`
   as the major axis, two `measure` lengths from a point on the curve to
   the foci whose sum is spoken as constant while the point `move`s along
   (the measures update).

## 3. What this does not do (yet)

- Text still never rotates (a measure's text is a follower).
- No solids (own round), no copies generator, no `arrange` sort/align.
- A ghost of a template's parts is minted only at an `animate` boundary
  or by `keep` of visible ids; ghosts never follow later motion.
- `measure` values are in logical units × `scale`; no domain-unit
  measuring.
- `unroll` is defined for ring pieces only.
- `angle` and `measure` resolve their points at layout time; an `angle`
  does not update when its arms move (a `measure` does, by design).

## 4. Verification

Unit: minted ghosts (drawables copied through the pose, opacity, order
before the source, ids, boxes; `keep` and every verb's `ghost` option;
an `animate` ghost from the boundary layout), `angle` (value, right
square, label text, anchors), `measure` (each `what`, formatting, the
dimension line's side, `label_<id>` as follower, values after scale /
morph / mirror / a moving `from` ref, the line re-pointed, `texts` state,
`setText` against the mini-DOM), the three
cuts (ids, geometry, `pieces[id].ring`), `unroll` (strip lengths 2π·r_mid,
stacking), `ellipse`/`line` (points, clipping, anchors), the helper and
the gate, the seven examples through the examples gate. tsc, the full
suite, both builds. Live: the hand checklist gains the ring unroll with
its ghost, the measure changing under a scale, and the ellipse's moving
point.
