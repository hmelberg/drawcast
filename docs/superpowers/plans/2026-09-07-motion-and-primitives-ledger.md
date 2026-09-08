# Ledger — motion and primitives (2026-09-07)

Plan: `docs/superpowers/plans/2026-09-07-motion-and-primitives.md`. Design (the
authority the plan argues from): `docs/superpowers/specs/2026-09-07-motion-and-primitives-design.md`,
agreed after the πr² drawcast could only swap matplotlib stills because
nothing in drawcast could move a piece and turn it. Branch: worktree
`template-spike`, base `b51b02e`. Full progress record with every review
verdict: `.superpowers/sdd/2026-09-07-motion-and-primitives/progress.md`.

Six tasks landed (Task 5 is this document): the plan's four (move/pose,
primitives, arrange, template) plus a Task 6 the controller opened mid-round
after the first live smoke found a gap the plan hadn't anticipated.

## Pre-flight scan and the parallel-dispatch ruling

Before dispatch the controller mapped what each task produces and what
another consumes: Task 1 (`src/render/pose.ts` — `Turn`, `composeTurn`,
`poseOf`, `poseCentre`; `TransformItem`; `SceneState.turns`;
`PlanOptions.attachedTo`) is what Task 3 imports; Task 2 (`PieceGeometry
{apex, centroid, midAngle, halfAngle, radius}`, `LayoutResult.pieces` /
`pieceGroups`, piece ids `<id>_<k>`) is what Task 3's `pieceOf`/`expandId`
read. Task 1 and Task 2 both edit `src/spec/types.ts`, `schema.ts` and
`compiler-v1.md` in different regions, so they had to run in sequence, not
parallel. Task 4 (template + pack + examples) touches a disjoint file set
and was ruled safe to run alongside Task 1 despite the general
subagent-driven-development skill's "never dispatch two tasks in parallel"
default — the skill's reason (file conflicts) doesn't apply when the sets
don't overlap; the cost if the ruling were wrong would have been a re-run of
Task 4's tests, which it wasn't.

## Task 1 — `move` gains `rotate`/`to`/`pivot`, the pose model

Shipped: `src/render/pose.ts` (new) with the pose composition math from the
design's §2.1 — a rotation by δ about a point given in current coordinates
composes exactly with any prior pose, verified against the `to`-test
(offsets `[200,150]`, centre `(200,150) → (400,300)`); `TransformItem` and a
player `transform` step tweening offset and angle together; attached labels
follow a translation but never rotate.

