# Ledger — ghosts, angle, measure, more cuts (round 3, 2026-09-09)

Plan: `docs/superpowers/plans/2026-09-09-ghost-angle-measure.md`.
Design (the authority the plan argues from):
`docs/superpowers/specs/2026-09-09-ghost-angle-measure-design.md`,
agreed after Hans's request that a figure could stay on screen, faded,
while its pieces animate away ("propose only"), and his "gjør som
anbefalt" on the round-3 list that grew from it: ghosts, an `angle`
element, a `measure` whose value follows the figure, three more `pieces`
cuts (rings, triangles, halving), `ellipse` and `line`, and the two
leftovers from round 2. Branch: worktree `template-spike`, base `e29ac31`
(round 2 as pushed). Smoke checklist:
`2026-09-09-ghost-angle-measure-smoke.md`.

Nine tasks, each implemented by a fresh subagent and gated by a task review
with a fix loop, then one whole-branch review and one fix wave. Every
review verdict and every ruling is recorded here in short form; the full
per-task record (briefs, reports, review packages) lived in the
git-ignored `.superpowers/sdd/` workspace during the round.

## Pre-flight rulings

- Tasks ran strictly in order 1 → 9: every pair after Task 1 shares
  `types.ts`/`schema.ts` or `plan.ts`. Cost: wall-clock only.
- The tests' numbers were re-derived while writing the plan (ghost offsets
  and order, angle sweeps and the right-angle square, the measure values
  10000/40000/200 and the re-pointed line, ring radii and strip lengths,
  the triangle apothem and zipper apex heights, the halving boxes, ellipse
  foci, line clipping).

## Per task

- **Task 1 — `ghost` / `keep`** (51cfc00 + a00e7e5). Review on the most
  capable model found a plan defect: `params: {}` conflated "tier-2 spec"
  with "template spec at its base params", so a ghost on a template's first
  `animate` re-derived from every tween frame instead of freezing.
  Ruling: `GhostSpec.params` is `Record<string, number> | null` — null
  means read the wrapped layout, an object means a template's boundary
  params, `{}` the base. Also fixed: ghosts minted before the flip/morph
  validity guards; a ghost of a minted element (refused now); the pieces
  clause (a pieces target yields per-piece ghosts). Deferred: a
  prefix-match insertion index in `withMinted`; the stale "cached layout"
  comment; `keep` of a hidden element is silent.
- **Task 2 — `angle`** (1fecee2 + ab19462). Widening `from`/`to`/`at` to
  point refs broke a pre-existing arrow test and let `{ref, anchor}` reach a
  `point` element where it was swallowed silently; fixed with a structural
  check (`badEnd`) and a `point.at` guard. `ANCHOR_NAMES` gained the
  angle's `vertex`/`arc` — ruling: every element that adds anchors adds
  them to that inventory. A coincident arm warns and skips.
- **Task 3 — `measure` layout** (4614a08 + 82dd15c). Review found that
  `of` a `shape` rect or circle was unmeasurable. Ruling: shapes are
  measured exactly — a rect by its corners, a circle by `{c, r}` carried
  in the ring source and in `MeasureSpec` (π r², 2 π r, 2 r); `label:
  false` hides the text. A point or a circular node became measurable as a
  consequence.
- **Task 4 — the measure follows** (caf6304 + 3d28e8b). Implemented on the
  most capable model; chose the allowed alternative of carrying
  `extraMorphs`/`extraTransforms`/`texts` on the plain `move` step. Review
  (most capable model) found that a not-yet-drawn measure popped into view
  when its figure moved, because a rebuilt leaf hard-coded `setProgress(1)`
  — a latent round-2 bug for morphing a hidden element too. Fixed with
  `lastProgress` on the handle and a shared `leafProgressAt`, plus a
  player-level test that fails with the old code; followers now count as
  changed for every verb. Disclosed and accepted: `animate` does not
  reconcile measures with a re-laid-out template; a rotated rect shape
  measures its axis box; the dimension line's side is fixed at layout.
