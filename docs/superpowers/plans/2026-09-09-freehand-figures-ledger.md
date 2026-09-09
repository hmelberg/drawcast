# Ledger — freehand figures (2026-09-09)

Plan: `docs/superpowers/plans/2026-09-09-freehand-figures.md`.
Design (the authority the plan argues from):
`docs/superpowers/specs/2026-09-09-freehand-figures-design.md`, agreed
after Hans's question: when nothing in the template library fits, what
does drawcast draw? Branch: worktree `.claude/worktrees/freehand`, branch
`freehand`, base `6bead90` (main). Motion round 3 (ghosts, angle, measure,
ellipse, line) ran in parallel on worktree `template-spike`; it landed on
main as `4a04eb2` and was merged into this branch, with no conflicts, as
`92af752`. Smoke checklist: `2026-09-09-freehand-figures-smoke.md`.

Fifteen tasks (several split into an A half runnable before the round-3
merge and a B half wired after it), each implemented by a fresh subagent
and gated by a task review with a fix loop. Every review verdict and every
ruling is recorded here in short form; the full per-task record (briefs,
reports, review packages) lived in the git-ignored `.superpowers/sdd/`
workspace during the round — `.superpowers/sdd/2026-09-09-freehand-figures/progress.md`
is the authoritative log this ledger is built from.

## Coordination ruling (pre-flight)

Hans's ruling (2026-09-09): run the conflict-free subset first — Task 1;
Task 7 steps 1–4 (image resolver, resolve.ts deps only, no render/index.ts
wiring); Task 12 steps 1–3 + resolver/codec/licence table (no
tier2/model.ts/index.ts); Task 13 router.ts + seed.ts + tests (no
compile.ts/main.ts wiring); Task 14 visual.ts + its unit test only; Task 15
eval script only. Everything touching types.ts/schema.ts/tier2.ts/plan.ts/
layout.ts/render/index.ts/compile.ts/main.ts/prompt/examples waited for
round 3 to merge, then `git merge main`. The merge landed at `92af752`
(316 files, 6238 tests green, tsc clean, no conflicts), unblocking Tasks 2,
3, 4, 5, 6, 7b, 8, 12b, 10, 11, 15 (steps 2–6) in that order.

## Per task

