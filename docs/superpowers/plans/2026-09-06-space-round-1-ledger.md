# SDD ledger — plan: docs/superpowers/plans/2026-09-06-space-round-1.md

Spec: docs/superpowers/specs/2026-09-06-space-design.md (round 1 only)
Worktree: /Users/hom/Documents/GitHub/drawcast/.claude/worktrees/space, branch `space`
Baseline before Task 1: d19935d, 4984 tests passing.

## Pre-flight scan

Pairs that share a file or an interface:

| Pair | Produces → consumes | Found |
|---|---|---|
| T1 → T2 | `types.ts` (`Body`, `Vec`, `MoonPhaseInfo`), `rules.ts` `AU_KM` | agree |
| T1 → T3 | `SpaceEngine` type built by `makeSpaceEngine` | agree |
| T1 → T5 | `eng.all/bodies/satellites/resolveDate/positions/moonPositions/orbitRadii/logRadius/drawnRadii/sunSegment/scaleNote/scaleBar/labelTiers/km/au` | agree (plan self-review §type consistency) |
| T1 → T8 | `AU_KM`, `THIN`, `fmtInt`, `indexBodies` from `rules.ts` | agree — `THIN`/`fmtInt` exported at plan:695-696 |
| T2 → T3 | `positions`, `moonPositions`, `phase`, `schematic` | agree |
| T4 → T5 | `kit.ball()`; `space.yaml` declares `kit: 9` | agree — `doc.ts:62` errors only when `kit > KIT_VERSION`, so the packs on `kit: 1..8` keep working |
| T5 → T7 | `src/examples.json` (1 example → 5), `tests/space-template.test.ts` count | agree — T7 step 1 raises the count first |
| T6 → T7 | `explore.space` used by example 5 | agree — T6 precedes T7 |
| T6 → T9 | `trayPlan(...).space` read as `plan.space` | agree |
| T8 → T9 | `focusTargetFor` → `overrides.focus` (`string | null`) | agree |
| T3 → T5 | `engines.space` reachable from a pack layout | agree |

Each task against itself: T1 data vs tests, T2 ephemeris vs its known-value tests, T3 engine vs the five list edits, T4 kit vs its two pinning tests (see the ruling), T5 layout vs element-id tests, T6 four-file flag vs two test files, T7 examples vs the guards, T8 pure rules vs tests, T9 DOM vs tray mount, T10 docs and merge — all self-consistent apart from the row below.

**Ruling 1 (pre-flight): Task 4 must also rewrite the EXISTING `KIT_VERSION` assertion, not only append a new one.**
`tests/scene-kit.test.ts:165-166` is `test("KIT_VERSION is 8 and constants ride on the kit")` with `expect(KIT_VERSION).toBe(8)`; the plan only names `tests/kit-smooth-closed.test.ts:43`. Left as written, the bump to 9 fails an existing test. Task 4 updates that test's name and assertion to 9, and drops the appended `test("kit v9 ships it")` so the version is asserted once. Cost if wrong: a renamed test, one line.

**Note (not a ruling):** `tests/pack-defaults.test.ts` derives its expectation from `PACK_DEFS` minus `DEFAULT_OFF_PACKS`, so it needs no hand edit — but it also asserts every ready template keeps a full catalog entry below `TEMPLATE_FULL_THRESHOLD`. A params schema too large for that threshold would surface there in Task 5.

## Progress
Task 1: implemented (commit b0a7a5f), review dispatched over c8c57b2..b0a7a5f.
  Implementer deviation to judge in review: the `AU` scale-bar label uses a plain
  ASCII space rather than THIN, because the brief's own test bytes asserted one.
Out of band (2026-09-06): Hans asked for a connect-the-stars exercise in both
  directions. Verified the data supports it (799/800 constellation vertices snap
  to catalogue stars; 735 HIP-pair edges; 88/88 Norwegian names from the
  Wikipedia list) and recorded it in the spec as §6.1-6.2, round 2 scope.
  Commit 96dafd4. Round 1 is untouched by it.