- **Task 5 — `pieces` of `rings`, `arrange: unroll`** (d257dbc). Clean;
  keyhole winding, the morph to a rectangle, the inverse pose and the
  pieces-parent expansion all traced. Deferred: no tests for n = 1 or an
  omitted `at`; `othersRow` uses R as its clearance.
- **Task 6 — `pieces` of `triangles` and `halving`** (917859a + d0a4863).
  Review found by probing that the regular-polygon fan did not clamp
  `from: "vertex_7"` and threw out of `layoutSpec`; fixed with one
  `fanVertexIndex` helper for both branches that warns and falls back to
  vertex_1. Deferred: the n-gon vertex formula duplicated with
  `polygonDrawables`.
- **Task 7 — `ellipse` and `line`** (0a98e5d + 5c1452f). Clean; foci,
  the tall ellipse under rotation, axis-aligned clipping and the domain
  slope through separate x/y scales all hand-checked. Ruling: the ring
  starts at the +x end of the x-radius (the major axis only when rx ≥ ry)
  — behaviour kept, the comment corrected.
- **Task 8 — leftovers** (2abe5ef). One `isExplicitPointRef` for move,
  flip and morph; the examples gate plans with `bboxesFor` built through
  `withOverrides` as `render()` does. Passing boxes exposed no shipped
  example.
- **Task 9 — prompt, examples, roadmap** (5c07c82 + the fix below). The
  gates forced four example edits; two of them were dodges around engine
  defects the prompt itself invites (`label: "b = {value}"`): a measure's
  label sat a fixed 16 units from its dimension line, so any wide label on
  a vertical or oblique line crossed it at every offset; and an area or
  perimeter measure painted nothing under its own id, so `draw: ["areal"]`
  was a no-op for the planner and an unknown id for the molecule3d gate.
  Rulings: the clearance is 16 + |nx| · w/2 with the label's heuristic
  width (horizontal measures unchanged); a line-less measure registers its
  text as its own piece group. Both fixed in one round (11a9b36) with
  tests that fail on the old engine; no earlier assertion moved, because
  every measure asserted so far was horizontal — which is why the defect
  survived Tasks 3 and 4. A third ruling on the ring example (a8af296):
  its height measure ran inside the ring nest at the offset that cleared
  the label, and the brief's endpoints read 113 for a radius of 100; the
  nest moved to x = 250, the unroll stack to x = 670, and the radius is
  measured from the centre, so the line stands outside the rings and the
  label reads "r = 100". The review of that commit then caught the
  controller's own mistake: an endpoint on the pieces PARENT follows the
  union of its scattered pieces, so after the unroll the radius read 50.
  The measure belongs to the kept circle, so its endpoints are fixed
  coordinates now, and it stays at 100 through every state while the
  strip's width updates to 589 — the strict "follow" rule was right, the
  endpoint choice was wrong. `pieceGroups`' doc names the measure case.

## Whole-branch review

The final review (most capable model, 20 commits, tsc clean, 6179 tests
green) found one Critical, three Important and eight Minor items. The
Critical is the round's fifth "test that could not fail": `ghost: true`
on `move`, `arrange`, `flip` and `morph` was NEVER painted. `mintGhosts`
marked the ghost visible in the plan state but pushed no step, so no
handle was ever finished; `keep` pushes a `show` and worked, and `animate`
escaped by accident through the reprojector's `revealNew`. All four ghost
tests stopped at the plan level and passed with the bug present; the
reviewer proved it with a mini-DOM probe reading the ghost leaf's dash
offset (100, hidden) after `Player.play()` ran to completion, on all four
verbs and on a shipped example. The controller's live smoke had looked only
at the two examples that use `keep`, which is why it saw ghosts.

Important: a measure anchored to a pieces PARENT went stale after
`arrange`/`move` because `measuresDependingOn` matched ids exactly while
the verbs passed children — the same trap the ring example hit, now fixed
in the engine (a parent-anchored measure follows the union box; `of:
<parent>` keeps warning at layout); the prompt never said a measure's
number is the separate element `label_<id>`; `resolveIds` did not dedupe,
so the doubled-side example sketched its area label twice.

