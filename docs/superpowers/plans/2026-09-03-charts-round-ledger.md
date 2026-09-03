# Charts round — ledger

Spec: `docs/superpowers/specs/2026-09-03-charts-round-design.md` (amended in
flight; each amendment marked with its date and ruling id).
Plan: `docs/superpowers/plans/2026-09-03-charts-round.md` (12 tasks).
Delivered 2026-09-03, subagent-driven, one review per task plus a final
whole-branch review and one fix wave. 3853 tests green, `tsc` clean, both
harnesses passing.

**Measurement of record:** median ~1.5 ms, p95 2.4 ms, worst 3.4–4.8 ms per
animation frame (layout + rough.js path generation) against a 16.7 ms budget
for 60 fps. That is a CPU-time proxy: it excludes DOM construction, paint and
compositing, and it must never be quoted as "fps in Chrome".

---

## Rulings

Each is what was decided, why, and what it costs if wrong.

**P0 — work on `main`, not a worktree.** Every prior drawcast round did, the
push was pre-authorized, and a parallel session was already committing to the
same branch, so a worktree would only defer the interleaving. *Cost if wrong:
an interleaved history that is harder to revert as one unit.*

**P1 — the `X_CAPTION_DROP` hoist removes every copy present when it runs**,
not the literal three the plan named; `bar_race` added a fourth. *Cost: a
surviving copy drifts.*

**P2 — a template body's refusal is DRAWN, not linted.** `SceneLayout` carries
drawables only and `issues` come from `lintLayout`, so the plan's `issue(...)`
calls were impossible. Refusals became a text drawable with id `note`,
declared in `element_ids` and truncated via `kit.textWidth`. Applies to
bar_chart's mixed-sign stack, line_chart's non-two-value slope, bar_race's
non-positive data and heatmap's size caps. *Cost: an author sees the refusal
on the figure rather than in the lint chip.*

**T1-A — fix the examples-test blind spot inside Task 1** rather than parking
it. The test asserted only `severity === "error"`, so every warn-level overlap
shipped silently, and the round's remaining work was label-dense. It
immediately caught a third defect nobody had seen. *Cost: a stricter test
surfaces pre-existing issues and costs a detour — which is the point.*

**T2-A — an unresolved token is "not data yet"**, so slope's two-values check
exempts it, matching how the limits scan already exempts token-fed series.
*Cost: a script-fed slope chart would show a refusal during authoring, before
the script had run.*

**T2-B — a tautological test is worse than no test.** The plan's own
`color_by` fixture put the rising series at index 0, so default colouring
satisfied it either way. Replaced with a fixture only direction colouring can
satisfy. *Cost: one extra round on an approved task.*

**T4-A — the `top_n` airlock is the plot's BOTTOM STRIP**, not a row below the
axis: a literal off-plot row puts geometry at y = −74 and trips `out-of-canvas`
as an error. Spec §5.4 amended. *Cost: an entering racer slides up through the
plot's lowest band rather than from beyond the axis; the fade still carries
the entry.*

**T4-B — a new `ready` template cannot land alone.** Touching
`tests/packs.test.ts`, the strict example loops and `src/examples.json` is in
scope, because `examples.test.ts` fails any ready template with no bundled
example. *Cost: files in the diff the brief did not name.*

**T4-C — route the advertised-but-undrawn `ticker` and the silently-horizontal
`vertical` to Task 5**, which owns both. *Cost: had Task 5 slipped, the branch
would ship a manifest id that produces a dropped-beat warning.*

**T5-A — an overtake's one-frame overlap is intrinsic and accepted.** Two
racers crossing share a row for one frame; that is what an overtake looks
like, and the alternative is the rank-snapping the template exists to avoid.
Evidence standard: every INTEGER stage of every example lints clean, which is
where a viewer pauses and reads. Documented in the template so nobody "fixes"
it. *Cost: a viewer paused exactly mid-crossing sees two names touching.*

**T5-B — `null` means ABSENT, not zero.** Zero was a data lie: the chess race
labelled an entering player "1345" mid-tween. A `null` racer is ranked last,
drawn as nothing, and on entry carries its true value across the transition
instead of growing from an invented one. Propagated to `heatmap` (masked
cell) and `line_chart` (draws nothing). *Cost: one more encoding in the
values schema.*

**T5-C — fix the tick test whose stated rationale was false.** `niceStep(55)`
returns 20, identical to the chosen-once step, so the assertion proved
nothing; its real discrimination rode on an unrelated 8 % headroom the report
itself called cosmetic. *Cost: one more round on an approved task.*

**T6-A / T6-B / T6-C — line race.** The `scatter_plot` half of a latent axes
collision was routed to Task 7 rather than fixed twice; the chess example was
restaged because double-nested values collapsed it to a single frame, so the
few-shot for a race could not race; and when `null` then violated
`line_chart`'s own schema, both the schema and the **missing canary** were
fixed — nothing had ever asserted that a template's bundled examples satisfy
its own schema, though `catalog.ts` shows both to the compiler together.
*Cost: a broader canary may surface other exemplar drift, which is the point.*

