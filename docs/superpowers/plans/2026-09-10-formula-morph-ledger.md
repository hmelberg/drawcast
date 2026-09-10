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
| After Task 9 (`fe5602c`) | 348 | 7126 |
| After the final fix wave (current `HEAD`) | 348 | 7134 |

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

A read across the whole branch (all nine tasks together) after Task 9,
findings fixed in one dispatch, one commit per logical group, 2026-09-10.

Important:

1. **`erase`/`hide`/`clear` on a copy was undone at the next commit — the
   copy reappeared.** `player.ts`'s `planTimeIds` was built only from the
   plan-time (mounted) elements, which never includes a `copy`-minted id, so
   every copy fell through the "minted by a param change" escape hatch and
   was unconditionally `finish()`ed on every later scrub. Fixed: seeded
   `planTimeIds` with every id in every `state.copies` too.
2. **A copy did not appear where the source now stands, once the source had
   already moved.** `plan.ts`'s copy branch recorded `copies[as] = id` but
   never seeded `offsets[as]`/`turns[as]`/`shapes[as]` from the source's
   CURRENT pose, so the clone was laid out at the source's declared place
   instead — contradicting the schema's own promise. Fixed: seed the
   clone's offset/turn/shape from the source's current pose at copy time.
3. **An auto-named copy whose default name (`<id>_copy`) was already taken
   silently replaced the existing element.** The `as === undefined` path
   computed `${id}_copy` from a counter alone, skipping the `known.has(as)`
   guard the explicit-`as` path applies. Fixed: the auto-name loop now
   checks `known` and counts past any taken name; `tier2.ts`'s `withCopies`
   gained the same guard for a layout-level caller (a `copies` key naming an
   existing element id is refused with a warning, not silently spliced in).

Minor (fixed):

4. A warned-and-skipped `morph.tex` (a non-math target with `ghost: true`)
   still minted a permanent ghost — `showGhosts` ran before the tex-mode
   validity check. Fixed: in tex mode, ghosts are minted only for targets
   that actually resolve to math TeX.
5. The ICER example's `colors` used bare `C`/`E`, so only the letters were
   coloured — after the morph, `\Delta C` showed a black Δ with a red C.
   Investigated a full-subterm fix (`C_1`, `C_0`, `\Delta C`, `E_1`, `E_0`,
   `\Delta E`); it fails two real, pre-existing gates that check disjoint
   tex strings (`tests/molecule3d.test.ts` checks the base declared spec —
   before any morph, no `\Delta` term exists yet; `tests/examples.test.ts`
   checks the post-morph override — no `C_1`/`E_1` term exists any more), so
   no superset of `{C, E}` can satisfy both without a colour-override channel
   the layer does not have. Per the deferred ruling below, left as `{C, E}`
   — this specific complaint (the black Δ) is NOT resolved by this round;
   carried forward as deferred ruling (b).
6. Two parametric-curve rough edges in `tier2.ts`: (a) a failed
   `x_expr`/`y_expr` warned twice in effect — the Pass 2 catch's straight-line
   fallback left the id registered in `ctx.parametric`, so a later
   `point.at.on` wrongly warned "is parametric" and skipped a curve that was,
   in fact, an ordinary polyline; fixed by deleting the id from
   `ctx.parametric` in the catch. (b) `t_from === t_to` silently produced 61
   identical samples; fixed with a warning naming the curve.
7. `docs/superpowers/plans/2026-09-10-formula-morph.md` contained two literal
   NUL bytes (a `\0` key separator in a code comment, written raw instead of
   as the two characters `\`+`0`), making the file binary for git and grep.
   Fixed with `perl -pi -e 's/\x00/\\0/g'`; `file` now reports it as UTF-8
   text and `git diff --stat` shows line counts instead of `Bin`.
8. Two test names promised more than they proved: `math-morph-layout.test.ts`
   "an unpaired counter appears only from t ≥ 0.5" actually exercises an
   UNMATCHED shape that fades in continuously (opacity == t), not one that
   appears only past the midpoint — renamed. `formula-overrides.test.ts`
   "…and can carry its own pose" asserted nothing about position (`poses` is
   a renderer-only override the layout's own `namedAnchors` never reflects)
   — renamed to what it actually proves and the unused pose override dropped
   from the test.
9. Copying a `pieces` parent minted an un-expandable clone parent into
   `order` (it draws nothing of its own). Fixed: the copy branch refuses a
   target `opts.expandId?.(id)` expands, with a warning to copy the pieces
   instead.

Every item above has a regression test (`tests/formula-plan.test.ts`,
`tests/formula-player.test.ts`, `tests/formula-overrides.test.ts`,
`tests/parametric-curve.test.ts`) except 5 (an example content change,
already covered by the existing example/prompt gates) and 7-8 (a doc fix and
test renames).

## Deferred with rulings

- **(a)** An `equation_steps` `colors` key that matches nothing is silent —
  the template layout has no warnings channel to report through. A later
  round can add one.
- **(b)** A colour key for a term that leaves in a morph warns "matches
  nothing" at the OTHER boundary — a known limitation of checking unused
  keys against a single static TeX, with no notion of "this key targets the
  other side of a morph." This is exactly what blocked the ICER's full
  subterm colouring (finding 5 above): `colorFor` reads one element-level
  `colors` dict against whichever tex is currently laid out, so a key aimed
  at the post-morph formula is always "unused" pre-morph and vice versa.
  Fixing this for real needs either a per-morph-side colours channel or the
  unused-key check to know about a morph's `to` tex too — both out of scope
  here.
- **(c)** Style duplications, left as observed by review and not touched:
  `matchedColorKey` re-implements `colorFor`'s logic instead of calling it;
  `pf`/`pt` sets built the same way in two places; the path/rect two-line
  pattern repeated rather than factored; a redundant `slice(0, 5)`.
- **(d)** The examples gate's morph-boundary test
  (`tests/examples.test.ts`, "every morph.tex boundary lays out cleanly")
  re-implements the planner's copy naming and tex accumulation by hand
  instead of reading `plan.states` off a real `planCommands` run. It works,
  but two naming/accumulation rules now live in two places. A stronger gate
  for a later round would drive the check off `plan.states` directly.

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
