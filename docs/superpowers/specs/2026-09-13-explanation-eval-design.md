# Design: the explanation eval — does a prompt change teach better?

Status: approved by Hans 2026-09-13 ("Do it"), after four rulings taken
during the design conversation:

1. **Purpose** — discovery first, gate second. The judge emits per-item
   verdicts with evidence; a ratchet over those rates comes later, in its
   own round, once the case set is big enough for a pin to mean anything.
2. **Judge proof** — negative controls (mutants), not a human-labelled
   calibration set.
3. **Case set** — authored, held out of `src/examples.json`, frozen.
4. **Cadence** — the 12-case tier only for now; the 40-case tier and the
   gate are deferred.

Hans then asked why the 12 are not also bundled as examples; the answer is
§3.2, and it added the promotion rule and the 18/12 reservoir.

## 1. The problem

`STYLE.md` is a 662-line ledger of what makes a drawcast engaging. It is
distilled by hand into `src/llm/prompts/compiler-v1.md`, into the tag briefs,
into `src/examples.json`, and into `PEDAGOGY_RUBRIC` (`src/llm/compile.ts:307`),
which the pedagogy pass holds every finished spec against. That loop —
ledger → prompt → examples → output — has never been measured. In the week
to 2026-09-12 it turned three new rulings, one rewritten verb section and
four new examples into shipped behaviour on belief alone.

What exists measures something else:

- `tests/examples.test.ts` — geometry and lint on the bundled corpus.
- `tests/examples-style.test.ts` — two mechanical style ratchets over the
  corpus (`isErrandShaped`, speak-only openings). STYLE.md calls it "the
  first test that looks at what an example TEACHES". It looks at the
  *corpus*, not at what the model generates today.
- `scripts/freehand-eval.mjs` — a live 12-case generation eval scoring
  **structure**: `usesGroup`, `usesMath`, `usesImage`, lint counts, latency.
- `scripts/selector-eval.mjs` — recall@k for the template router.

Nothing reads a generated drawcast as a *teacher* would. So a prompt edit
cannot be shown to have helped, a STYLE ruling cannot be shown to have
landed, and the next ruling is chosen from intuition.

## 2. What we build

`scripts/explanation-eval.mjs`, in two phases with the artifacts cached
between them.

### 2.1 Generate

12 frozen requests through the real `generateSpec` at `effort: "high"` with
`pedagogyReview: true` — exactly the pipeline the app ships — following
`freehand-eval.mjs`'s established shape: vite `ssrLoadModule` against
`src/`, `ANTHROPIC_API_KEY` from env or `.env`, a `localStorage` shim, one
`try`/`catch` per case so a single throw cannot erase the other eleven, and
per-case JSON plus `records.json` under
`.superpowers/eval/explanation-<ISO timestamp>/`.

**Serial, deliberately.** `resetCallLedger()`/`callLedger()`
(`src/llm/client.ts`) are module-global, so concurrent cases would scramble
per-case cost attribution. 12 cases × ~100 s ≈ 20 min, ~$10 on
`claude-opus-5`.

