# SDD ledger — plan: docs/superpowers/plans/2026-09-07-space-round-2.md

Spec: docs/superpowers/specs/2026-09-06-space-design.md §6 and §6.1 only.
Measured data: docs/superpowers/specs/2026-09-07-sky-data-measured.md — take as given, no re-research.
Worktree: /Users/hom/Documents/GitHub/drawcast/.claude/worktrees/space, branch `space`.
Baseline before Task 1: 6d78551, 5235 tests passing, tsc clean.

## Controller scope decision, taken before planning

Round 2 is the sky map ONLY. The `connect` widget of spec §6.2 (given a name, draw
the lines) is a sixth `ask.widget` with its own gate, grading and reveal —
comparable in size to the drag round, which was a round of its own. It gets its own
plan immediately after. Round 2 still ships the answer-key data it will need (§6.1's
735 HIP-pair edges), because one build script produces both that and the star set the
template needs. Direction A of §6.2 (the lines are drawn, name the constellation)
needs no new machinery and IS in this round.

## Pre-flight scan

Files each task creates or modifies, and where they meet:

| Pair | Produces → consumes | Found |
|---|---|---|
| T1 → T2 | the two committed JSON tables + `sky-names.json` | agree |
| T1 → T3 | `sky.ts` loads what the build script wrote | agree |
| T2 → T3 | `sky-types.ts` (tray-reachable), `sky-rules.ts` (no astronomy import) | agree — same split round 1 used for `types`/`rules` vs `ephemeris` |
| T2 → T6 | the tray reads types and pure rules only | agree |
| T3 → T4 | `engines.sky`; the five hand-made lists | agree |
| T4 → T5 | `sky_map` v1 gains constellations in T5, same YAML document | sequential, same file — T5 must re-read what T4 shipped, not the plan's snapshot |
| T4 → T7 | one bundled example at registration, four more later | agree — T4 cannot register without one |
| T5 → T7 | the constellation examples need T5's ids | agree |
| T6 → T7 | example 5 uses the ⊕ sky section | agree |
| T4/T5 → T6 | `sky-model.ts` resolves clicks against ids the template makes | agree |

Each task against itself: T1 build script vs its shape assertions; T2 pure trig vs
known-value tests; T3 engine vs the five list edits; T4 layout vs sweep + hit tests;
T5 constellations vs the naming floor tests; T6 DOM vs pure model; T7 examples vs the
zero-issue guard; T8 docs. Self-consistent.

## Rulings ratified before execution

The plan took nine scope decisions (R1-R9). I ratify all nine. Two need a note:

**Ruling A (ratifies R4, which DEVIATES from the spec).** The spec said every star
gets a `hip_<n>` element id. The plan makes `stars` and `figures` two group elements
and lifts a thing into its own id only when `mark`, `highlight` or `focus` names it.
RATIFIED: `draw` takes an array and has no wildcard, and neither an author nor the
model can know which stars are above the horizon at a given hour and place, so
per-star ids would be unusable in a `draw` list that changes with time. The plan's own
answer to the obvious objection is good — `mark` exists precisely so a click question
can be authored without a tint giving the answer away. Cost if wrong: a lesson wanting
to address a star the author did not name has to name it first.

**Ruling B (ratifies R7, which drops a spec feature).** The spec offered a runtime
jsdelivr fetch for stars fainter than 4.5. RATIFIED as dropped: a layout body is
synchronous and engines load before params are known, so the value that would trigger
the fetch is read where nothing can await it — and spec §2's own rule is that nothing
in a figure depends on a runtime fetch. The bundled union already carries every star a
constellation line needs, down to magnitude 5.89. Cost if wrong: a chart cannot go
fainter than 4.5 without a new data build.