Rulings for the fix wave (708859a): the four verbs' ghost path pushes the
same `show` step as `keep`, before the motion step — narration-free, so
the beat's line is spoken once, which means a ghosted motion without a
line of its own now waits at the narration barrier exactly as `keep`
does — with a mini-DOM regression test through the real backend and
Player; the parent match in `measuresDependingOn`; one prompt clause; the
dedupe; a line-less measure's id leaves `layout.order` (no phantom final
draw), which in turn made `measureUpdates` accept the text id as the
known id; `zipper`/`fan` on ring pieces warns and skips like `unroll` on
non-rings, with the ghost minted only after the guards. The scoped
re-review verdicted every item addressed with no new breakage. Deferred: `unroll`
inks a strip's outline twice (outer and inner ring strokes morph to the
same rectangle); an ellipse's area is read off the 48-gon (−0.3 %); a
ghost of a labelled element ghosts the shape but not its label, and a
measure of a ghost warns — both undocumented; a weak test title; the
already-disclosed measure limitations.

## The live smoke

Run by the controller on the dev server while the final review ran, with
the browser tools kept light (three examples, one zoomed frame each, a DOM
probe for opacity, the console):

- **Sirkelen som ringer** — the ghost nest stays behind, faded (31 paths
  at 0.35 / 0.105 opacity), `r = 100` stands outside the rings, the eight
  strips unroll into the staircase with 589 on the longest. Found: the
  strip-width measure's line landed inside the stack after the unroll (it
  sits below the top strip's bottom edge at the default offset). A pieces
  parent cannot be measured ("has nothing to measure"), so the example
  keeps `of: ringer_8` with an offset that clears the whole stack after
  the unroll and the nest before it (cd911e0).
- **Ellipsen: to brennpunkter** — the two distances end at 540 and "60.0":
  the defaulted format gave one decimal under 100 beside none above.
  Ruling: a defaulted number drops a trailing ".0" (60; 12.5 keeps its
  half); an explicit `decimals` is kept as written. The plan's own
  "b = 50.0" assertion became "b = 50" (37970de).
- **Sekskanten som trekanter** — the six triangles fold into the
  parallelogram with `a = 121`, the ghost hexagon behind. The apothem's
  label crosses a neighbouring triangle's edge after the zipper, which no
  lint sees (post-arrange geometry is not linted). Deferred, cosmetic.
- No console errors in any of the three.
- **Dobbel side, firedobbelt areal** (after the fix wave) — the ghost of
  the original square is now painted at the origin corner (three faded
  paths, dash offset 0) while the scaled square reads `s = 400` and
  `A = 160000`; before the fix this example's ghost had never been seen.

Hans's hand smoke from the checklist remains the merge condition for the
mid-tween seams: the measure's number climbing under the scale, the ghost
appearing at the start of a beat rather than its end, the angles' labels
travelling with their arcs.

## Deferred (can wait)

From the task reviews and the final triage: a prefix-match insertion index
in `withMinted` (`tri` vs `tri_angle`); the stale "cached layout" comment;
`keep` of a hidden element is silent; no test of the arrow `[x, y]`
rejection branch; no test of `length` on a circle; tier-2/planner
duplication of the measure end rules; a measure line that is itself a move
target lands twice-translated; `animate` does not reconcile measures with a
re-laid-out template; a rotated rect shape measures its axis box; the
dimension line's side is fixed at layout; the label clearance uses the
heuristic width and compensates only the horizontal component; no tests
for n = 1 rings or an omitted `unroll` `at`; the regular n-gon vertex
formula duplicated between `polygonDrawables` and
`trianglePiecesDrawables`; `unroll` inks a strip's outline twice; an
ellipse's area is sampled from the 48-gon; the apothem label crossing a
neighbour after the zipper (post-arrange geometry is not linted); a ghost
of a labelled element ghosts the shape but not its label; a measure of a
ghost warns; `durationMs`/`cumulative` stale after `rebuildLeaf`.

## Verification at the end

After the fix wave: full `npx vitest run` green (306 files, 6191 tests),
`npx tsc --noEmit` clean, `npm run build` and `npm run build:engine` (with
its contract check) green.