Task 1: complete (commits c8c57b2..b0a7a5f, review clean — no Critical, no Important).
Task 1: minor (deferred): the AU scale-bar label uses a plain space where km uses THIN.
  Cosmetic; the brief's own test pinned it. Final review may reconcile.
Task 1: Ruling 2 (⚠️ resolved by the controller): the reviewer could not verify from the
  diff that `sunSegment`'s "Sun centre left of FRAME" assumption always holds. It does, by
  the plan's own Ruling 4: the Sun-as-segment exists ONLY in `row` view, where the Sun
  stands at the left edge. Carried into Task 5's dispatch so the layout keeps that
  invariant. Cost if wrong: a clipped Sun arc in a view that never calls it today.
Task 1: Ruling 3: Charon's `rot_h` is +153.29 while Pluto's is -153.29 for the same
  magnitude. Charon is tidally locked in Pluto's equatorial plane, and our own convention
  (types.ts:100) is "negative = retrograde", so the internally consistent value is
  -153.29. Real but Minor and invisible until a card shows rotation, so the one-character
  data fix is folded into Task 8 (the first task that formats rotation) rather than a fix
  round. Cost if wrong: Charon's card says "retrograde" under a convention some sources
  would write the other way.
Task 2: implemented (commit da92737), review dispatched over 96dafd4..da92737.
  Implementer flagged the brief's `.moon[]` fallback as dead code (astronomy-engine
  exposes the Galilean moons as named properties); kept per the brief, judged in review.
Task 2: review returned Approved with ONE Important finding, labeled plan-mandated.
Task 2: Ruling 4 (plan-mandated finding, controller decides): FIX IT. The reviewer found
  the brief's `.moon[]` fallback in ephemeris.ts:134-145 unreachable at astronomy-engine
  2.1.19 (JupiterMoonsInfo exposes io/europa/ganymede/callisto as named properties, no
  array), and it forces an `as unknown as` cast that is strictly less type-safe than a
  direct lookup. The SPEC is the binding authority and it pins the version exactly, which
  makes the plan's defensive branch dead by construction — the plan's argument loses to
  the spec's constraint. Fix round 1 drops the branch and the cast. Cost if wrong: a
  future version bump would reintroduce the property/array question deliberately, which is
  where that decision belongs anyway.
Task 2: ⚠️ resolved — commit trailers verified present on da92737 (git log -1 --format=%B).
Task 2: ⚠️ noted for round 3 — `moonPositionsKm` returns {x,y} with no z, per the brief's
  own signature. Round 1 draws in 2D so nothing is lost; round 3's plan must revisit it if
  it wants moons off the parent's orbital plane.
Task 2: minor (deferred): duplicated circular-sketch two-liner between helioPositions and
  moonPositionsKm; redundant `if (id === "sun")` early return (HelioVector already returns
  the origin for the Sun).
Task 2: fix round 1/5 dispatched (commit 45f160f) — dead .moon[] branch and its cast
  dropped for GALILEAN.find(), plus both minors taken (redundant Sun early return removed,
  circlePoint() helper de-duplicates the circular sketch). Scoped re-review dispatched
  over da92737..45f160f.
Task 2: fix round 1/5 (3 addressed, 0 open; commits da92737..45f160f, re-review clean).
Task 2: complete (commits 96dafd4..45f160f, review clean after one fix round).
Task 3: implemented (commit 1492dac, 5029 tests), review dispatched over 45f160f..1492dac.
  Implementer went one line past the brief (added toContain("anatomy") beside
  toContain("space") in tests/engines.test.ts); flagged for the reviewer to judge.
Task 3: complete (commits 45f160f..1492dac, review clean — code-split boundary traced and
  holds; all four hand-made lists covered). The extra toContain("anatomy") judged an
  acceptable in-scope tidy-up by the reviewer, not creep.
Task 4: implemented (commit 803f084, 5031 tests), review dispatched over 1492dac..803f084.
  Ruling 1 was carried into the dispatch and the implementer reports both KIT_VERSION
  assertions updated; the reviewer verifies it.