**T8-A — a Node harness, not Playwright.** Playwright is not a dependency of
this repo; adding one plus a browser download for a single gate was not worth
it. `scripts/smoke-race.mjs` measures the real per-frame work (layout +
rough.js path generation) and says plainly what it excludes. *Cost: the
committed number is a CPU proxy, not painted frames.*

**T8-B — the gate encodes Ruling T5-A rather than flattening it.** At integer
stages any issue fails; at fractional stages an `overlap-label-label` between
two `race_*` elements is an expected crossing, counted and printed, while
everything else — including any overlap involving axes, ticker, title or note
— still fails. *Cost: a genuine racer-label collision that is not a crossing
would be counted rather than caught.*

**T8-C — a gate whose teeth are proven by analogy is not proven.** An
adversarial self-check fixture runs on every invocation with an inverted
expectation: it must fail, so drift in the exemption announces itself. *Cost:
the fixture proves the shipped classification path catches a real collision,
not that `bar_race` itself can produce one — and the harness's own evidence
says it cannot.*

**T9-A — the heatmap gets `box`.** The data bridge chose templates over a new
element type precisely so a chart could sit beside its own code panel, and a
correlation matrix next to the pandas that made it is the obvious drawcast.
*Cost: one small round.* (It also flushed out a real bug: a token-fed heatmap
silently lost its legend beat.)

**T9-B — accept the `x-max-from` omission.** `sliderSpecs` cannot tell a
static 2-D matrix from stages of one, and the honest fix lives in
`src/ui/tray-model.ts`, which this round does not own. **Follow-up work.**
*Cost: a staged heatmap has no tray slider, only the animate verb.*

**T11-A — `did_trends` and `event_study` take data as a scalar knob, not a
coefficient vector.** They were built as teaching diagrams; plotting real
coefficients is a redesign, not a retrofit. Their descriptions now say
SCHEMATIC out loud and name their silent clamps. An author with real
coefficients has `line_chart` and `scatter_plot`, which this round fed. *Cost:
someone expecting to plot estimates in `event_study` must reach for
`line_chart`.*

**T12-A — push after the whole-branch review, not inside Task 12.** The plan
put the push in the last task; publishing before the review that might flag it
is backwards. *Cost: the push lands minutes later than planned.*

**Final wave — `label_top: 3 → 2` on the chess line race accepted.** Narrowing
`ylim` exposed a different collision class: a label landing on a third-party
*unlabeled* series' stroke, which the dodge does not defend against at all.
Diagnosed to the geometry (9 Elo ≈ 13.5 units inside a 19 pt box at stage
2.708) with alternatives measured and disclosed — 0 dirty stages of 1001 at
`label_top: 2`, five at 3. *Cost: it leaves the general label-vs-any-stroke
gap unowned — see follow-ups.*

---

## What the round changed about its own evidence

Three habits paid for themselves and are worth keeping:

- **Measure the break before fixing it.** The 52-character racer name (460
  units against a 430-unit margin), the row-name overlap (0 issues at box
  height 390, 11 at 360), the wash density (0.7 never fires the flip at 3.0:1;
  0.9 gives 4.53:1) — each fix started from a number.
- **Prove the counterfactual.** The race's central ruling was demonstrated by
  building a naive twin that ranks the interpolation and measuring its snap,
  not by arguing. Two later tests were verified by mutation.
- **Recompute contrast, never assert it.** The heatmap's L\* ≈ 0.2532 crossing
  and 3.35:1 floor were both re-derived independently in review and matched to
  the digit — the repo's own twice-learned lesson, applied.

## Traps found, for the next round

- A pin that encodes a scaling assumption becomes the bug's bodyguard: raising
  the series cap broke a test whose guarantee still held. Re-pin the guarantee.
- `catalog.ts` shows a template's schema and its examples to the compiler
  together, so an exemplar that violates its own schema teaches the model to
  generate specs that fail validation.
- A template body has no warning channel at all.
- The offline examples test only ever sees ONE frame; a defect that appears
  mid-race needs a per-stage sweep.
- When another session shares the branch, build every review package from the
  task commit's PARENT, never from the round's base.

## Follow-up work, deliberately not done here

1. **`bar_race` has no `box`** — every other data-pack template can share a
   canvas with a code panel. The heatmap gained one mid-round on an argument
   that applies verbatim to a race.
2. **The general label-vs-unlabeled-stroke collision** (final wave above).
3. **`tray-model.ts` cannot tell a matrix from stages of a matrix**
   (Ruling T9-B), so `heatmap` opts out of the stage slider.
4. **`ticker` is documented as "ignored in slope mode" but is not** — the draw
   has no `!slope` guard. Behaviour is safe (slope labels dodge the ticker);
   the description is wrong, and descriptions feed few-shots.
5. **An `overlap-label-stroke` between the ticker and a very flat, very low
   line's own polyline.** No bundled example reaches it.
6. **Hoist the ellipsis-truncation loop into the kit** (`kit.ellipsize`) — it
   is inlined in four bodies and factored in a fifth, the next
   `X_CAPTION_DROP`-shaped cleanup.
7. **`bar_chart` maps `null` to 0** while every other data template treats it
   as absent. Documented, not unified.