| Task | Commits | Review outcome |
|---|---|---|
| 1 — anchors/boxes/fit/Catmull-Rom/simplify layout helpers | 6bead90..dd2f2bd | Clean. Minor (deferred): duplicated Catmull-Rom coefficient expression. |
| 7a — image resolver, credits, player credits slot | dd2f2bd..478ab45 | 1 Important (document-guard fabricating photo data) + a spec nit; fix round 1 (2 addressed, 0 open) → clean. Part B deferred to after the merge. |
| 12a — icon resolver, SVG arcs, licence table, codec | 478ab45..a02561e | 1 Important (arc flags glued to the next number mis-parsed → silent wrong geometry); fix round 1 (tokenizer rewritten to a lazy scanner, 2 addressed, 0 open) → clean. Part B deferred. |
| 13a — router `subject`, `seed.ts` | a02561e..3035879 | Approved with 1 Important plan-mandated (≤40-point cap not guaranteed); fix round 1 (deterministic even-index decimation to 40, 1 addressed, 0 open) → clean. Part B deferred. |
| 14a — `visual.ts`, `snapshot.ts`, store field | 3035879..66365e0 + 06480e6 | Pre-review fix (SETTINGS_TABS listing removed). Review Approved with 1 Important plan-mandated (`snapshotPng` skips `hd.destroy()` on early exit); fix round 1 (try/finally around destroy, 1 addressed, 0 open) → clean. Part B deferred. |
| 15a — eval script only | 66365e0..da0ac1a + d424b2b, then + fbcfc58 | Review found 3 Important (pedagogy round recorded a rejected candidate's lint — a compile.ts bug; `--limit` broke the ≥3 threshold; no per-case try/catch); fix round 1 (4 addressed, 0 open) → clean. A later fix round 2 (the eval script eagerly loaded `/src/render/icon.ts`, absent on `main`, killing the baseline run before any API call) added lazy seed imports + a boot check on both checkouts (commit `fbcfc58`, 1 addressed, 0 open). Steps 2–6 deferred to the end of the plan. |
| 9 — on-demand trigger (`main.ts` + `multi.ts`) | d424b2b..fa614c9 | Implemented, then a pre-review fix (cross-lecture reuse must survive the shared-brief gate). Review Approved with 1 Important plan-mandated (an authored part's brief described twice) — parked for the final fix wave. Minor (deferred): `buildPartRequest` computed twice; a stale status tooltip. |
| 13b — compile.ts/main.ts seed wiring | fa614c9..aa78d9a | Clean. Task 13 fully delivered (A+B). Minor (deferred): missing delimiter comments; an unused `signal` param dropped. |
| 14b — compile.ts visual round + main/store wiring | aa78d9a..4071454 | Clean. Task 14 fully delivered (A+B). Minor (deferred): `phaseText` has no "visual" case; the visual round lacks the pedagogy pass's `!forcedMismatch` gate. |
| **— merge —** | main 4a04eb2 → `92af752` | Automatic, no conflicts; 316 files / 6238 tests green, tsc clean. |
| 2 — types/schema/validation on the merged base | 92af752..7d69dd4 | Clean (schema +3,649 of a 5,500-char budget). Minor (deferred): a `point` may carry `side`/`gap`/`offset` in `at`, silently ignored. |
| 3 — relative placement (`at`) | 7d69dd4..50a1780 | 2 Important (own box null → `at` silently discarded; ref-without-box left an element at the origin with the wrong warning; pieces parent unusable as ref) + minors; fix round 1 (4 addressed, 0 open) → clean. Minor (deferred): ctx.panes/windows and a measure's PointSource.pt don't travel with a shift; an accidental cycle in a test fixture. |
| 4 — `group` | 50a1780..1a62ce7 | Implemented, then a pre-review fix (shared to-delta; a label is a legal group member). Review found 3 Important (group of pieces has no box; flip on a group tears; annotation member falsely unknown); fix round 1 (4 addressed, 0 open) → clean. Minor (deferred): one-member groups take the per-element path; prefix-collision membership. |
| 5 — `path.smooth` + fill | 1a62ce7..74af1af | Clean. Minor (deferred): no bundled example exercises a closed+fill path yet (Task 11 was asked to add one). |
| 6 — `math` element | 74af1af..fe3169b | Approved with 2 Important (unguarded engine load throws instead of warning; no test pins `MATH_X_HEIGHT`); fix round 1 (render guard, scale pinned, math position requirement, 3 addressed, 0 open) → clean. |
| 7b — image layout case + render wiring (incl. `resolveIcons`) | fe3169b..dc6efae | Clean. Task 7 fully delivered (A+B). |
| 8 — `group.fit` | dc6efae..87190d3, then + 2781498 | Implemented, then a ruling (label/annotation members keep their own font size — intended). Review found 3 Important (overlap exemption misses derived ids; boundary rule ignores arrow/edge/measure endpoints; outside→inside placement order-dependent); fix round 1 (4 addressed, 0 open) → clean. Task 11 later surfaced a defect (a fitted group's label member kept its pre-fit anchor); fix round 2 (member `LabelRequest` anchors re-mapped, 1 addressed, 0 open) → clean after two fix rounds. |
| 12b — icon layout case | 87190d3..260d3ef | 1 Important (placement box was the ink extent, not a nominal size); fix round 1 (explicit `box?: BBox` on `GroupDrawable`, 1 addressed, 0 open) → clean. Task 12 fully delivered (A+B). |
| 10 — prompt (baseline measured on merged main 4a04eb2 before this task's edits: SYSTEM 216,427 / SCHEMA 100,767 / prompt-md 47,892 chars) | 260d3ef..3b0bafc | Clean. Non-code system 207,538 < baseline; schema 104,416; prompt-md 35,362; freehand section 3,145 chars (11 lines). Minor (deferred, final-fix-wave candidates): a hedging point; a `#code` tag that doesn't exist; missing Norwegian code triggers; a blank line at `{{CODE}}`; no signpost to the Freehand section. |
| 11 — exemplars/examples/STYLE/rubric (opus) | 3b0bafc..f808029, fix round 1 → 2beba34 | Review found 1 Important (lock example: key cuts didn't align with the pins after the move; key outside the fitted group; blunt end leads) + minors; fix round 1 (lock rebuilt, Δ 0.00 verified numerically; Norwegian folds; STYLE note; commit `2beba34`) — **re-review pending** at the time this ledger was written (Task 15c-2, the example-promotion step, waits on it). Minor (deferred): a brief-forced label→text conversion; Eiffel's two absolute legs need a note (`at` cannot mirror). |
| 15b — smoke checklist + ROADMAP + NOTES | 2781498..cd3b6dc + 5a3f3c4 | 1 Important (checklist §6 pointed at a nonexistent Settings control, wrong label, inert toggle for single figures); fix round 1 (§6 rewritten, commit `5a3f3c4`, 1 addressed, 0 open) → clean. Surfaced a new defect (the "seeded from `<set>`" status suffix is overwritten by the freehand template-offer message; `logOutcome` doesn't persist `seeded`) — parked for the final fix wave. |
| 15c-1 — this document: eval tables, ROADMAP §7.4 rewrite, eval script error labels + `--baseline-median` | dispatched at BASE `5a3f3c4`/`2beba34` | In progress (this ledger). 15c-2 (example promotion, full build/sweep) waits for the Task 11 re-review. |

## Rulings

- Ruling: task-brief script may cut code lines at quote characters (known trap) — verified Task 1 brief intact (181 lines, code present).
- Task 13a: review Approved with 1 Important plan-mandated (≤40-point cap not guaranteed by the epsilon loop). Ruling: spec §3.6 (10–40 points) is binding — fix now with a deterministic even-index decimation to 40 after the loop; cost if wrong: none beyond a few lines. Fix round 1 dispatched.
- Task 14a (visual.ts, snapshot.ts, store field; Part B deferred): implemented 68e88c1. Ruling: SETTINGS_TABS listing of visualRepair removed until Part B adds its main.ts block (a listed setting without a block throws on opening Settings) — cost if wrong: none, Part B re-adds one line. Pre-review fix dispatched.
- Task 14a: review Approved with 1 Important plan-mandated (snapshotPng skips hd.destroy() when svg is missing or paintFrame throws — inherited from the brief's code). Ruling: fix now with try/finally around destroy; cost if wrong: none. Fix round 1 queued behind Task 15a's implementer (same worktree, avoid concurrent commits).
- Task 15a: review found 3 Important (pedagogy round records the candidate's lint even when rejected — a compile.ts bug the eval would inherit; --limit breaks the ≥3 threshold; no per-case try/catch). Ruling: compile.ts, main.ts, store.ts and multi.ts are NOT in round 3's diff (re-checked: its 30 files are layout/tier2/lint/plan/player/svg-backend/index/schema/types/prompt/tests), so the compile.ts lint-recording bug is fixed at the source now, and Tasks 9, 13b and 14b (compile/main/multi/store wiring) join the conflict-free set after 15a closes. Cost if wrong: a merge conflict in main.ts/compile.ts that git can resolve by hand. Fix round 1 dispatched.
- Task 9: review Approved; 1 Important plan-mandated (the authored part's brief is described twice: once for the sharing decision, once inside authorOnDemand). Ruling: parked for the final fix wave — add `brief?: TemplateBrief` to OnDemandConfig and skip describeTemplateFor when given; cost of waiting: one extra Sonnet brief call (~1.5k tokens) per course authoring, which happens at most cap (3) times per run.
- Task 4: review found 3 Important (group of pieces has no box; flip on a group tears; annotation member falsely unknown). Ruling: flip on a group uses one axis through the union-box centre (same pre-step box as pivot/to) — cost if wrong: a planner tweak. Fix round 1 dispatched.
- Task 8: Ruling: a label/annotation member of a fitted group is placed after tier-2 beside the scaled anchors and keeps its own font size — intended (readability), not a defect. Cost if wrong: labels visually out of proportion on very small fits (the font-too-small warn still fires for text members).
- Task 8: review found 3 Important (overlap exemption misses derived ids; boundary rule ignores arrow/edge/measure endpoints; outside→inside placement order-dependent). Ruling: outside elements that depend on a fitted member get the GROUP as a dependency edge (deterministic order) rather than an error — cost if wrong: an extra edge in placementOrder. Fix round 1 dispatched (nothing-to-fit warn folded in).
- Task 12b: review found 1 Important (placement box = ink extent, not size). Ruling: explicit `box?: BBox` on GroupDrawable honoured by unionBBoxForId (nominal slot), transformed by shift/scale — not shapeHint (renderer reads it). Cost if wrong: one model.ts field. Fix round 1 dispatched (in parallel with Task 10's implementer — disjoint files).
- Ruling: (b) is handled in the prompt, not by raising the token cap (cost) — "a figure is at most ~30 elements and ~15 beats; if the thing has more parts, name the six that matter".
- Ruling (Hans, on cost): full eval plan — baseline + after (seed off) + after (seed on), 12 cases each; the after-runs wait for Task 11 (few-shots are part of the system prompt).
- Ruling (Hans, re-confirmed with measured cost ≈ $0.9/case, ~220 s/case): full eval plan stands — three runs × 12 cases ≈ $33.
- Ruling (Hans asked 2026-09-09 late): eval output feeds the examples — Task 15 gains a step: read the 24 after-run specs, promote up to 3 that use the new elements well and read as explanations into src/examples.json after hand-fixing them to pass the examples gate; ledger the source run and every edit; Hans may strike them in the smoke test. Cost if wrong: three examples removed.

## Deferred

- Task 1: minor (deferred): smooth.ts duplicates the Catmull-Rom coefficient expression between catmullRom and catmullRomClosed (pre-existing in kit.ts; a shared catmullPoint helper would remove ~10 lines).
- Task 7a: minor (deferred): share.ts recomputes exportSequence twice per export site to keep two literal-text-pinned tests intact (tests/caption-burn-defaults.test.ts, tests/share-youtube.test.ts) — loosen those assertions later.
- Task 7a: minor (deferred): tests/render-resolve.test.ts has no case for the omitted-resolveImages path (safe by optional chaining; Part B wiring will cover it).
- Task 12a: minor (deferred): iconCacheKey treats any truthy strokes as resolved even when undecodable — document or re-resolve from `of`.
- Task 12a: minor (deferred): tests/mathjax.test.ts lost its "arcs are rejected" canary; confirm MathJax glyph data never emits arcs, or restore a narrower canary.
- Task 13a: minor (deferred): seedBlock with empty rings emits a group with members: [] — untested; Part B's fetchSeed returns null when no rings, so unreachable in practice.
- Task 14a: minor (deferred): store.ts visualRepair doc comment terse about why it is unlisted.
- Task 15a: fix round 1/5 (4 addressed, 0 open; commit d424b2b). Re-reviewer note: two of the three new generate-loop assertions do not discriminate old vs new code for their fixture (the WORSE_CANDIDATE one does) — minor (deferred): make the template-switch/invalid fixtures carry a non-clean base lint.
- Task 9: review Approved; 1 Important plan-mandated (the authored part's brief is described twice: once for the sharing decision, once inside authorOnDemand). Ruling: parked for the final fix wave — add `brief?: TemplateBrief` to OnDemandConfig and skip describeTemplateFor when given; cost of waiting: one extra Sonnet brief call (~1.5k tokens) per course authoring, which happens at most cap (3) times per run.
- Task 9: minor (deferred): buildPartRequest computed twice per authored part; status tooltip "Templates on demand (≤N per run)" at main.ts:1153 not reworded to course runs.
- Task 9: complete (commits d424b2b..fa614c9, 1 parked)
- Task 13b: minor (deferred): the credit-attach call sites lack the "---- icon seed ----" delimiters the report claims; main.ts fetchSeed drops the unused signal param.
- Task 14b: minor (deferred): main.ts phaseText has no "visual" case (shows "repair N" during the visual round); the visual round lacks the pedagogy pass's !forcedMismatch gate.
- Task 2: minor (deferred): a point may carry side/gap/offset in `at` (schema does not restrict them by type; point's guard checks only ref/anchor) — they are silently ignored.
- Task 3: minor (deferred): ctx.panes/windows and a measure's stored PointSource.pt do not travel with a shift (code/measure + at.ref); unknown at.anchor silently → centre, side+anchor together → side wins, no lint; placementOrder keys by id (duplicates rejected by schema anyway).
- Task 3: minor (deferred): the "no box at all" test builds an accidental cycle (group members ↔ at.ref) — rewrite the fixture so the group does not list the element it is referenced by.
- Task 4: minor (deferred): one-member groups take the per-element path (equivalent, implicit); standsFor double-looks-up expansion; membership by `startsWith(id_)` accepts prefix collisions.
- Task 4: minor (deferred): planner-side groupCentre/currentBox has no pieces-parent fallback (a group holding a pieces figure targeted by move/flip relies on bboxOf for the parent id) — check in Task 8/final review.
- Task 5: minor (deferred): no bundled example has a closed+fill path, so the corpus gate says nothing about that routing — Task 11's new examples should include one.
- Task 6: minor (deferred): `(err as Error).message` on non-Error throws; mathlogic.yaml lacks a back-reference to math.ts; engine-render.ts:27 ensureEnginesForTemplate now redundant; math with no ink/bad TeX registers no anchors (noisy "no box" for dependents).
- Task 7b: minor (deferred): imageDrawable mirrors portraitDrawable's structure (acceptable; revisit if a third captioned-photo element appears); a caption wider than the photo widens the placement box.
- Task 8: minor (deferred): strokeWidth unscaled vs fontSize scaled; scaleDrawables ≈ shiftDrawables with scale=1 except `clip` (collapse them; also fixes an at-shifted code pane's clip); one font-too-small warn per text drawable (could be one per group).
- Task 8: minor (deferred): a hasLine measure's `label_<id>` is not resolved by ownsId (not excused inside a fit group) — asymmetric with the line-less case.
- Task 12b: minor (deferred): box+nine-anchors boilerplate repeated in icon/image/group cases (a setBoxAnchors helper).
- Task 12b: minor (deferred): scaleDrawables' box handling has no direct unit test (only reachable via an icon inside a fit group).
- Task 11: minor (deferred): label placement inside a large stroked box grazes (NEAR_RINGS=2); prompt budget headroom 407 chars; `at` cannot express a mirror (Eiffel legs absolute).
- Task 11: minor (deferred): client–server few-shot converted two working labels into at-placed text (brief-forced); Eiffel's two absolute legs need a ledger note (at cannot mirror); new JSON entries fully expanded vs compact existing ones; sweep:round is vacuous for freehand examples (examples.test.ts is the real gate).

## Prompt and schema size

Baseline (measured on merged main `4a04eb2`, before this round's prompt/
schema edits — Task 10's controller-supplied numbers): `SYSTEM_CHARS`
216,427; `SCHEMA_CHARS` 100,767; `PROMPT_MD_CHARS` (compiler-v1.md source)
47,892.

After Task 10: non-code system 207,538 chars (< baseline, despite the new
elements — the `{{CODE}}` block became conditional on `wantsCode`); code
request 223,060 chars; schema 104,416 chars; prompt-md 35,362 chars; the
new `## Freehand figures` section itself is 3,145 chars (11 lines).

## Eval

Design §7.4's live eval: twelve requests with no template ready for them —
four "thing" (parts to name), four "math" (a formula beside its curve),
four "image" (a real photo) — run through the real compiler with a real
API key (`claude-opus-5`, effort high), scored against the element the
round added for that label (`thing` → `usesGroup`, `math` → `usesMath`,
`image` → `usesImage`). Three runs: baseline (against `main`, no relative
placement/groups/math/image at all), after (seed off), after (seed on).
Node warnings (`ExperimentalWarning`, `--trace-warnings`) stripped from the
logs below.

### Baseline (main 4a04eb2, seed off, 2026-09-09)

| # | label | request | template | rounds | ms | cost | at | group | fit | math | image | icon | error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | thing | How does a bicycle pump push air into a tyre? | none | — | 225,279 | $0.90 | · | · | · | · | · | · | cut off at 16k |
| 2 | thing | Hva er delene i en symaskin, og hva gjør de? | none | initial>pedagogy | 221,378 | $0.96 | · | · | · | · | · | · | |
| 3 | thing | What are the parts of a neuron and what does each do? | neuron | initial>schema-repair×2>pedagogy | 43,367 | $0.44 | · | · | · | · | · | · | |
| 4 | thing | Hvordan virker en dørlås? | none | — | 235,254 | $0.44 | · | · | · | · | · | · | cut off at 16k |
| 5 | math | Why does a dropped ball speed up? Show the equations with the curve. | none | initial>pedagogy | 100,666 | $0.74 | · | · | · | · | · | · | |
| 6 | math | Hvorfor blir renters rente så stor? Vis formelen ved kurven. | none | initial>pedagogy | 66,494 | $0.31 | · | · | · | · | · | · | |
| 7 | math | What does the logistic equation say, drawn next to its S-curve? | generic_axes_diagram | initial>schema-repair×2>pedagogy | 101,496 | $0.54 | · | · | · | · | · | · | |
| 8 | math | Vis formelen for arealet av en sirkel ved siden av sirkelen. | none | initial>pedagogy | 67,754 | $0.27 | · | · | · | · | · | · | |
| 9 | image | Why is the Eiffel Tower shaped like that? | none | initial>schema-repair>pedagogy | 190,416 | $0.51 | · | · | · | · | · | · | |
| 10 | image | Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen. | none | initial>pedagogy | 224,426 | $0.59 | ✓ | · | · | · | · | · | |
| 11 | image | What makes a violin sound the way it does? | violin_anatomy | initial>schema-repair×2>pedagogy | 90,759 | $0.55 | · | · | · | · | · | · | |
| 12 | image | Hvordan ser Stortinget ut, og hvorfor er det bygget slik? | none | initial>lint-repair>pedagogy | 221,389 | $0.57 | · | · | · | · | · | · | |

Summary: thing FAIL (0/4 usesGroup), math FAIL (0/4 usesMath), image FAIL
(0/4 usesImage). Lint errors 0/0/0; warnings thing 1, math 4, image 9.
Medians: thing 225,279 ms, math 100,666 ms, image 221,389 ms; overall
190,416 ms (≥ 90,000 required — FAIL). Total cost ≈ $6.82 (per-case
$0.27–$0.96). As expected: `main` has none of the round's elements, so
every label fails by construction; two cases route to an existing
template (neuron, violin_anatomy) and one to `generic_axes_diagram`.

### After, seed off (freehand @ f808029, 2026-09-09)

| # | label | request | template | rounds | ms | cost | at | group | fit | math | image | icon | error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | thing | How does a bicycle pump push air into a tyre? | none | initial>pedagogy | 51,378 | $1.09 | ✓ | ✓ | ✓ | ✓ | · | · | |
| 2 | thing | Hva er delene i en symaskin, og hva gjør de? | none | initial>pedagogy | 231,806 | $1.46 | ✓ | ✓ | ✓ | · | · | · | |
| 3 | thing | What are the parts of a neuron and what does each do? | neuron | initial>pedagogy | 30,942 | $0.19 | · | · | · | · | · | · | |
| 4 | thing | Hvordan virker en dørlås? | none | — | 246,545 | $0.44 | · | · | · | · | · | · | cut off at 16k |
| 5 | math | Why does a dropped ball speed up? Show the equations with the curve. | none | initial>lint-repair>pedagogy | 59,053 | $0.44 | ✓ | · | · | ✓ | · | · | |
| 6 | math | Hvorfor blir renters rente så stor? Vis formelen ved kurven. | none | initial>pedagogy | 68,127 | $0.29 | ✓ | · | · | ✓ | · | · | |
| 7 | math | What does the logistic equation say, drawn next to its S-curve? | none | initial>lint-repair>schema-repair>pedagogy | 86,318 | $0.36 | · | · | · | ✓ | · | · | |
| 8 | math | Vis formelen for arealet av en sirkel ved siden av sirkelen. | circle_sectors | initial>pedagogy | 50,033 | $0.23 | · | · | · | ✓ | · | · | |
| 9 | image | Why is the Eiffel Tower shaped like that? | none | initial>schema-repair>pedagogy | 162,261 | $0.44 | · | ✓ | ✓ | · | · | · | |
| 10 | image | Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen. | none | initial>pedagogy | 130,119 | $0.41 | · | · | · | · | ✓ | · | |
| 11 | image | What makes a violin sound the way it does? | violin_anatomy | initial>pedagogy | 68,924 | $0.29 | · | · | · | ✓ | · | · | |
| 12 | image | Hvordan ser Stortinget ut, og hvorfor er det bygget slik? | none | initial>pedagogy | 172,524 | $0.43 | ✓ | ✓ | ✓ | · | · | · | |

Summary: thing FAIL (2/4 usesGroup), math PASS (4/4 usesMath), image FAIL
(1/4 usesImage). Lint errors 0/0/0; warnings thing 0, math 1, image 1.
Medians: thing 231,806 ms, math 68,127 ms, image 162,261 ms; overall
86,318 ms (< 90,000 — ok, script printed "ok"). Total cost ≈ $6.07.
The script's log line prints "ok" for case 4 ("dørlås") even though its
outcome carries an `error` (cut off at the 16k output cap) — the eval
label bug fixed in this task.

### After, seed on (freehand @ f808029, 2026-09-09)

| # | label | request | template | rounds | ms | cost | at | group | fit | math | image | icon | error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | thing | How does a bicycle pump push air into a tyre? | none | initial>lint-repair>pedagogy | 105,171 | $0.97 | ✓ | ✓ | ✓ | ✓ | · | · | |
| 2 | thing | Hva er delene i en symaskin, og hva gjør de? | none | initial>pedagogy | 176,158 | $0.91 | ✓ | ✓ | ✓ | · | · | · | |
| 3 | thing | What are the parts of a neuron and what does each do? | neuron | initial>pedagogy | 28,461 | $0.19 | · | · | · | · | · | · | |
| 4 | thing | Hvordan virker en dørlås? | none | — (seeded) | 248,555 | $0.44 | · | · | · | · | · | · | cut off at 16k |
| 5 | math | Why does a dropped ball speed up? Show the equations with the curve. | none | initial>pedagogy | 41,578 | $0.22 | ✓ | · | · | ✓ | · | · | |
| 6 | math | Hvorfor blir renters rente så stor? Vis formelen ved kurven. | none | initial>pedagogy | 94,759 | $0.37 | ✓ | · | · | ✓ | · | · | |
| 7 | math | What does the logistic equation say, drawn next to its S-curve? | generic_axes_diagram | initial>pedagogy | 86,914 | $0.30 | · | · | · | ✓ | · | · | |
| 8 | math | Vis formelen for arealet av en sirkel ved siden av sirkelen. | none | initial>lint-repair>pedagogy | 102,443 | $0.37 | · | · | · | ✓ | · | · | |
| 9 | image | Why is the Eiffel Tower shaped like that? | none | initial>schema-repair>lint-repair>pedagogy (seeded) | 241,615 | $0.64 | · | ✓ | ✓ | · | · | · | |
| 10 | image | Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen. | none | initial>pedagogy | 119,659 | $0.38 | · | · | · | · | ✓ | · | |
| 11 | image | What makes a violin sound the way it does? | none | — | 22,584 | <$0.01 | · | · | · | · | · | · | terminated |
| 12 | image | Hvordan ser Stortinget ut, og hvorfor er det bygget slik? | none | — | 231,938 | $0.45 | · | · | · | · | · | · | cut off at 16k |

Summary: thing FAIL (2/4 usesGroup), math PASS (4/4 usesMath), image FAIL
(1/4 usesImage) — same hit pattern as seed off. Lint errors 0/0/0;
warnings thing 2, math 0, image 5. Medians: thing 176,158 ms, math 94,759
ms, image 231,938 ms; overall 105,171 ms (≥ 90,000 — FAIL). Total cost ≈
$5.23–5.3.

**Case 11, "terminated"**: `records.json` entry 11 shows `rounds: []`,
`seeded: false`, `cost: $0.0015` (13k cached tokens in, 38 out, 1 call) —
that one call is the router's (`routeTemplates`), which returned normally.
The main generation call (`callForJson` inside `generateSpec`'s
`while (true)` loop, `src/llm/compile.ts` ~line 426) then threw; the
loop's own `catch (err)` (compile.ts line 544) caught it and returned a
non-throwing outcome — `spec: null` (`best` was never set, no round had
validated yet), `rounds: []`, `error: describeApiError(err)` — which is
why the eval script's per-case try/catch never fired ("THREW" never
printed) and the summary line still says "ok". `describeApiError` (client.ts
line 388) checks, in order: `RefusalError`, `Anthropic.APIUserAbortError`
("Cancelled."), `AuthenticationError`, `RateLimitError`, `BadRequestError`,
`Anthropic.APIError`, then a `/fetch|network/i` test on `err.message`,
falling through to `err.message` verbatim. `"terminated"` matches none of
those — it is not an `Anthropic.APIError` subclass and its message has
neither "fetch" nor "network" in it — so it fell through to the bare
`err.message`. That message text is the signature of Node's built-in
fetch (undici) `TypeError: terminated`, raised when the underlying HTTP/2
or keep-alive socket for a streaming response closes before the stream
finishes — not an `AbortError` from `cfg.signal` (the eval script never
passes one to `generateSpec`, and that path prints "Cancelled." anyway).
It is a transient network-level stream termination on the long,
high-effort streaming call to the Anthropic API, surfaced unmodified by
the SDK and not retried. Not fixed here, per the task's instruction —
this is a report, not a repair; a retry-on-transient-network-error is a
candidate for the final fix wave.

### Comparison

| | baseline | seed off | seed on |
|---|---|---|---|
| thing (usesGroup) | 0/4 | 2/4 | 2/4 |
| math (usesMath) | 0/4 | 4/4 | 4/4 |
| image (usesImage) | 0/4 | 1/4 | 1/4 |
| lint warnings (total) | 14 | 2 | 7 |
| median ms | 190,416 | 86,318 | 105,171 |
| total cost | ≈ $6.82 | ≈ $6.07 | ≈ $5.3 |

Math goes 0/4 → 4/4 on both after-runs: every math request now gets a real
`math` element (two route to a template — `generic_axes_diagram`,
`circle_sectors` — which is correct behaviour, not a miss: the template
fits and the model uses it, exactly as the router is supposed to work).

Thing goes 0/4 → 2/4: one case routes to the existing `neuron` template
(again, correct routing — the request has a ready template); the other
miss is the same case in every one of the three runs — "Hvordan virker en
dørlås?" (how does a door lock work) — which hits the 16,000-token output
cap (thinking included) before the model finishes the spec, in baseline,
seed-off and seed-on alike. This is a size problem (a door lock's part
count and prose overrun the cap), not a missing-capability problem.

Image goes 0/4 → 1/4: the violin case routes to the existing
`violin_anatomy` template in both after-runs (correct routing again); the
Eiffel Tower and Stortinget cases both use `portrait` instead of `image`
for a building's real photo — `portrait` is documented for people, and the
model reaches for it anyway for a landmark. This is a prompt gap, not an
engine gap: the `image` element itself works (the beehive case uses it
cleanly in both runs).

Seed fired on only 2 of the 12 seed-on cases (subject "door lock" and
subject "none_fits" thing/none_fits path) — the dørlås case (still cut off
at 16k despite the seed) and the Eiffel case (which used `group`, not
`image`, so the seed's icon rode along unused). At n=2 there is no
measurable seed effect on hit rate; it neither helped nor hurt.

Total cost of the three runs ≈ $18.2, against the $33 estimated when Hans
approved the full plan. Timing medians moved 190 s (baseline) → 86 s (seed
off) / 105 s (seed on) — a large drop, but the two after-runs bracket the
90 s bar from both sides, so a single seed on/off toggle is not what
decided pass/fail on timing; run-to-run variance in model latency is.

## Verdict against spec §7.4

- **Math**: PASSES. 4/4 on both after-runs, well past the "≥ 3 of 4" bar,
  0 lint errors.
- **Thing**: FAILS the "≥ 3 of 4" bar (2/4 on both after-runs) — but for
  reasons that are a size limit (the door-lock case hits the output cap in
  every run) and correct template routing (the neuron case), not a defect
  in `group`/`at`/`fit` themselves. The one case that actually exercises
  freehand parts in full (the bicycle pump) does so cleanly on both runs.
- **Image**: FAILS the "≥ 3 of 4" bar (1/4 on both after-runs) — one
  correct template route (violin) and two prompt-wording misses
  (`portrait` reached for on a building instead of `image`), not an
  `image`-element defect; the one case that uses `image` (the beehive)
  does so cleanly.
- **Timing**: the "< 90,000 ms median" bar passed once (seed off, 86,318 ms)
  and failed once (seed on, 105,171 ms) — see the ROADMAP §7.4 rewrite for
  the ruling that replaces this absolute bar with a relative one (under the
  baseline's median), since 90 s sits below what effort-high production on
  `main` itself.

**What this means for the merge decision**: the round works exactly where
the model reaches for the new elements — every case that used `group`,
`math`, `at`, `fit`, or `image` did so with zero lint errors and produced
a plausible figure. The label failures are concentrated in two known,
narrow, prompt-fixable gaps (buildings reach for `portrait` instead of
`image`; a big "thing" overruns the 16k output cap) plus correct template
routing being counted against the freehand hit rate by the eval's own
design (a routed case can't also set `usesGroup`/`usesImage`). Two prompt
follow-ups — teach `image` vs `portrait`, and cap a freehand figure's size
— are queued for the final fix wave; they are not new engine work, and
nothing found here calls the elements themselves (`group`, `math`,
`image`, `fit`, `at`) into question. Hans's live smoke test (checklist
sections 1–5) remains the actual merge condition, as for every prior
round.

## Final review and fix wave

The whole-branch review (2026-09-10, at HEAD `8e15869`, 6411 tests green)
returned **"merge with fixes"**: no finding questioned the round's design
or its elements, and none of the fixes below touched the layout engine's
emit loop. One implementer took every "fix before merge" finding in one
dispatch, grouped into five commits by seam (A attribution/baking,
B prompt/status, C layout/lint, D tests, E docs) so the re-review can read
it seam by seam.

### A — attribution and baking (one seam)

| # | Finding | Done |
| --- | --- | --- |
| A1 | `creditsOf` read only `image`/`icon`, but the SEED credit is written on a `group` (`src/llm/seed.ts:69`, spec §3.7) — so it reached nothing | `src/export/credits.ts` collects a `credit` from every element type, order and dedupe unchanged |
| A2 | `embeddedPlaylist` resolved portraits and sources only: a published cast re-fetched Commons and Iconify in every viewer's browser, against §3.5/§3.6 | `EmbedDeps` gained `resolveImages`/`resolveIcons` (required); wired from `main.ts`'s new `embedDeps()` and `ui/course.ts` |
| A3 | `creditsOf(exportSequence(...))` read the UNRESOLVED document, so `<name>.credits.txt` was empty for every freshly generated figure and icon credits appeared nowhere in an exported video | both video paths in `ui/share.ts` resolve the sequence ONCE (through `embeddedPlaylist`, on a clone) and hand the same specs to `renderVideo` and to `creditsOf`; the second `exportSequence` computation is gone; the two literal-text pins were updated, not worked around |
| A4 | `blobField` hoisted `strokes` for portrait/source only, so 10–34 KB of base64 per bundled example rode into revise rounds and exemplar prompts | `src/llm/hoist.ts` returns `"strokes"` for `image` and `icon` too; a test asserts the beehive exemplar's prompt text contains no `data:image` |

### B — prompt and status

| # | Finding | Done |
| --- | --- | --- |
| B1 | `CODE_WORDS` had no Norwegian stems; `simulat\w*` missed `simuler`; the tag branch matched `code\|python\|r\|microdata\|c64`, none of which `src/llm/tags.ts` has ever defined | stems added (`kode`, `skript`, `program`, `beregn`, "regn ut"), `simul(at\|er)\w*`, and the dead tag branch DROPPED — `wantsCode(request)` now takes the request alone, and the two assertions that tested the fabricated tag are gone |
| B2 | The prompt never said which element a photo of a THING is, and nothing capped a figure's size (the door-lock case overran the 16k output cap in all three eval runs) | `compiler-v1.md` says "`portrait` is for people; a photo of a THING … is `image`" on BOTH the freehand image bullet and the portrait bullet, and caps a figure at "about 30 elements and 15 beats; … name the six that matter". Measured: a non-code system prompt is **216,280 chars** against the 216,427 budget (`tests/prompt-size.test.ts`). The Freehand section is 11 lines |
| B3 | Task 11 had rewritten the client–server few-shot's two notes as at-placed `text`, teaching the model the very anti-pattern the prompt names | reverted to `label` + `attach_to` + `side`; `tests/freehand-examples.test.ts`'s `at.ref` assertion retargeted at the bicycle-pump few-shot, where the freehand assembly rule belongs |
| B4 | The "· seeded from `<set>`" suffix was clobbered by the freehand template offer in the same tick, and `logOutcome` did not persist `seeded` | the suffix is built once and appended to BOTH the `setDoc` status and the `setStatusAction` offer; `LogEntry` (main.ts and `src/store.ts`) records `seeded`. `fetchSeed` does NOT forward the signal — `resolveIcons(spec, IconDeps, IconResolveOpts)` accepts none |
| B5 | `phaseText` had no `"visual"` case | reads "looking at the drawing" |

### C — layout and lint

| # | Finding | Done |
| --- | --- | --- |
| C1 | An unknown `at.anchor` silently became the reference's centre, and `side` + `anchor` together silently let `side` win | tier2's `at` block pushes a `placement` WARN for each, mirroring `render/plan.ts:493`'s "— using center" wording; two tests in `tests/placement-layout.test.ts` |
| C2 | Annotations resolved their target with `unionBBoxForId`, which cannot see a `group` (ink filed under its members' ids) or a line-less `measure` (draws only its number) — both were reported "unknown or empty target" and skipped | `src/layout/layout.ts` uses `boxOfId(drawables, target, measure, groups, pieceGroups)`; two tests in `tests/group-layout.test.ts` |
| C3 | `resolveImages`/`resolveIcons` were still optional in `RenderResolveDeps` with "not passed yet" comments, though the wiring had landed | both required, comments deleted, test fakes updated |

### D — tests that did not discriminate

| # | Finding | Done |
| --- | --- | --- |
| D1 | The template-switch and invalid-candidate pedagogy fixtures used a base spec that lints CLEAN, so `expect(lintIssues).toEqual([])` passed on the old bug too | both fixtures now start from a base with a slow-start WARN (two speaks before the first draw) and assert the recorded lint EQUALS that base lint. Verified by inverting the source: the test fails |
| D2 | No bundled example had a `closed` + `fill` `path`, so the examples gate never rendered `filledOutline` for a path | the Stortinget example's `stairs` (a closed trapezoid) carries a stone wash; a new assertion in `tests/freehand-examples.test.ts` keeps that coverage from being edited away |

### E — docs

- The smoke checklist gained **§8** (export «Vegg er voks», open
  `<name>.credits.txt`, expect the photo credit — an empty file is a
  failure of that step), the line for Hans about **#200 vs #225**, and the
  Part C table naming the three promoted examples with their source runs.
  Its §6 and §7 notes — the invisible seed suffix and the missing "visual"
  label — were rewritten: both are fixed now, and a checklist that still
  described them as gaps would send Hans looking for the wrong thing.
- `ROADMAP.md`'s follow-up list strikes what this wave fixed and gains
  `### Follow-ups the whole-branch review left (2026-09-10)`: the
  `startsWith` ownership heuristic → an emitted-slice map; a cross-lecture
  brief pool; `at` on a `group` as a validation error rather than silence;
  a heading and per-item context for the Credits panel; one automatic
  retry on `TypeError: terminated`; and the `scaleDrawables`/
  `shiftDrawables` collapse (already listed) specifically for `clip`.

Gates after the wave: `npm test` 6425 passing in 329 files, `npx tsc
--noEmit` clean, `npm run build` clean, examples gate at zero issues and
zero plan warnings. Hans's live smoke test remains the merge condition.
