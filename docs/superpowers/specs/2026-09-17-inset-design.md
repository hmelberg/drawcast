# Inset — a small picture of another page on this one

Status: implemented 2026-09-17 on branch worktree-inset (plan:
docs/superpowers/plans/2026-09-17-inset.md, smoke:
docs/superpowers/plans/2026-09-17-inset-smoke.md). Hans's smoke test is
the remaining acceptance step.

Deviations made during Task 9 (the prompt bullet, the schema-size pin,
the three bundled examples, ROADMAP, smoke):

(a) SUPERSEDED (fix round 2): the bullet's illustration is two command
objects (one action verb per command); see §8.

(b) `generic_axes_diagram`'s curves are fixed to x, y ∈ [0, 100] — there
is no `x_range`/`y_range` param (checked: `params_schema` in
`src/scenes/generic_axes_diagram/layout.ts`). The addendum's own suggested
parabola substitute (`x*x - 4*x + 5`) still overflows the canvas well
before x = 100 (y reaches 9,605), which the layout gate catches as
`fit-scale`/`overlap-label` warnings once the template is fitted into the
inset column's smaller box. The bundled parabola example uses a shallow
leading coefficient instead (`0.02(x-50)^2 + 1`, vertex (50, 1), y ranges
1–51), and the growth-curves example's exponential rate was lowered
(`5*exp(0.025*x)`, not the first-drafted 6 %/year) to keep every curve
inside the canvas over the whole fixed domain.

(c) SUPERSEDED (controller ruling, fix round 1): the examples gate now
resolves insets before laying an item out, so the two `point.at.ref+anchor`
beats keep the source element's own id (`t_2`, `step_2`) as originally
drafted — see §9 below.

(e) SUPERSEDED (final review, fix wave): §3 and §4.3 as originally
written say `resolveInsets` runs inside `resolvedRenderSpec`, wired into
`RenderResolveDeps` and its four injection sites. The code instead calls
it from `render()` (`src/render/index.ts` ~294), after the resolve pass
and after `withTextStyle`: the picture needs the source's settled text
style (§6), and the other four resolve sites (portraits/sources/code/
images/icons) have no siblings to resolve against. §3 and §4.3 below are
rewritten to describe the code as it stands.

## 1. What this is

A new tier-2 element type, `inset`. It names another item of the same
playlist and draws that item's FINAL FRAME as a small hand-drawn picture
in a box on the current page — the inset a lecturer keeps in the corner
of a slide so the audience remembers the model while the results are
interpreted. The picture is real drawables under the inset's own id, so
everything that works on an element works on it: `draw` sketches it,
`camera` zooms into it, `move` with `scale` brings it forward, `focus`
dims the rest, `point`/`highlight` aim at it, `erase` takes it away, and
the video export records it like any other ink. A paused click on an
inset opens the source page full size in a modal; the modal's "Go to
page" button jumps the playlist there.

