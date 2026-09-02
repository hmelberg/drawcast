# SDD ledger — plan: docs/superpowers/plans/2026-09-02-code-data-bridge-m1.md

Spec: docs/superpowers/specs/2026-09-02-code-data-bridge-design.md (read; binding authority).
Start HEAD: 205d4466b59e (main).

Ruling: work directly on `main`, no worktree — Hans's task statement says "work on main, push when done" and "Do it" (explicit consent); every prior drawcast round ran on main — costs a messy history if a task has to be reverted (revert commits, no branch to drop).
Ruling: push to origin main at the end of the plan (Task 13) — pre-authorized by Hans ("push when done"); no other side effects outside the repo.

## Pre-flight scan

| Pair / task | Produces vs consumes | Found |
|---|---|---|
| T1 ↔ T6, T7, T8 | tokens.ts exports scanDataTokens/pathsByCodeId/substituteDataTokens/DATA_TOKEN_RE/MALFORMED_TOKEN_RE/isDataToken; consumers use the same names | consistent |
| T2 ↔ T3 | CodeRunRequest.paths, CodeRunResult.data/dataErrors; pyodide spreads both into the return | consistent |
| T2 ↔ T6, T8 | runCode({language, code, paths}); decodeCodeResult tolerates extra fields | consistent |
| T5 ↔ T6, T7 | show: "none" enum must exist before tests use codeEl({show:"none"}) — T5 precedes both | ordered |
| T6 ↔ T8 | both build a TokenLookup over envelopes; same error strings not required | consistent |
| T8 ↔ T10 | compile.ts calls packTemplateIds("data") (empty until the pack registers — strictness then falls to "tokens present") | acceptable; no cycle (llm→scenes/packs) |
| T9 ↔ T10, T11 | kit.plotArea(), COLORS.series, KIT_VERSION 5; templates declare kit: 5 | consistent |
| T10 ↔ T11 | same data.yaml (T11 appends a document); same test file (T11 extends two tests) | ordered, explicit |
| T10 ↔ T12 | example/fewshot params vs bar_chart schema (labels, values token via oneOf pattern, stage, ylim, value_labels, y_label, box, title) | consistent; token pattern matches "{dice.frames}" |
| T11 ↔ T12 | table example: title in params so draw:[title] resolves; font_size 24 in [12,30]; decimals 1 | consistent (fixed at plan review) |
| T7 ↔ T12 | translate-coverage: GDP example labels are typed (translatable); code lines/captions collected from layout | consistent |
| T8 self | strictness: tokens present OR data-pack template; NO_CODE_CHECK path → raw tokens pass the oneOf string branch | consistent |
| T10 self | Y helper (hi·1.08) matches the template's 8 % headroom when yMin = 0; value_labels precision "4.0" matches fmt | consistent |
| T4 self | withOverrides({}, {"values.0": 1}) → {values: {"0": 1}} per "never create arrays" | consistent |
| Global | no task touches render/plan.ts, player.ts, index.ts, svg-backend.ts, export/video.ts | clean |
| Rubric | bar_chart and data_table repeat the tiny num/str/clamp/box helpers — pack bodies are standalone `new Function` sources and cannot share code (every existing pack template repeats `num`) | Ruling: plan-mandated duplication stands — inherent to the pack format; cost if wrong: a few duplicated lines per template |