Task 4: complete (commits 1492dac..803f084, review clean — zero findings; Ruling 1
  verified applied, both KIT_VERSION assertions and the stale title updated).
Task 5: implemented (commit 4fffa60, 5063 tests), DONE_WITH_CONCERNS, review dispatched
  over 803f084..4fffa60 with all four concerns flagged for adjudication.
Task 5: Ruling 5 (controller ratifies a loosened guard): the implementer raised
  tests/pack-defaults.test.ts's default-catalog ceiling from 250 000 to 300 000 chars.
  RATIFIED. Measured independently: the catalog is 254 611 chars over 78 ready templates,
  the new template's entry is ~7 137, so it stood at ~247 474 — 99 % of the old ceiling —
  BEFORE the space pack existed. The bound was set 2026-08-25 against 45 templates and
  118 582 chars and had already stopped being a guard. Blocking round 1 on pre-existing
  catalog growth would charge this round for someone else's debt, and moving `space` to
  DEFAULT_OFF_PACKS would make it invisible to the compiler, defeating the pack.
  SURFACE TO HANS: the compile prompt now carries ~64 000 tokens of catalog on every
  request, doubled since August unnoticed. That deserves its own round — a catalog diet,
  or per-request template routing rather than shipping all 78. Cost if wrong: real money
  per request, and the new ceiling expires the same way in a few rounds.
Task 5: review returned Needs fixes — 2 Important + 1 Important that is a controller gate.
  Reviewer confirmed the sunSegment ruling holds and is documented at the call site
  (space.yaml:253-254), and that all three of the implementer's forced brief deviations
  were correct against the shipped Task 1-4 code.
Task 5: ⚠️ resolved — commit trailers verified present on 4fffa60.
Task 5: Ruling 6 (gate carried into Task 6): the template description tells the model to
  write {"explore": {"space": true}}, and the ENFORCING surface is src/spec/schema.ts:349-372
  whose explore object is additionalProperties:false — not just src/spec/types.ts:302 as the
  Task 5 report said. Until Task 6 patches BOTH, a spec following that sentence is hard-
  rejected by the validator. Task 6's dispatch names both files. If Task 6 were to slip, the
  remedy is deleting that sentence from the description. Cost if wrong: the pack ships a
  description that instructs the model to emit invalid specs.
Task 5: fix round 1/5 dispatched — (1) scale_note names the Sun on a Sun-less focus figure,
  fixed properly by making the reduced body nameable in rules.ts; (2) the new manifest sweep
  re-runs an undated example against today's sky and asserts zero warnings, made deterministic;
  (3) Minor taken by controller request — replace the expiring absolute catalog ceiling with a
  chars-per-ready-template guard, which is the durable version of what Ruling 5 ratified.
Task 5: minor (deferred to final review): row view computes an unused ephemeris every frame
  when `days` animates; the scale-bar group is built twice; SUN_CAP's "never a sixth of the
  frame" promise breaks on an empty selection (n===0 path untested); `focus` silently
  overrides view:"row"; the "no clock in the layout" test does not actually test that;
  missing_note can grow leftward into scale_note with no lint case covering it; Saturn's
  focus portrait mixes a squashed ring with a circular moon orbit (put on Task 10's smoke
  list); rules.ts writes km with THIN but AU with a plain space.
Task 5: fix round 1/5 implemented (commit a77d7ba), scoped re-review dispatched over
  4fffa60..a77d7ba. Implementer also dropped "Planet" from the reduced-note strings
  ("Sizes to scale, {name} reduced, distances not") because in a focus figure the
  true-size bodies are moons, not planets. Ruling 7: ACCEPTED — it removes a second false
  clause and reads correctly in both the solar-system and the focus case. Cost if wrong:
  the non-focus note is one word less specific than it was.
Task 5: fix round 1/5 (3 addressed, 0 open; commits 4fffa60..a77d7ba, re-review clean).
Task 5: complete (commits 803f084..a77d7ba, review clean after one fix round).
Task 6: implemented (commit 5fb8e77, 5069 tests), review dispatched over a77d7ba..5fb8e77.
  Implementer reports a parallel `space` line at every `anatomy` site in the four brief
  files; the reviewer re-greps to confirm, since Ruling 6's gate depends on it.
