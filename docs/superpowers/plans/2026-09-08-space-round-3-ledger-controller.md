# SDD ledger — plan: docs/superpowers/plans/2026-09-08-space-round-3-connect.md

Branch: `space`. Base at start: 123b054 (spec + plan committed).
Spec: docs/superpowers/specs/2026-09-06-space-design.md §6.2, §6.3, §6.4.

## Pre-flight scan

Every pair of tasks that shares a file or an interface, and every task against
its own text.

| # | shares | produces → consumes | finding |
|---|---|---|---|
| 1 ↔ 2 | — | T1 `ConnectStar`/`ConnectEdge` from `render/widgets.ts` → T2 imports them into `ui/connect-model.ts` | agree; T2's `snapStar(p, stars, radius)` takes T1's `ConnectStar` exactly |
| 1 ↔ 4 | — | T1 `connectKey(leaves, boxes, conId)` → T4 calls it from lint | agree after the patch that gave T4 its own leaf-box recipe; both use LEAF boxes, and a ball leaf's id is its element id |
| 1 ↔ 6 | — | T1 `connectKey` → T6 calls it with `elementBBoxes` (top-level) not leaf boxes | **divergence, ruled below** |
| 2 ↔ 6 | — | T2's whole surface → T6 | agree |
| 2 ↔ 4 | — | T2 `CONNECT_MAX_EDGES` → T4 | agree |
| 3 ↔ 5 | `widget` union | T3 schema enum → T5 plan.ts union + controls.ts union | three copies of one list (schema enum, plan.ts:40, controls.ts:186); T5 owns two of them, T3 the first. Ordered T3 before T5, so no conflict |
| 3 ↔ 6 | `controls.ts` | T3 none; T5 widens the union, T6 adds the dispatch arm | sequential, same file, no overlap in lines |
| 5 ↔ 6 | `controls.ts` | union (T5) vs dispatch (T6) | sequential |
| 7 ↔ 8 | `space.yaml` | T7 adds `interactions:` to both manifests; T8 edits `sky_map`'s description | different keys, sequential |
| 4 ↔ 8 | — | T4's lint rule → T8's examples must pass it | ordered correctly: the guard runs after the rule exists |
| 1 | self | test fixtures vs implementation | agree after the `pts` patch |
| 2 | self | `edgeAt` test pins clamped projection; implementation says so | agree |
| 3 | self | schema test asserts `answer` required; :896 already requires it for any non-drag widget | agree — the test pins existing behaviour, which is fine, but the implementer must VERIFY :896 covers connect rather than assuming |
| 4 | self | four conditions, four messages, one issue per command | agree |
| 5 | self | `makeVisible` + `answerBox` only | agree |
| 6 | self | tests cover only what jsdom can honestly see | agree; noted as a known gap, covered by the smoke checklist |
| 7 | self | `activitiesFor` restructure vs its own tests | agree |
| 8 | self | examples must lint clean under T4's new rule | agree |

**Ruling 1 (pre-flight).** T1 is called with two different box maps: lint builds
a LEAF map (T4), the gate passes `elementBBoxes` (T6), which keys top-level
elements and includes group union boxes. For the stars this is the same map —
a `kit.ball` star is its own top-level element and its own leaf. The one
difference is the group box for `con_ori` itself, which `connectKey` already
skips by id, and `label_…` boxes, which it also skips. So the two callers agree
on every id that can win a vertex. Cost if wrong: a vertex snaps to something
that is not a star, which the `unmatched`/edge-count assertions in T1's real-Orion
test would catch immediately. No change to the plan.

**Ruling 2 (pre-flight).** The plan asserts Orion is 24 edges over 23 stars, and
T1 Step 5 turns that into a test against the real chart. That number came from
the pinned data (`sky/constellations.json`, SHA-pinned), not from the drawing.
If the derivation yields a different number the implementer must STOP rather
than adjust the expectation — the plan says so. Cost if wrong: an implementer
edits the number to make the test pass and the key silently disagrees with the
figure. This is the one place in the round where that failure is possible, so
the task reviewer is told to check it explicitly.

## Progress

(nothing yet)

**Ruling 3 (before Task 2).** The plan's Task 6 called for a jsdom test that
mounts the gate. There is no jsdom in this repo: `vitest.config.ts` sets
`environment: "node"` and no test file opts out. Rather than add a DOM
environment for one file, the gate's one testable DECISION — whether to open at
all — moves into `connect-model.ts` as `connectOpens`, where a node test pins
it, and Task 6's test becomes a source-drift test in the exact style of
`tests/gates.test.ts` (read the file as text; assert what would fail silently).
Plan amended in both tasks before either was dispatched. Cost if wrong: the
gate's pointer behaviour is still unverified by machine — which was already
true of every gate in this repo, and is why the smoke checklist is a merge
condition. This is the round-2 lesson applied on purpose, not by accident.

