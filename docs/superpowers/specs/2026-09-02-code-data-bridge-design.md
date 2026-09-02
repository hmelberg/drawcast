# Code → template data bridge — scripts feed charts and tables drawn as vector geometry

Date: 2026-09-02. Status: approved design (Hans, 2026-09-02); nothing built.
Builds on `2026-09-02-code-element-design.md` (the code element) and the
multi-figure beats added after it.

## 1. Goal

A code element's Python (later R) script hands **structured data** — numeric
series, table rows, categories — to a drawcast **template**, which draws it
natively as ordinary drawables. The chart is then geometry, not a captured
PNG: it animates through the existing `animate` verb, scrubs and exports
exactly, and costs a few hundred bytes of JSON in the document instead of
kilobytes of pixels.

The same templates take data typed by the author. Whether the numbers come
from a person or from a script is a substitution step the template never
sees.

Rulings that shaped this design (Hans, 2026-09-02):

- **Charts live in templates, not in a new element type.** `animate`, the
  explore tray, the catalog and the kit all come free that way. A new
  optional `box` param lets a chart share the canvas with a code panel.
- **Reference-pull contract.** Params name script variables with a token;
  the runtime harvests exactly those paths. Scripts stay vanilla Python/R.
  A push-emit helper module (`drawcast.emit(...)`) is not the contract; it
  may come later as optional sugar.
- **Token syntax: `"{sim.y}"`** — the existing `{var}` idiom; the dot is the
  discriminator from ask-store tokens.
- **A changing chart is a `stage` param the template interpolates**, plus a
  small generic fix so array indices are animatable. The flipbook idea is
  explicitly not built: for data charts the bridge makes it unnecessary,
  and pixel output already has `_fig_N` slides.
- **Four first consumers**: `bar_chart`, `line_chart`, `scatter_plot`,
  `data_table`. The catalog's full-entry threshold rises from 80 to 100.
- **Freeze-on-publish is in scope.** A published cast can carry the data
  and need no Python runtime at view time.

## 2. Principles

1. **The spec is the one place that says what crosses the bridge.** No
   declared output schema on the element, no emit calls in the script: a
   token in `params` both requests the value and places it.
2. **Substitution happens on the render clone, never on the document.**
   Same seam as portraits, sources and code results (B11). The author's
   document keeps its tokens until an explicit freeze on publish.
3. **Everything downstream is unchanged.** Layout, `animate`'s per-frame
   relayout, the tray, video export and the lint all read `spec.params`
   from the resolved clone, so a data-fed template is indistinguishable
   from a hand-typed one.
4. **Generic first, library second.** The substitution works for every
   template's params — a `forest_plot` from computed estimates, a
   `survival_curve` from a fitted model — and the four new templates are
   the first consumers, not the mechanism.
5. **Deterministic and cached.** Results are cached with the requested
   paths in the key; a scrub, a replay or an animate tick never re-executes.
