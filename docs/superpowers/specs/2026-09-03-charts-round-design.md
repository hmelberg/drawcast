# Charts round: stacked bars, slope, races, heatmap, data retrofit

Design spec, 2026-09-03. Follows the code→template data bridge (M1 spec
`2026-09-02-code-data-bridge-design.md`, delivered M1+M2), which gave the
`data` pack four templates: `bar_chart`, `data_table`, `line_chart`,
`scatter_plot`.

## 1. Why this round

Hans asked which further chart types are worth building. The evaluation that
produced this spec found three things worth writing down, because they
overturn the answer I gave in the M2 planning session:

1. **Histogram and box plot are already answered.** `bar_chart`'s own
   description routes histograms to it ("compute the bins in Python"), the
   data-bridge spec §13 ruled both out with the same argument, and the
   catalog already ships `sampling_dist`, `galton_board`,
   `distribution_curve` and `binscatter`. The delivered CLT example already
   animates "stage = sample size". Neither is built here.
2. **The scarce asset is not chart types.** Token substitution is *not*
   pack-gated: `scanDataTokens`/`substituteDataTokens` walk `spec.params`
   generically (`src/render/code.ts:39`), and the token lint only checks
   that the id names a code element (`src/spec/schema.ts:812`). What the
   data pack actually owns is token-tolerant *schemas* (11 token patterns in
   `data.yaml`, zero in the other 14 packs), staged values, and the numeric
   `stage` param the animate verb tweens. That idiom reaches 4 of 64
   templates. §7 spreads it.
3. **A line race almost exists.** `line_chart` already does staged values,
   prefix reveal out of the predecessor, and end labels that follow each
   line. A chess-Elo race needs pacing, a running year caption and a rolling
   window — not a new template.

## 2. Milestones

| M | Contents | Why this order |
|---|---|---|
| **M1** | `stacked: true` on `bar_chart`; `slope: true` on `line_chart` | Params on tested templates; inherit the stage tween, legend, colours and token plumbing for free |
| **M2** | `bar_race` template; race extensions to `line_chart`; `easing` on animate; a test pinning narration-under-tween | The new capability, and the one whose smoothness risk is worth finding early |
| **M3** | `heatmap` template | No substitute in the catalog; `payoff_matrix` is game-theory-shaped and `data_table` is text |
| **M4** | Token-tolerance retrofit of six existing templates | Highest value per line, but it edits templates with bundled examples, so it goes last |

Each milestone ends green, smoked and pushed. A later milestone never
reaches back into an earlier one's surface.

## 3. M1a — stacked bars

`stacked: true` on `bar_chart`, valid only with `series`.

- Segments stack in series order, bottom-up, in `COLORS.series` order —
  the same colours the grouped legend already uses.
- The y range is the maximum **stack total** across all stages (the
  existing "never jumps mid-tween" rule, applied to totals).
- `bar_i` stays **one id per category**, covering all of that category's
  segments. This keeps the storyboard's beat contract (`bar_1`, `bar_2`, …
  one per label) and keeps the rough.js seed stable, since the seed is
  `hashSeed(drawable.id)` (`src/render/svg-backend.ts:228`).
- `value_labels: true` writes a segment's value inside the segment when the
  segment is at least 26 units tall, and the stack total above the stack.
  Segments too short to label are left unlabelled rather than dodged out.
- **Mixed signs are refused.** A stack of positive and negative values is a
  lie about the total. When `stacked` is set and any value is negative, the
  template emits a layout issue naming the series and renders grouped bars
  instead — visible failure, not silent nonsense.
- Staged values, tokens and fractional `stage` behave exactly as today; the
  tween interpolates segment heights, so a stack grows and re-proportions.

## 4. M1b — slope mode

`slope: true` on `line_chart`, valid only when every series has exactly two
values (two columns). It selects a distinct layout branch, ~70 lines:

- Two labelled columns, no x axis arrow, one tick per column carrying the
  column's name (from `x`, defaulting to "Before"/"After").
- Each series is one straight connector between its two values, with
  **name and value at both ends**, dodged vertically against neighbours on
  each side independently (the existing symmetric end-label dodge, run
  twice).
- `color_by: "direction"` (optional) paints rising lines in one ink and
  falling lines in another, which is what makes the chart argue — the
  Simpson's-paradox reading (group lines all rising, the pooled line
  falling) is the reason this template exists. Default is per-series colour
  as today.
- Staging still works: the two columns' values may change per stage, so a
  slope chart can animate between cohorts.

The existing Simpson kidney-stone example (a `data_table`) gains a slope
companion example.

## 5. M2a — `bar_race`

A new template in the `data` pack. Horizontal by default, because that is
where long racer names fit.

### 5.1 Params