**Ruling 4 (before Task 8).** The examples guard is `tests/examples.test.ts`;
Task 8's brief says "find it". Named here so the implementer does not hunt.

**Ruling 5 (Hans, not mine — recorded because it changed three tasks).** Hans
overruled `STRAY_ALLOWANCE = 1` mid-round, before Task 2 was dispatched.
Grading is now an exact set comparison, and the fairness the allowance was
meant to buy comes from the framing instead: a connect question must follow a
beat that drew the figure. His argument, which is better than the one it
replaced: the interface already forgives an accident (click a segment to remove
it; nothing is judged until Done), so an allowance only makes the app say
"right" about a drawing it then paints red — and the allowance sat on the wrong
side, since demanding all 24 edges of ONE publisher's convention is the
doubtful half while an extra line usually means the viewer knows a richer
version. Spec §6.3 rewritten, plan Global Constraints + Tasks 2, 3, 4, 6 and 8
amended, all before any of them ran. Commit 40760fd.

**Ruling 6 (tooling).** The skill's `task-brief` script truncated a code line at
an embedded quoted space: `seen.set(e[0] + " " + e[1], e)` reached Task 1's
implementer as `seen.set(e[0] + "`. They noticed, implemented from the
interface instead, and said so — but the next implementer might not. Briefs are
now cut by `scratchpad/mkbrief.py`, a verbatim slice between `### Task N:`
headings with a fence-balance check, and every dispatch tells the implementer
that the interface and the tests are authoritative if a sample looks broken.

## Progress

Task 1: complete — commit 8af3751. `connectKey` in `src/render/widgets.ts`,
5 tests in `tests/connect-key.test.ts`. The real-Orion test lays out a genuine
`sky_map` spec and gets exactly 24 edges over 23 stars, matching the pinned
data — the number Ruling 2 said must not be adjusted to fit. Full suite 5572
green, tsc clean. Review dispatched.

Task 1 fix round 1: commit 0a9c9ef. eps 2 → 0.25 with the reason written into
the doc comment; tie-break `<=` → `<`, documented. Sweep over twelve figures at
the tight tolerance: every one `unmatched === 0` with a non-empty edge list —
Scorpius checked from Sydney, since it never clears Oslo's horizon (the
implementer's own catch, and a good one). 5575 tests green, tsc clean.

Task 1: COMPLETE. Re-review done by the controller rather than dispatched: the
fix diff is 20 source lines whose correctness the sweep already demonstrates,
and an independent reader adds little to "did they change 2 to 0.25". Read it
in full; both changes are as instructed and the boundary shift (a candidate
exactly at eps is now excluded) is a tightening, not a regression.

Task 2: implemented at 5338719 (`src/ui/connect-model.ts`, 15 tests; suite 5590
green). The implementer self-caught a `snapStar` draft that could return a star
beyond the radius and fixed it before committing.

**Ruling 7 (controller fix, 00b3f04).** The module was committed as a BINARY
file: the edge-key separator was written as a literal NUL byte inside a
template string, so `git show --stat` printed `Bin 0 -> 6615 bytes` where the
diff belongs, and the review package carried no reviewable text at all. The
separator itself is a good choice — no element id can contain it — so the fix
is to write it as the escape `\u0000`, identical to the parser, with a comment
saying why it must stay an escape. I made this change myself rather than
spending a round trip: it is a byte, not a design. Verified the committed blob
has no NUL. Cost if wrong: none a test would catch — the 15 tests pass
unchanged either way, which is exactly why nothing but a human reading
`--stat` would have found it.

Task 2 fix round 1: commit ecde7ff. `edgeAt` now matches `snapStar` — strict
`<`, first wins — after the implementer weighed and REJECTED the z-order
argument I had offered them: `drawn` is insertion order, not paint order, so
"the segment on top" is not a thing that list knows. Non-mutation test added.
5591 green, tsc clean.

Task 2: COMPLETE.

Task 3: COMPLETE — commit 1c0acf5, review clean, no fix round. Both clauses
that were argued over survive verbatim in the shipped prompt string
(schema.ts:409): the figure must have been drawn earlier, and the whole figure
is required exactly. The reviewer also established why Task 3's cast is safe
rather than merely small: ajv enforces the enum in structuralErrors BEFORE
semanticErrors runs, so a.widget is already a valid enum value where the cast
sits. Task 5 still deletes it, and now owns all three widget unions
(spec/types.ts, render/plan.ts:40, ui/controls.ts:186) — plan amended.
5595 green.