Review (package `b51b02e..03c752a`) found two Important bugs: (1) a plain
`move` issued after a `rotate` wiped the rotation in live playback, because
`player.ts`'s `move` case called `setOffset` instead of composing onto the
existing pose; (2) a follower was translated twice when a spec label's id
happened to be `label_<attach_to>` — `attachedTo` pushed it from both the
explicit-label and the auto-follower branch, with no cross-target dedupe.
Minors deferred: `to` against a null bounding box is a silent no-op; the
default pivot against a null bbox falls back to the origin; `currentBox`
ignored turns (carried forward as a requirement into Task 3's brief);
`rotate: 0` validates but is skipped as a no-op; one redundant plan test;
the tween lerps offset and angle independently, which drifts off the true
chord on a second off-centre rotation.

Ruling: the reviewer's minor about `to`/`pivot` schema descriptions lacking
an example was promoted into fix round 1 alongside the two Importants — a
Global-Constraint-class gap (the schema descriptions the compiler reads),
cheap to fix immediately rather than deferred.

Fix round 1/5 (commit `5d9330e`, re-reviewed against `1b4848a..5d9330e` —
Task 4's commit sits in between but touches unrelated files): all three
addressed — rotation now survives a plain `move`; followers deduped across
targets; `to`/`pivot` schema examples added. Review came back clean. Task 1
complete: `b51b02e..5d9330e`.

## Task 4 — the `circle_sectors` template (dispatched in parallel with Task 1)

Shipped: `circle_sectors` added to the mathlogic pack (`src/scenes/packs/mathlogic.yaml`),
params `n` (2–64) and `t` (0 = circle, 1 = zipped rectangle), interpolating
every sector's rotation-about-apex and translation continuously in `t`, plus
a bundled example rebuilding the πr² drawcast on it (`src/examples.json`,
`tests/circle-sectors.test.ts`).

Review (package `03c752a..1b4848a`) found one Important, plan-mandated bug:
`radius_line`/`label_r` switched binarily at `t = 0.5` instead of tracking
`piece_1`'s interpolated apex and angle — a visible jump mid-animation in
the bundled example. Minors deferred: the `language` param is inert; a
`packs.test.ts` title still said "eight templates" though the pack now has
nine; no test at `n = 2` or `n = 64`; `label_height` sits near the canvas's
right edge at `n = 64` (x ≈ 939); the brief's own Interfaces section listed
a stray `caption` id (a brief defect, not an implementation bug — no code
action taken).

Ruling: the reviewer was right and the brief's code was wrong — fixed by
making `radius_line` follow `piece_1` continuously: `apex = lerp(CIRCLE,
apexTo_0, t)`, `angle = half + delta_0·t` (its mid-line, which lands at π/2
at `t = 1`, the brief's intended end state).

Fix round 1/5 (commit `af3457a`, re-reviewed against `b9923c6..af3457a`):
addressed via the shared `apex0`/`delta0` values. Review came back clean.
Task 4 complete: `03c752a..1b4848a` + `af3457a`.

## Task 2 — geometric primitives (`sector`/`arc`/`polygon`/`pieces`)

Shipped: `sector` (x, y, radius, angle pair), `arc` (same, stroke only),
`polygon` (`points`, or `sides` + `radius` for a regular one), and the
generator `pieces` (`of: "sectors"`, x, y, radius, `n`, emitting `<id>_1 …
<id>_n` as its own top-level drawables) in `src/layout/tier2.ts`,
`src/spec/types.ts`, `src/spec/schema.ts`; the layout records
`LayoutResult.pieces[id]` geometry for `arrange` to consume without
re-deriving it.

Review (package `5d9330e..b9923c6`) found three Importants: (1) adding
`"fill"` to `SUB_SUFFIXES` double-painted shipped scenes whose `<id>_fill`
is already a *public* id in their `order` (music, cell_diagram, plant,
physics, others); (2) widening `from`/`to` to accept a bare number to serve
the new angle fields disarmed arrow/edge endpoint validation — an arrow with
numeric endpoints validated and then silently vanished — with a further
⚠️ that a `type: ["object","number"]` union might not survive structured-
output decoding at all; (3) the prompt's promise that `draw: ["<id>"]` draws
every piece of a `pieces` group had nothing behind it yet — no code expanded
`pieceGroups`. Minors deferred: `arcPts`/`sectorPts` duplicate wedge-geometry
logic; a `polygon` with fewer than three points silently defaults instead of
erroring; `of` is unread in the layout; `n` is unclamped; a degenerate
`start === end` case is unhandled; some test names claim to assert a wash
that they don't.

Three rulings here, one of which reaches beyond this task: (1) the wash
fix is `<id>_wash` with `SUB_SUFFIXES` gaining `"wash"`, not `"fill"` — the
reviewer was right, the brief was wrong. (2) sector/arc angles are named
**`start`/`end`** (degrees), *not* `from`/`to` — `from`/`to` were restored
to the plain endpoint-only schema with no type union. This departs from the
plan's own field names and is why Task 5's prompt line and this ledger both
say `start`/`end`. (3) the `draw: ["<id>"]` piece-expansion promise is
delivered by Task 3 (`PlanOptions.expandId` in `resolveIds`) rather than
Task 2 — carried into Task 3's dispatch as a required test.

Fix round 1/5 (commit `05e1bf4`, re-reviewed against `af3457a..05e1bf4`):
rulings (1) and (2) addressed — `_wash` suffix; `start`/`end` angle fields
with `from`/`to` restored to the endpoint schema. Review came back clean.
Task 2 complete: `5d9330e..b9923c6` + `05e1bf4`.

## Task 3 — the `arrange` verb

Shipped: `src/render/arrange.ts` (new) — `arrange: {target, layout, at?,
gap?, columns?, duration?, easing?}` with layouts `row`, `zipper` (the
rearrangement proof: sector pieces alternately up and down on a common
line, interleaved into a bumpy πr-wide, r-high rectangle), `grid`
(`columns`), `ring`, `stack`; `target` may be a list of ids or a single
`pieces` id, expanded via `PlanOptions.expandId` (ruling (3) above); the
planner computes each target's destination pose from its current bounding
box and Task 1's pose composition and emits one `transform` step for all
targets, tweened together.

Review (package `05e1bf4..6bfff69`) found one Important: `arrange`'s
translation-only layouts (`row`, `grid`, `stack`, `ring`) stranded attached
labels — `move` already carries them, `arrange` didn't. Minors deferred:
a grid with `columns > n` renders off-centre; `arrangeTargets([])` is not
handled as a total no-op; a one-item `ring`; the zipper's non-sector
fallback row ignores `gap`; no warning when a target is invisible; a
silently-empty expansion; missing schema examples for `target`/`at`/`gap`/
`columns`; coverage gaps (a null-bbox warning path, a single target, `at`
omitted at plan level). The implementer also flagged, and the review
confirmed as pre-existing (not caused by this task): `captionLines` in
`src/llm/subtitles.ts` plans with an empty id list, so a `speak` paired with
`move`, `highlight`, or `arrange` never reaches the subtitle track.

Ruling: the missing `at`/`columns` schema examples were promoted into fix
round 1 as a Global-Constraint gap, the same call as Task 1's `to`/`pivot`
examples.

Fix round 1/5 (commit `72e188a`, re-reviewed against `6bfff69..72e188a`):
followers now carried on translation layouts and deduped across targets;
`at`/`columns` schema examples added. Review came back clean. Task 3
complete: `05e1bf4..6bfff69` + `72e188a`. One minor left on record from this
final pass: `arrange`'s `duration`/`easing` descriptions have no example
(same gap `move` has).

## Task 6 — player reveals ids a param change mints (opened mid-round)

Not in the original plan. The controller's first live smoke (below) found
that after `animate: {n: 40}` on the πr² example, only the twelve pieces
drawn at the template's rest state were visible — the other twenty-eight
minted ids stayed hidden, because `applyScene` hides any id not already in
`scene.visible` and `animate`'s `frame()` ran without `revealNew`. Ruling:
minted ids should join the implicit final draw, the same way
`withNewIdsVisible` already treats a preview — so a new Task 6 was written
(`task-6-brief.md`) and dispatched in parallel with Task 3's fix round
(disjoint files: `player.ts` vs `plan.ts`/`arrange.ts`). Named cost if the
ruling was wrong: a template that deliberately mints hidden ids under a
param change would now show them — none such is known to exist.

Shipped, entirely in `src/render/player.ts` (plus its test): `planTimeIds`,
`applyScene` showing previously-unknown ids, and `animate`'s frame step
running with `revealNew = true`.

Review (package `72e188a..0eb8692`) came back clean on first pass; Task 6
complete. One minor left on record: a redundant hide assertion in the
animate test (harmless, not fixed).

## Live smokes

**Smoke 1** (HEAD `6bfff69`, full suite 5400 green, `tsc` clean): in a real
browser, a freehand spec combining `pieces` + `arrange: {layout: "zipper"}`;
a polygon rotated with `rotate` + `by` (its attached label followed); a
plain `move` issued after a `rotate` (rotation survived — Task 1's fix
verified live, not just in tests); `arrange: {layout: "stack"}` of an arc
and a sector. All four read back correct — the SVG transforms matched the
expected math. The πr² example itself lint-checked clean and played through,
but after `animate: {n: 40}` only the twelve originally-drawn pieces
rendered; the other twenty-eight stayed hidden, with labels sitting where
the full rectangle should be. This finding is what produced Task 6. A
separate observation, deferred rather than fixed: zipper rotation deltas
are not normalised to (−180°, 180°], so a slice can spin 432° on its way
into place (`kake_10` in the example) — cosmetic, no visible defect in the
end state.

**Smoke 2** (HEAD `0eb8692`, after Task 6): the πr² example plays through
end to end; after `animate: {n: 40}` all forty pieces render, SVG extents
447..933 (≈ πr wide, r high), labels in place — screenshot at
`scratchpad/motion/probe-played.png`. One minor noted, not fixed:
`label_height` sits roughly 45 px right of the rectangle's true edge.

## Not done / follow-ups

- **Zipper angle normalisation.** Rotation deltas during a zipper arrange
  are not normalised to (−180°, 180°]; cosmetic (observed live, `kake_10`),
  never fixed this round.
- **`arrange` warns nothing for invisible or missing targets** — a silent
  no-op rather than a diagnostic (Task 3 minor, deferred).
- **The zipper's non-sector fallback row ignores `gap`** (Task 3 minor,
  deferred).
- **`captionLines` (`src/llm/subtitles.ts`) plans with an empty id list**,
  so a `speak` paired with `move`, `highlight`, or `arrange` never reaches
  the subtitle track. Pre-existing (not introduced by this round), flagged
  independently by the Task 3 implementer and confirmed by the Task 3
  reviewer — not triaged or fixed here.
- **`language` on `circle_sectors` is inert** (Task 4 minor, deferred).
- **Design's three deliberate non-goals** (§3, updated — scale shipped in
  Task 7): rotated text stays unrotated (labels follow translations only);
  `zipper` is defined for sectors, not a general "tile these polygons"
  layout; no flip/mirror, no morphing between shapes.
- Smaller minors left on record across the reviews, none reopened: `to`
  against a null bbox is a silent no-op; default pivot against a null bbox
  is the origin; `rotate: 0` validates but is a no-op; the transform tween
  lerps offset and angle independently (chord drift on a second off-centre
  rotation); `arcPts`/`sectorPts` duplicate wedge-geometry logic; a
  `polygon` with fewer than three points silently defaults; `of` is unread
  in the tier-2 layout; piece count `n` is unclamped; a degenerate
  `start === end` sector/arc is unhandled; a grid with `columns > n` renders
  off-centre; a one-item `ring`; `arrange`'s `duration`/`easing` schema
  descriptions have no example; a `packs.test.ts` title still says "eight
  templates" though the pack now ships nine; no test exercises
  `circle_sectors` at `n = 2` or `n = 64`, and at `n = 64` `label_height`
  sits close to the canvas's right edge (x ≈ 939); a redundant hide
  assertion in Task 6's animate test.

## Addendum 2026-09-08: scale, fade, examples

**Task 7 — `move.scale`.** A pose now carries a uniform scale about the same
pivot as `rotate` (`Turn.scale`, `composeScale` in `src/render/pose.ts`); the
SVG transform composes as `translate rotate translate scale translate`, so a
single move can grow and turn an element from one corner at once. Reviewed
clean.

**Task 8 — `fade`.** A new persistent-dim verb: `SceneState.opacities`
(`src/render/plan.ts`) tracks each element's settled opacity, a `fade` player
step tweens it, and `RenderedElement.setOpacity` (`src/render/backend.ts`,
implemented in `src/render/svg-backend.ts`) applies it as the SVG opacity
attribute. The planner dedupes `fade`'s followers the same way `arrange`
already does.

Review caught: `SvgElementHandle.groups` (what `setOpacity` originally
targeted) ARE the leaf nodes, and text/image leaves write their OWN inline
`style.opacity` onto those same nodes every frame (reveal progress, the typed
cursor, and — for images — every tween frame) — an inline style always beats
a presentation attribute, so `fade` silently no-opped on labels, titles and
images (stroke/area leaves were unaffected; their reveal never touches that
property). Fix round 1, commit `3ec304b` ("Fix fade: text/image leaves need
their own opacity node"): `buildNodes` now wraps only text/image leaves in a
dedicated `fadeNode` `<g>` above the leaf's own node, and
`SvgElementHandle.setOpacity` targets these `fadeGroups` instead of the
transform groups; stroke/area leaves are untouched (`fadeNode === g`, the
same attribute-on-the-leaf behavior as before, since their reveal never
writes `style.opacity`). SVG's nested-opacity compositing multiplies the
wrapper's persistent attribute with the leaf's own transient style, so ending
a `focus` dim never undoes a `fade`. The implementer verified in a real
browser (Playwright/chromium): a faded path and its attached label both read
0.3, and a focus dim/undim round trip (0.3 → 0.16/0.048 during focus → 0.3
after) preserves the fade; full suite (270 files, 5445 tests) and
`tsc --noEmit` stayed clean. The re-review of this fix is running separately;
not claimed here.

**Task 9 — three bundled examples + this addendum.** Added to
`src/examples.json` (spliced before the closing `]`, matching the file's
existing 2-space/one-line-per-command formatting): "Sektorer blir et
rektangel" (freehand `pieces`/`arrange: zipper`, no template — the πr² proof
drawn by hand), "Parallellogram = rektangel" (`polygon` + `fade` + `move`,
the cut-and-slide proof that a parallelogram's area is base × height), and
"Formlikhet: dobbelt så stor" (`polygon` + `camera` + `move.scale` + `fade`,
showing a triangle scaled ×2 from one corner quadruples the area rather than
doubling it). Two problems caught by `tests/examples.test.ts` before these
were clean, both fixed here, not in production code:

- The brief's draft style objects used `strokeWidth`; the landed schema
  (`src/spec/schema.ts`) only recognizes `stroke_width` — the wrong key is
  silently dropped by AJV's `additionalProperties: false` rather than
  rejected loudly, so this would not have surfaced until someone looked at
  the rendered stroke. Fixed to `stroke_width` in all three examples.
- The first draft addressed the "kake" `pieces` group by its parent id alone
  in `draw`/`arrange.target` (as `src/render/index.ts`'s wiring of
  `expandId`/`pieceOf` from `layout.pieceGroups`/`layout.pieces` supports
  live). `tests/examples.test.ts` calls `planCommands` directly, without
  those two options, so in that path the parent id (never itself in
  `layout.order`) reported as unknown. Initially worked around by spelling
  out `kake_1` … `kake_12` — **closed properly in fix round 1** instead:
  `src/render/index.ts` now exports `planOptionsFor(spec, layout)`, pulling
  the pure `pieceOf`/`expandId`/`attachedTo` builders out of `render()`'s own
  `planCommands` call so a test can plan the way the app does; the test now
  passes `planOptionsFor(spec, layout)` as its third argument, and the
  example was restored to the parent-id shorthand
  (`draw: ["kake"]`, `arrange: {target: "kake", ...}`) it was always meant to
  teach. Running the full suite after that turned up one more spot with the
  same blind spot: `tests/molecule3d.test.ts`'s own bundled-examples check
  builds its "known id" set straight from `flattenDrawables` (which never
  includes a `pieces` parent, only its children) with no expansion at all —
  fixed by adding `Object.keys(res.pieceGroups)` to that set too, the same
  principle as `planOptionsFor`'s `expandId`.

All three examples pass every check in `tests/examples.test.ts` (validates,
lays out and lints clean, every command id resolves, params/template
checks), the group-id shorthand resolves through `planOptionsFor` exactly as
the live player does, and `tests/molecule3d.test.ts` no longer needs the
spelled-out ids either. Full suite green (`npx vitest run`, 270 files / 5445
tests) and `npx tsc --noEmit` clean after both fixes — counts in the Task 9
report and its fix-round addendum. **Not run: a browser smoke of the three
new examples.** The controller has not yet driven them in a live browser the
way Smoke 1/2 above did for the πr² example; this addendum does not claim
one.
