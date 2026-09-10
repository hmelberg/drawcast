# Ledger: vars and dependencies (the manim round, part 1)

Plan: `2026-09-10-vars-and-dependencies.md`. Design:
`../specs/2026-09-10-vars-and-dependencies-design.md`. Branch
`manim-round` in the worktree `.claude/worktrees/template-spike`, cut from
`origin/main` at `2059d06` (Hans's three commits of 2026-09-10 on top of the
merged freehand round). Executed inline by Claude in one session,
2026-09-10, while Hans was away; every ruling below was Claude's.

## Numbers

| | Files | Tests | Time |
|---|---|---|---|
| Baseline (`2059d06`) | 332 | 6473 | 31.6 s |
| After Task 8 | 341 | 6808 | 31.7 s |
| After the review fix wave | 341 | 6812 | 31 s |

`npx tsc --noEmit`, `npm run build` and `npm run build:engine` clean after
Task 7 and after Task 8.

## Rulings made during execution

1. **`t` is not reserved.** The design reserved the six curve variables
   (`x X q Q t T`); the very first example (`vars: {f: 1, t: 2}`) tripped on
   it. `t` is the name a sweep parameter naturally takes, so only `x`/`X`
   (and the evaluator's functions and constants) are reserved; a var named
   `t` or `q` shadows that alias of `x` — `sampleExpression` spreads the vars
   after the aliases. Design §2.1 amended in place.
2. **The prompt-size budget was re-pinned twice**, not dodged: the four
   schema descriptions were cut to one sentence each first (schema stays
   under the freehand round's ceiling; system prompt +1,521), then the three
   prompt sentences (+1,197). Both notes sit beside the constants in
   `tests/prompt-size.test.ts`.
3. **Seed-time overrides apply only to ids no element declares.** The first
   cut of the posed lookup view mapped every overridden id before Pass 3,
   which posed a tier-2 curve's own samples before its ink was built (the
   curve moved with its pose — twice). Now template ids are registered at
   seed time and a tier-2 element right after it is emitted, so its own ink
   comes from raw samples and only what follows reads the posed ones
   (`tests/dependencies-layout.test.ts`, "the curve's own ink does not move").
4. **`Plan.sources` is optional** so the hand-built plans in
   `tests/player-raf.test.ts` need no empty list; the player reads
   `plan.sources ?? []`.
5. **On a template spec an unknown dot path still animates and jumps**, as
   before; the "neither a template param nor a var" warning is for a
   freehand spec with vars. The old "animate requires a scene template"
   message became "animate needs a template param or a var (skipped)" (two
   assertions in `tests/plan.test.ts` updated).
6. **A ghost on a spec with vars carries its boundary params** (`ghostParams`
   returns `{...params}` whenever `varsBase` is set), so a `keep` followed by
   a var-animate stays frozen — the same reason a template ghost carries
   params.
7. **`cutTrail` never duplicates a vertex** it lands exactly on (fraction 0.5
   of a two-segment trail returns two points, not three).
8. **Test fixtures corrected, not the code**, in three places where the
   first assertion encoded a wrong assumption: an arrow stands off its anchor
   by the connector gap (≈ 14 units), so its tail is *near* a moved
   intersection; two arms on one ray make a 360° angle, not a warning; a
   motionless trail has no arc length to advance along, so the player test
   traces a moving anchor.
9. **Measures stay on their round-3 path** (`MeasureFollow`) and are not
   relayout triggers; under a relayout step the player drops this step's own
   stale measure overrides from the frame so the layout's recompute shows
   mid-tween, and the boundary state restores them (they agree).

## Whole-branch review (one reviewer subagent, read-only, four executable probes)

Eight findings, all fixed in the final fix wave (`tests/relayout-plan.test.ts`,
`tests/vars-layout.test.ts`, `tests/examples.test.ts` carry the proofs):

1. **CONFIRMED — a dependent moved together with its source landed at
   double the displacement** (`move: {target: ["d", "eq"]}`: its own offset
   plus the recompute from the posed curve; probe: +162 for +81). Fix: a
   verb's targets that are DEFINED by another target leave the moving set
   with a warning and the step becomes a relayout (`withoutDependents`
   in plan.ts) — they follow by recompute, never by offset.
2. **CONFIRMED — a group (or pieces cut) as a source never followed**: the
   planner moves a group through its members, so `dependentsOf(member)`
   was empty and the group id never carried a pose. Fix: `planOptionsFor`
   attaches a source's dependents to every member and adds the members to
   the sources; tier2's group branch (and a new pieces-parent branch) then
   computes the posed anchor from the view.
3. **CONFIRMED — every not-yet-visible minted id was painted during animate
   frames** (`withNewIdsVisible` measured against the raw plan-time layout,
   so a later step's ghost or trail counted as "new"; pre-existing for
   templates, now reachable freehand). Fix: measured against the mounted
   layout, which already carries every minted id.
4. **CONFIRMED — a point or region listed before its curve read raw samples**
   (posed samples were registered when the curve was emitted). Fix: posed
   samples for every overridden curve computed once after Pass 2 into
   `posedCurveSamples`, read through `samplesOf`; `curveSamples` stays raw
   for the curve's own ink.
5. **PLAUSIBLE — ghosts ignored the boundary's poses** (and a tier-2 ghost
   with `params: null` read the wrapped layout, which under a relayout is a
   later frame). Fix: `GhostSpec.overrides`, read through `layoutAt(params,
   overrides)`; a spec with sources gets `params: {}` instead of null.
6. **PLAUSIBLE — the relayout tween painted at plan params while the commit
   used the viewer's `{answer}` overrides.** Fix: `withVarOverrides` on the
   frame's params in both the relayout tween and the animate tween.
7. **PLAUSIBLE — a measure of a co-moved non-source lagged for the tween**
   (the frame dropped this step's measure extras expecting the layout to
   recompute them, but the layout only poses sources). Fix: the extras ride
   the frame exactly as on the handle path — dimension line as a shape,
   label slide as a pose.
8. **PLAUSIBLE — an edge to a scaled node backed off by the unscaled
   radius.** Fix: the stand-off is multiplied by the source's pose scale.
9. Coverage: the examples gate now asserts the post-move / post-sweep
   layout's warnings and errors are empty (it used to discard them); the
   noise expression in `tests/vars-layout.test.ts` is gone; text and node
   unknown tokens are asserted alongside the label's.

Checked and fine by the reviewer: planner/player override keys agree
(`turn: undefined` serialises identically, empty and undefined both key
to ""); scrub recommits on key change and an aborted relayout tween leaves
`geometryDirty`; trail progress flows through `withMinted`'s `cutTrail`;
`evalBindings` clones each container on the path; `sy`/`iy` are true
inverses.

## What the round leaves open

See ROADMAP "Vars and dependencies — done 2026-09-10", "Deliberately not
done". Two known limitations worth a sentence: a label attached to a
dependent is re-solved each relayout frame and may change side mid-tween
(as under `animate` today); a flip with dependents drops its turn-over squash
for that step (swapGeometry has no squash).

## Smoke

Hans's checklist: `2026-09-10-vars-and-dependencies-smoke.md` — the round's
acceptance, as before.