Task 4: COMPLETE — 32bda0c, then two fix rounds (e40575e, 6c7929d).

  Fix 1 came from a defect I found myself, not from a review: the framing rule
  treated an id no command manages as visible from the start, mirroring
  coVisible because I had told it to. But plan.ts:608-612 draws unmentioned ids
  in ONE implicit step after every command, so such a figure appears AFTER the
  question it was meant to precede. I proved it with a throwaway probe rather
  than by reasoning: lint silent, and the plan steps came back
  [draw(1), ask, draw(37) <= con_ori HERE]. That is the cast a compiling model
  is likeliest to write, and all nine of the task's tests passed either way.

  Fix 2 came from the independent review: right_goto/wrong_goto/if.goto let the
  player skip commands, so a figure drawn textually before the ask can be
  missed by a viewer who takes a branch. The check now flags any jump target
  landing in (revealIdx, askIndex]. The implementer showed that a backward
  re-explain jump cannot false-positive BY CONSTRUCTION — its target is at or
  before revealIdx, outside the window — which the re-review confirmed is plain
  arithmetic, not a carve-out. It also verified the five goto fields are the
  only ones in the schema, and that the rule fires on no bundled example.

  **Ruling 8 (residue accepted).** The re-review returned ADDRESSED WITH
  RESIDUE on two points. One: the "never touched + no matching leaf" test
  recombines conditions already proven separately rather than reaching new
  lines. Two: `erase` is untested in the visibility walk. I accept both and do
  NOT order a third fix round. `erase` and `hide` sit in the same expression in
  the same branch, so the `hide` test added in fix 2 does execute that line; an
  erase test would restate it. Cost if wrong: if someone later splits that
  branch, erase loses its only coverage — which is why this is written down
  rather than left implicit.

Task 5: implemented at 09a3411 — all three widget unions widened together and
BOTH interim casts retired (schema.ts:896, lint.ts:323), restored to plain
comparisons. 5612 green, tsc clean. Review dispatched.
Task 5: COMPLETE — review clean, no fix round. Reveal timing verified against
player.ts states-boundary convention (post-step, so no tracing risk); both
retired casts confirmed behaviourally identical for undefined; zero
`as unknown as string` left in src/. The reviewer noted controls.ts still falls
through connect to the typing gate, which is Task 6.

Task 6: COMPLETE — cab3b4b, then three fix rounds (21a8db7, 15e01d8, 954dc7c).
5646 green, tsc clean. The round's hardest task and the only one no test can
watch working; it took three rounds and two independent readings to settle.

  Review 1 (opus) returned CHANGES REQUESTED with four real defects: the tap
  path was dead (a >4px drift on the same star did nothing, and real finger
  taps drift further), a pointer capture taken only on a star hit could be
  stranded forever, `armed` survived a completed drag so tap/drag/tap silently
  ERASED the line just drawn, and my own source-drift test could not fail —
  the reviewer deleted the restorer and all four assertions still passed. It
  also cleared the thing I feared most: a click at a branching star can never
  delete the wrong segment, because snapStar wins over edgeAt and the
  tolerances nest.

  Fix 1 removed the distance threshold — and with it the branch that completes
  a pair, leaving `armed` write-only. **The re-review caught that the claimed
  fix did not work**, which is why it was dispatched at all: the same claim had
  been made and been wrong once already. It also applied the destructive check
  to the new seams and found two with no teeth (deleting the sort in
  medianNearestNeighbour passed; 0.4 -> 0.04 passed — both fixtures were
  pre-sorted and landed on the clamps).

  Fix 2 rebuilt the state machine to a written specification and swapped the
  window resize listener for a stage ResizeObserver, which also rescued a
  cache that measured zero at mount and stayed empty for the gate's life.
  Check 3 (opus) traced all six sequences and re-ran both mutations itself:
  they now fail as they should.

  **Ruling 9.** The implementer deviated from my specification on one row: a
  press starting and ending on empty space keeps the armed star rather than
  cancelling. I kept THEIR version. A tap that lands on nothing is far more
  often a fumble at a small star than a deliberate cancel, and tapping the
  armed star again already cancels. Consequence, now in the comment: tap A,
  tap empty, tap B draws A-B. Cost if wrong: a viewer who meant to cancel gets
  a line they must click away — recoverable, unlike losing an armed star to a
  three-pixel miss.

  **Ruling 10.** I also upheld the implementer's refusal of an instruction:
  rather than move `touch-action` to the overlay as I asked, they removed the
  JS handling entirely because `.cs-figgate` already sets it for exactly the
  gate's lifetime. The re-review verified the claim in styles.css and called
  the result strictly better scoped than my suggestion.

  Two defects only a person will ever see were fixed on the way: the hint pill
  never bobbed because a more specific rule killed its animation while the
  comment above claimed otherwise, and three CSS hooks were stamped in markup
  with no rule behind them. Writing the drift test flushed out a fourth
  orphaned class from round 1.

