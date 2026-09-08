# Design: motion for any element, geometric primitives, `arrange`, and the circle-sectors template

Status: agreed Hans + Claude 2026-09-07 (assessment in chat after the πr²
drawcast). Implementation plan: `docs/superpowers/plans/2026-09-07-motion-and-primitives.md`.

## 1. The problem

Asked "Hvorfor er arealet av en sirkel πr²?", the compiler drew three
matplotlib stills that swap in one frame (`figures: 3`) — because it had
no way to MOVE pieces. The verbs can translate an element (`move`, no
rotation, attached labels left behind), `animate` recomputes a TEMPLATE's
params per frame, and tier-2 has no sector, arc or polygon element. The
classic proofs — cut a circle into sectors and zip them into a rectangle,
shear a parallelogram, rearrange Pythagoras' squares, tear a triangle's
corners — all need pieces that move and turn.

Hans: objects should be movable and rotatable in general; there should be
geometric primitives (template or built in); both must be general, not
specific to one drawcast.

## 2. Three layers, one principle

The founding principle holds: **the model writes semantics, code computes
geometry.** The model says "rotate this 90° about its apex", "zip these
pieces into a row"; code computes every coordinate.

### 2.1 Transforms on any element (the `move` verb grows)

`move` gains `rotate` (degrees, counter-clockwise in the y-up canvas),
`pivot` (`[x, y]` in current logical coordinates, or omitted = the
element's current bounding-box centre) and `to` (an absolute target for
the element's bounding-box centre, as an alternative to `by`/`path`). At
least one of `by`, `to`, `path`, `rotate` is required. Attached labels
(spec labels with `attach_to`, template labels named `label_<id>`, and
their `_leader` strokes) now FOLLOW a translation; they do not rotate.

Pose model. Every element carries a pose `{ offset: [dx, dy], turn: { deg,
pivot } }` in the scene state (today only `offsets`). The pivot is stored
in the element's ORIGINAL frame (the layout's coordinates), and the SVG
transform is `translate(dx, -dy) rotate(-deg, px, H - py)` — rotate about
the pivot in the original frame, then translate. Composing a new rotation
by δ about a point Q given in CURRENT coordinates:

```
if deg == 0: pivot p := Q - offset            (choose the original-frame point under Q)
deg  := deg + δ
offset := R(δ)(p + offset - Q) + Q - p         (R(δ) = rotation by δ about the origin)
```

which is exact (derivation in the plan). A rotate with no prior rotation
and the default pivot leaves the offset unchanged, as one expects.

The player gets a `transform` step: per element, a from-pose and a
to-pose, tweened over `duration` (offset along a straight line, angle
linearly), through a new `RenderedElement.setTransform(dx, dy, deg, pivot)`
on the backend (`setOffset` stays and means `setTransform(dx, dy, 0,
[0,0])`). Plain `move` (no rotate) keeps its `move` step and waypoint
paths unchanged. Scrubbing and step-back work because the pose is scene
state; export works because the transform is an SVG attribute on the
frame the exporter clones.

### 2.2 Geometric primitives (tier-2 elements)

New element types: `circle` (x, y, radius), `sector` (x, y, radius,
`from`, `to` in degrees, counter-clockwise from +x), `arc` (same, stroke
only), `polygon` (`points`, or `sides` + `radius` + optional `rotation`
for a regular polygon at x, y), and the generator `pieces` — `kind:
"sectors"`, x, y, radius, `n` — which emits `n` sector drawables with ids
`<id>_1 … <id>_n`, each its own top-level group (closed outline + fill),
so each is command-addressable, hit-testable and a "part" for the drills.
Fill and stroke come from the element's `style` like every tier-2 element
(`fill` for the wash, `color` for the edge). The layout records piece
geometry in `LayoutResult.pieces[id] = { apex, centroid, midAngle, radius,
halfAngle }` so `arrange` can zip sectors without re-deriving them.

### 2.3 The `arrange` verb

`arrange: { target, layout, at?, gap?, columns?, duration?, easing? }`.
`target` is a list of ids or one `pieces` id (expands to its pieces).
Layouts:

