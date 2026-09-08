# Ledger — anchors and motion round 2 (2026-09-08/09)

Plan: `docs/superpowers/plans/2026-09-08-anchors-and-motion-round-2.md`.
Design (the authority the plan argues from):
`docs/superpowers/specs/2026-09-08-anchors-and-motion-round-2-design.md`,
agreed after Hans's question "what else should drawcast have to explain
visually — more primitives, mathematical objects as templates, other ways
to divide, stack or move?" and the assessment that the biggest gap was the
model still computing coordinates for pivots, destinations and arrow
endpoints. Branch: worktree `template-spike`, base `fc4b823`. Smoke
checklist: `2026-09-08-anchors-and-motion-round-2-smoke.md`.

Nine tasks, each implemented by a fresh subagent and gated by a task review
with a fix loop, then one whole-branch review and one fix wave. Every
review verdict and every ruling is recorded here in short form; the full
per-task record (briefs, reports, review packages) lived in the
git-ignored `.superpowers/sdd/` workspace during the round.

## Pre-flight rulings

- Task 8 (the calculus templates) ran in parallel with Task 1 — disjoint
  file sets, as the motion round ruled for its Task 4.
- `tests/examples.test.ts` was allowed to stay red between Task 8 and
  Task 9 on "every ready template has an example or a fewshot".
- An explicit `move.pivot` now rides with the move's own translation, so
  `by` + `rotate` about `{ref: "wheel"}` rolls instead of swinging about a
  far point. The eight bundled examples that used `pivot` combined it with
  `rotate` only, so nothing shipped changed.

## Per task

- **Task 1 — anchors in the layout** (9e2f10f + baeff04). Review found the
  connector's node-radius backoff was skipped for a TYPO'd anchor name
  (the invalid-anchor fallback returned the plain point but still dropped
  the backoff); fixed by having `resolveEnd` say whether it resolved to a
  named or box anchor. Deferred: sector centroid formula duplicated
  inline; no direct test of the shapeHint rect branch.
- **Task 8 — `riemann_sum`, `tangent_secant`** (a1d36fd + acb410c). The
  brief's YAML had six `element_ids` lines js-yaml rejects; fixed by
  unquoting. Review found `at == x_to` gave a NaN secant slope; fixed by
  clamping `at` below the right edge.
- **Task 2 — `PointRef` in commands** (2c8b672). Clean. Two brief tests
  corrected (offsets vs positions in an arranged row; a pre-existing
  "target not visible" warning). Deferred: `to`/`pivot` resolved inside
  the per-target loop — noted as warning noise, later found to be the
  smoke's bug (see the fix wave).