## Task log
Task 1: dispatched (implementer haiku, base 205d4466b59e)
Task 1: review (sonnet) — spec ❌ 1 Important (plan-mandated): substituteDataTokens throws when one array-element token resolves and a sibling fails (reverse-order loop deletes the array, then setAt writes through undefined). Ruling: the finding stands against the plan text — fix with two passes (all successful setAt first, then all deletions; order-independent) and add the mixed success/failure array test — cost if wrong: none beyond a slower substitution of a handful of tokens. Minor (deferred): the reverse-order comment is inaccurate (folded into the fix).
Task 1: fix round 1/5 (1 fixed pending re-review — two-pass substitution + mixed-array test; commits d1d2c13..18caddf)
Task 1: re-review round 1 — ADDRESSED; minor (deferred): substituteDataTokens calls lookup twice per token (success pass + failure pass) — cache the first result; call sites are pure reads so no bug today.
Task 1: complete (commits 205d446..18caddf, review clean after 1 fix round)
Task 2: dispatched (implementer haiku, base 18caddf38a95)
Task 2: review (sonnet) — spec ✅, approved. minor (deferred): codeCacheKey does not dedupe paths (upstream pathsByCodeId already does); minor (deferred): no test of dataErrors without data.
Task 2: complete (commits 18caddf..ba14722, review clean)
Ruling: Task 3 Step 6 (live browser smoke of the harvest) is deferred to Task 13's smoke pass, run by the controller with the browser tools once — subagents have no browser; cost if wrong: a Python harvest bug surfaces late (at Task 13), one extra fix commit.
Task 3: dispatched (implementer haiku, base ba147227479b)
Task 3: implementer DONE (f323efe); review dispatched (opus, Python desk-check)
Task 3: review (opus) — spec ✅, approved. minors (deferred, for the final fix wave): (1) pd.NA/pd.NaT stringify instead of null — add `v != v` sentinel check in __scalar (live smoke must probe); (2) KeyError str() adds quotes — raise ValueError; (3) `.replace(/,/g, ", ")` on the paths JSON literal is a test-shaped wart — build the list with join; (4) harvest placed after the figure harvests (benign, __g untouched) but report claimed exact compliance; (5) big arrays materialised before the cap — add a len() pre-check; (6) `(err as Error).message` on a non-Error throw → use String(err).
Task 3: complete (commits ba14722..f323efe, review clean)
Task 4: dispatched (implementer haiku, base f323efee076b)
Task 4: implementer DONE (2b1dc6a); review dispatched (sonnet)
Task 4: review (sonnet) — spec ✅, approved. minors (deferred): out-of-range write index grows the copied array with holes (untested, plan-mandated gap); spread copy densifies sparse arrays; report diffstat miscount.
Task 4: complete (commits f323efe..2b1dc6a, review clean)
Task 5: dispatched (implementer haiku, base 2b1dc6aaebd4)
Task 5: implementer DONE (e334072); review dispatched (sonnet)
Task 5: review (sonnet) — spec ✅, approved. minors (deferred): warnings test omits "split"; test imports added mid-file (plan quirk).
Task 5: complete (commits 2b1dc6a..e334072, review clean)
Task 6: dispatched (implementer sonnet, base e334072b44da)
Task 6: implementer DONE (ab0062e); review dispatched (opus)
Task 6: review (opus) — 2 Important: (1) plan-mandated: substituteDataTokens' `failures` are discarded, so a failed show:none script drops params with no warning (the layout only warns from stamped dataErrors, and a failed run stamps none). Ruling: stamp every resolver-side failure into the named element's envelope dataErrors (path → reason) before returning, so layout/code.ts warns in every mode — cost if wrong: a spurious extra warning line; (2) the stamped-reuse test exercises the skip rule, not covers() — restore the tokens before the second call and assert {id, ok:true} without skipped. minors (deferred): skip-table under-asserts running rows and lacks visible-pane+token rows; "not harvested" branch is a silent dead end (parseHarvest fallback); decorative type predicate on covers(); unused fakeRun/bridged flexibility; stale stamp on a skipped element can emit a phantom warning (low reachability under B11).
Task 6: fix round 1/5 (2 fixed pending re-review — failures stamped as dataErrors; genuine reuse test; commits ab0062e..585d7e8)
Task 6: re-review round 1 — both ADDRESSED; minor (deferred): the failure-stamping loop decodes/stringifies once per failure rather than once per element.
Task 6: complete (commits e334072..585d7e8, review clean after 1 fix round)
Task 7: dispatched (implementer sonnet, base 585d7e8f3963)
Task 7: implementer DONE (348b651); review dispatched (sonnet)
Task 7: review (sonnet) — spec ✅, approved. minors (deferred): unused-source warning text lacks the spec's phrase "data source unused" (plan-mandated wording); two traversals of params in semanticErrors.
Task 7: complete (commits 585d7e8..348b651, review clean)
Task 8: dispatched (implementer sonnet, base 348b6515c9d0)
Task 8: implementer DONE_WITH_CONCERNS (afb07c8): budget-timeout/abort path leaves check.resolvedParams undefined → strict validation runs on raw token strings (plan-mandated). Ruling: strict = (tokens present AND check.resolvedParams !== undefined) OR data-pack template; a timed-out check can only warn — cost if wrong: an off-schema token-fed spec slips through as a warning when the runtime is slow (render still degrades safely). Fix requested before review.
Task 8: pre-review fix applied (af262ec, paramsStrictness pure fn); review dispatched (opus) on the whole task range
Task 8: review (opus) — 2 Important: (1) plan-mandated: a runtimeUnavailable/throwing runner leaves its tokens unresolved ("not run") → the property is deleted → strict validation reports a missing required prop as a hard ERROR (contradicts "runtime-unavailable stays a warning"). Ruling: check.ts counts unresolved tokens (failures whose codeId produced no envelope) and exposes `unresolvedTokens`; compile.ts treats `substituted` as resolvedParams defined AND unresolvedTokens === 0 — cost if wrong: an off-schema token-fed spec passes as a warning when the runtime is down (render degrades safely). (2) ajv.compile on an invalid user-template schema throws out of generateSpec. Ruling: catch in templateParamErrors, return [] and cache the failure per template+schema (a broken user schema = no validation, like unknown/stub templates; schema validity belongs to validateTemplateDoc later) — cost if wrong: a broken user schema is validated silently by nobody. minors (deferred): lint rule "code-use" for template-param issues (add "template-params" to the closed union); redundant isPackTemplateId; ajv params suffix restates type errors; "runs with the referenced paths" test never asserts req.paths; cache-invalidation untested; scenes[templateId] with a prototype key ("constructor") throws — optional chaining.
Task 8: fix round 1/5 (2 fixed pending re-review — unresolvedTokens gate; ajv compile guarded; commits af262ec..8496aa6)
Task 8: re-review round 1 — both ADDRESSED; minor (deferred): paramsStrictness lets dataPack force strict even with unresolved tokens (harmless today: data templates have no `required` and accept the token string branch — revisit if a data template ever gains a required prop); report misnames the ajv error class.
Task 8: complete (commits 348b651..8496aa6, review clean after 1 pre-review fix + 1 fix round)
Task 9: dispatched (implementer haiku, base 8496aa61073b)
Task 9: implementer DONE (a5dd84c); review dispatched (sonnet)
Task 9: review (sonnet) — spec ✅, approved, no findings.
Task 9: complete (commits 8496aa6..a5dd84c, review clean)
Task 10: dispatched (implementer sonnet, base a5dd84ce31ec)
Task 10: implementer DONE_WITH_CONCERNS (ecfb67d): interim bar_chart example added to examples.json because examples.test.ts requires one per ready template (plan gap — Task 12 must reconcile); smoke describe added to packs.test.ts (noUnusedLocals). Review dispatched (opus).
Task 10: review (opus) — 1 Important (plan-mandated): a `series` entry whose values are an unresolved token is dropped → no legend, changed colour/beat structure offline. Ruling: keep the series as a zero series (`stages: st || [[]]`) so m, legend and colours survive the offline→resolved boundary — cost if wrong: an unnamed extra empty series in a malformed spec. minors (deferred): `values: []` is ambiguous under oneOf (add minItems:1 to the staged branch); a single NaN blanks a series (treat like null); legend can escape a narrow box / long names; title lands inside a tall box; x_label/y_label/title lack descriptions; `as never` in packs.test.ts; 40-category labels illegible; mixed-sign anchor; three test names over-claim (6-series cap and colour wrap untested). Interim examples.json entry judged sound and purely additive.
Task 10: fix round 1/5 (1 fixed pending re-review — token-fed series kept as zero series; commits ecfb67d..16ca223)
Task 10: re-review round 1 — ADDRESSED, no new breakage.
Task 10: complete (commits a5dd84c..16ca223, review clean after 1 fix round)
Ruling: examples.test.ts requires an example per ready template, so Task 11 lands the planned data_table example (Task 12 Step 6, second object) itself; Task 12 then adds only the GDP example, the few-shot and the prompt — cost if wrong: none (same example, one task earlier).
Task 11: dispatched (implementer sonnet, base 16ca223037ba)
Task 11: implementer DONE (f096bf8; packs.test.ts templateIds assertion updated for the second doc); review dispatched (opus)
Task 11: review (opus) — spec ✅, approved. minors (deferred): one wide cell squeezes other columns (no min share); "… 1 more rows" grammar + unconditional more-slot; degenerate short box draws below it; silent column/row losses on the data path (slice 8, filter Array); header color arg is a no-op; cell() on NaN/Infinity/1e21/objects; CAP 24 unasserted (fit bites first); box test checks left edge only; arrayContaining hides "121.899"; spec §6.5 Ids line lacks `more`; "comparison grid" routing overlap with two_by_two_table; stray column-0 brace in examples.json:8903 (Task 10 leftover).
Task 11: complete (commits 16ca223..f096bf8, review clean)
Task 12: dispatched (implementer sonnet, base f096bf88ac48)
Task 12: implementer DONE (8e470dc); review dispatched (opus)
Hans (mid-plan, 2026-09-02): add more bundled examples using the new features (a compounding replication + original ones). Ruling: Task 12b after Task 12 review — three examples written by the controller to scratchpad/extra-examples.json (compounding bars from Python, CLT dice averages morphing to a bell, Simpson kidney-stone table); an implementer appends them textually and runs the suite.
Task 12: review (opus) — 1 Important (plan-mandated): the dice few-shot's stage-0 line "some near a quarter, some barely a tenth" contradicts the seeded output ([0.15,0.14,0.15,0.19,0.17,0.20]) that value_labels prints on the bars. Ruling: reword to "some at a fifth, some at a seventh" — cost if wrong: a pyodide numpy version producing a different stream makes the sentence approximate again (any seed's extremes are ~fifth/seventh far more often than quarter/tenth). minors (deferred → folded into Task 12b): the code bullet still lists show as three values (add none); competing `figures: K` vs `stage` recipes; "Depth means staged" lacks its WHY; GDP example draws no title; its closing line is tool-talk; highlight names non-extremes.
Task 12b: brief written (.superpowers/sdd/…/task-12b-brief.md) — three examples + the show:none clause in the code bullet; dispatch after Task 12 closes
Task 12: fix round 1/5 (1 fixed pending re-review — few-shot narration; commits 8e470dc..6c3c23f)
Task 12b: dispatched (implementer sonnet, base 6c3c23f) in parallel with the Task 12 re-review (disjoint files: examples.json+compiler-v1.md vs fewshots.json)
Task 12: re-review round 1 — ADDRESSED.
Task 12: complete (commits f096bf8..6c3c23f, review clean after 1 fix round)
Smoke (controller, Playwright against the dev server, pyodide live): harvest contract OK — DataFrame→{columns,rows} with numbers kept, column→list, ndarray→list, tuple→list, over-cap → error text, missing name → "no variable nope", object → "not data", missing key → error. CONFIRMED gaps (→ final fix wave): pandas nullable Int64 with NA → "NAType is not data" instead of null (Task 3 minor 1); KeyError message carries stray quotes (Task 3 minor 2). Render smoke of the GDP example through render(): values substituted from Python ([[87,52,58],[67,52,61]]), bars at 2010 heights, order = axes,bar_1..3,gdp,gdp_line_1..6,gdp_out, zero warnings, plan has the animate step (stage 0→1); renderUpTo(end) commits stage 1 (value labels 67/52/61 on screen); screenshot eyeballed OK. Cache-warm run 64 ms.
Task 12b: implementer DONE_WITH_CONCERNS (3122d8e): the dice example needed an explicit box because a long template title collides with the y-axis caption in the default plot area. Ruling (→ final fix wave): when a title is drawn and no box is given, bar_chart/data_table lower the default plot top to y1 = 620 (the did_trends convention: caption 642..677, title 682..718) — cost if wrong: 55 units less plot height on titled charts. Review dispatched (sonnet).
Smoke (controller, live pyodide) of the three Task 12b examples: compounding frames = [[100,122,149,181,221,269],[100,197,387,761,1497,2946]] (narration exact); CLT stage 0 = spikes at even bins (~0.167), stage 1 = triangle (peak 0.172 at bar_6), stage 2 = bell (0.355 at bar_6); Simpson table order header,row_1..3,title. Zero warnings, zero lint errors, no unknown ids, all three.
Task 12b: review (sonnet) — spec ✅, approved; minor (deferred): "eleven times" rounds 10.95.
Task 12b: complete (commits 6c3c23f..3122d8e, review clean)
Final review: dispatched (fable) over 205d446..3122d8e (19 commits, 34 files) with the ledger for minor triage; three scheduled fix-wave items: pd.NA→null, KeyError quotes, title-vs-caption default plot top
Final review (fable): "With fixes". 3 Important: (1) paramsStrictness lets dataPack go strict with unresolved/unsubstituted tokens → `series.items.required` fires offline (my T8 "harmless" ruling was WRONG — probe-confirmed). Ruling: strict = (dataPack||tokens) && (!tokens||substituted); labels gains the token branch; minItems:1 on staged branches. (2) scheduled title fix would move the title INTO the caption band. Ruling: bar_chart computes title y from the y caption (≥ caption+30, ≤730) AND lowers the default plot top to 620 when a title is drawn without a box; data_table untouched; CLT example's box removed only if it then passes. (3) `v != v` throws on pd.NA. Ruling: `__isna` by type name (NAType/NaTType) + float NaN; ValueError for missing key. Fold-ins: harvest wart/len pre-check/String(err); layout decode guard for show:none; two drift tests (examples params vs schema; every animate stage lays out); lint wording + "template-params" rule. Remaining minors CAN-WAIT per triage. Fix wave dispatched (opus) with .superpowers/sdd/…/final-fix-brief.md.
Final fix wave: DONE_WITH_CONCERNS (947ffc4, f28586f, ab20555, dce59ca; 3391 tests). Concern: with an authored box reaching y1=675 the caption centre is 722.75 and the 730 ceiling leaves 7 units — the brief's rule was unreachable for boxed charts; CLT example kept its box. Ruling (amendment): when a title is drawn, plot.y1 = min(plot.y1, 620) regardless of box source (a title costs 55 units of plot height); title y = max(plot.y1 + 25, captionY + 30) ≤ 730; then the CLT example's box is removed if the examples test passes — cost if wrong: authored boxes lose 55 units of height when titled.
Re-smoke (live pyodide, after ab20555): Int64 NA → [1,null]; DataFrame NA and NaT cells → null; NaN/inf → null; missing-key message has no quotes. Harvest fixes confirmed live.
Fix wave round 2 (68260f3): title rule amended, but captionY+30 is 7 units short of the lint pad (+40 passes with the CLT box removed) and an authored box with y0 > 620 inverts under the unconditional min. Ruling: title y = max(plot.y1 + 25, captionY + 40) capped 730; plot.y1 = Math.max(plot.y0, Math.min(plot.y1, 620)) when a title is drawn; remove the CLT example box (must pass now) — cost if wrong: a 10-unit taller gap above the plot on titled charts.
Fix wave round 3 DONE (68f1142; 3392 tests; CLT box removed). Scoped re-review dispatched (opus) over 3122d8e..68f1142.
Final verification on 68f1142: tsc clean, production build clean, tree clean; live CLT render without box: plot top 620, caption 667.75, title 707.75, zero warnings, final stage 2.
Final re-review (opus): all 7 findings ADDRESSED, no Critical/Important breakage. Parked (Ruling: real, deferred to M2): the harvest len() pre-check misfires on a 0-d ndarray (guard with getattr(v, "ndim", 1) != 0); dead `Math.min(700, …)` in bar_chart's title y; caption-vs-title order not universal for boxes with floor above ~700 (finite, non-inverted, accepted); the 40-unit clearance is calibrated to the 30/22pt pair.
Plan complete: 205d446..68f1142 (25 commits), 3392 tests, tsc + build clean, live-smoked. Pushing (pre-authorized).
