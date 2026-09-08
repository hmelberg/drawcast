# Ledger — the template router and the two-level catalog as default (2026-09-07)

Step 2 of the template-on-demand plan (assessment + spike ledger:
`2026-09-07-template-on-demand-spike-ledger.md`; step 1:
`2026-09-07-parts-drill-ledger.md`). Hans: "gjør det du anbefaler" —
router first, "none fits" reported now, threshold lowered when the bench
passes.

## The question

The compiler read the whole catalog on every request: 84 ready templates,
278 746 chars ≈ 75k tokens, inside a system prompt of 390 433 chars ≈ 105k
tokens (measured; the earlier ledger's "178 934 chars" was a partial
catalog, as suspected). The two-level machinery (index + hot set +
`need_template`) existed but sat behind a threshold of 100 because its
shortlist was keyword overlap, which fails on requests shaped like a
story. Step 2: a selector good enough to make the two-level regime the
default.

## What shipped

- **`scripts/selector-eval.mjs`** (`npm run selector:eval`): the bench.
  Every request whose intended template is known — 152 bundled examples,
  5 fewshots, 181 manifest examples = 338 cases — scored for recall at
  1/3/5 against any selector; `--router` adds one Haiku call per case, and
  six template-less requests score `none_fits`. `--gate 0.95` for CI.
- **`src/llm/router.ts`**: `routeTemplates(request)` — Haiku 4.5 reads
  `routerIndexText()` (one line per template: id, first sentence, the
  "Choose this for…" sentence, two example requests; 50 621 chars, cached
  as one block) plus the request, and returns up to five ids and
  `none_fits` as JSON (closed schema). `parseRouteReply` keeps only ready
  ids, in order, deduped, capped; `none_fits` only with an empty list.
- **`catalogParts({shortlist})`**: the router's picks first, then the
  keyword selector's, up to `HOT_SHORTLIST = 5`, minus anything already in
  the stable prefix. No shortlist → the keyword selector alone, three
  deep, exactly as before. `catalogIsTwoLevel()`, `catalogFullText()`.
- **`GenerateConfig.route`**: the app injects the router (main.ts single
  and multi-part generation, compiler.ts for host embeds); tests and
  keyless embeds inject nothing and keep the keyword path. A router
  failure is logged on `outcome.route.error` and degrades to the keyword
  path — never to an index-only prompt. Forced templates skip the router.
- **`TEMPLATE_FULL_THRESHOLD` 100 → 40.** The default library is now in
  the two-level regime; `tests/pack-defaults.test.ts` pins that
  (every template on the index, the core in full, the escalation offered,
  the prompt under 35 % of the full catalog).
- `Player`-side nothing; the spike's `maxTokens` knob is what the router
  uses to cap its reply (400).

## Measured

| selector | recall@1 | recall@3 | recall@5 | notes |
|---|---|---|---|---|
| keyword (shipped before) | 83.4 % | 90.5 % | 92.6 % | 25 misses, all story-shaped ("How can one number describe a whole country's inequality?" → lorenz_curve) |
| router alone | 92.9 % | 94.4 % | 94.4 % | terse — it answers with one to three ids, so @3 = @5; 2 of 344 calls failed (transient); avg 1.5 s; the index cached after the first call |
| router ∪ keyword (shipped) | 93.8 % | 96.7 % | **97.6 %** | 330/338; the two miss different requests. Second router run for this row: router alone 93.8 % (run-to-run variance ≈ 0.6 points) |

The eight union misses: three `two_by_two_table` requests phrased as
stories (comparative advantage, the pin factory, "most published
findings are false"), Bayes' theorem (bayes_tree vs equation_steps —
both defensible), the dice CLT (sampling_dist vs bar_chart), Simpson's
kidney stones (two_by_two_table vs data_table), the settling correlation
matrix (sampling_dist vs heatmap), and "the heart between the lungs, in
3D" (heart_circulation vs anatomy). Every one is a near-synonym the
compiler can still reach through the index + `need_template`.

`none_fits`: on the 338 cases WITH a template the router said "none" 5
times (1.5 %); on the six template-less requests it said "none" for
three and claimed a template for three (a bicycle pump → hydraulic_press,
a lock and key → free_body, the atmosphere's layers →
generic_axes_diagram). Honest but soft: step 3 should treat it as a hint
to OFFER a template, never as a verdict.

Finding 1: Haiku 4.5 rejects the `effort` parameter (400 "This model does
not support the effort parameter") — the first bench run scored 0/338
because every call failed. The router sends no effort.

Prompt sizes (chars ≈ tokens at 3.7 chars/token), default library:

| | chars | tokens |
|---|---|---|
| full catalog (old default) | 278 746 | 75k |
| two-level stable (index + core + stubs + packs + escalation) | 45 746 | 12k |
| two-level variable (five full entries) | 12 773 | 3.5k |
| whole system prompt, old regime | 390 433 | 105k |
| whole system prompt, new regime | 170 206 | 46k |

The fixed parts — compiler prompt 41k chars, spec schema 39k, fewshots
14k — are now the bigger half. That is the next slimming target if cost
matters more; it is not a routing question.

## Live check

Six bundled-example requests (the keyword selector's former misses
first) through the real `generateSpec` in the app page, Opus 5, router
on, two-level catalog (scratchpad `live-route.mjs`):

| request (intended template) | router said | Opus chose | rounds | wall |
|---|---|---|---|---|
| How do economists check whether a policy actually worked? (event_study) | event_study, did_trends, rd_plot | did_trends | 1 | 60 s |
| How can one number describe a whole country's inequality? (lorenz_curve) | lorenz_curve | lorenz_curve | 1 | 23 s |
| Why are most published research findings false? (two_by_two_table) | bayes_tree | two_by_two_table | 1 | 23 s |
| When does a twice-a-day pill reach its working level? (pk_curve) | pk_curve | pk_curve | 1 | 17 s |
| What a derivative actually is (generic_axes_diagram) | generic_axes_diagram | generic_axes_diagram | 1 | 16 s |
| Draw a neuron and show how the signal travels (neuron) | neuron | neuron | 1 | 18 s |

Five of six land on the intended template; the sixth chose the sibling
(a difference-in-differences plot for "did the policy work" — the
example happens to use event_study; both were in the shortlist). No
repair rounds, no `need_template` round trips. Wall time 16–23 s for
five of them against 70–140 s for the same kind of request in the full
regime during the spike — the uncached input is a quarter of what it was.
System prompt ≈ 175k chars in every case. Note the third row: the
router missed, the keyword fill missed, and Opus still produced a valid
two_by_two_table from the index line alone (its params are simple);
the escalation prose says not to guess, and a guess that validates is
the harmless case.

## Not done / follow-ups

- The router's index line is only as good as a template's description;
  the bench lists the misses by template, so a bad line is a one-line
  fix in the pack YAML. The remaining union misses are mostly ambiguous
  by nature (a table vs a tree for Bayes; a bar chart vs a line chart for
  a change over time).
- Embeddings were not built: the router passed the bar without them.
- The app's log view does not yet show `outcome.route`; it is on the
  outcome object for whoever looks.
- `none_fits` is recorded, not acted on — that is step 3.