Task 6: complete (commits a77d7ba..5fb8e77, review clean — zero findings). Ruling 6's gate
  is closed: both schema surfaces patched, independent grep confirms every anatomy site has
  its space counterpart, and a spec carrying {"explore":{"space":true}} now validates and
  reaches the tray plan.
Task 6: minor (deferred): tray-model computes `body` and `space` independently with no
  mutual-exclusivity guard — inherited from the anatomy pattern, not introduced here.
Task 7: implemented (commit 48f42d2, 5105 tests), DONE_WITH_CONCERNS, review dispatched
  over 5fb8e77..48f42d2. Two things flagged for adjudication: (a) three of four examples
  failed the zero-lint guard as briefed, fixed by a date shift, by orbits:false, and by
  labelling only Earth — the reviewer judges whether any of those silences a warning
  rather than fixing it; (b) the implementer reports a REAL template defect out of scope:
  row+sizes label tiering overlaps for the four rocky planets regardless of date,
  reproducible from the template's own manifest example. Severity is the reviewer's call
  and the fix decision is mine.
Task 7: complete (commits 5fb8e77..48f42d2, review Approved). All three lint remedies
  judged legitimate (a sanctioned date shift, a real documented param, and the `hide`
  idiom lint.ts itself sanctions). ⚠️ resolved: trailers verified on 48f42d2.
Task 7: minor (deferred): "Earth laps it" over a 687-day window is loose (synodic period
  is ~780 days); narration says "buttons" where the UI calls them pills.
Task 7: Ruling 8 (controller inserts a task): TWO pre-existing defects in space.yaml —
  one disclosed by the implementer, one found by the reviewer — must be fixed before this
  round merges. I measured both myself over a 200-date sweep, reading layoutSpec().issues
  (the field the examples guard actually asserts; my first probe read .warnings and saw
  nothing, which is also why tests/space-template.test.ts's sweeps are weaker than the
  examples guard):
    top/schematic/planets, ALL DEFAULTS: 0/200 dates clean — every date warns
      "label sits on stroke". With orbits:false: 200/200 clean.
    focus jupiter + moons, orbits default: 0/200 clean. With orbits:false: 27/200.
    top/distances/inner: 13/200 clean.
    row/sizes: 2 warnings on EVERY date (label_venus/label_earth, label_earth/label_mars).
  So the most natural request a user can make of this template warns every time. Shipping
  that is shipping a known defect Hans would meet on his first render. Fixing it inside
  the round, LOCALLY to space.yaml: I am NOT touching the shared overlap-label-stroke rule
  in lint.ts, because exempting guide strokes globally would silently change lint for maps,
  anatomy and every chart — that is a whole-app design decision for Hans, not this pack's
  to take. Dispatching it as Task 7b before Task 8. Cost if wrong: label placement in the
  space template gets busier than the author intended, in exchange for figures that no
  longer warn.