## Progress
Task 1: implemented (commit da42ff1, 5245 tests), DONE_WITH_CONCERNS, review dispatched
  over 459270e..da42ff1. Produced 88 constellations, 1 040 stars in the 4,5 union, faintest
  line star 5,89 — all exact against the measured doc — but 741 edges against my measured
  735, absorbed by a [700,780] tolerance and attributed to the unpinned @master CDN having
  drifted. Flagged to the reviewer as the first of four judgements, since the instruction
  was to stop on a mismatch rather than let a tolerance swallow it. Also asked the reviewer
  to rule on whether the source URL must be pinned before merge (a build whose output moves
  with upstream is not deterministic, and this repo's build scripts are).
  Implementer found two real bugs by RUNNING the brief's verbatim script: Serpens arrives as
  two GeoJSON features sharing "Ser", and stars.6.json delivers B-V as a numeric STRING, so
  a typeof === "number" check had silently nulled every star's colour.
Task 1: review Approved. Reviewer INDEPENDENTLY re-derived the drift from the raw cache:
  893 coordinate points upstream today against the 800 I measured, and the shipped
  top-five-by-edges list (Sgr 29, Eri 26, Ori 24, Per 23, Psc 23) matches my measured doc
  exactly — which a snapping bug could not do while moving the total 0,8 %. So the +6 is
  upstream content drift, and reporting it under the brief's own tolerance was right.
  Both bug catches verified real: Serpens genuinely arrives as two features sharing "Ser"
  (without the fix the script's own 88-count assert crashes before producing anything), and
  bv is a STRING in 5042 of 5044 features, so the brief's typeof check would have shipped
  b: null for all 1040 stars. Shipped file has b populated for all 1040.
Task 1: Ruling C: PIN THE SOURCE NOW. The shipped data is fine but the BUILD is not
  reproducible — a wiped cache pulls whatever master holds that day, which is what just
  happened. Cheapest now, while nothing else in the round reads that URL; after Task 4 the
  template depends on the data and a rebuild becomes a reconciliation. Told the implementer
  to KEEP whatever the pinned build produces rather than chase my number: a pinned count we
  can reproduce beats an unpinned one that happened to be today's. Cost if wrong: the
  figures use a slightly different snapshot of a hobby dataset than the one I measured.
Task 1: fix round 1/5 dispatched — pin the URL to a commit SHA and rebuild; add a
  count-based loud-failure guard to bvOf (the exact class of bug that just bit); name the
  bare 3.0 proper-name cutoff. Also asked for one line in the measured doc recording the
  drift, keeping my numbers and adding the pinned ones beside them.
Task 1: fix round 1/5 (4 addressed, 0 open; commits da42ff1..4a6535e, re-review clean).
  Source pinned to d3-celestial@7e720a3d; the pinned rebuild produced output byte-identical
  to what was already committed, so no data file moved. The bvOf guard fires above 5 % of
  stars missing a colour — the original bug had 100 % missing, so it would have caught it.
Task 1: complete (commits 459270e..4a6535e, review clean after one fix round).
Task 2: implemented in parallel with that re-review (read-only reviews do not conflict with
  an implementer). Dispatched over BASE 4a6535e.
Task 2: implemented (commit db645cd, 5269 tests, 24 new), review dispatched over
  4a6535e..db645cd. Implementer reports one sanctioned deviation (a Math.round in
  resolveTime's bare-date branch, verified a no-op for the four PLACES longitudes) and
  grep-confirmed no astronomy-engine / ephemeris / sky.ts import in either new file.
  Reviewer asked to attack the trigonometry tests specifically: for each orientation-
  critical assertion, would it still pass with a sign flipped or east and west swapped?
Task 2: complete (commits 4a6535e..db645cd, review Approved — no Critical, no Important).
  Reviewer byte-diffed both files against the brief (identical but the one pre-authorised
  line), traced the astronomy-engine boundary transitively, and did the substitution
  analysis I asked for: the east-left assertion (e[0] < CHART.cx at az 90) genuinely
  discriminates — a sign flip OR a handedness swap both fail it — while the zenith and
  horizon-distance assertions pin magnitude only. It also independently re-ran the
  Horizon() cross-check in Node and got agreement to 6 decimals. It found the Math.round
  deviation is worth MORE than claimed: Sydney's longitude lands at ...767.99999999, which
  Date truncates, silently losing a millisecond.
Task 2: minor (deferred): resolveTime's regexes do not range-check month/day, so
  "2026-13-45" rolls over instead of falling back to now; FRAME is hand-duplicated from
  round 1's rules.ts rather than imported, so the two can drift.
Task 3: implemented (commit ab96461, 5283 tests), DONE_WITH_CONCERNS, review dispatched
  over db645cd..ab96461. Three concerns flagged for adjudication: (a) it fixed a real bug in
  the brief's own moonLimb code — the dot-product gate left `toward` non-null at a true new
  or full Moon, now gated on illuminated fraction; (b) it REWORDED THREE COMMENTS in
  already-committed Task 2 files because the boundary test greps the source literally for
  "astronomy-engine" and tripped on the words in prose — this is the one that concerns me,
  since a test that fails on a comment is testing the wrong thing, and editing reviewed
  files to satisfy a grep is the wrong direction of fix; (c) the build matched the astronomy
  symbol in two chunks rather than the brief's stated one, claimed to be round 1's existing
  vendor split rather than a regression.
Task 3: review Approved with ONE Important — and it confirmed my concern (b). The reviewer
  reproduced the moonLimb bug against astronomy-engine with real numbers (at the true new
  Moon the sky separation is 2,401 deg, dot 0,999122, so the brief's dot gate stayed non-null
  at BOTH extremes because the Moon's ~5 deg latitude excursion decouples elongation from
  sky-plane separation), re-ran the build itself and got byte-identical chunk names, and
  confirmed the two-chunk match is round 1's own vendor split with zero occurrences in
  main/index.
Task 3: Ruling D: the BOUNDARY TEST is the defect, not the comments. It greps raw source
  including comments, which is why an implementer had to reword prose in already-reviewed
  files. The reviewer found this repo already has the idiom — viewer-anvil, names-entry and
  learn-viewer all strip comments before asserting on source. Fix round 1 fixes the test and
  RESTORES the three comments to name astronomy-engine precisely, and must show RED evidence
  that a real static import still fails it. Editing reviewed files to satisfy a grep is the
  wrong direction of fix; precision in a comment beats a grep's convenience. Cost if wrong:
  none I can see — the guarantee is unchanged, only the false-positive surface goes.
Task 3: minor (deferred to final review): the star/constellation index-building in
  sky.ts:257-274 belongs in sky-rules.ts the way round 1's engine.ts delegates to rules.ts —
  it puts ephemeris-free logic behind the heavy chunk. Traces to the brief; moving it now
  would ripple into Task 4.
Task 3: fix round 1/5 (3 addressed, 0 open; commits ab96461..f141729, re-review clean).
  The boundary test now strips comments using the repo's own idiom, with a comment saying
  why and forbidding a "simplification" back to a raw grep; the four comments are restored
  byte-for-byte; and RED evidence exists — a probe import made it fail at the exact
  assertion, 13/14, then 14/14 after removal. The re-reviewer reasoned about whether the
  stripping regexes could accidentally swallow an import line and concluded they cannot.
Task 3: complete (commits db645cd..f141729, review clean after one fix round).
Task 4: dispatched in parallel with that re-review over BASE f141729 — the sky_map template
  itself, the largest task of the round.
Task 4: implemented (commit dfc5026, 5335 tests, 43 new), DONE_WITH_CONCERNS, review
  dispatched over f141729..dfc5026. Sweep: 10 param sets x 200 moments = 2 000 layouts,
  ZERO issues. SIX deviations from the brief, each claimed as a bug in the brief:
    (1) `daylight` never saw the Sun unless `show` named it, against the brief's own test;
    (2) `show` kept only bodies[0] of a group expansion — ROUND 1'S EXACT SCAR, the same
        defect the round-1 whole-branch review found in `highlight`;
    (3) the brief's Moon colours composited to a 10/255 difference on the cream ground, so
        the phase was INVISIBLE — inverted to shade the dark side with the paper colour,
        claimed verified at 4x zoom over a lunation with the crescent on the Sun's side;
    (4) star-name placement needed a hard/soft cost split or label_polaris, which the
        bundled example draws, often would not exist;
    (5) a crash path — two catalogue stars are both "Alnair", minting a duplicate id that
        dropped the figure through to tier-2 as a warning;
    (6) three brief assertions encoded false facts (the catalogue is not magnitude-sorted,
        Polaris moves 0,67 deg not under 0,5, Tromso is 22:15).
  Told the reviewer that six "the brief was wrong" claims in one task is either unusually
  good bug-finding or a pattern of rationalisation, and its job is to say which — and to
  probe (3) hardest, since a phase nobody can see is exactly what a lint-clean sweep hides.
Task 4: review Approved. All SIX deviations verified as real brief bugs, each checked
  against the actual engine, kit, lint, hit-test and catalogue source — "six claims, six
  real brief bugs, this is good bug-finding, not rationalisation". The corrected tests were
  judged STRENGTHENED, not relaxed (the magnitude test now measures Polaris by HIP at both
  limits with a floor it cannot pass on; the Polaris swing bound is paired with a Vega
  contrast). One Important:
Task 4: Ruling E: the Moon's phase fix is verified for the DEFAULT style only. kit.area
  leaves `precise` undefined, so the roughjs path HACHURES both areas — about four strokes
  across a 24-unit disc — and a paper-coloured hatch laid BETWEEN grey hatches is not the
  knock-out the implementer drew. Their evidence was a flat-fill HTML render, which matches
  DEFAULT_SETTINGS.style "clean" and nothing else. Same trap as their own deviation 3, one
  layer down. Fix round 1 adds precise:true to both areas and requires an actual look under
  `sketchy`. Cost if wrong: the phase reads in the default style and mushes in the sketchy
  one, which is the style this app is named for.
Task 4: ⚠️ RECORDED, not chased: the bundled example's intermediate animate frames are
  covered by no test — tests/examples.test.ts only re-lays out animate.stage targets — so
  label_polaris and label_saturn existing at +0,5 h through +6 h rests on a manual check.
Task 4: minor (deferred to final review): lint.ts's coreOf comment is stale now that
  space.yaml holds two copies; SEVEN helpers are duplicated verbatim between the two
  documents (push, textBox, boxAt, boxHit, coreOf, turn, segHit) and the reviewer suggests
  promoting the box/segment predicates into the kit, which would also collapse the third
  copy of the lint constants; sky_note is conditional while element_ids advertises it
  unconditionally (round 1's missing_note has the same shape).
Task 4: fix round 1/5 implemented (commit 860871d) — and it turned up something bigger than
  the findings. While building Finding 2's floor, the implementer found that `resolveTime`
  REJECTED FRACTIONAL SECONDS, i.e. every string toISOString() produces, and silently fell
  back to `now`. **Their 200-moment sweep was two hundred copies of a single instant, and it
  passed.** That sweep was this task's whole acceptance evidence and the round's stated bar.
  resolveTime is Task 2's file — already implemented, reviewed and approved; its reviewer
  flagged the missing month/day range checks but not this. They fixed the pattern, re-ran for
  real (2 000 layouts over a genuine year, 0 issues on all ten rows) and added a guard that
  asserts 200 DISTINCT clocks before any row is believed.
  The sketchy verification also came back worse than the reviewer predicted: without
  `precise` there is not just sparse hachure but a 1,8-wide INK STROKE slashing the disc
  along the terminator, because kit.area leaves color: INK while the branch zeroes
  strokeWidth. With `precise` both styles emit an identical path, so one check covers both.
  Scoped re-review dispatched over dfc5026..860871d with four explicit questions about the
  resolveTime bug, including whether anything ELSE already shipped this round was proving
  nothing for the same reason.
Task 4: fix round 1/5 (3 addressed, 0 open; commits dfc5026..860871d, re-review clean).
  The re-reviewer RAN both resolveTime patterns side by side: the old one parsed 0 of the
  sweep's 200 timestamps, the new one 200/200, each equal to new Date(str), while genuine
  rubbish still falls back under both. It recomputed the 200 local clocks independently and
  got 200 distinct, so the guard's assertion is exact, not slack. BLAST RADIUS: none beyond
  this task's own two tests — every `time` string that ships uses the offset form and always
  parsed correctly, so no shipped figure was ever drawing "today", and round 1's sweep goes
  through resolveDate, which is structurally immune. **The acceptance evidence for Task 4 is
  now sound, re-verified rather than taken.**
  It also measured what the implementer did not: the shipped Moon composite is 1,47:1
  luminance contrast — a genuine knock-out but a faint one, worth knowing before anyone
  shrinks the Moon.
  Two informational nits: the fix report said 18 phases are checked when the Moon is above
  the horizon at only 7 of them (in a report about evidence that did not say what it
  claimed, that number should have been counted); and the "loser stays in the sky" half of
  the Alnair fix is implemented but unasserted.
Task 4: complete (commits f141729..860871d, review clean after one fix round).
Task 4: Ruling F: resolveTime's missing range checks have now been raised by TWO reviewers
  (Task 2's and Task 4's) and the set has widened — "2026-13-45" silently becomes 2027-02-14,
  "T25:00" the next day, and seconds >= 60 joined them with the fix. A figure that names a
  date and draws a different one is wrong in the same way the fallback was. Folding the
  post-parse round-trip check into Task 5's dispatch rather than deferring it a third time.
  Cost if wrong: a spec with a malformed date now falls back to today instead of silently
  drawing some other day — which is the behaviour already pinned for unparseable input.
Task 5: implemented (four commits 9eb86ab, b7dedd1, 5923fe2, 4672b92; 5370 tests),
  DONE_WITH_CONCERNS, review dispatched over 860871d..4672b92. Ruling F's resolveTime fix
  landed alone in 9eb86ab as asked. Sweeps: 18 rows x 200 moments = 3 600 layouts, 0 issues
  on every row, PLUS a per-row guard proving each row's own subject varied (figures on
  200/200 default charts, 0/200 under constellations:"names", con_ori on 147/200 with
  mark:["Orion"]); and a third sweep focusing all 88 figures at four seasons, 352 layouts,
  0 issues. That is the round's hard-won standard applied without being asked twice.
  FOUR concerns for adjudication, the first the important one:
    (1) their SELF-REVIEW found the brief's name placement put 21 OF 39 constellation names
        nearer another figure than their own — "The Great Bear" 166 units away inside Coma
        Berenices. Fixed so a name goes on its own figure or nowhere, at the cost of naming
        11-24 figures a chart instead of 24-35. They ask for a second opinion on the trade;
        my own view is that a name on the wrong figure is worse than no name, and the plan's
        R5 already said a name is written only where it costs nothing, but the reviewer
        rules;
    (2) tests/sky-template.test.ts is now ~29 s, taking the suite from 20 to 35;
    (3) `focus` crops silently, so a marked star outside the detail vanishes with no word;
    (4) no pixel was looked at — all evidence is geometric.
Task 5: review returned Needs fixes with a CRITICAL claiming the whole chart is drawn upside
  down and mirrored — the reviewer rendered the layout, looked at a pixel (the first person in
  two rounds to do so) and reported S at the top with Orion on his head.
Task 5: Ruling G (I OVERRULE THE CRITICAL, with proof): the chart is NOT flipped, and
  following that finding would have broken a correct projection. Verified myself:
  src/layout/canvas.ts:1 says "Cartesian, y-up, origin bottom-left" and :33 says "The one
  y-flip: logical y-up -> SVG y-down. Backends call this at emission time only", applied at
  svg-backend.ts:129,149,282. So project(az=0) -> [cx, cy+r] is a HIGHER logical y, which
  after the flip is the TOP of the page. North is at the top; east at [cx-r, cy] is on the
  left. The reviewer's own evidence gives it away — they wrote "place_label at y=24 is the
  top of the page", but on a y-up canvas y=24 is the FOOT, exactly where a place caption
  belongs, and round 1 calls y=36 the foot strip with the title at 726. They hand-rolled an
  SVG from logical coordinates WITHOUT the backend's flip and saw everything mirrored. Their
  Orion detail is the same mirror: with the flip applied Betelgeuse is above the belt and
  Rigel below, which is the real sky. Cost if I am wrong: the chart ships upside down, which
  is why I checked the canvas source rather than reasoning from the report.
  Their instinct was right and is how a genuine flip WOULD be caught, so I kept the useful
  half: the compass test only checks the layout against itself, and the fix round adds an
  assertion tying orientation to something outside the template (Polaris projects above
  centre at Oslo), so a future sign flip fails against the sky.
Task 5: three real Importants sent to fix round 1 — constellations:"names" keeps 361 faint
  line stars though it draws no lines (23 in "none" mode); `focus` crops marked stars and
  named bodies in SILENCE, against the pack's own stated contract and the maps template's
  existing idiom; and the limit_mag description is now false in the default mode. Plus three
  minors (a stale measured number in a guard's comment, a 5,6 s guard that re-lays charts the
  sweep already lays, and a focus portrait spending 9,6 of 16,7 s on 23 star dots).
Task 5: the name-placement trade is UPHELD. The reviewer reimplemented the brief's candidate
  geometry against the real winter chart: 834 of 936 spots misattach, 89 %, 27 of 39 figures
  misattaching at their FIRST candidate, Ursa Major's furthest 178 units out — worse than the
  implementer's own 21 of 39. Under the shipped rule, 0 of 24 misattach.
Task 5: carried to Task 7 — the bundled sky example now sets constellations:"none", so no
  shipped example displays this task's work.
Task 5: fix round 1/5 implemented (commit 796c934). All three Importants and three minors
  landed: limit_mag 2 under constellations:"names" now draws 23 field stars, not 361; a new
  "Outside view:"/"Utenfor utsnittet:" clause on the maps.yaml model reports what the crop
  took, and `below` now covers a marked constellation that never rose; the limit_mag
  description is corrected and a 19th sweep row added so both halves are swept; the stale
  24-35 comment is now 11-24; the 5,6 s guard is folded into sweep() so 1 400 duplicate
  layouts are gone; a portrait's stars share a budget, taking Orion's 23 dots from 9 660 ms
  to 2 001 ms. Sweep is now 19 rows x 200 = 3 800 layouts, 0 issues. 5376 tests.
  The implementer INDEPENDENTLY re-derived the y-up/emission-flip reasoning and agreed with
  Ruling G before changing nothing it was told not to. It also wrote the trap into the README
  and added the external tie the rejected finding exposed: Polaris (due north, altitude ~
  latitude, both asserted FROM THE ENGINE) must project above chart.cy, and the star nearest
  azimuth 90 must land left of chart.cx — so a sign flip now fails against the sky rather
  than against a letter the same code drew.
Task 6: dispatched in parallel with that re-review over BASE 796c934 — the ⊕ tray's sky half.
Task 5: fix round 1/5 (7 addressed, 0 open; commits 4672b92..796c934, re-review clean).
  The re-reviewer settled Ruling G INDEPENDENTLY from source and confirmed it: canvas.ts is
  y-up with toSvgY as the only flip, applied at every emission path, so project(az=0) puts
  north at the top and az=90 east on the left. Its verdict on the rejected finding: "the
  previous reviewer's finding was itself the bug — rendering logical y-up coordinates as if
  they were already SVG y-down, without the one documented flip, inverts everything." It
  also confirmed project() is byte-identical and the compass test untouched.
  It verified the new external assertion is genuinely external, not circular: Polaris's
  position comes from the engine and the expectation (alt ~ latitude, az ~ 0) is a physical
  fact, so a sign flip fails it while the self-referential compass test would keep passing.
  And it traced that the folded guard can still fail, including that drew[row] is written
  before the row's own assertions so a failing row still populates it.
Task 5: complete (commits 860871d..796c934, review clean after one fix round).
Task 6: implemented (commit ed7b098, 5397 tests, 7 new), review dispatched over
  796c934..ed7b098. Boundary re-verified in the real build: the astronomy symbol matches only
  the vendor and lazy sky chunks, never the chunk holding the new UI. Two concerns flagged:
    (a) the brief's own sample sky-explore.ts had DIVERGED from the shipped template — it did
        not gate lineStars by showLines, ignored the mark/highlight exemption, and did not
        handle focus's crop at all. The implementer followed the shipped code and put the
        corrected logic in a pure tested `visibleField` in the MODEL half rather than the DOM,
        which is exactly the rule round 1 had to learn the hard way;
    (b) clicking the Sun, Moon or a planet on a sky chart does NOTHING in this section,
        because the brief's types and tests only covered stars and constellations. I told the
        reviewer to judge this hard: Hans's one bug report against round 1 was verbatim that
        clicking a moon did nothing, and a section that invites a click then ignores the
        brightest things on the chart repeats it.
Task 6: review Needs fixes. It verified the visibleField extraction properly — traced both
  sides line by line, confirmed the brief's sample really did add every constellation
  endpoint unconditionally with no gating, and confirmed the port reproduces the shipped
  template exactly including the focus transform's pad, zoom clamp and centre; the new test
  would fail under the brief's own unfixed logic. Model-half placement judged correct.
Task 6: Ruling H: the unclickable Sun, Moon and planets must be FIXED, not deferred. The
  brief's rationale for leaving them ("hitElement would only ever answer 'the stars'") was
  never true of bodies: the reviewer read the template and found every shown body is pushed
  as its OWN drawable element (space.yaml:1069-1094, 1422-1447), unlike the star field, which
  is the one-element case that argument is about. So hitElement already resolves a click on
  "saturn". Hans's single bug report against round 1 was verbatim that clicking a moon did
  nothing — same class of object, same tray feature, same symptom — and the template itself
  tints a body when an author writes mark/highlight, so an author action that works for a
  star is silently inert for a planet. It is also recorded nowhere: Task 8's README brief
  lists this round's known limits and does not mention it. All the machinery exists
  (hitElement, cardFacts, bodyLabel, loadWikiSummary, and visibleField's own crop, since
  bodies get the identical focus treatment). Cost if wrong: a moderate, well-scoped addition
  that repeats existing patterns.
Task 6: fix round 1/5 implemented (commit 1641794) — SkyTarget gained a body variant,
  targetAt's new `bodies` param was appended AFTER `slop` so every existing call site keeps
  its meaning, visibleField gained a body list reusing the same proj/onPage focus crop, and
  the card renders from round 1's existing cardFacts/bodyLabel/phaseLine. Body resolution
  mirrors space.yaml's own skyBodies/DEFAULT_SHOW/take() precedence including group-word
  expansion. Five new tests, including one that fails under the pre-fix signature, a
  focus-crop case, and the Moon's phase line specifically. Scoped re-review dispatched with
  three questions: does the new param position really preserve old callers, does the
  expansion keep every group member (this round has been bitten twice by a bodies[0] that
  dropped the rest), and would the new tests fail if the fix were reverted.
Task 7: dispatched in parallel over BASE 1641794 — four more bundled examples, carrying
  Hans's 2026-09-07 STYLE.md rule that an example starts from a question rather than an
  errand, and the round's open note that no shipped example displays the constellation
  figures at all.
Task 6: fix round 1/5 (1 addressed, 0 open; commits ed7b098..1641794, re-review clean).
  Re-reviewer grepped every targetAt call site to confirm the new param really is appended
  after slop and every old call still means what it meant; compared the body resolution
  line-for-line against space.yaml:826-886 and confirmed the group-word expansion iterates
  the FULL array rather than [0] — the defect that bit this project twice; and confirmed the
  new tests fail under the pre-fix signature analytically (the fifth argument would be
  dropped and the assertion returns null) rather than being tautological. The Moon test
  asserts real phase content by regex, not merely that a card exists.
Task 6: complete (commits 796c934..1641794, review clean after one fix round).
Task 7: implemented (commit 79727a6, 5438 tests, examples guard 1573/1573), review dispatched
  over 1641794..79727a6. It found and fixed THREE real defects in the brief's own draft
  before committing: a staging bug (a beat narrating stars not yet drawn), and two FACTUAL
  errors about the sky — Ursa Major's figure is 20 stars, the whole bear, not the seven-star
  Dipper the draft described, and Orion is NOT up all night in December at Oslo but sets two
  to five hours before dawn. Both would have shipped as lessons teaching something false.
  Reviewer asked to verify all three independently against the committed data and the engine.
Task 8: dispatched in parallel over BASE 79727a6 — README, ROADMAP, smoke checklist, ledger.
  Told explicitly NOT to merge or push; the merge decision is mine after the whole-branch
  review. Handed it the round's seven lessons to record honestly, including that nobody
  looked at a rendered pixel for two rounds.
Task 7: review Needs fixes — one CRITICAL and one Important. It independently confirmed all
  three of the implementer's defect catches (the staging bug against the template's own
  `singled` logic, UMa's 20 stars against constellations.json, Orion setting 2-5 h before
  dawn by its own engine sweep), and judged three of the four examples clean.
Task 7: Ruling I (I VERIFIED THE CRITICAL MYSELF — it stands): the replacement claim in the
  Ursa Major example is ITSELF false. I ranked all 20 UMa stars from the app's own stars.json:
  the seven brightest are Alioth 1,76, Dubhe 1,81, Alkaid 1,85, Mizar 2,23, Merak 2,34,
  Phecda 2,41 and HIP 54539 at 3,00 — a LEG star at RA 167,4 Dec 44,5, not a Plough star.
  Megrez (HIP 59774, 3,32) is only ELEVENTH. So "the Plough is just the seven brightest of
  the twenty" does not hold: the Plough is defined by shape, not by brightness rank. The
  sentence was written to replace a false claim and is false in a new way, in the one example
  built to fix a previous error. Fix round told to drop the ranking framing entirely and to
  verify whatever replaces it against stars.json before committing — this is the second false
  claim in this example and must not become a third.
Task 7: Important — beat 1 of the winter-stars example says "Nine in the evening" for
  21:00:00Z while the same beat draws place_label, which renders local SOLAR time by this
  template's own design, so the caption reads 21:43. The file's existing sky example says
  "quarter to nine" for a computed 20:43, so matching words to the rendered caption is house
  practice. Fix either by rewording or by moving the pinned time to 20:17Z — and if the time
  moves, every other claim in that example must be re-verified at the new moment.
Task 8: complete (commits f99ecc9 + ce94966 — README's sky_map section, ROADMAP entry, smoke
  checklist). Did NOT merge or push, as instructed. It corrected two of the plan's PREDICTED
  numbers against what actually shipped (741 edges not 735, six decimal places of
  astronomy-engine agreement not four) and found "Rounds ahead" stale, still calling the ⊕
  Sky section future work after Task 6 shipped it. Noted for later: pack-defaults.test.ts's
  explanatory comment is one template stale (79 templates/258 427 chars against the real
  80/267 329, sky_map third-largest at 8 880, well under the 16 000 ceiling) — out of its
  file list, so recorded rather than fixed.
Task 7: fix round 1 implemented (commit ca0f0bb). Combined re-review dispatched over
  79727a6..ca0f0bb covering both the fix and Task 8's docs, with the reviewer told that
  verifying the REPLACEMENT sentence against stars.json is the single most important thing
  in the review — this must not become a third false claim in one example.
ALL EIGHT TASKS IMPLEMENTED.
Task 7: fix round 1 reported DONE — the implementer re-ranked all 20 Ursa Major stars from
  stars.json ITSELF, confirmed Megrez is 11th not 7th, and replaced the false claim with a
  verified one (Megrez at 3,32 is markedly fainter than the other six Dipper stars at <= 2,41,
  which is why the bowl looks lopsided) given its own beat. It read eng.localClock's source
  directly, confirmed the +43-minute solar offset, and reworded "Nine" to "A quarter to ten"
  rather than move the pinned time, so no other claim in that example needed re-verifying.
  Both minors also taken.
Task 7: CARRY TO THE FINAL REVIEW — the implementer reports an intermittent flake in a
  200-moment sweep test: one failure in four full runs, unreproducible on immediate rerun and
  in isolation, and untouched by its data-only diff. In a round whose entire discipline was
  that a sweep must prove something, a sweep that fails one run in four is worth the final
  reviewer's attention, whether it is a real nondeterminism or test-runner load.
Task 7: fix round 1 (2 addressed + 2 minors, 0 open; commits 79727a6..ca0f0bb, re-review
  clean). The re-reviewer independently re-derived BOTH new claims from stars.json and
  constellations.json: Megrez at 3,32 is ~0,9 mag fainter than the next-faintest Dipper star,
  and the topology check shows Megrez is the ONLY vertex shared between the bowl's 4-cycle and
  the tail's 3-edge chain, so "der ryggen møter halen" is exactly right, not approximate. The
  13 leg stars attach only to Dubhe, Merak and Phecda, so "the seven are only the back and the
  tail" is precisely true of this 20-star figure. No third false claim.
Task 7: complete. Task 8: complete. The re-review called the documentation "unusually well
  fact-checked" — it verified 88 constellations, 741 edges, the faintest line star, the
  Cassiopeia magnitudes, the licence files and all five example titles against source.
Task 8: one gap the re-review found — layoutSpec().issues vs .warnings was the round's own
  hardest lesson and was NOT in the README. I added it myself as commit 967314d, since it is
  one line of documentation stating a fact the reviewer had just verified.
FINAL WHOLE-BRANCH REVIEW dispatched over 6d78551..967314d (20 commits), carrying four items
  for triage: the intermittent sweep flake (one failure in four runs), the stale
  pack-defaults comment, the README calling local MEAN time "solar", and round 1's standing
  known limits.
FINAL WHOLE-BRANCH REVIEW: Needs fixes first. No Critical. It verified the code-split
  boundary in the SHIPPED ARTEFACT by enumerating static imports across all 72 chunks, and
  re-derived every headline data number from the committed tables rather than the doc (1040
  stars, 88 figures, 741 edges, all 756 line stars present, faintest 5,89, exactly one
  duplicate proper name). It confirmed Ruling G a fourth time from canvas.ts.
  TWO Important:
  (1) space.yaml:1096 — the caption drops clauses FROM THE END when too wide, but positions
      2-4 are exactly the clauses that keep the pack's contract that a named thing is SAID
      rather than silently missing. Measured: show:["all"] in daylight leaves only "The Sun
      is up" and drops every named body below the horizon; twelve unknown names leaves
      sky_note UNDRAWN — twelve typos, no complaint; and it is width-dependent, so the
      promise holds intermittently. This is almost exactly the failure the README says this
      round FIXED, re-introduced by the width policy. No sweep can see it, because writing
      less is lint-clean.
  (2) sky-model.ts's visibleField/focusTransform re-derive the template's own pad, zoom
      clamp, centre and star rules, and every test uses synthetic tables — change pad in the
      YAML and every click on a focused chart lands on the wrong star with a green suite.
  Carried items triaged: the sweep flake is runner load, not nondeterminism (slowest row
  2,46 s against a 30 s budget; no clock read, no unordered iteration, vitest isolates per
  file) — can stand; the stale pack-defaults comment can stand; the "solar" vs mean time
  wording should be fixed where the AUTHORING MODEL reads it (space.yaml:715).
  MERGE CONDITION THAT IS PROCESS, NOT CODE: the smoke checklist is written and has never
  been run, sky-explore.ts is 281 lines of DOM glue with zero automated coverage by house
  convention, and round 1's single field bug report from Hans was exactly that class.
ONE fix wave dispatched over 967314d.
FINAL FIX WAVE implemented (commits 7957dce + 4175588, 5453 tests, tsc clean). The caption
  now shortens the LISTS instead of dropping the clauses, and a shared frozen SKY_DEFAULTS on
  sky-rules.ts collapses six constants that were duplicated between the tray and the template
  (including the focus centre, which had been hard-coded in three places). A tie-together
  test now lays out a real focused chart and asserts visibleField's star points match the
  template's own anchors, so changing pad in the YAML can no longer leave the tray clicking
  the wrong star with a green suite.
  The implementer CORRECTED the whole-branch reviewer's own framing: its case A was not the
  defect, because at 10:00Z all seven planets are above the horizon and there was nothing to
  drop but the symbols clause; the reproducing case is the same params at 02:00Z. Verbatim
  after: "The Sun is up · Below the horizon: Mercury, Venus, Jupiter"; the focus case gains
  "Outside view:" with all eight names; twelve unknowns went from NO CAPTION AT ALL to
  "Unknown: …+3".
  Disclosed remaining gap for my decision: a MARKED STAR below the horizon is still silently
  missing — same family, but a missing clause rather than a dropped one. Sent to the final
  re-review with the specific question of whether space.yaml's param text or the README
  currently promise something the code does not do for a marked star, since the standing rule
  this round is that the manifest must not tell the authoring model something the code will
  not honour.
FINAL FIX WAVE re-review: Not ready, two small things. It verified everything else by doing
  rather than reading: reproduced all five caption cases VERBATIM including widths, and
  reconstructed the OLD pop policy by re-registering a copy of space.yaml with the width
  lifted, to verify the BEFORE strings character for character; ran the tie-together test
  itself (23 anchors, max distance 0,0) and measured that a perturbed pad gives 45,58 units
  of drift, so the 1-unit bar is genuinely sensitive; and it RAN THE BUILD SCRIPT'S GUARD
  OFFLINE and watched it fire, then confirmed the unpinned run reproduces the committed data
  byte for byte. It also verified the implementer's correction of the reviewer's case A by
  measuring all eight altitudes directly.
Ruling J: FIX the marked star, do not record it. The re-review found the gap broader than
  reported — mark:["Altair"] with NO focus at all draws nothing and says nothing, because
  space.yaml:1033's alt<0 continue sits ahead of every sayBelow. A marked CONSTELLATION below
  the horizon is said and a named BODY is said; a marked STAR is the only named thing that
  goes silent, which is the exact asymmetry this round set out to remove. Three manifest lines
  over-promise, one squarely: :778 says the caption carries "anything named that has set".
  And there is no net elsewhere — a click question whose answer names a missing element loses
  its box silently. Two lines at :1033. Cost if wrong: a caption clause for a case that was
  previously silent.
Ruling K: KEEP rung 2, FIX its argument. The re-review measured the counterfactual string at
  879,84 against a 880 limit — it fits — so the claim that without the rung A' "cannot name a
  single planet" is false; the truth is three names rather than one name and a count. The rung
  earns its place, but in a round that twice caught evidence proving nothing, a rung argued
  for on a measurement that does not hold is the wrong thing to leave in the record.
FINAL FIX WAVE round 2 (commit a988cd1): both taken. The marked-star gap is FIXED, not
  recorded — mark:["Altair"] with no focus went from nothing drawn and nothing said to
  "…· Below the horizon: Altair", and case B's caption gained its ninth named thing. Two of
  the three manifest lines were tightened; :778 is now true as written. Rung 2's argument
  corrected in both the README and the report with the real numbers (the implementer was
  wrong by 0,16 units).
I VERIFIED THE LAST CODE CHANGE MYSELF, since no review had seen it: all five caption cases
  now name what they hide — marked star below the horizon, highlighted star, twelve unknown
  names, planets below at 02:00Z, and a plain default chart. 5454 tests, tsc clean, build
  clean.
MERGE: origin/main had moved to 143500a — another session landed a whole TEMPLATE-ON-DEMAND
  round (a Haiku template router, a two-level catalog as the default regime, authoring a
  template when none fits, an effort setting, a cost estimate, a "Find the part" drill, and
  EXPLORE SECTIONS DECLARED ON THE MANIFEST), 65 files and ~5 600 insertions. Three
  conflicts: package.json, examples.json and tray.ts. Dispatched a resolver told that both
  rounds' features must survive, that tray.ts is the one to think hardest about because their
  manifest-declared explore sections may be a general mechanism ours should ADOPT rather than
  sit beside, and that pack-defaults.test.ts auto-merged while BOTH rounds changed the
  catalog guard — mine replaced an expired absolute ceiling with a max-over-templates bound,
  theirs introduced a two-level catalog that may change what the catalog even is.