Each case's record keeps: the delivered spec, the **pre-pedagogy** spec
(`outcome.rounds[]` retains every round's spec with an `adopted` flag), the
round labels, lint error/warn counts, template, ms and cost.

### 2.2 Judge

A separate pass over the saved specs. `--judge-only <dir>` re-judges an
existing run for ~$1, so iterating on the rubric never re-rolls a
generation, and the mutants (§4) run against saved artifacts.

## 3. The case set

### 3.1 Eighteen authored, twelve run

Frozen in the script. Axes: kind (template-backed / freehand thing / math
with curve / chart / code), language (⅓ Norwegian, the app's measured
share), and an `awkward` flag naming why a case is hard — so items can fail
for real rather than on cases that make every rule easy.

Run set (12), Norwegian marked ⁿᵇ:

| # | Kind | Request | Note |
|---|---|---|---|
| 1 | thing | How does a noise-cancelling headphone silence an engine drone? | |
| 2 | thing ⁿᵇ | Hvordan finner GPS-en i telefonen ut hvor du er? | |
| 3 | math | Why does binary search find a name in a million-row list in twenty steps? | |
| 4 | math ⁿᵇ | Hvorfor koker vannet ved lavere temperatur på fjellet? | |
| 5 | chart | Where does the money go in the first year of a mortgage? | |
| 6 | code | How does a QR code still scan when part of it is covered? | |
| 7 | template | Why does adding salt melt the ice on a road? | |
| 8 | template ⁿᵇ | Hvordan lager en bank penger når den låner ut? | |
| 9 | awkward | What is the difference between the mean and the median? | low surprise, tempts textbook |
| 10 | awkward ⁿᵇ | Hva er forskjellen på brutto og netto lønn? | no honest tidbit |
| 11 | awkward | How do you convert Celsius to Fahrenheit? | too short for three passes |
| 12 | awkward | What does the y-intercept of a line tell you? | tempts signposting |

Reserve (6), same axes, used only to replace a retired case (§3.2): a
sourdough starter; hvorfor har vi skuddår?; why a small difference in annual
return compounds over thirty years; hvorfor veier ikke en astronaut noe i
bane?; how a hash table finds a value without searching; what is the
difference between weather and climate?

Every request is question-shaped, per STYLE.md's 2026-09-07 ruling, and
every topic was checked against `src/examples.json` for keyword collisions —
heat pumps, p-values, vaccines and renters rente were dropped for that
reason.

### 3.2 Why the cases are NOT bundled examples

`selectExemplars` (`src/llm/prompt.ts:215`) scores by keyword overlap and
pastes the winners into the prompt as `### Exemplar N` — the full spec,
strokes stripped. An identical request scores 1.0 and takes the top slot, so
a case that also lives in `examples.json` is a case where the model is shown
the finished figure and asked to produce it. It would score near-perfectly
on every item, forever: train-on-test.

Excluding a case at run time does not rescue it. The matcher keys on words,
not identity, so a near-duplicate leaks just as well — a corpus entry on herd
immunity feeds an eval case on vaccines — and exclusion would measure a
pipeline the app never runs.

**Promotion retires the case.** The 2026-09-09 freehand ruling stands: up to
three of a run's generated specs may be promoted into `src/examples.json`,
hand-fixed through the examples gate. When one is, its request is struck
from the eval set the same day and replaced from the reserve, both moves
recorded in the round's ledger. Never both. Cases are consumable; the
instrument stays clean.

Standing caveat: `examples.json` is what the model imitates, so promoting
its own output feeds its habits back and narrows the corpus over time. The
cap of three per round and real (not cosmetic) hand-fixing are what keep
that in check.

## 4. The judge

### 4.1 What it sees

A **beat transcript**, not raw spec JSON: each command in order, its `speak`
line, the ink or gesture it carries, and the element names — the drawcast as
a viewer meets it. Raw JSON invites structural nitpicking and buries the
prose. The transcript renderer is a pure function, unit-tested
independently of any model call.

The judge does not see the case's `awkward` flag, its kind, or whether the
spec it is reading is the delivered or the pre-pedagogy one.

### 4.2 What it may say

Per item: a **binary verdict**, and for any FAIL a **verbatim quote** from
the transcript. The quote is checked against the transcript by the harness;
a FAIL whose quote does not appear is discarded and counted as a judge
error, not as a failure of the spec. A judge that cannot point at the line
did not find one — this rule is what separates a usable judge from a
plausible-sounding one. Binary, not 1–5: scores drift between runs and
cannot be mutation-tested.

Model: `claude-opus-5`, temperature 0. Reading for teaching quality is the
taste task, and a cheap model is weakest exactly there. It shares a family
with the generator, so self-preference bias is real; §4.4 is the guard.

### 4.3 The items

Split by what can be counted. **Computed** (no model, reported as columns,
never judged): lint errors and warns, beats, speak-before-ink (the existing
ratchet's rule — item 2 of `PEDAGOGY_RUBRIC` is a shape, so it leaves the
judge's plate), speak-only runs, gestures per beat.

**Judged** — nine items, restated from STYLE.md as failure modes rather than
copied from `PEDAGOGY_RUBRIC`. Copying it verbatim would grade the student
against the answer key they were handed at `compile.ts:599`.

| Id | Fails when |
|---|---|
| J1 situated | The opening goes into mechanism before anything says what this decides, prevents or complicates. |
| J2 interesting | The piece is a recitation of mechanics on a topic that plainly offered more. *A plain clean explanation is a PASS — absence of a tidbit can be correct, and a forced or invented one is itself a fail.* |
| J3 aha | The close does not name what the viewer can now see, or the beats do not converge on one insight. |
| J4 in passing | Lecture signposting inside the explanation — "note that", "it is important to", "det er viktig å merke seg". |
| J5 intelligent viewer | Words spent on the self-evident; emphasis on the obvious half rather than the non-intuitive one. |
| J6 moments marked | Gestures sit as decoration rather than at the reveal or the contrast. |
| J7 named parts | A figure that is a *thing* draws anonymous strokes the narration cannot point at. |
| J8 three passes | *(ungraduated ruling, 2026-09-12)* No announce/explain/conclude arc, or the close restates the open rather than taking a different angle. |
| J9 unmotivated ink | *(ungraduated ruling, 2026-09-12)* Meaning-carrying ink appears with no narration preparing it. Scaffolding — axes, grids, boards — is exempt. |

J8 and J9 are in deliberately: the other seven are already in the prompt
*and* in the rubric the generator self-corrects against, so they start near
the ceiling and can only measure decline. The two ungraduated rulings give
the instrument headroom to show an improvement when they graduate.

### 4.4 Proving the judge can fail

Six mutants, each derived from a bundled example that passes clean, each
degrading exactly one item:

| Mutant | Target | Expected collateral |
|---|---|---|
| Opening stakes beat deleted, starts at mechanism | J1 | — |
| Closing synthesis deleted | J3 | J8 |
| "Det er viktig å merke seg at" injected mid-explanation ⁿᵇ | J4 | — |
| Parts renamed `part_1…`, names stripped from narration | J7 | — |
| A meaning-carrying element drawn with no speak | J9 | — |
| Close replaced with a verbatim copy of the open | J8 | J3 |

The signposting mutant (ⁿᵇ) is derived from a **Norwegian** bundled
example, with the injected phrase in Norwegian, so the suite carries at
least one case proving the judge reads Norwegian narration rather than
failing it for the language. The six mutated specs live as fixtures under
`tests/fixtures/eval-mutants/`, each beside the unmutated original it was
derived from, so a reader can diff them.

Assertion: the targeted item FAILS, its documented collateral may fail, and
every other item still PASSES — a judge that fails everything is as useless
as one that fails nothing.

**What the checked-in test does and does not buy.** `tests/eval-judge.test.ts`
replays a *recorded* judge response, so it guards the transcript renderer,
the quote check and the scoring arithmetic — not the model's sensitivity.
The sensitivity proof is the **live** run, `npm run eval:judge-mutants`, and
it is a required step whenever the judge rubric is edited, with its verdicts
recorded in the round's ledger. A recorded fixture allowed to stand in for
that would be the sixth test in this repo that cannot fail.

## 5. Output

`report.md` in the run directory:

- per-item pass rate, **delivered vs pre-pedagogy**, side by side;
- every failure with its case and its quote;
- the computed columns per case;
- a closing section ranking the weakest items, written to paste into
  STYLE.md's "Candidates for the next prompt refinement".

Plus `records.json` for machine use, and `<n>.json` per case.

The delivered-vs-pre-pedagogy column is the round's one free production
answer: the pedagogy pass is an extra Opus call on *every* generation the
app ships, and nothing today says whether `adoptIfNoWorse` buys teaching
quality or mostly waves through lateral rewrites.

**No pins, no gate, no ratchet this round.** Twelve cases across nine items
means one flipped verdict moves a rate by ~8 points. Exit code is 1 only on
harness failure or a case that threw; the numbers are advisory by
construction.

## 6. Build order

1. Transcript renderer (pure, unit-tested).
2. Case file (18) + the generate phase; verify with `--limit 0` (no key, no
   calls) and then `--limit 2`.
3. Judge: prompt, structured-output schema, quote verification, scoring.
4. Mutants + `tests/eval-judge.test.ts` against a recorded response.
5. `report.md` writer.
6. The live mutant run — the sensitivity proof — recorded in the ledger.
7. The first 12-case run; report; ROADMAP entry and STYLE candidates
   updated from what it found.

Files. New: `scripts/explanation-eval.mjs` (the harness and the frozen case
set), `scripts/eval/transcript.mjs` and `scripts/eval/judge.mjs` (both pure
enough to import from a test), `tests/eval-judge.test.ts`,
`tests/fixtures/eval-mutants/`. Touched: `package.json` (two scripts,
`eval:explanation` and `eval:judge-mutants`), `ROADMAP.md`, `STYLE.md`'s
candidates list. Nothing under `src/` changes: this measures the pipeline,
it does not alter it.

## 7. Risks

- **Self-preference bias** — judge and generator share a family. Mitigated,
  not removed, by the mutants and the quote rule; a human read of the first
  report is the real check, and Hans's smoke test is where it belongs.
- **Judge nondeterminism** — temperature 0, and every comparison that
  matters re-judges the *same* saved specs rather than a fresh generation.
- **Norwegian** — the judge reads Norwegian specs in Norwegian and must not
  fail an item for the language; one mutant pair is Norwegian to check this.
- **Twelve cases is a weak signal.** Stated, not papered over: this round
  buys a profile and an instrument, not a bar.

## 8. Out of scope

The 40-case tier and the ratchet gate (their own round, once the instrument
has proven itself); a deterministic unmotivated-ink lint rule (STYLE.md's
2026-09-12 entry proposes one — a spike for when J9 graduates); judging the
rendered PNG (the visual pass already exists and answers a different
question); any in-app judging UI.