| Param | Type | Meaning |
|---|---|---|
| `labels` | ≤ 40 strings, or a token | Racer names, in **input order**, which fixes ids and colours |
| `values` | staged: list of lists (≤ 200 stages × ≤ 40 numbers), or a token | One row per stage, one number per racer |
| `stage` | number | Fractional interpolates — the animate target |
| `orientation` | `horizontal` (default) \| `vertical` | Vertical caps at 12 racers; names sit under the bars |
| `order` | `rank` (default) \| `fixed` | `fixed` keeps input order and animates lengths only |
| `top_n` | integer, default 10, max 20 | Rows shown; others wait off-plot |
| `ticker` | list of strings, or a token | Stage captions (years); drawn large and dimmed in the plot corner |
| `value_labels` | bool, default true | The value rides the bar's end |
| `xlim` | `[a, b]` | Fixes the scale; default rescales (see §5.3) |
| `title`, `x_label`, `decimals` | | As in `bar_chart` |

### 5.2 Continuous rank — the smoothness ruling

At integer stages a racer's rank is well defined. Between stages:

```
rowPos(i)   = lerp(rankAt(k0, i), rankAt(k1, i), t)
barLength(i)= lerp(valueAt(k0, i), valueAt(k1, i), t)
```

Rank is computed **at each integer stage and then interpolated**, never
recomputed from interpolated values. Ranking interpolated values would hold
a racer in row 3 until the exact crossing frame and then jump it to row 4;
interpolating the rank glides the row across the whole interval, which is
what makes a race read as motion rather than as snapping. Both quantities
are continuous in `stage`, so any frame rate looks right and a scrub is as
smooth as playback.

### 5.3 Scale

Default: the x range is `0 … max(all racers at the interpolated stage)`,
so the leader always fills the plot. This deliberately departs from
`line_chart`'s "range over all stages so the frame never jumps" rule,
because in a race the leader defines the scale and a fixed range squashes
the early years into nothing. To keep the ticks from popping, tick *values*
are chosen once from the final stage's magnitude and their *positions*
recomputed every frame; ticks that fall outside the current range are
dropped. Ticks therefore slide rather than reflow. `xlim` fixes the range
for anyone who wants a constant scale.

### 5.4 Entering and leaving

A racer is drawn when its interpolated row position is under `top_n + 1`.
The extra row is the airlock: a racer climbing in slides up from it while
fading in, and one falling out slides down through it while fading out.
Opacity ramps across that one row's height, so entry and exit are gradual
and no bar ever pops.

### 5.5 Ids, colours, beats

- Ids are `race_1 … race_N` **by input order, never by rank**. The rough.js
  seed is derived from the id, so a rank-keyed id would re-roll a racer's
  sketchy stroke every time it overtook someone — visible as a flicker
  exactly at the moment the viewer is watching. Colours likewise cycle by
  input index.
- All N racers are declared and drawn once; a racer outside the window
  simply contributes no geometry at that stage. This keeps re-entry working
  under the player's plan-time `visible` set (`src/render/index.ts:195`),
  which a mid-tween id could not join.
- `element_ids` also declares `axes`, `ticker` and `title`.

### 5.6 Caps and the harvest ceiling

`values` allows 200 stages × 40 racers, but a code element's harvest caps at
5000 numbers (data-bridge spec §6). 20 racers × 200 stages = 4000 fits;
40 × 200 = 8000 is refused as a harvest error, not truncated. The template
description says so, so the model sizes the script's output rather than
discovering the ceiling at run time.

## 6. M2b — race extensions to `line_chart`

Three additions, no new template:

- **`ticker`** — the same param and the same rendering rule as `bar_race`,
  so a line race carries its year.
- **`x_window: n`** — show only the last `n` x positions; the range is
  `[cur − n, cur]` with `cur` fractional, so the window slides continuously
  instead of stepping.
- **`label_top: n`** — only the `n` highest series at the current stage
  carry end labels; the rest stay drawn but unlabelled. This is what makes
  ten chess players legible when six was the practical ceiling.

Caps: the series cap goes 6 → 12 (schema `maxItems` and the body's
`slice(0, 6)`), and the staged-values cap goes 12 → 200 stages in both
`bar_chart` and `line_chart`. Twelve stages was sized for "before/after",
not for a race across fifty years.

## 7. M2c — the two player changes

### 7.1 `easing` on animate

`animate` hardcodes smoothstep (`player.ts:846`). Over a two-second tween
that is right; over a thirty-second race it eases in and out across the
whole race, so the middle years blur past and the ends crawl.

`easing: linear | ease-in | ease-out | ease-in-out` becomes valid on an
animate command, reusing `EASINGS` from `src/render/effects.ts`. **Absent
means today's smoothstep, byte for byte** — no existing cast changes. Races
say `easing: linear`.

### 7.2 Animate already speaks while it runs — pin it

Commentary over a running race ("in 1985 Kasparov overtakes Karpov") is the
point, and the player already delivers it. The narrated-action prelude
(`player.ts:494-514`) starts the voice and runs the action under it with
`Promise.all`; the `narrationBarrier()` at the head of the animate case
waits only for a *previous* non-blocking `speak`, exactly as `play` does.