It is opt-in. A page without `inset` elements is exactly what it is
today: no strip is reserved, nothing is inserted. (Hans, 2026-09-17: "It
is a feature that we can use if we want, not something that always will
be inserted.")

The scenario that shaped it: page 1 draws a Markov model; page 2
simulates it with sliders and a plot; page 3 concludes in text while
small pictures of the model and the plot stay in view, and the narration
brings the model forward for a beat to point at one arrow.

## 2. Problems it solves, in order of frequency

1. **Refer back without leaving the page.** "Remember the sick → dead
   rate" needs the model in view, not a jump to page 1. Today the only
   ways are redrawing the figure by hand on the new page or `zoom_from`,
   which is a transition, not an embed.
2. **A conclusion page that shows what it concludes from.** Two insets
   and a text block make the closing view of the Markov scenario without
   the screens/stage feature.
3. **A memory cue that can be inspected.** The inset is a thumbnail; the
   modal is the page.

## 3. Decisions

**A screen is a playlist item; an inset is its final frame.** Every item
is a spec with a final frame, and a chapter is only a grouping; an "end
of chapter" picture is the chapter's last item. The frame is what the
player PAINTS at the end — `sceneAt(plan, plan.steps.length)`, the held
frame — so an item that ends in `clear` (most do) still gives its last
drawn frame, not a blank. Built from the item's AUTHORED spec: the
playlist's exit (`withSoftExit`/`withZoomExit`) is appended only by the
export path and would blank it.

**Vector, not raster.** The picture is built from the source item's
layout and plan with pure functions (`layoutSpec`, `planCommands`,
`sceneAt`, `mapDrawable`), never from a screenshot. It keeps the hand,
zooms crisp under `camera`/`move`, serialises into the video export, and
is testable in vitest with no DOM. `src/export/snapshot.ts` (a PNG) is
not used.

**Computed once, in the async resolve phase.** `layoutSpec` is
synchronous and re-runs per tween frame, so the picture cannot be laid
out inside the host's layout. `resolveInsets` runs in `render()`
(`src/render/index.ts` ~294), on the deep clone `resolvedRenderSpec` has
already produced (B11: never the author's document) and after
`withTextStyle` has settled the host's text style on it — AFTER the
resolve pass, not inside it, because the picture needs that settled
style (§6) and the other four resolve sites (portraits/sources/code/
images/icons) have no siblings to resolve against. It stores the picture
on the element clone; tier-2 only FITS the stored picture into its box
on each layout call.

**Crop by default, whole canvas on request.** `crop: true` (default)
fits the ink union of the frame (plus padding) into the box, so a small
drawing in a sea of white comes out as the drawing. `crop: false` fits
the full 1000 × 750 canvas, so every uncropped inset shares one scale and
the source's layout, white space included, is preserved. Mixing the two
on one page gives insets of different scales by design.

**A picture, not a life.** Nothing inside an inset is live: no slider,
no quiz, no beat-by-beat drawing inside it, no ids of its own that
commands can address. That line is what keeps it cheap and keeps it out
of template-as-element. The one concession: the inset publishes the
source's element boxes as READ-ONLY named anchors, so `point`, `camera`
and `at` can aim at a part INSIDE the picture (`{ref: "model_pic",
anchor: "arrow_sick_dead"}`).

**Deterministic.** A source whose final frame depends on a slider or a
stored answer renders at the spec's default vars, so live and export
agree. An inset that reflects what the learner did is a later ruling.

**No pictures of pictures.** The source is rendered with its own
`inset` elements removed, at the full canvas with the camera reset. One
filter in the resolver.

**Default placement is a right-hand column, top down, thumbnail size.**
Fixed constants (§5). Explicit `x/y/width/height` or `at` wins. On a page
that has default-column insets and a template WITHOUT an explicit
`params.box`, the template's box defaults to the region left of the
column (`INSET_MAIN`), the same way `figureSplit` invents a box when a
code panel and a template coexist. Paint order is global by kind
(template-box spec §8), so an inset over live ink is a collision, not an
overlay — the default keeps them apart; explicit boxes always win.

**Stroke width and roughness scale with the picture.** `scaleDrawables`
scales geometry and font size but not `style.strokeWidth` or
`style.roughness` (rough.js works in absolute units), so a 1/6-size
picture with full-size wobble is six times too rough. The inset divides
both by the fit scale, with a floor on stroke width so lines stay
visible on a phone. `group.fit` does not do this today; that is left as
it is (out of scope), noted for a later fix.

**Text in an inset is a picture of text.** Font sizes scale with the
geometry and are NOT floored at `FONT_FLOOR`; the `font-too-small` and
`overlap-label-*` lints skip leaves inside an inset (the group carries
`role: "inset"`). Legibility comes from the modal or from `camera`/
`move`, not from the thumbnail.

**Enlarging is the existing verbs.** No new verb. `camera: {center:
{ref: id}, zoom: 4}` then `camera: {reset: true}` moves the page to the
picture; `move: {target: id, scale: 4, to: {x, y}}` with `focus:
{target: id}` brings the picture forward and keeps the page — the better
feel for a reference during narration; `move` has no reset, so the way
back is a second move (`scale: 0.25`, cumulative) to the slot's centre
(x 900, y 670 for the first thumbnail, 136 lower for each next). If the
pattern proves common a sugar verb is a later round.

**Reference by title or number, warn on a miss.** Items have no ids
(`PlaylistItem` = spec + chapter + index). `of` is the item's title
(case-insensitive, trimmed) or its 1-based number among items (chapter
markers excluded), or `"previous"`. A miss draws the frame only and warns
— the `camera` posture for an unknown ref (degrade, never throw). A
self-reference warns the same way. Forward references (a preview of a
later page) are allowed.

**Live controls and layout stay as they are.** The overlay is
player-only (the export never mounts controls), registered in
`gates.ts`'s `GATE_SELECTOR`, and chains — never replaces —
`hd.timeline.callbacks.onState`/`onStep` (media-modal's pattern).

## 4. Mechanism

Files: `src/layout/inset.ts` (constants + pure fit/frame functions),
`src/render/inset.ts` (the resolver), `src/render/frame.ts` (pure
"scene state → drawables"), `src/ui/inset-modal.ts` (the overlay), plus
the touchpoints in §10.

1. **Spec.** `SpecElement` gains `of` (already exists — a string for
   portrait/image; `inset` also accepts a number), `crop?: boolean`, and
   the internal `picture?: InsetPicture` the resolver fills (never
   authored; not in the schema). `ElementType` gains `"inset"`;
   `elementErrors` requires `of`.
2. **Siblings reach `render()`.** `RenderOptions` gains
   `siblings?: { specs: readonly Spec[]; self: number }` — the
   playlist's item specs in order and this item's index.
   `session.ts` sets it once in `renderOpts` per item (lines ~309, ~465);
   `export/video.ts:545` the same. The editor and viewer both mount
   through `mountPlaylist`, so a single cast simply has `siblings` of
   length 1 and an inset warns.
3. **Resolver** (`resolveInsets(spec, {siblings, self, prepare,
   measureFor, planOpts})`), called from `render()` (`src/render/
   index.ts` ~294) AFTER the resolve pass (`resolvedRenderSpec`) and
   after `withTextStyle` — not wired into either: the picture needs the
   source's own settled text style (§6), and the other four resolve
   sites (portraits/sources/code/images/icons) have no siblings to
   resolve against, so folding insets into that pass would gain them
   nothing. For each `inset` element: `resolveSibling(of, siblings,
   self)` finds the source spec; `deps.prepare(source)` does what
   `render()` does to its own spec — `ensureEnginesForSpecs([source])`,
   `expandCards`, `resolvedRenderSpec(source, deps with no siblings)`
   (so the recursion is one level by construction), `ensureMathFont`,
   `withTextStyle` — then the pure core `pictureOf(source, measure,
   planOpts, prefix)` (`src/render/inset.ts`; strips the source's own
   `inset` elements first):
   - `layout = layoutSpec(source, measure)` (`source` already carries
     its own `text:` block's style, applied by `prepare` above, so a
     page set in the C64 face keeps it; the host's `applyTextStyle` is
     NOT applied to the picture — see 6);
   - `plan = planCommands(source.commands, layout.order,
     {...planOptionsFor(source, layout), bboxOf, bboxesFor, anchorsAt})`;
   - `state = sceneAt(plan, plan.steps.length)`;
   - `final = layoutAt(state)` — `layoutSpec` again with the state's
     params (`withOverrides`) and overrides `{math: tex, copies, shapes}`,
     then `withMinted(final, plan.minted, layoutAt)` so trails, ghosts
     and copies exist;
   - `drawables = frameDrawables(final, state)` (`src/render/frame.ts`):
     for each id in `state.visible`, in that order, `drawablesForId`
     mapped through `poseOf(state.offsets[id], state.turns[id])` via
     `mapDrawable`, with `style.opacity *= state.opacities[id]` (skip at
     0). Leaves are re-homed under ids `${insetId}__p${k}` so the host
     never sees the source's ids.
   - `InsetPicture = { drawables, ink: BBox | null, boxes:
     Record<string, BBox> }` — `ink` is `unionBoxes` over the frame's
     leaves (for `crop`), `boxes` is `elementBBoxes(final)` filtered to
     visible ids, mapped through the same poses (for the read-only
     anchors; the modal takes the whole inset and needs no boxes).
   Failures degrade: no siblings / no match / self → `picture` stays
   undefined and a warning string lands on `LayoutResult.warnings` via
   the element (the tier-2 case pushes it). Nothing throws.
4. **Tier-2** (`case "inset"` → `insetDrawable(el, ctx, measure)` in
   `tier2.ts`, geometry in `src/layout/inset.ts`):
   - slot: explicit `x/y/width/height` (y-up, like image), else `at`
     (placed by the common `at` path with a default size), else the
     k-th default-column slot where k counts default-column insets in
     element order;
   - `frame = ${id}__frame`: a rect stroke at the slot, light style
     (`strokeWidth 1`, `roughness 0.6`, the portrait frame's look);
   - inner box = slot inset by `INSET_FRAME_PAD`; source box = `crop` ?
     `ink` padded by `INSET_CROP_PAD` : `CANVAS`; `{s, dx, dy} =
     fitTransform(sourceBox, inner)`; children = `structuredClone`
     of `picture.drawables` → `scaleDrawables(s, dx, dy)` → per leaf
     `strokeWidth = max(INSET_STROKE_FLOOR, strokeWidth * s)`,
     `roughness *= s`;
   - returns a `GroupDrawable {id, role: "inset", box: slot, children:
     [frame, ...children]}`; `ctx.anchors[id]` = slot centre;
     `ctx.namedAnchors[id]` = `UNIVERSAL_ANCHORS` off the slot, then one
     entry per source element id = the centre of its box mapped by
     `(s, dx, dy)` (universal names win on collision);
   - no picture (unresolved): the frame alone, plus the warning.
5. **Constants** (`src/layout/inset.ts`): `INSET_W = 160`, `INSET_H =
   120` (4:3 like the canvas, ~1/6 width), `INSET_GAP = 16`,
   `INSET_RIGHT = 980`, `INSET_TOP = 730`, `INSET_MAX = 5` (5 × 120 + 4 ×
   16 = 664 ≤ 710), `INSET_FRAME_PAD = 6`, `INSET_CROP_PAD = 12`,
   `INSET_STROKE_FLOOR = 0.8`, `INSET_MAIN = {x: 60, y: 95, w: 740, h:
   560}` (the `full` region cut to stop 20 units short of the column at
   x = 820). Default-column slot k: `x = INSET_RIGHT − INSET_W`, `y =
   INSET_TOP − INSET_H − k × (INSET_H + INSET_GAP)`. More than `INSET_MAX`
   in the column: the column's slots shrink uniformly so all fit
   (`h = (710 − (n−1) × gap) / n`, width keeps 4:3), and lint warns.
6. **Text style.** The source's own `text:` block is applied inside
   `pictureOf` (`withTextStyle`). The host's `applyTextStyle`
   (`index.ts:287`, multiplies every text leaf's fontSize by the host
   scale and sets the family) must skip leaves inside a `role: "inset"`
   group — one guard in `text-style.ts` — or the picture would be
   scaled twice and re-faced.
7. **Layout default for the template box** (`layout.ts` ~119): `box =
   requestedBox ?? split.box ?? (hasDefaultColumnInsets(elements) ?
   INSET_MAIN : null)`. Native data templates get the rectangle as
   `params.box`; the rest are fitted. A template WITH an explicit box
   is untouched.
8. **Planner/player.** Nothing. The inset's id is in `layout.order`;
   `elementBBoxes` returns the group's nominal `box` (the slot), so
   camera/move/focus/point/highlight/erase/hit-test work unchanged. The
   implicit trailing draw draws an inset no command names. Draw pacing
   follows ink length as for any group.
9. **Overlay** (`src/ui/inset-modal.ts`, `openInsetModal(stage, hd, el)`):
   the media-modal shell (scrim, box, bar with ✕, Escape, outside click,
   chained `onState`/`onStep` close) with a `<div>` host instead of an
   iframe; `await render(sourceSpec, host, {mode: "silent", style, text})`
   then `hd2.timeline.renderUpTo(hd2.plan.steps.length)`; `hd2.destroy()`
   in `close()`. The source spec for the modal is the resolved source the
   resolver already built; it rides on `picture.spec` (memory only,
   never serialised — `hoist.ts` and `insert.ts` never see `picture`
   because the resolver writes it on the render clone). A "Go to page"
   button dispatches `CustomEvent("cs-goto-item", {detail: {index}})`
   on the stage; `session.ts` listens on the host and jumps (its
   existing backward-jump path keeps question ordinals). Attached from
   `attachPlayerControls` right after `attachInfoCards`
   (`controls.ts:1044`): `attachInsetZoom(stage, hd)` — a capture-phase
   click listener like infocard's, guarded by `state === "playing"`,
   `gateIsOpen`, and the R9 visible-set filter (`sceneAt(plan,
   position).visible`), hit-testing only inset ids with
   `hitElement(boxes, p, 8)`. Info cards keep priority: an inset with
   `link` gets a card from infocard as today; `attachInsetZoom` stands
   aside when the click target has a card (`cardTargets` contains it).
   `.cs-insetmodal` joins `GATE_SELECTOR`.
10. **Playlist warnings.** `parsePlaylistText` checks every `inset.of`
    against the items it just parsed (title, number, "previous") and
    pushes a warning for a miss — the compile-time check, since a single
    spec's lint cannot see siblings.

## 5. Sizes and readability, stated so nobody re-derives them

At the default slot a 28-unit label becomes ~4.5 units: unreadable
everywhere, by design; the thumbnail is a memory cue. `zoom: 4` on it
gives ~18 units, readable on a laptop. Two half-page insets (explicit
`x`/`y` and `width: 420`) read at ~12 units, fine on a laptop and
marginal on a phone. Five in the column is the maximum before the
lint; there is no scrolling column and there will not be one.

## 6. Lint

- `inset-source` (warn): `of` does not name an item, or names this item.
  Raised by the playlist parser (§4.10) and again by the resolver at
  render time (as a `warnings` string).
- `inset-count` (warn): more than `INSET_MAX` default-column insets on
  one page.
- `font-too-small`, `overlap-label-label`, `overlap-label-stroke`,
  `overlap-math-*`: skip leaves inside a `role: "inset"` group. The label
  solver still treats the inset's leaves as obstacles (soft for strokes,
  solid for text), so the host's labels route around the picture.
- `out-of-canvas`: unchanged; an explicit slot off the canvas is an
  error as for any element.
- The overlap rules between the inset's frame and host ink stay on:
  that is the collision the default template box exists to prevent.

## 7. Concurrent work in this repo — read before branching

Base: `main` at `ca0a1bb` (2026-09-17). Locked worktrees
`live-controls` (f5e1299) and `sweep` (2fa39cc) are stale branches, not
active work; `template-spike` holds `manim-part2`, merged. This round
touches `tier2.ts` (one case), `layout.ts` (the box default, ~5 lines),
`text-style.ts` (one guard), `lint.ts` (skip guards + one rule),
`resolve.ts`/`index.ts` (deps + `RenderOptions`), `session.ts`/`video.ts`
(one line each + the goto listener), `controls.ts` (one attach call),
`gates.ts` (one selector), `schema.ts`/`types.ts`/`compiler-v1.md`/
`prompt-size.test.ts`/`examples.json`. No file that the ROADMAP's open
rounds (course progress) touch.

## 8. Schema, params check, prompt

Schema (`schema.ts`): `"inset"` in the type enum; `of` description
extended: "inset: the playlist item whose final frame this shows — its
title, its 1-based number, or \"previous\"."; new `crop`: "inset: true
(default) fits the page's ink into the box; false fits the whole
1000×750 canvas so every uncropped inset shares one scale."; `width`/
`height`/`x`/`y` descriptions gain "inset: the box; omitted = the next
slot in a right-hand column of thumbnails". `elementErrors`: `inset`
needs `of`.

Prompt (`compiler-v1.md`, under "Elements that need more than the
schema"): **inset** — a small picture of another page of the same
playlist (its final frame), for referring back without leaving the page:
`{ "id": "model_pic", "type": "inset", "of": "The Markov model" }`. Omit
the position: insets stack in a right-hand column, and a template on
the same page then takes the region to the left automatically. Give a
`width` only when the picture must be read in place (half the page).
Bring it forward for a beat with TWO commands, one action verb each —
`{"move": {"target": id, "scale": 4, "to": {"x": 500, "y": 375}}}`, then
`{"focus": {"target": id}, "speak": "…"}` — then put it back with a
second `move` (`scale: 0.25`, cumulative, to the slot's centre); or
`camera` into it and `camera: {"reset": true}` back. Use insets ONLY to
refer back to an earlier page; a page's own figure is never an inset of
itself; at most a few per page.

Re-pin `tests/prompt-size.test.ts` in the same commit as the schema and
prompt text (house rule, Hans 2026-09-10).

## 9. Acceptance

One playlist checked by eye (the smoke doc): three items — a
`markov_model` page, a sliders + plot page, and a conclusion page with
two insets and text — where item 3's narration brings the model forward,
points at one arrow through the inset's anchor, and returns it; then a
paused click on the model inset opens the modal and "Go to page" jumps
to item 1.

Tests, each written to fail first:

1. `layout/inset.ts`: default-column slots for k = 0..4 land where §5
   says; six shrink uniformly and stay inside the canvas.
2. `frameDrawables`: a layout + state with one moved, one rotated, one
   faded and one hidden element yields exactly the visible leaves, posed,
   with opacity multiplied, under `__p` ids.
3. `pictureOf`: a source ending in `clear: {}` gives the held frame, not
   an empty picture; a source with `copy` + `move` includes the copy.
4. `pictureOf` strips the source's own insets (no regress).
5. `insetDrawable`: `crop: true` fits the ink union, `crop: false` the
   canvas; the group carries `role: "inset"` and `box` = slot; stroke
   width and roughness are divided by `s`, stroke width floored.
6. Named anchors: a source element id resolves through the inset
   (`at: {ref: inset, anchor: srcId}` places at the mapped centre;
   universal names win).
7. Template box default: a spec with a default-column inset and no
   `params.box` lays its (non-native) template out inside `INSET_MAIN`;
   with an explicit box it does not; with an explicit `x/y` inset it does
   not.
8. `applyTextStyle` leaves `role: "inset"` leaves untouched.
9. Lint: `inset-count` at six; `font-too-small` silent for inset leaves;
   an unresolved `of` yields the frame and a warning, never a throw.
10. Resolver: `of` by title (case-insensitive), by number, `"previous"`;
    self and miss warn; siblings absent warns.
11. Playlist parser: `inset-source` warning for a miss.
12. Plan: `camera` centred on an inset resolves to its slot; `move
    scale` on it plans like any group.
13. Mini-DOM: a mounted host with one inset paints `__p` leaves and the
    frame (the ghost lesson: a plan-level test cannot see a missing
    paint).
14. Prompt: the schema and prompt sentences are present; sizes re-pinned.
15. Examples: the Markov playlist is lint-clean per item and its ids are
    real.
16. Fix round 1 (controller ruling, recorded in the ledger): `pictureOf` is
    pure and synchronous and a playlist example's other items are already
    in scope in `tests/examples.test.ts`, so the gate need not skip inset
    resolution — `resolveInsetsSync` (`src/render/inset.ts`, beside
    `resolveInsets`) builds a source's picture straight off the AUTHORED
    sibling spec (no `prepare`: no engines, no assets, no cards) and is
    called once per playlist example in `beforeAll`, after packs and
    engines are ready, mutating the same spec objects `cases` already
    holds. The gate now lints the pictures themselves too, not just the
    frame — tighter, not looser — and the bundled examples keep the
    part-anchor beats (`point.at: {ref, anchor: t_2}` etc.) the feature
    exists to show. Unit tests: `tests/inset-picture.test.ts`.

## 10. Non-goals, written down so they stay out

- Auto insets (every page shrinking into the next's column), the shrink
  transition, page slide transitions, scrolling back to a page. Later
  rounds; the transition needs export-side tweening.
- An inset of a live screen, shared vars through an inset, learner
  answers reflected in an inset.
- A scrolling column, more than five thumbnails, insets in the strip
  being "reserved" on pages without insets.
- Fixing `group.fit`'s unscaled stroke width and roughness (noted).
- A sugar verb for grow-dim-speak-shrink.
- Screens, stage, camera-to-screen (ROADMAP "Screens in a spec").