- `row` — left to right in target order, bounding boxes touching with
  `gap`, centred on `at` (default: the targets' current centroid).
- `zipper` — the rearrangement proof: sector k is rotated about its APEX so
  even pieces point up and odd pieces point down, apexes on a common line
  stepping by `r·sin(halfAngle)`, alternating below and above the line — the
  bumpy rectangle of width ≈ πr and height r. Requires sector pieces
  (from `pieces` or from the layout's `pieces` metadata); other elements
  are placed as `row`.
- `grid` — `columns` per row, bounding boxes, `gap`.
- `ring` — on a circle around `at`, radius from the total width.
- `stack` — bottom to top.

The planner computes each target's destination pose from its current
bounding box and pose (2.1's composition), and emits one `transform` step
for all of them, tweened together. The model never writes a coordinate.

### 2.4 The `circle_sectors` template (continuous morph)

Where the motion itself is the lesson ("with forty thinner slices the
edge is nearly straight"), the honest mechanism is a template with
`animate`: `circle_sectors` in the mathlogic pack, params `n` (2–64) and
`t` (0 = the circle, 1 = the zipper), `show_radius`, `labels`. The layout
interpolates every sector's rotation-about-apex and translation with `t`,
so `animate: {t: 1}` moves the pieces on every frame and `animate: {n:
40}` refines the cut (fractional `n` rounds). Element ids: `piece_<k>`,
`radius_line`, `label_r`, `label_base` (πr), `label_height` (r). A bundled
example rebuilds the πr² drawcast on it.

## 3. What this does not do (yet)

- Rotating text stays unrotated (labels follow translations only).
- `zipper` is defined for sectors; a general "tile these polygons" is not
  attempted.
- No scale/flip transform; no morphing between shapes.
- The compiler prompt learns the new verbs and elements in prose; a
  fewshot for a rearrangement proof is the bundled example, not a
  prompt fewshot.

## 4. Verification

Unit: plan (pose composition, `to`, labels follow, arrange layouts from
fake boxes and piece metadata), tier-2 layout (ids, closed outlines,
pieces metadata), schema, the template at t ∈ {0, 0.5, 1} and n ∈ {12, 40}
lint-clean, the bundled example through the examples test. Live: the
πr² example rendered and played in the app, and one freehand spec with
`pieces` + `arrange` rendered (a screenshot mid-tween).

## 5. Addendum 2026-09-08 (Hans): zoom, fade, more examples

Hans asked for three more things, with "spec what is not too complicated and
follow your recommendations". Decisions:

### 5.1 Zoom — two things, one already there

- **Zoom the VIEW onto an object** exists: `camera: { center: { ref: "hex" },
  zoom: 3 }` (and `camera: { reset: true }`). Nothing to build; the prompt
  already teaches it.
- **Scale the OBJECT** (grow or shrink it in place, the "zoom in on this
  piece" of a demonstration): `move` gains `scale` — a uniform factor about
  `pivot` (default the element's current centre), cumulative across moves.
  The pose model grows from offset + turn to offset + turn + scale sharing
  ONE pivot in the original frame: `x ↦ s·R(deg)(x − p) + p + offset`.
  Rotation and uniform scaling about the same point commute, so the
  composition rules stay exact: adding a scale by k about a current point Q
  gives `s := s·k`, `offset := k(p + offset − Q) + Q − p` (the rotation
  rule with R(δ) replaced by k); adding a rotation is unchanged. The SVG
  transform becomes `translate(dx, −dy) rotate(−deg, P) translate(P)
  scale(s) translate(−P)` with P the flipped pivot. Stroke widths scale
  with the element (it is a zoom). Attached labels follow the translation
  only. Tween: scale linear in time.

### 5.2 Fade — a persistent opacity verb

`fade: { target, to, duration?, easing? }` sets an element's opacity
persistently (0–1; `to: 1` restores), tweened over `duration` (default 1 s).
It lives in the scene state (`opacities`), so scrubbing and step-back
honour it, and attached labels fade with their element. It is distinct
from `focus`/`highlight` (transient emphasis that ends by itself) and from
`hide` (gone, not hit-testable). Backend: the SVG `opacity` ATTRIBUTE on the
element's groups, so `focus`'s CSS `style.opacity` dimming on leaf nodes
still works on top and its removal cannot undo a fade. `target` may be a
pieces id (expands). Not done: fading a template's whole figure (`target`
lists ids; use several).

### 5.3 More bundled examples

Three freehand examples in `src/examples.json` that exercise the new verbs
end to end (the πr² template example is already there): sectors zipped
into a rectangle with `pieces` + `arrange`; the parallelogram area (cut a
triangle with `polygon`, `fade` the original, `move` the piece across,
draw the rectangle); similar triangles (`camera` zoom onto a triangle, then
`move … scale: 2` about a vertex, the original outline drawn inside).
