# Ledger: formula morph, term colours, copy and parametric curves (the manim round, part 2)

Plan: `2026-09-10-formula-morph.md`. Design:
`../specs/2026-09-10-formula-morph-design.md`. Branch `manim-part2` in the
worktree `.claude/worktrees/template-spike`, cut from `bec8698` (the plan
commit) on `origin/main` `834ea8d`. Executed as nine dispatched tasks
(implementer + reviewer + fix-round loop per task, controller rulings in
between), 2026-09-10.

## Numbers

| | Files | Tests |
|---|---|---|
| Baseline (`bec8698`) | 341 | 6816 |
| After Task 9 (`fe5602c`, current `HEAD`) | 348 | 7126 |

`npx tsc --noEmit`, `npm run build` and `npm run build:engine` all clean at
`HEAD`.

Prompt-size budget (`tests/prompt-size.test.ts`): re-pinned three times on
the schema (+296 Task 3, +1,017 Task 5, +672 Task 7) and four times on the
system prompt (+296, +1,026, +672, +822 Task 8), ending at 108,068 schema
chars / 221,961 system chars.

## Rulings made during execution

1. **`planOptionsFor` gains both `mathOf` and `isElement`, in Task 5** (pre-flight
   scan). Task 5's brief said it adds `mathOf`; Task 6's said `planOptionsFor`
   gains both. Ruled: Task 5 adds both — `isElement` belongs beside `mathOf`
   even though the planner's own tests use inline opts — and Task 6 only
   verifies they are there. Cost if wrong would have been a one-line
   duplicate edit; no cost paid.
2. **The `copy` verb's own-warning wording, ruled before Task 5 ran** (pre-flight
   scan). The copy branch checks `known.has(id)`, `opts.isElement?.(id) !== false`
   and `!mintedBoxes.has(id)` itself and warns `copy target "<id>" is not an
   element — skipped`, before `resolveIds` runs (whose generic unknown-id
   wording differs and would not match the pinned test text).
3. **Task 3's centroid tolerance loosened from `toBeCloseTo(x, 0)` (< 0.5) to
   an explicit `< 1` unit check**, accepted after the implementer traced the
   cause: `morphPair` resamples both sides to `max(len(A), len(B), 24)`
   points before lerping, so a 21-point glyph's `t = 1` shape is a 24-point
   resample of itself, not its own raw points — a real, deterministic
   consequence of reusing `morphPair` as specified, not a placement bug
   (confirmed against four other matched shapes in the same test landing
   within tighter tolerances). Documented in the test.
4. **Task 3's prompt-size re-pin happened in Task 3, not Task 8** — accepted
   as a real, necessary re-pin (the `colors` schema property grew the
   already-nearly-exhausted rolling budget by 296 chars), with the growth
   noted in the file so Task 8's own re-pin would not double-count it.
5. **Task 3's schema-budget guard was a false ratchet, caught by review and
   fixed in the same task's fix round.** The re-pin had reset
   `BASELINE_SCHEMA_CHARS` to the post-change measured size while the
   assertion still added `+ 5,500` on top — a fresh 5,500-char rolling
   allowance on every future re-pin, unlike the system-prompt test's exact
   ceiling. Fixed: the schema test now asserts an exact ceiling with zero
   slack, matching the system-prompt test's shape; the dated comment says
   a later round re-pins both constants together, to their own freshly
   measured size, not that the schema gets rolling headroom.
6. **A copy of a copy must be copyable, ruled after Task 5's implementer
   flagged the gap.** The derivation idiom (copy a line, move it, morph it,
   then copy the *morphed copy* for the next line) needs the copy branch to
   treat `copies[id] !== undefined` as a valid element, not just entries in
   `known`. Confirmed as a real gap by review and fixed in Task 5's fix
   round (commit `48d73ee`, "a copy of a copy is copyable").
7. **Task 8's ICER example dropped the `\text{ICER} =` prefix from the TeX**
   so the single-letter colour keys (`C`, `E`) would not colour the
   acronym's own letters. Accepted by the controller, then reversed by
   Task 8's review (Important: keep `\text{ICER}`, verify no colour bleed
   instead of dropping the prefix) and fixed in the fix round (`fe5602c`).
8. **Task 8's circle domain was ~4.7% wider than tall** in the suggested
   `x`/`y` range. Accepted by the controller, then tightened by review
   (tweak to `x: [-2.1, 2.1]`) and fixed in the fix round, landing within 1%.

## Review findings and fixes, by task

Every task ran implementer → reviewer → (if findings) one fix round →
scoped re-review. Important findings and how they were closed:

- **Task 2**: `keyOf` omitted `normalizeTex`, so whitespace-different latex
  keys would not match. Fixed in fix round 1 (`195670b`); scoped re-review
  clean.
- **Task 3**: the schema-budget ratchet, per ruling 5 above. Fixed in fix
  round 1 (`ddbbfff`); scoped re-review clean.
- **Task 5**: copy-of-a-copy refused, per ruling 6 above. Fixed in fix
  round 1 (`48d73ee`); scoped re-review clean.
- **Task 8**: the ICER prefix and the circle domain, per rulings 7–8 above.
  Fixed in fix round 1 (`fe5602c`); scoped re-review clean. The review also
  left a gate-rigor note for the final review: a `colors` key that matches
  the wrong glyph produces no warning (`colorFor`'s design — it colours
  whatever chain segment matches, silently, by design) — carried into "What
  the round leaves open" below.

Tasks 1, 4, 6, 7 reviewed clean on the first pass. Minor findings across
every task were deferred rather than fixed (they do not change behaviour):
a redundant slice assertion and a two-line duplication in `engines.ts`
(Task 1); a `Set`-from-pairs duplicated between `matchTokens` and
`matchShapes` (Task 2); `matchedColorKey` duplicating `colorFor`'s logic, an
untested mismatched-holes branch, no ink-less from/to test (Task 3); an
unguarded copies-override name collision at the tier-2 layer (owned by
Task 5's planner-level guard instead) and a copy id landing at the end of
`layout.order` rather than beside its source (Task 4); auto copy names not
collision-checked against `known`, `showGhosts` running before the tex-mode
validity check, the `as`-name regex being broader than the brief strictly
asked for (Task 5); an imprecise comment in the copy case (Task 6); a
`sampleParametric` docstring silent on `q`/`Q`/`T` shadowing, a failed
parametric curve staying flagged parametric, two validation messages for
one mistake, no `t_from === t_to` guard (Task 7).

## Whole-branch review

Pending — filled in after the final review.

## What the round leaves open

See ROADMAP "Formula morph, term colours, copy and parametric curves —
done 2026-09-10", "Deliberately not done" (design §6). One item flagged
during Task 8's review for the final review to weigh, not fixed in this
round: a `colors` key whose TeX snippet matches the wrong ancestor in a
shape's ancestor chain colours that shape silently — `colorFor` has no way
to tell "matched something" from "matched the thing the author meant", so
a typo'd colour key that happens to collide with another glyph produces no
warning.

## Smoke

Hans's checklist: `2026-09-10-formula-morph-smoke.md`.
