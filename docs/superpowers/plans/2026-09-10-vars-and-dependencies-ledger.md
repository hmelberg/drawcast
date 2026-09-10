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

## What the round leaves open

See ROADMAP "Vars and dependencies — done 2026-09-10", "Deliberately not
done". Two known limitations worth a sentence: a label attached to a
dependent is re-solved each relayout frame and may change side mid-tween
(as under `animate` today); a flip with dependents drops its turn-over squash
for that step (swapGeometry has no squash).

## Smoke

Hans's checklist: `2026-09-10-vars-and-dependencies-smoke.md` — the round's
acceptance, as before.