Task 7b: implemented (commit ba40ee7, 5112 tests), review dispatched over 48f42d2..ba40ee7.
  Reported before -> after on the 200-date sweep: default top/schematic 0 -> 200; focus
  jupiter+moons 0 -> 200; distances/inner 13 -> 200; row/sizes 0 -> 200; top/sizes 8 -> 200;
  log 128 -> 200; tilted 0 -> 191; focus saturn 170 -> 195. Strategy: dropping `ignore` was
  not enough (33 units between rings vs a 43-unit label core diagonal, FONT_FLOOR 14 rules
  out smaller type), so each name is written along its own orbit and THAT ring ducks under
  it — 2-5 of 72 points. Consequence: the pack now places its own labels and kit.label is
  unused here; the reviewer judges whether that architectural shift is acceptable and
  whether the precedent claimed (row view, anatomy's columns) is real. Both example
  workarounds removed: the moons example draws the Galilean orbits again, and the size
  example names all four rocky planets.
Task 7b: open concern for adjudication — bodies:["all"] (13 rings in 230 units) still never
  clean, 2056 issues down to 225; a real fix needs a second break in one ring, making
  orbit_<id> a group of arcs. `all` is a group word the schema accepts, so a user can reach
  it. Severity is the reviewer's call.
Task 7b: review Needs fixes — strategy sound and independently re-verified (every reported
  measurement matched the reviewer's own recomputation; the figure got bigger, not quieter).
  Two Important gaps, both a cost of hand-rolling placement: the obstacle set omits title,
  scale_note, missing_note and scale_bar (worked case: a name lands inside the title's box
  and scores 0 because the title carries no cost); and the translation path sizes both the
  name box and the ring gap from the UNTRANSLATED string, because applyTextMap runs after
  the template body — so a Norwegian copy can draw the gap beside the word. Fix round 1
  dispatched with both plus four cheap minors (two inverted comments, a hard-coded 0.52
  that should import heuristicMeasure, an unstated load-bearing alias, a stale docstring).
Task 7b: Ruling 9: bodies:["all"] stays unclean. Thirteen rings over 230 units leave 19.2
  units against a 23.75-unit line of type, so no legible placement exists at any size; it
  is a property of orbitRadii's even spacing, not of the naming. Improved 2056 -> 225
  issues, residual is warn-severity. Goes to the whole-branch review as a known limit.
  Cost if wrong: a user asking for every body by name gets a crowded figure with warnings.
Task 7b: ⚠️ resolved — trailers verified on ba40ee7.
Task 7b: minor (deferred to final review): the row sweep's 200 dates are 200 identical
  layouts (the row branch never reads date); ring-break guard allows up to 49 % of a
  circumference in principle; a name over a planet is invisible to overlap-label-stroke
  because kit.ball emits a single point; the anti-cheap-fix guard covers only the default
  figure; the row step-up loop hides its arithmetic in a for-condition.
Task 7b: fix round 1/5 implemented (commit a368e51), scoped re-review dispatched over
  ba40ee7..a368e51. Both Importants and all four minors reported taken. Finding 2's remedy:
  padding a name's WIDTH took the Jupiter portrait 200 -> 0 (disc to Io's ring is 27 units),
  so headroom went into the clearance and the ring gap only, gap widened not heightened;
  limit stated in the pack and pinned by an Italian text_map test, residual 1 failing date
  in 60. New pre-existing concern disclosed for adjudication: scale:"sizes" WITH a missing
  note is never clean — scale_note grows and collides with missing_note in the same foot
  strip (reproduced on HEAD~1: 1674 issues there, 200 here), pinned meanwhile by a sweep
  asserting no label_ id is caught in it.
Task 7b: fix round 1/5 (6 addressed, 0 open; commits ba40ee7..a368e51, re-review clean).
Task 7b: complete (commits 48f42d2..a368e51, review clean after one fix round). Both label
  defects fixed by measurement: all four acceptance configurations 200/200.
Task 7b: Ruling 10: the scale_note vs missing_note foot-strip collision (needs scale:"sizes"
  AND an unknown body id together) is MINOR and deferred to the whole-branch review. It is
  pre-existing (reproduced on HEAD~1), touches none of the four acceptance configurations,
  and is contained by a 200-date test asserting no label_ id is ever caught in that strip.
  Smallest fix noted for later: place missing_note relative to scale_note's measured right
  edge instead of a hardcoded x=500. Cost if wrong: a user who both picks sizes mode and
  misspells a body name sees two captions overlap.
Task 8: implemented (commit 2cbe9f4, 5133 tests), review dispatched over a368e51..2cbe9f4.
  Includes Ruling 3's Charon rot_h fix (+153.29 -> -153.29). Implementer caught a literal
  THIN byte slip mid-task and verified with LC_ALL=C grep before committing.
Task 8: review Needs fixes — module approved (clean split, real tests, isolation from the
  astronomy-engine chunk confirmed, all 35 bodies simulated in both languages with no
  degenerate card lines), but ONE Important finding, and it overturns my own Ruling 3.
Task 8: Ruling 11 (REVERSES RULING 3 — I was wrong): Charon's rot_h goes back to +153.29.
  I ruled it should be negative because Pluto's spin is retrograde and Charon is locked in
  Pluto's equatorial plane. The reviewer refuted it and I verified the data myself:
    uranus rot_h -17.24, yet miranda/ariel/umbriel/titania/oberon all keep POSITIVE rot_h
    triton, the one genuinely retrograde moon, has BOTH period_d -5.877 and rot_h -141
    charon after my change was the ONLY sign mismatch in the file
  The file's convention is that a tidally-locked moon's rot_h follows its OWN orbital sense
  (period_d's sign), not its parent's spin. Uranus's moons are the direct counter-example to
  my reasoning; Triton is the positive proof. Worse, ephemeris.ts:76-78 animates from
  period_d's sign, so as merged Task 9 would revolve Charon prograde while the card called
  its rotation retrograde — a contradiction a learner could catch by watching and reading at
  once. Fix round 1 reverts it and re-pins the retrograde formatting on Venus or Triton,
  bodies that genuinely have it. Cost of my original error if it had shipped: one wrong fact
  on one card, and a visible contradiction with the animation.
Task 8: fix round 1/5 also takes two minors — fmtKm's "million km" branch does not group its
  digits ("10125 million km" beside "58 232 km" on the same card), and fmtMass's
  Math.floor(Math.log10()) is a latent floating-point edge for exact powers of ten.
Task 8: fix round 1/5 (3 addressed, 0 open; commits 2cbe9f4..b8b39bb, re-review clean —
  Charon back to +153.29 with no other data disturbed, retrograde formatting re-pinned on
  Venus and Triton rather than deleted, fmtMass guard verified to produce 1.00 x 10^21).
Task 8: complete (commits a368e51..b8b39bb, review clean after one fix round).
Task 9: implemented (commit 6d3400c, 5133 tests), review dispatched over b8b39bb..6d3400c.
  Adds no tests of its own — I verified the precedent myself: src/ui/body-explore.ts, the
  anatomy section this imitates, also has none; the house split is that the pure model half
  is node-tested and the DOM half is not. Told the reviewer that, and asked it to judge
  instead whether anything here is a RULE that belonged in the tested space-model.ts.
  Implementer verified the code-split boundary against the real build output
  (grep -l HelioVector dist/assets/*.js matched only the engine chunk). Disclosed oddity for
  adjudication: the Sun gets a "position is schematic" note because it is not in
  EPHEMERIS_IDS, though it sits at the origin of a heliocentric figure by definition.
Task 9: complete (commits b8b39bb..6d3400c, review Approved — no Critical, no Important).
  Reviewer traced the code-split boundary itself rather than trusting the build-grep, and
  walked every failure path: fetch rejects, 404, a late response after the learner clicks
  another body, destroy mid-request — the card is never empty or stuck and no listener
  outlives destroy. It also DISPROVED the implementer's own disclosed concern: `sun` IS in
  EPHEMERIS_IDS (ephemeris.ts:29, pinned by the size===15 test), so the Sun never gets the
  "schematic position" note. Nothing to fix there; noted because the self-review asserted a
  defect instead of re-deriving it from the source.
Task 9: minor -> folded into Task 10: `dateOf` (space-explore.ts:159) is domain date
  arithmetic living in the DOM half, duplicating resolveDate's semantics untested; and the
  Date pill row compares only overrides.date, so "Today" never highlights on first open.
  Also a dangling .cs-tray-space class with no CSS rule.
Task 10: complete (commits 6d3400c..a3114ca — README, ROADMAP entry, smoke checklist, and
  the folded-in dateOf cleanup moved into the tested space-model with an injectable now).
  5134 tests, tsc clean, npm run build clean with engine-*.js at 110.07 kB as its own chunk.
  Did NOT merge or push, as instructed. Concerns: ROADMAP entry placed after Drag-to-place's
  whole nested block rather than mid-block (would have orphaned unrelated sub-bullets); the
  smoke checklist was written, not executed, per Hans's standing preference to limit browser
  automation; .cs-tray-space was dropped since no CSS rule existed for it anywhere.
ALL TEN TASKS COMPLETE. Dispatching the final whole-branch review over 6e34a3a..a3114ca.
FINAL WHOLE-BRANCH REVIEW: Needs fixes first. No Critical. Two Important:
  (1) `highlight` silently discards group words — space.yaml:156-160 takes bodies[0] and
      drops the rest, so highlight:["inner"] tints Mercury alone, with no note and no
      warning. The same schema documents group words for `bodies`, so a model generalising
      as this pack taught it produces a quietly wrong figure.
  (2) My Ruling 10's containment claim is FALSE for view:"row". The reviewer executed
      {view:"row", scale:"sizes", bodies:["jupiter","krypton"]} and got
      overlap-label-label label_jupiter+missing_note. Cause is a real seam: the row branch
      seeds `written = []` and never consults captionBoxes(), because the two branches use
      incompatible box representations (row = centre-based {x,y,w}, top = corner-based
      rects). The containment test at tests/space-template.test.ts:372 runs the default TOP
      view only. Ruling 10 stands as a decision but its stated containment was wrong; the
      record must be corrected.
  Reviewer independently verified: the code-split boundary holds in the SHIPPED bundle
  (JupiterMoons in engine-DxHBBCaZ.js only, absent from main); the bodies table is
  internally consistent with no sign mismatch anywhere and Charon's revert took; the row
  view's unused ephemeris costs 0.0069 ms/frame, so it is dead code and not a perf issue.
  Fourteen deferred minors triaged: twelve can stand, two want a comment or a rename.
ONE fix wave dispatched over a3114ca.
FINAL FIX WAVE implemented (commit c67034a, 5138 tests, tsc clean). Both Importants
  reproduced as fixed: highlight:["inner"] now tints all four; the row+jupiter+krypton case
  is clean. Took the HARDER option for Important 2 — converged the two box representations,
  on the claim that the row's inline centre-distance test is arithmetically identical to
  boxHit(boxAt(c,w,LABEL_H), q, 2). Added unrequested behaviour: the row's name search now
  also runs UPWARD when downward fails, and refuses boxes off either page edge. Discloses a
  remaining gap: label_sun is still not an obstacle in the row. Also corrected a SECOND
  false claim it found in the README (the row's Sun does not take scale_note's reduced
  wording; the row clips, and a test has pinned the plain wording all along).
  Scoped re-review dispatched over a3114ca..c67034a, asked to verify the arithmetic
  equivalence by reasoning rather than trusting it, judge the unrequested fallback, and
  judge whether leaving label_sun is right.
FINAL FIX WAVE re-review: READY TO MERGE. All ten findings addressed with tests verified to
  fail against the pre-fix code. The risky box-representation convergence was proved
  arithmetically equivalent AND confirmed empirically: 460 figures compared old vs new, zero
  anchor changes. The unrequested upward fallback judged a necessary consequence (without it
  the seed would have traded a warn for an out-of-canvas ERROR); swept 108 row figures, no
  name ever above its body's centre line, none off-page. label_sun correctly left for round 2.
  Reviewer found one documentation-scope note to carry: scale:"distances" warns with PLAIN
  DEFAULTS in row/top/tilted, not only with bodies:["all"] as the README implies — pre-existing
  and byte-identical before and after, so not a regression.
MERGE: origin/main had moved to 1f386a4 — another session landed a whole periodic_table round
  touching the same integration points (tray.ts, tray-model.ts, types.ts, engines.ts,
  author.ts, pack-defaults/molecule3d/author tests, styles.css). `git merge origin/main` left
  SEVEN conflicts. Dispatched a resolver with instructions that both rounds' features must
  survive intact and that the catalog bound must keep OUR shape (max-over-templates + floor)
  re-measured against a catalog now holding BOTH packs.