Task 7: implemented at b3fbfba (5651 green). Review: spec PASS, quality FAIL —
on coverage, not on code. The reviewer built real `sky_map` and `solar_system`
layouts and confirmed empirically that every named and anonymous star (HIP
fallback), every lifted constellation, every planet, the Sun and the Moon come
back named in en/nb/la — Polaris as "Polarstjernen" in Norwegian — and that
`frame`, `stars` and `figures` correctly do not. The implementation is right.

But **the five new tests never call `sceneNamesFor` at all**: they exercise
`activitiesFor`, `KNOWN_INTERACTIONS` and the manifest declarations, and every
one would pass unchanged if the two new branches returned `[]`. That is the
task's whole point, untested — the third time this round a test could not fail,
after Task 6's restore assertion and Task 6's two toothless fixtures. The repo
already has the pattern to copy (`tests/periodic-interaction.test.ts`), unused
here. Fix round held until Task 8 commits, to keep two implementers from
committing into one worktree at once.

Task 7 fix round 1: commit 5701ef3. Tests now call `sceneNamesFor` against real
layouts. Destructive check: stubbing the space branch failed exactly its 2
tests, stubbing the sky branch exactly its 5, nothing else moved.

Task 8: COMPLETE — a8f998b, review PASS/PASS. The reviewer did the active check
I asked for: moving Orion's draw beat to after the ask makes `.issues` report a
real connect fairness violation, so the rule is proven against real content and
not only against fixtures. Orion 24/23 and Cassiopeia 4/5 verified against the
raw data; examples.json is a clean 28-line insertion, not a reformat.

**Ruling 11 (mine, after the review passed).** Reading the compiler prompt's
whole paragraph in context, its closing line — "Use ask ONLY when the request
wants typing or personalization" — sat immediately after five clauses
describing answer devices involving neither. The contradiction predated this
round; adding connect sharpened it. Reworded, plus a duplicate focus
instruction dropped. Commit 3bb8a4b.

## Final whole-branch review (opus) — MERGE AFTER FIXES

Six findings worth acting on, five verified fixed by an independent check
(82fb2b8, 6e9612a, d21cae0, 6ed5301, 626e850, 3f42591):

- The gate derived its key from the BASE layout, not what was painted.
- **A fourth toothless test, the worst of the round**: inverting the gate's
  resolve arms — so every correct drawing grades WRONG — passed all 21 tests,
  as did deleting the restore that constitutes the whole reveal. Fixed by
  extracting the resolution into a pure function; inverting it now fails 3.
- All three of `connectKey`'s candidate guards and its gap rule were inert:
  each could be deleted and the full 5682 stayed green. Now each kills exactly
  its own test.
- Lint warned where it should refuse: the repair pass reads errors, not
  warnings, so an unfair cast shipped, the gate then declined to open, and the
  player spoke the answer — a question that answered itself. Escalated to
  error after checking that nothing else treats error as a blocker.

**Ruling 12 (F1, and I got the direction wrong first).** The animate fix did
not work, and my brief had the numbers reversed. Measured: with `hours` 0 → 6,
the base layout yields 24 edges and the PAINTED sky 19, because the turn
carries five of Orion's stars below the horizon; `paintedLayout()` is null in
exactly this case (`player.ts:437` sets painted = null before commit). I ruled
AGAINST fixing it at the source — making paintedLayout non-null after an
animate means reaching into the tween and commit path every template depends
on, to serve one widget. Instead lint refuses a connect ask with a sky-moving
animate between the drawing beat and the ask (27d6a69). The better reason is
not technical: if the sky turns in between, the viewer is asked to redraw a
figure that has moved and partly set, which is the wrong question however the
key is derived. Cost if wrong: an author who wanted that cast is refused and
must reorder; the alternative was risking every template's paint path.

Residue accepted, flagged not chased: a `move` on the figure's own elements, or
an animate on some other geometry-affecting param, could still open a gap
between what lint measures and what the gate derives.

## Round closed

5694 tests, tsc clean, build clean, astronomy-engine absent from the main chunk
(isolated in astronomy-DN5T7FpK.js). Round cost: 8 tasks, 12 rulings, 9 fix
rounds, 11 independent reviews. Four times a test could not fail; not once did
the suite catch it — every one came from a reader. Smoke checklist at
docs/superpowers/plans/2026-09-08-space-round-3-smoke.md is Hans's, and remains
the only thing standing between this and the same class of bug round 1 shipped.