So no player change. What is missing is a test: nothing pins this, and a
future edit to the barrier would silently serialize every narrated race.
M2 adds a regression test asserting that a narrated animate's tween starts
before its narration resolves, and the spec records why the barrier stays.

### 7.3 The smoothness budget

Every tween frame re-runs the whole layout and rebuilds every SVG node
(`src/render/index.ts:191`, `svg-backend.ts:833`). Layout is not the
problem — measured at **0.25 ms/frame** for 20 bars over 40 stages. The
rough.js path build is the unknown.

**Gate: a 20-racer horizontal race must hold ≥ 50 fps in Chrome**, measured
in the live smoke by timing `swapGeometry` across a real race, not asserted.
If it misses, in this order: (1) cut per-bar path count (one rounded rect,
no hachure, during a race), (2) cap tween frames to 30 fps above a drawable
threshold. Both are local; neither changes the architecture.

## 8. M3 — `heatmap`

`rows`, `cols`, `values` (2-D, optionally staged), `title`, `value_labels`,
`scale: sequential | diverging`, `decimals`. Tokens accepted throughout, so
a correlation or confusion matrix comes straight from Python.

- **Encoding is fill opacity of one ink** (sequential) or two inks either
  side of zero (diverging). A continuous colour ramp fights the hand-drawn
  ground and walks straight into this repo's contrast trap; a graded ink
  wash does not.
- A cell's value label flips to the light ink once the cell's **computed**
  luminance passes the threshold. Computed, not asserted — the palette
  round's lesson, twice learned.
- Ids are per row (`row_1 … row_R`) plus `axes`, `legend`, `title`, so a
  reveal can walk down the matrix. Per-cell ids would flood the storyboard.
- Cap 12 rows × 12 cols; beyond that the cells are too small for a label
  and the template says so.

## 9. M4 — token-tolerance retrofit

**Mechanism, not sixty hand edits.** A template manifest gains
`accepts_data: true`. At registration, that template's params schema is
widened automatically: every leaf typed `number`, `array of number`,
`array of string`, or `array of array of number` gains the token-string
alternative (`^\{[A-Za-z][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_.]*\}$`). One
function, one place, one test.

The flag is opt-in rather than universal because advertising data means
promising something the body must survive: the editor's layout lint runs
**before** the script has run, so the body must tolerate an unresolved token
string (the M1 promise idiom — typed labels give the placeholder count).

First six, chosen for what a health economist actually computes:
`distribution_curve`, `forest_plot`, `survival_curve`, `ceac`, `did_trends`,
`event_study`. Each gets: the flag, a token-tolerance pass over its body, a
description sentence telling the model it accepts `{id.var}`, and one
bundled example fed from a code element.

The compiler prompt gains one bullet: data tokens are not limited to the
data pack.

## 10. Testing

- **Pure body tests** (node): rank continuity across a crossing, top_n entry
  and exit, stack totals and the mixed-sign refusal, slope dodging on both
  sides, heatmap label flip at the computed threshold, schema widening.
- **Runtime lint per stage.** The offline examples test only ever sees
  placeholders (M2 ledger trap 2), so the live smoke must run
  `layoutSpec(resolved, stage k).issues` across the race — 12 sampled
  stages, not 200.
- **Live smoke** per milestone in Chrome against the dev server, with the
  fps measurement in M2.
- Every new assertion must be **seen to fail** before it is committed (the
  editor-shell lesson: tests that only cover the new thing let three
  regressions through a green suite).

## 11. Traps carried in from the ledgers

- **`X_CAPTION_DROP`** is duplicated in three template bodies. This round
  adds a fourth and fifth axis-bearing template, so the parked M3 item is
  paid here: hoist it into `axisLabelPlacement` and have all five call it.
- **Another session is implementing R and other languages in this repo.**
  It owns `src/code/*`. This round owns `src/scenes/*`,
  `src/render/{plan,player,effects}.ts`, `src/spec/schema.ts` (the animate
  `easing` clause only) and the examples. Commit **named files only** —
  never `git add -A` — and rebase before pushing.
- **`kit:` must be bumped** in any pack template whose layout starts using a
  new kit function.
- **Contrast numbers are computed, never asserted.**
- `h()` throws under `environment: "node"`, so only pure functions are unit
  testable; keep the new logic pure.

## 12. Out of scope, deliberately

- **Histogram, box plot, pie** — §1, with reasons.
- **Bubble chart** — `scatter_plot` plus a `size` param, when something
  needs it.
- **Horizontal plain `bar_chart`** — `bar_race` carries horizontal bars;
  revisit only if a static horizontal chart is actually wanted.
- **Rolling y-window** — `x_window` only; a moving y range during a line
  race reads as instability.
- **Per-cell heatmap beats** and **staged tables** — both already parked.