6. **Degrade, never die.** An unresolvable token drops the param (the
   template's default applies) and records a warning. Errors reach the
   author at authoring time through the repair loop, not the viewer at
   playback time.

## 3. Spec surface (model-facing)

### 3.1 The token

A param value that is **exactly** the string `"{<codeId>.<path>}"`:

```
^\{([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$
```

- `codeId` is the id of a `code` element in the **same playlist part**.
- `path` is a variable name optionally followed by dotted segments. A
  segment walks a DataFrame column, a dict key, or an attribute, in that
  order of preference.
- A token may appear at any depth in `params`, including inside
  `series[0].values`. No interpolation inside longer strings: `"GDP {sim.y}"`
  is plain text.
- A brace string **without a dot** is not a token. Ask-store tokens
  (`"{name}"`) keep their namespace and remain invalid in params.

```yaml
template: bar_chart
params:
  title: GDP per capita, 2010 → 2020
  labels: "{gdp.df.country}"
  values: "{gdp.frames}"      # [[2010 values], [2020 values]] → two stages
  stage: 0
  y_label: "USD (thousands)"
  box: {x: 470, y: 90, w: 480, h: 560}
elements:
  - id: gdp
    type: code
    language: python
    show: code
    x: 220
    width: 400
    code: |
      import pandas as pd
      df = pd.DataFrame({"country": ["Norway", "Sweden", "Denmark"],
                         "y2010": [87, 52, 58], "y2020": [67, 52, 61]})
      frames = [df.y2010.tolist(), df.y2020.tolist()]
commands:
  - draw: [gdp, gdp_line_1, gdp_line_2, gdp_line_3, gdp_line_4]
    parallel: true
    speak: "Three countries, two years, one data frame."
  - draw: [axes, bar_1, bar_2, bar_3]
    speak: "In 2010 Norway towered over its neighbours."
  - animate: {stage: 1}
    duration: 3
    speak: "Ten years on, the oil price took the tower down."
```

### 3.2 Code element: one new mode

| `show` | Draws | Beats |
|---|---|---|
| `output` (default) | output pane | `<id>_out`, `<id>_fig_N` |
| `split` | code + output | lines + output |
| `code` | code lines only | `<id>_line_N` |
| **`none`** (new) | nothing | none — the element is a data source only |

`show: none` mints no drawables, no anchors and no ids, so it never lands in
the implicit final draw. A script can feed a template **and** show its lines
or output pane; the modes are orthogonal to referencing.

### 3.3 What the model must know (prompt bullet, condensed)

- Reference a script variable from any template param with `"{id.var}"`;
  columns as `"{id.df.col}"`. The variable must be a list, a number, a
  dict, a Series or a DataFrame.
- Depth means staged: `values: [3, 5]` is one chart; `values: [[3, 5], [4, 9]]`
  is two stages of the same chart. `animate: {stage: 1}` plays the change.
- Keep axis limits stable across stages (the templates do this by
  default); never draw a new chart per stage.
- `show: none` when only the data matters; `show: code` beside a chart
  with a `box` when the code is the story.

## 4. Runtime contract (`src/code/`)

### 4.1 Request and envelope

```ts
interface CodeRunRequest {
  language: "python" | "r";
  code: string;
  /** Dotted paths to harvest after the run (sorted, deduplicated). */
  paths?: string[];
  onStatus?: ...;
}
interface CodeRunResult {
  ... // unchanged
  /** Harvested values keyed by the requested path. */
  data?: Record<string, unknown>;
  /** Per-path failures (missing name, not data, over cap) — the run itself still succeeded. */
  dataErrors?: Record<string, string>;
}
```

`CODE_VERSION` bumps. Old cached envelopes decode without `data` and miss
cleanly because the key changes.

### 4.2 Cache key

`c<CODE_VERSION>|py<version>|<hash(code)>|<len>|<hash(paths.join(","))>`.
Adding a reference re-runs the script once per machine; every render,
scrub and animate tick after that hits the cache. A run with no paths keys
on the empty string, so specs without tokens keep one envelope per script.

### 4.3 Python harvest (after the run, in the run's namespace)

For each path `a.b.c`:

1. `obj = __g["a"]` — missing name → `dataErrors[path] = "no variable a"`.
2. Each further segment: DataFrame → `obj[seg]` (column); dict → `obj[seg]`;
   otherwise `getattr(obj, seg)`. Failure names the segment.
3. Convert to JSON-safe data:

| Python value | JSON |
|---|---|
| DataFrame | `{columns: string[], rows: (number \| string \| null)[][]}` — numbers stay numbers, NaN/None → null, everything else `str()` |
| Series, ndarray, list, tuple, range | list (numpy scalars → Python numbers; nested arrays → nested lists) |
| dict | object (keys `str()`-ed; values converted recursively) |
| int, float, bool, str, None | as is (non-finite floats → null) |
| anything else | `dataErrors[path] = "<type> is not data"` |

Caps, enforced in Python so nothing large ever crosses into JS: **5,000
numbers per path** (counted over nested lists) and **200 DataFrame rows**.
Over cap → `dataErrors[path]` with the count and the cap ("downsample or
aggregate in the script"). Nothing is silently truncated: a chart that
would have lied about its data is an error, not a warning.

Harvest is skipped entirely when `paths` is empty — a spec without tokens
pays nothing.

### 4.4 R (M2 of the code element, not built here)

Same request, same envelope. `data.frame` → `{columns, rows}`, atomic
vectors → lists, named lists → objects, `NA` → null. Column walk on a
data.frame by name. The contract is language-neutral by construction; the
serializer runs inside the shelter with the run.

## 5. Resolve phase (`src/render/code.ts`)

`resolveCode(spec)` grows three steps, all on the clone:

1. **Scan.** Walk `spec.params` (any depth, arrays included) collecting
   tokens grouped by `codeId`. A token naming an id that is not a code
   element in this spec → warning, param dropped.
2. **Run.** For each code element: `runCode({language, code, paths})` with
   that element's sorted paths. Elements with no tokens run exactly as
   today (empty `paths`).
3. **Substitute.** For each token: value present → replace the string with
   the harvested value; `dataErrors[path]` or a failed run → delete the
   param (a template default applies). The envelope, `dataErrors`
   included, is stamped on the element as `code_result` exactly as today,
   and `codeDrawables` pushes one warning per failed path into
   `ctx.warnings` (before its `show: none` early return), which is how
   resolve-time trouble reaches `LayoutResult.warnings` and the lint chip.
   The code element's own error panel shows a run failure when its pane is
   visible. A token naming an unknown id never reaches the resolver
   silently: it is a static lint error (§9.1).

**Skip rule (view time, independent of freeze).** A code element is **not
executed** when its output pane is hidden (`show: code` or `none`) **and**
no token in this spec's params references it. Its code lines, if shown,
are text — no runtime needed. This is what makes a frozen cast runtime-free
(§8) and it costs nothing for casts that never had data.

Order of operations in `resolvedRenderSpec` is unchanged: the three
resolvers still run in parallel on the clone; substitution is internal to
`resolveCode`. `render()` reads `spec.params` from the clone afterwards, so
`animateBase`, `layoutFor`, the tray's initial values and the export all
see substituted data with **no code change**.

## 6. The `data` pack (`src/scenes/packs/data.yaml`)

Four templates, `status: ready`, `kit: 5`, enabled by default
(`packsDefault` bumps to v7). `TEMPLATE_FULL_THRESHOLD` 80 → 100 so the
catalog stays single-level (74 ready templates after this round).

### 6.1 Shared vocabulary

| Param | Type | Meaning |
|---|---|---|
| `labels` | `string[]` | category names (bars) or per-point names (scatter) |
| `x` | `number[] \| string[]` | x positions (line, scatter); strings = categorical |
| `values` | `number[] \| number[][]` | one series; depth 2 = staged |
| `series` | `{name: string, values: number[] \| number[][]}[]` | several series (grouped bars, several lines); each stageable |
| `stage` | `number ≥ 0` | which stage is shown; fractional = interpolated; default 0 |
| `box` | `{x, y, w, h}` | plot area in logical units, lower-left origin, y-up (the kit's box convention); default = `plotArea()` from `layout/canvas.ts`, the box every axes template uses |
| `x_label`, `y_label`, `title` | string | captions via `kit.axisLabel` and the title convention |
| `xlim`, `ylim` | `[number, number]` | axis limits; default computed over **all** stages so the frame never jumps mid-tween; bars start at 0 |

Colors: a new ordered `COLORS.series` (six entries drawn from the existing
palette, `demand`, `supply`, `accent`, `shifted`, `region2`, `region1`) in
`layout/model.ts`, exposed through `kit.COLORS` (kit v5). One series =
`series[0]`.

**Staging rule — depth means staged.** `values: [3, 5, 8]` is static.
`values: [[3, 5, 8], [4, 9, 2]]` is K = 2 stages. The same rule applies
inside each `series[k].values`. Mixed depths across series are an error
(schema `oneOf` on the item, checked after substitution — §9).

**Interpolation.** `s = clamp(stage, 0, K−1)`, `k = floor(s)`, `t = s − k`,
`v_i = lerp(stage_k[i], stage_{k+1}[i], t)`. Linear on purpose: the player
already applies smoothstep to the param. Missing values:

- **bar** absent from a stage → height 0 (grows from, or shrinks into,
  the axis);
- **line / scatter point** absent from stage k but present in k+1 → its
  position lerps **from its predecessor point** (the previous index in the
  same stage; the first point from itself), so a series revealed prefix by
  prefix draws itself in. Absent from both → not drawn.

Ids are minted from the **longest** stage, so every bar and point exists
at every stage and draw/erase/highlight/focus address it throughout.

**Caps.** Each template's caps below are `maxItems` in its params schema,
so an overrun is an authoring-time error through the post-substitution
validation (§9.2). The layout also clamps defensively at view time — it
draws the first N and pushes a warning — so a hand-edited document never
blanks a figure.

### 6.2 `bar_chart`

- Params: shared + `value_labels: boolean` (the interpolated value above
  each bar, rounded to the data's own precision), `gap: number` (bar
  spacing fraction, default 0.35).
- Ids: `axes` (group with captions), `bar_1..n` — one group per **category**
  containing that category's bar from every series, its label under the
  axis, and its value label; `legend` when `series` has ≥ 2 entries;
  `title`.
- Caps: 40 categories, 6 series.

### 6.3 `line_chart`

- Params: shared + `points: boolean` (dots at data points), `smooth:
  boolean` (Catmull–Rom via `kit.smooth`).
- Ids: `axes`, `line_1..k` — each a group of the polyline, its dots and its
  end label (`series[k].name`, dodged apart as `did_trends` does); `title`.
- Caps: 6 series, 2,000 points per series.

### 6.4 `scatter_plot`

- Params: `x: number[]`, `y: number[] \| number[][]` (stageable), optional
  per-point `labels`, `fit: true \| [slope, intercept]`. `true` = least
  squares computed in the template; the pair = numbers from the script
  (and thus animatable: `animate: {"fit.0": 0.4}`).
- Ids: `axes`, `points` (all dots), `point_1..n`, `fit_line` (with its
  equation as caption), `title`.
- Caps: 500 points (over cap → error at authoring time, §9).

### 6.5 `data_table`

- Params: `columns: string[]` + `rows: (string \| number \| null)[][]`,
  **or** `data: "{sim.df}"` (a whole harvested DataFrame — `{columns,
  rows}`; explicit `columns`/`rows` win when both are given), `decimals`
  (default 2; integers untouched), `box`, `title`, `font_size`.
- Drawn with `kit.table`: header row over an ink rule, guide-colored row
  rules, columns sized to content and clamped to the box.
- Ids: `header`, `row_1..n` (a row's cells and its rule — so a table fills
  row by row with ordinary draw beats), `title`.
- Cap: 24 rows drawn, then one "… N more rows" line. **No `stage` in v1**:
  a filling table is row beats; changing cell values (a compounding table
  across years) wait for a real request.

### 6.6 Two enabling fixes outside the pack

- **Array indices in animate paths** (`render/params.ts`): `readParam` and
  `withOverrides` treat an array like a record with integer keys, so
  `animate: {"values.2": 40}` and `"{var}"`-driven single values work.
  ~10 lines, pure, tested.
- **Data-bounded slider** (`ui/tray-model.ts`): a numeric schema node may
  carry `x-max-from: <param path>`; the tray reads the current value at
  that path and uses `length − 1` as `maximum` (a static `maximum` still
  wins). `stage` declares `minimum: 0, x-max-from: values` and becomes a
  slider only when the data actually has stages. A template with `series`
  declares `x-max-from: series.0.values`.

## 7. Composition and the playlist

- **Code beside chart**: the code element with `show: code` on the left
  (`x`, `width`), the template with a `box` on the right. Lint's overlap
  check covers the pair like any two drawables.
- **Several charts from one script**: playlist parts, each with its own
  template; a token references a code element **in its own part only**
  (parts lay out independently). Duplicating the script across parts is
  the honest v1 answer; the run cache makes the second execution free. A
  cross-part reference is a lint error naming both parts.
- **Data typed by hand**: same templates, literal params, no code element.
- **A chart plus existing tier-2 annotations**: unchanged — template ids
  are addressable by `annotation`, `highlight`, `point` as today.

## 8. Freeze on publish

- **UI**: the Publish dialog's embed choices (`ui/share.ts`,
  `buildEmbedChoices`) gain a checkbox **Freeze data**, default on when
  any part of the document contains a token, absent otherwise. Same row
  as the narration bake.
- **Mechanism**: for the published copy only, run every referenced code
  element with its paths (cache-warm from authoring), substitute the values
  into `params`, and leave the tokens out. Runs happen through
  `resolveCode`'s own scan/run/substitute (one implementation, called on
  the publish clone), and the freeze then **strips `code_result`** from the
  copy: freeze carries data, never pixels or stdout. A failed path aborts
  the publish with the path named — a frozen cast must never carry a
  silently missing series.
- **Order against translation**: translate-on-publish runs **first** on
  copies that still hold tokens (the translator skips them, §9.4); freeze
  then substitutes the same values into every language copy. Harvested
  strings are data and are never translated.
- **Source document**: unchanged, tokens intact — the Save-verbatim /
  Publish-embeds rule (F.3).
- **Report**: the publish report adds "N values frozen from M scripts",
  itemized like the narration line.
- **Payload**: a frozen chart is its JSON — a 40-bar, 3-stage chart is
  under 1 KB. Nothing to hoist; `code_result` is not stamped by freeze.
- **Runtime-free viewing**: a frozen cast whose code elements are `show:
  code` or `none` loads **zero** runtime bytes through the skip rule (§5).
  A cast that shows a live output pane still executes at view time; baking
  stdout/figures is a separate follow-up (code-element spec §8.5).
- **Engine build** (`compiler.ts` / xplainer): the same freeze function,
  no UI, on by default because an embedded figure has no publish dialog.

## 9. Authoring time

### 9.1 Static lint (`spec/schema.ts` validation + `lint/`)

- A token's `codeId` must be a `code` element in the same spec → error.
- Token path must match the grammar → error naming the offending string.
- A `show: none` code element referenced by no token → warning "data
  source unused".
- Mixed staged/static depths across `series` → error (schema, after
  substitution).

### 9.2 Execution check (`code/check.ts`, in the repair loop)

`codeExecutionErrors` runs each script **with its referenced paths** (the
same scan as the resolver, exported from one place). Then:

- `dataErrors[path]` → error text naming the variable and the reason
  ("`{sim.y}`: no variable y — assign it in the script or fix the token");
  the model repairs the script or the token.
- After substitution, the resolved `params` are validated against the
  template's `params_schema` with the ajv instance `validateSpec` already
  holds (today `params` is `additionalProperties: true` and never checked
  per template). Violations become errors ("values: expected numbers, got
  strings"). Strictness: **errors** for the four `data` templates always
  (they are new, nothing can regress) and for any template spec that
  carries tokens; for token-free specs of pre-existing templates the same
  validation is advisory (warnings), so no bundled example regresses on
  the day the check lands.
- Caps overrun → error with the count and the cap.

Budget and gating as today (60 s, off in embedded/engine contexts).

### 9.3 Prompt, few-shots, examples

- `compiler-v1.md`: one bullet (§3.3), placed after the `code` bullet;
  the `animate` bullet gains "…or a data template's `stage`".
- `fewshots.json`: one pair (a staged bar chart from a script).
- `examples.json`: three bundled examples — staged bars from Python (GDP
  swap), a line chart from typed data with `animate: {stage: …}`, a
  scatter with a Python-computed fit plus a `data_table` part from the
  same DataFrame. `examples.test.ts` validates them; the layout test
  checks each at stage 0 and at its last stage.

### 9.4 Translation

`paramIsText` (`spec/i18n.ts`) returns false for any string matching the
token grammar — the same exemption `{name}` enjoys in speak lines. A
harvested label list is never offered to the translator: at authoring time
it is not in the document, and on publish translation runs before freeze
(§8). A typed `labels` list is text and translates as today.

### 9.5 Hoisting

Nothing new. Tokens are tiny and semantic (the model must see them);
`code_result` is already hoisted.

## 10. Player, tray, export — nothing new

- `animate: {stage: 1}` is a numeric dot path; the planner, the reprojector
  and the per-frame `layoutFor` are untouched. Boundary layouts stay cached
  as today.
- Per-frame cost: the template relayouts with ≤ 2,000 points; the code
  element's `codeDrawables` returns before decoding `code_result` when
  `show` is `none`, so no PNG string is parsed on a tween tick.
- The explore tray shows a `stage` slider through the `x-max-from` hint.
- Video export renders the same clone and records the same tween.

## 11. Testing

Node tests, fake runner (`CodeRunDeps.runner`), no WASM:

- **Scan + substitute**: nested tokens, arrays, dotless brace strings left
  alone, unknown id → dropped + warning, `dataErrors` → dropped + warning,
  document untouched (the B11 fake-resolver proof).
- **Cache key**: differs by paths; empty paths = old key shape.
- **Templates**: geometry at stage 0, 0.5 (interpolated bar heights, point
  positions), last stage; absent bar → 0; new point grows from its
  predecessor; ids stable across stages; auto limits identical at every
  stage; caps.
- **params.ts**: array index read/override; existing record paths
  unchanged.
- **tray-model**: `x-max-from` bounds; static `maximum` wins.
- **Freeze**: published copy has values and no tokens; source unchanged;
  failed path aborts.
- **Skip rule**: a `show: code` element with no tokens never calls the
  runner; with a token it does.
- **i18n**: token strings skipped; `spec-i18n.test.ts` and
  `translate-coverage.test.ts` extended.
- **Check**: `dataErrors` → repair error text; schema violation after
  substitution → error; token-free spec → warnings only.
- **Drift**: prompt mentions the token grammar and `stage`; the four
  manifests declare `x-max-from`; `packsDefault` bump; threshold 100.
- **Python harvest**: manual smoke checklist (DataFrame column, Series,
  ndarray, dict, over-cap error), as for every live-runtime behaviour.

## 12. Milestones

- **M1 — the bridge + two consumers**: token scan/substitute, `paths` in
  the request/envelope, Python harvest, cache key, skip rule, `show:
  none`, lint, execution check + post-substitution schema validation,
  i18n exemption, array-index params, `COLORS.series` (kit v5),
  `bar_chart`, `data_table`, prompt bullet + few-shot + two examples.
- **M2 — `line_chart`, `scatter_plot`**, the `x-max-from` slider hint,
  third example, threshold 100, `packsDefault` v7.
- **M3 — freeze on publish**: checkbox, publish-clone freeze, report line,
  engine default.
- **R** follows the code element's webR milestone unchanged.

## 13. Out of scope (designed for, not built)

1. Staged tables (cell values that change).
2. A `drawcast` helper module for scripts that want to shape data
   explicitly (would produce the same plain variables; pure sugar).
3. Baking stdout/figures on publish (code-element spec §8.5).
4. Re-running a script from viewer input (sliders, asks) — `runCode` is
   stateless and keyed, so a future `RenderHandle.update` can re-resolve;
   nothing here forecloses it.
5. Cross-part references and shared namespaces (`session: "shared"`).
6. Histograms and box plots as templates — bins and quantiles are two
   lines of Python feeding `bar_chart`.

## 14. Core touch points (isolation audit)

| File | Change |
|---|---|
| `src/code/envelope.ts`, `run.ts` | `paths` on the request; `data`/`dataErrors` on the envelope; key; `CODE_VERSION` bump |
| `src/code/pyodide.ts` | path harvest + JSON conversion + caps |
| `src/code/check.ts` | run with paths; `dataErrors` → errors; post-substitution schema validation |
| `src/render/code.ts` | token scan, substitute, skip rule |
| `src/render/params.ts` | array indices in `readParam`/`withOverrides` |
| `src/layout/code.ts` | `show: none` early return |
| `src/layout/model.ts` | `COLORS.series` |
| `src/scenes/kit.ts` | `KIT_VERSION` 5 (colors only) |
| `src/scenes/catalog.ts` | `TEMPLATE_FULL_THRESHOLD` 100 |
| `src/scenes/packs.ts`, `src/store.ts` | `data` pack registered, `packsDefault` v7 |
| **new** `src/scenes/packs/data.yaml` | the four templates |
| `src/spec/types.ts`, `schema.ts` | `show: none`; token lint; per-template params validation after substitution |
| `src/spec/i18n.ts` | token exemption |
| `src/ui/tray-model.ts` | `x-max-from` |
| `src/ui/share.ts`, `src/publish/*` | Freeze data checkbox, freeze on the publish clone, report line |
| `src/compiler.ts` | freeze by default in the engine build |
| `src/llm/prompts/*`, `src/examples.json` | bullet, few-shot, three examples |
| tests | as §11 |

Not touched: `render/plan.ts`, `render/player.ts`, `render/index.ts`,
`render/svg-backend.ts`, `layout/layout.ts`, `export/video.ts`.