- **Task 3 — followers ride the pose change** (11a5930 + 5532824). A
  pre-existing test encoded the superseded rule ("labels follow a
  translation but not a rotation") with a fixture that could not tell the
  rules apart; rewritten with a distinct box and hand-derived numbers.
  Ruling: rewriting a test that encoded the superseded rule is correct.
- **Task 4 — `flip`** (3717989 + 12007be). Reviewed on the most capable
  model: the mirror composition, the squash's rotate signs and every
  `setTransform` call site verified by hand. Found: `normalizeSpec` had no
  `flip` line (the advertised bare-string target failed validation) and
  the prompt's verb inventory omitted `flip`. Ruling (plan defect): the
  enumeration list for a new verb gains `normalizeSpec` and the prompt's
  inventory line; carried into Tasks 5 and 7.
- **Task 5 — `morph`** (ac603e3 + f82a7ad + f92302d). The round's biggest
  task. Review (most capable model) found three integration gaps the
  geometry tests could not see: explore-tray/code previews dropped
  `shapes`; the subtitle track planned without `leafPointsOf`, so every
  narrated morph lost its line; the step never settled, so a `reset` left
  the K-point resample on screen. Ruling: the settle is in the spirit of
  "scrubbing and step-back are exact". The settle then needed the same
  `signal.aborted` guard as `animate` (a scrub mid-morph was overwritten
  by the abandoned step's boundary) — caught by the re-review, fixed with
  a player-level scrub test that fails without the guard.
- **Task 6 — `trail` on `move`** (9f7a4dc + 49b4c3f). The cycloid math
  and the sampled pose's parity with the player verified by hand. Found:
  `layoutFor`'s cache-hit path returned the raw layout without trails.
  Ruling: every `layoutFor` return goes through `withTrails`; the cache
  keeps the raw layout.
- **Task 7 — `flow`** (308e7df). Clean; export parity, abort cleanup, the
  y-flip and subtitle reachability all checked, the last by execution.
- **Task 9 — examples, prompt, roadmap** (108edb4). Clean. The two
  stacked template texts sat 34 units apart and overlapped under the
  examples gate (heuristic text height 32.5 + the lint's 2-unit pad);
  widened to 40. The cycloid's trail was moved to the spoke's end because
  the gate planned without boxes — undone in the fix wave once the gate
  planned with them.

## Whole-branch review and the live smoke

The final review (most capable model, 18 commits) re-derived the flip
algebra, the squash transform order and the cycloid closed form, and
verified all eight examples plan clean under `render()`'s options and both
templates lint-clean across their animate ranges. It found five Important
items and the controller's live smoke a sixth:

1. `arrange` on a minted trail threw a TypeError (the guard used the
   trail-aware `boxOf`, the body the raw `bboxOf`).
2. The default rotate/scale pivot used the layout box, ignoring a morph
   (design §2.4).
3. `mentionedIds` in the subtitle track lacked `morph.to.ref`.
4. The Speiling example's A/B/C letters stayed on the ghost while the
   narration and the laser claimed the flipped positions.
5. The examples gate planned without `bboxOf`, silently skipping a flip in
   a shipped example.
6. (Smoke.) In the `move` branch the explicit `to`/`pivot` was resolved
   per target AFTER earlier targets' offsets had moved: in the cycloid the
   wheel got its own centre as pivot but the spoke and the dot got the
   wheel's post-move centre, so the trail was a giant arc (y from −121 to
   641) instead of a cycloid. Reproduced with a scratch plan of the
   bundled example; the flow overlay, the flipped triangle and the
   stretched rectangle looked right live, with no console errors.

The fix wave (one implementer, 13cbd27) closed all six plus the fix-
before-merge minors: `PACK_DEFS.mathlogic.description` (the model-facing
line for an un-enabled pack), `flip.line` warnings for an unresolvable or
zero-length line (ruling: a zero-length line has no mirror direction, so
it warns AND skips), a drawn height beside "h" in the triangle example,
the `MoveArgs.pivot` doc, the stale "eight templates" test name, and the
template tests tightened to all lint severities. The gate, now planning
with boxes, also exposed two older examples (the Bayes tree, the water
cycle) whose `focus` named elements drawn in the next beat; fixed.
The scoped re-review of the wave verdicted every item ADDRESSED with the
pivot hoist traced by hand (all three cycloid targets get pivot (160, 260)
and offset (377, 0)) and no new breakage. Two observations left for later:
the "is this pivot explicit" test is now written three times (move, flip,
morph), and the examples gate still omits `bboxesFor`, so geometry after an
`animate` inside one example is checked against pre-animate boxes.

Main had moved 35 commits (space round 3, the connect gate, the player
round, template on demand) while this round ran; the merge was automatic
with no conflicts, and the merged tree passed tsc, the full suite (298
files, 6077 tests) and both builds before the push.

## Deferred (can wait)

From the task reviews and the final triage: the sector centroid formula
duplicated inline in tier2.ts; four inline `{deg: 0, pivot: [0, 0]}`
literals beside `IDENTITY`; `boxOf` unions only the morphable leaves of a
morphed id; `SvgElementHandle.durationMs`/`cumulative` stale after
`setPoints`; a dead `closed: true` on the explicit-`to` ring literal; after
a `to` morph `vertex_k` means "k/24 of the perimeter" (spec-mandated,
wants a comment); `settleParams()` commits without a following
`applyScene` (pre-existing shape of bug, `shapes` now joins it); no
player-level test of the two-half squash tween; no backend test of
`dashes` / `reverse` / an explicit flow colour; `tangent_secant`'s `h`
slider maximum is 20 rather than the domain's span; the `riemann_sum`
`a == b` zero-width bars; the two dedupe tests' same-box fixture; the
triangle example names b and h a beat before their texts are drawn.

## Verification at the end

Full `npx vitest run` green (286 files; 5901 tests after the fix wave),
`npx tsc --noEmit` clean, `npm run build` and `npm run build:engine` (with
its contract check) green. Hans's hand smoke from the checklist remains
the merge condition for the mid-tween seams the node tests cannot reach.
