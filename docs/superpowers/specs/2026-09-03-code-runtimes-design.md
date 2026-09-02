# Code runtimes — R (webR), Brython and MicroPython behind the code element

Date: 2026-09-03. Status: draft for review.

## 1. Goal

The `code` element runs Python through pyodide today (spec
`2026-09-02-code-element-design.md`, M1; the data bridge,
`2026-09-02-code-data-bridge-design.md`). This round adds the three runtimes
that spec listed as later milestones, each behaving exactly like the pyodide
path from the author's and viewer's point of view: run the script at
figure-preparation time, capture stdout and stderr, echo a trailing value,
draw a trailing data frame as a ruled table, harvest plots as PNG data URIs,
feed template params through `{id.path}` tokens, cache the envelope, degrade
to an error panel, never throw. Line-by-line stepping with narration, the
output beat and the `figures: K` stage beats are storyboard features of the
element, not of the runtime, so they work for every language unchanged.

- **R via webR** — base R and tidyverse output alike: `print`, `summary`,
  `data.frame`, tibble, `data.table`, base graphics and ggplot2.
- **Brython** — the preferred light tier: CPython 3.12 syntax and CPython's
  own pure-Python standard library, about a megabyte on the wire, with the
  openstat emulations of pandas, plotly.express, numpy, matplotlib,
  scipy.stats, statsmodels and seaborn.
- **MicroPython** — the minimal tier: a fifth of a megabyte and a boot
  measured in milliseconds, pandas and plotly.express emulations, a partial
  standard library. Available on request; the compiler does not reach for
  it on its own.

Donors: xplainer's webR handler (proven canvas-to-PNG path, unpinned
`latest`, merged streams, never-purged shelter — port with those fixed) and
openstat's `js/brython-engine.js`, `js/micropython-engine.js`, their runner
scripts and the pure-Python libraries. MicroPython is NOT in xplainer; only
openstat/safestat carry it. xplainer's step-by-step speak / run / show-code
behaviour is what drawcast's `_line_i` / `_out` / `_fig_N` beats already
give, for every runtime.

## 2. Rulings (Hans, 2026-09-03)

1. **One-token discriminator.** `language: "python" | "r" | "brython" |
   "micropython"`. `python` keeps meaning full CPython via pyodide. No
   separate `runtime` field.
2. **All three ship. Order: R, then Brython, then MicroPython.** Brython
   before MicroPython because it is the tier the compiler will prefer
   (§6.4): CPython fidelity and the larger library set matter more for
   AI-written scripts than the extra megabyte, which a viewer pays once.
3. **R plots are PNG via the canvas device.** svglite (true vector) and
   ggplotly (plotly package) are later spikes, not this round.
4. **The compiler learns the tiers** — Brython for scripts that need no
   heavy numerics, pyodide when real numpy/scipy/matplotlib or a PyPI
   package is needed, R when the story is in R — in M3, gated on a live
   smoke of AI-written scripts against the emulated pandas.
5. **Library hosting.** The openstat `.py` libraries are vendored into
   drawcast as a dated snapshot and served from drawcast's own origin, so the
   vendored engine in xplainer finds them too.
6. **Isolation.** The core codebase must not grow more complicated: all
   machinery lives in `src/code/` behind dynamic imports; core edits are the
   handful listed in §3.
7. **One data bridge for all runtimes.** The `{id.path}` token mechanism
   that feeds `bar_chart`, `line_chart`, `scatter_plot`, `data_table` and
   whatever comes next is language-neutral by contract (§4.7); every
   runtime implements the same harvest.

## 3. Isolation budget

| File | Change |
|---|---|
| `src/spec/types.ts` | `language?: Language` — the union moves to `src/code/languages.ts` |
| `src/spec/schema.ts` | `enum: [...LANGUAGES]` and `need(isLanguage(el.language), …)` |
| `src/code/run.ts` | dispatch table (four entries) and `cacheTag(language)` |
| `src/code/check.ts` | drop the `language !== "python"` filter; label from `RUNTIME_LABEL` |
| `src/code/pyodide.ts` | the plotly renderer moves to `plotly-render.ts`; no behaviour change |
| `src/llm/prompts/compiler-v1.md` | the code bullet's "Python only — never emit r" sentence becomes the tier guidance (§7) |
| `src/llm/prompts/fewshots.json`, `src/examples.json` | additive examples |
| `tests/` | new files per runtime; an enum-drift test |
| **new** `src/code/languages.ts`, `plotly-render.ts`, `png.ts`, `webr.ts`, `harvest-r.ts`, `pylib.ts`, `dialect.ts`, `brython.ts`, `micropython.ts` | all the actual machinery |
| **new** `public/pylib/<PYLIB_VERSION>/…` | vendored runner and libraries |

Untouched: `src/layout/*`, `src/render/*`, `src/llm/hoist.ts`, the player,
the video export, `src/scenes/engines.ts`, both Vite configs, every
template. The engine build already emits `pyodide.ts` as a lazy chunk; the
new modules get the same treatment for free. A spec without a code element
loads zero runtime bytes; a Python spec never fetches webR or a dialect
library.

## 4. Shared architecture (`src/code/`)

### 4.1 `languages.ts` — the one place a runtime is declared

Dependency-free, imported by types, schema, run, check and the prompt-drift
test.

```ts
export const LANGUAGES = ["python", "r", "brython", "micropython"] as const;
export type Language = (typeof LANGUAGES)[number];
export const RUNTIME_LABEL: Record<Language, string>;   // "Python", "R", "Brython", "MicroPython"
export const RUNTIME_VERSION: Record<Language, string>; // "314.0.2", "0.6.0", "3.12.0", "1.27.0"
export const PYLIB_VERSION = "2026-09-03";               // vendored library snapshot
export function cacheTag(language: Language): string;   // py314.0.2 | r0.6.0 | bry3.12.0+2026-09-03 | mpy1.27.0+2026-09-03
```

The dialect tags carry `PYLIB_VERSION` because a library snapshot changes
outputs just as a runtime upgrade does. `CODE_VERSION` stays at 5: the
envelope shape does not change.

### 4.2 `run.ts` — dispatch

```ts
const RUNTIMES: Record<Language, () => Promise<{ run(req: CodeRunRequest): Promise<CodeRunResult> }>> = {
  python:      () => import("./pyodide"),
  r:           () => import("./webr"),
  brython:     () => import("./brython"),
  micropython: () => import("./micropython"),
};
```

Every runtime module exports one `run(req)`; `pyodide.ts` keeps `runPython`
and gains the alias. A failed chunk load is tagged `runtimeUnavailable` for
all four, exactly as today. The cache key uses `cacheTag`; the request
shape, the IndexedDB cache and the never-cache-failures rule are unchanged.

### 4.3 `plotly-render.ts` and `png.ts`

- `plotly-render.ts`: `loadPlotly()` and `renderPlotlyFigures(jsons)` lifted
  verbatim out of `pyodide.ts` (pinned plotly.js 2.32.0, offscreen render,
  PNG at 2×). Used by pyodide, both dialects, and R in the later ggplotly
  spike.
- `png.ts`: `bitmapToFigure(bitmap: ImageBitmap): CodeFigure` — draw onto a
  canvas, `toDataURL("image/png")`, dimensions from the bitmap. Used by R.

### 4.4 Envelope and cache — unchanged

`CodeRunResult` (`envelope.ts`) already carries everything the new runtimes
produce: `stdout`, `stderr`, `figures` (PNG data URIs with pixel dims),
`tables` (stringified cells, `truncated`), `data`/`dataErrors` for the
bridge, `error`, `runtimeUnavailable`. Layout, resolve and hoist need no
change.

### 4.5 Authoring-time check

`codeExecutionErrors` runs every code element regardless of language (today
it skips non-Python ones, so an R script would reach the author unverified).
The runtime-unavailable warning names the runtime via `RUNTIME_LABEL`.

### 4.6 Serialization, timeouts, status

Each runtime module keeps its own promise queue and the 180 s watchdog with
the same "the queue chains on the real execution" rule. Status phases are
the existing pair `loading` / `running` with runtime-specific detail strings
("Loading R…", "Installing ggplot2…", "Loading Brython…", "Loading
pandas…", "Running…", "Rendering charts…", "Reading data…").

Interrupts: none. Without COOP/COEP headers webR falls back to its
PostMessage channel, where `interrupt()` is unavailable, so R timeouts
behave exactly like pyodide's: the caller gets an error envelope while the
WASM finishes in the background. Documented, accepted.

### 4.7 The data bridge is one contract

Nothing on the template side knows which language ran. `tokens.ts` scans
params for `{id.path}`, `render/code.ts` asks the facade for exactly those
paths, substitutes the values and applies the skip rule; `check.ts`
validates the substituted params against the template schema. All of that
is already language-neutral and stays untouched.

What each runtime owes is one function of the request's `paths`: resolve
each dotted path in the script's namespace, convert it to plain JSON under
the rules of the data-bridge spec §4.3 (frames → `{columns, rows}`,
vectors → lists, named collections → objects, missing → null, caps are
errors), and return `{data, errors}` as one JSON string that `parseHarvest`
reads. pyodide does this with `harvest.ts`; R with `harvest-r.ts` (§5.6);
the dialects with the runner's `_harvest_data` (§6.3). A new animated
template gets all four languages for free, and a new runtime gets every
template by implementing that one function.

## 5. R runtime (`webr.ts`, `harvest-r.ts`) — M2

### 5.1 Boot and packages

- `import("https://webr.r-wasm.org/v0.6.0/webr.mjs")` (verified 200;
  jsdelivr `webr@0.6.0/dist/webr.mjs` is the fallback URL). `new WebR()`,
  `await init()`. Memoized in-flight boot promise, cleared on failure.
- Once after boot: `webr::shim_install()` — `library()` and `require()` then
  auto-download missing packages from `repo.r-wasm.org` (23,559 packages;
  ggplot2 4.0.3, dplyr, tidyr, data.table, tibble, tidyverse, jsonlite,
  plotly, svglite all present).
- Before each run, a pre-scan installs what the shim cannot see and gives
  the status pill something to say: `library(x)`, `require(x)`,
  `requireNamespace("x")` and `x::` → `webR.installPackages([...])`, base and
  recommended package names excluded. "Installing ggplot2…" while it runs.

### 5.2 Run wrapper — console semantics, trailing value

Each run gets a fresh shelter and a fresh environment; the shelter is purged
in `finally`. The user script is passed as an R string variable in the
environment (no escaping into R source). The wrapper, in R:

```r
.__exprs <- parse(text = .__code, keep.source = FALSE)
.__env   <- new.env(parent = globalenv())
.__n     <- length(.__exprs)
.__table <- NULL
if (.__n > 1) withAutoprint(.__exprs[seq_len(.__n - 1)], evaluated = TRUE, echo = FALSE, local = .__env)
if (.__n > 0) {
  .__last <- withVisible(eval(.__exprs[[.__n]], .__env))
  if (.__last$visible) {
    if (is.data.frame(.__last$value)) .__table <- .__last$value else print(.__last$value)
  }
}
```

Every top-level expression but the last prints when visible — what the R
console, knitr and R users expect (`summary(m)` on line 3 shows up). The
last expression follows the pyodide rule: a visible data frame (tibble and
data.table are data frames) becomes a ruled table instead of text; any
other visible value prints; an invisible value stays silent. A trailing
ggplot object autoprints and so renders. The parse error of a broken script
surfaces as an error entry like any other R error.

Executed via `shelter.captureR(WRAPPER, { env, withAutoprint: false,
captureConditions: true, captureGraphics: { … } })`.

### 5.3 Output mapping

`captureR` returns typed entries; nothing is merged:

| entry | → envelope |
|---|---|
| `stdout` | `stdout` |
| `stderr`, `message`, `warning` | `stderr` (`conditionMessage`, prefixed `Warning:` for warnings) |
| `error` | `error` = `Error in <call>: <message>`, `ok: false` |

A JS-side throw (boot failure, worker death) is the runtime-unavailable
envelope, as today.

### 5.4 Plots — canvas device → PNG

Base graphics and ggplot2 both draw on webR's canvas device; each new page
arrives as one `ImageBitmap` in `images`, in order, so `figures: K`
stage-beats work unchanged (one `plot()` or printed ggplot per stage).
`png.ts` turns each bitmap into a PNG data URI with its pixel dimensions.

Target size ≈ 1400 × 900 px at 2× so the export stays crisp beside
matplotlib's dpi-110 output. The canvas device takes width, height,
pointsize and bg; the first live smoke picks the combination where base and
ggplot2 text read at the same apparent size as the Python plots (ggplot2's
theme sizes do not follow pointsize, so the answer may be "render at 1× and
let layout scale"). Whatever the smoke settles on is pinned in `webr.ts`.

### 5.5 Tables

If `.__table` is set: columns as `names()`, at most 30 rows, cells
stringified in R — numbers via `format(col, digits = getOption("digits"),
trim = TRUE)` so they match what `print(df)` shows, factors and dates via
`as.character`, `NA` → empty string — and `truncated` = rows beyond the cap.
Serialized with `jsonlite::toJSON`, which is installed on first need only
(a script that just prints never pays for it).

### 5.6 Data bridge (`harvest-r.ts`)

The contract of §4.7, in R: the same `paths`, the same `parseHarvest`, an R
script instead of a Python one.

Walk: `get(seg1, envir = .__env)`; then per segment `[[name]]` on a data
frame (column) or a list (element); anything else is "no column or element
<name>". Conversion:

| R value | JSON |
|---|---|
| data frame (≤ 200 rows, else error) | `{columns, rows}`, `NA` → null, factors → strings |
| atomic vector, length 1, unnamed | scalar |
| atomic vector, named | object |
| atomic vector, otherwise | list |
| list, named | object; unnamed → list (recursive) |
| factor | character |
| anything else (function, environment, S4, matrix) | error naming the path |

Caps and their messages mirror `harvest.ts` (5000 numbers, 200 rows; caps
are errors, never truncation). `jsonlite::toJSON(x, auto_unbox = TRUE,
na = "null", null = "null", digits = NA)` produces the one string the
existing `parseHarvest` reads. A `frames <- list(df$y2010, df$y2020)` feeds
a staged `bar_chart` exactly as the Python example in the prompt does.

### 5.7 Limits, stated

- No interrupt (PostMessage channel); timeout semantics as pyodide.
- `pkg::fn` without `library()` relies on the pre-scan regex.
- First-ever R load is in the same weight class as pyodide (R.wasm alone
  is 11.8 MB, uncompressed on the wire, plus the filesystem image and any
  packages); the browser caches it across figures and sessions like the
  Python runtime.
- Package installs live in webR's in-memory filesystem: a page reload
  re-downloads them (HTTP cache helps).

## 6. Python dialects (`brython.ts`, `micropython.ts`, `dialect.ts`, `pylib.ts`) — M3, M4

### 6.1 Loaders

- **Brython** (M3): script tags `brython@3.12.0/brython.min.js` and
  `brython_stdlib.js` (jsdelivr), then `__BRYTHON__.runPythonSource(source,
  moduleName)` for the runner. Stdout captured by swapping `sys.stdout` for
  a `StringIO` inside the runner.
- **MicroPython** (M4): `import("https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@1.27.0/micropython.mjs")`,
  `loadMicroPython({ url: …/micropython.wasm, stdout: line => buf.push(line), linebuffer: true })`
  — openstat's proven pin and capture. Stdout can only be captured through
  this callback (MicroPython cannot swap `sys.stdout`).

Both: memoized boot, queue, watchdog, `runtimeUnavailable` tagging, fresh
globals per run (independent scripts — the cache must stay
order-independent, as with pyodide's `__g`).

### 6.2 Vendored libraries and the registry (`pylib.ts`, `public/pylib/`)

A dated snapshot from openstat, no sync obligation, bumped by hand
(`PYLIB_VERSION`, which is part of the cache tag):

```
public/pylib/2026-09-03/
  drawcast_runner.py                 one runner for both dialects
  brython/pandas_brython.py          plotly_express_brython.py  numpy_brython.py
          matplotlib_brython.py      scipy_stats_brython.py     statsmodels_brython.py
          seaborn_brython.py
  micropython/pandas_mpy.py          plotly_express_mpy.py
```

Not vendored: openstat's `ui`, `tabulator`, `folium`, `altair`, `duckdb`,
`lifelines`, `sklearn` (DOM-mounted widgets, database bridges and UI have
no place in a static figure; they can be added later by adding files).
openstat's engine JS is NOT copied (its DuckDB replay bridge, dataset
binding and Norwegian error strings are not wanted here, and cross-repo
byte-copies of engine files are a known trap).

`pylib.ts` holds the registry — per library: file, import aliases, trigger
tokens, deps — and `scanImports(code)` ported from openstat (import
statements plus tokens such as `.plot`, over-matching harmless). Notably
our registry aliases `plotly` and `plotly.express` to the plotly.express
emulation (a dotted alias needs its parent registered first). Libraries
load lazily by `fetch` + the runner's `_register_module(name, source)` /
`_alias_module(alias, name)`, once per page.

Hosting: `PYLIB_BASE` defaults to
`https://hmelberg.github.io/drawcast/pylib/<PYLIB_VERSION>/` (versioned path,
so a bump never serves a stale cached file); the app's `index.html` sets
`window.DRAWCAST_PYLIB_BASE` to its own relative `pylib/…` so app builds
(Pages, Netlify, `vite dev`) serve their own copy. The engine build has
`publicDir: false`, so the vendored engine in xplainer fetches from the
default absolute URL and needs nothing shipped.

### 6.3 One runner source (`drawcast_runner.py`)

A drawcast-specific runner, small, dialect-neutral (no `ast`, no
`sys.stdout` assumption — MicroPython lacks the first and forbids the
second):

- `_run(code) -> json`: fresh globals; the statement-aware trailing-
  expression detector ported from openstat's runners (column-0 candidates
  scanned from the end, first `(head exec, tail eval)` pair that compiles
  wins; `_`-prefixed bare names and `;` suppress display); exec head, eval
  tail; a trailing DataFrame is stashed for the table harvest, any other
  non-None value is printed. Errors → `traceback.format_exc()` (Brython) or
  `sys.print_exception` (MicroPython) into `error`.
- `_harvest_tables()`, `_harvest_figures()`, `_harvest_data(paths_json)` —
  the same three post-run probes pyodide runs, written against the
  emulated APIs: `DataFrame.columns` / `to_dict` for frames, `tolist()` for
  Series, `to_plotly_json_str()` for figures (this covers plotly.express,
  the plotly-backed matplotlib and seaborn emulations alike). Data-bridge
  rules and caps identical to `harvest.ts` (§4.7); everything crosses as
  one JSON string; the existing `parseHarvest` reads it.
- Stdout capture: try the `StringIO` swap (Brython); if the dialect refuses
  (MicroPython), the JS side reads its own line buffer instead. The TS
  modules differ only in loader and stdout source.

`dialect.ts` is the TS half both modules share: build the probe calls,
parse the JSON envelope, run the plotly figures through
`renderPlotlyFigures`, assemble `CodeRunResult`.

### 6.4 Which tier when — the prompt policy (M3, gated)

Told to the compiler once the live smoke (§8) shows AI-written scripts
succeed against the emulated pandas at a rate that does not burn repair
rounds:

- `brython` — the default for a script that needs no heavy numerics: build
  a frame, compute lists, feed tokens, a plotly.express chart, a quick
  regression from statsmodels, a matplotlib-style plot. Full CPython syntax
  and standard library (`statistics`, `itertools`, `collections`,
  `dataclasses`, `random.gauss`, thousands separators in f-strings — the
  idioms a model writes without thinking).
- `python` — anything that needs the real numpy, scipy, matplotlib or a
  PyPI package, or exact CPython numerics.
- `r` — when the story is told in R (base or tidyverse).
- `micropython` — only when the author asks for it. The compiler never
  picks it on its own: the partial standard library trips CPython idioms,
  and the payload it saves over Brython is one megabyte, once.

### 6.5 Limits, stated

- The emulations are subsets; an unsupported call raises a normal Python
  error and the existing repair round fixes the script. That is the whole
  point of the gate in §6.4.
- Both dialects have quirks documented in openstat's notes and they are the
  reference: Brython (json float formatting, JS `null` versus `None`,
  `dict.clear` + `update`), MicroPython (no `__code__`, regex and `str`
  gaps, `try/else` behaviour). Any that bite an AI-written drawcast script
  go into the ledger and, if recurring, the prompt.
- Brython transpiles to JavaScript at load time and is slower than a
  bytecode VM on tight loops; drawcast scripts are ≤ ~14 lines, so this is
  a note, not a constraint.
- The matplotlib emulation keeps one figure per script (module-global
  traces), so `figures: K` on the dialects is a plotly.express-in-variables
  affair; the prompt says so.
- Library snapshot drift versus openstat is deliberate: no sync, bump when
  wanted.

### 6.6 Cost, measured 2026-09-03

Bytes a viewer fetches the first time a runtime is used, before any
library, from the pinned CDN URLs (`wire` = what actually crosses the
network with compression; `raw` = what the browser parses):

| runtime | files | raw | wire |
|---|---|---|---|
| MicroPython 1.27.0 | `micropython.mjs` + `.wasm` | 0.5 MB | 0.2 MB |
| Brython 3.12.0 | `brython.min.js` + `brython_stdlib.js` | 5.3 MB | 1.2 MB |
| pyodide 314.0.2 | `pyodide.asm.wasm` + `python_stdlib.zip` | 11.6 MB | 5.8 MB |
| webR 0.6.0 | `R.wasm` (+ filesystem image) | 11.8 MB+ | 11.8 MB+ |

pyodide's numbers are before numpy, pandas and matplotlib wheels, which
add tens of megabytes; the vendored pandas emulation is 0.2 MB of source
on either dialect. Boot after download: MicroPython in milliseconds,
Brython in the order of a second (it parses 4.4 MB of JS), pyodide and
webR in seconds. All are browser-cached across figures and sessions.

## 7. Prompt and examples

The `code` bullet's sentence "Python only for now — never emit `language:
r`" is replaced by the tier guidance of §6.4 (M2 ships the R part of it:
"R is available: base or tidyverse, `library()` auto-installs, leave a data
frame or a ggplot as the last line"). One R few-shot pair (a dplyr pipe
ending in a tibble → table, plus a ggplot) and one R example in
`examples.json` in M2; one Brython pair feeding a `bar_chart` through a
token in M3. The schema description on `language` describes the four
values in the house voice.

## 8. Testing

Node (`vitest`, no WASM, no network):

- dispatch reaches the right module per language (injected fakes);
  `cacheTag` per language; failures never cached; runtime-unavailable
  tagging for all four.
- `codeExecutionErrors` runs R and dialect elements and names the runtime
  in its warning.
- enum drift: `LANGUAGES` ⇔ schema enum ⇔ prompt mentions.
- R harvest and table serializers are R strings built in TS — tested for
  the paths they embed and the caps they carry; the wrapper's expression
  splitting is exercised by the live smoke.
- `dialect.ts` envelope parsing against canned runner JSON.
- `scanImports` for the dialect registry (imports, tokens, aliases).

Live smoke (manual checklist, run ×3, the house pattern) per runtime:

- **R**: base `plot`; ggplot2 via `library()` auto-install; dplyr pipe
  ending in a tibble → table; `data.table` → table; `summary()` mid-script
  prints; a warning reaches stderr; a broken script → error panel; `figures:
  2` with two plots; tokens feeding `bar_chart`, `line_chart` and
  `scatter_plot` from a data frame column, a list of vectors (stages) and a
  named vector.
- **Brython / MicroPython**: `print`; trailing expression echo; `pd.DataFrame`
  → table; `px.bar` → chart; `df.plot` token loading; tokens feeding the
  three animated templates; an unsupported pandas call → repair round;
  Brython-only: matplotlib-lite and statsmodels.
- **AI-script gate (M3)**: ten compiler-generated Brython scripts from
  ordinary prompts; the share that runs clean on the first try, and how
  many needed a repair round, written into the ledger before the prompt
  policy is switched on.
- **pyodide regression**: the M1/M2 examples still render after the plotly
  extraction.
- Cost check per runtime: bytes fetched on first run and boot time, written
  into the ledger (§6.6 is the baseline).

## 9. Milestones and gates

- **M2 — R.** `languages.ts`, dispatch, `plotly-render.ts`, `png.ts`,
  `webr.ts`, `harvest-r.ts`, check across languages, prompt + examples,
  tests, smoke. Gate: the R smoke list green ×3.
- **M3 — Brython.** `pylib.ts`, `dialect.ts`, `drawcast_runner.py`,
  `brython.ts`, the vendored library set, smoke, the AI-script gate, then
  the prompt policy.
- **M4 — MicroPython.** `micropython.ts`, its two libraries, smoke, schema
  mention (no compiler preference).
- Each milestone ends with its SDD ledger under `docs/superpowers/plans/`.

## 10. Deferred, designed for

1. **ggplotly / plotly for R**: harvest `inherits(x, "plotly")` values,
   `plotly_build(x)$x[c("data", "layout")]` → jsonlite → the shared
   renderer. Needs a load-time smoke first: the plotly package pulls a long
   dependency chain on first install.
2. **svglite** for vector R plots — fits the SVG-only rule, font metrics in
   WASM unverified.
3. **Interactive overlay** (the code-element spec's §8.6) — every runtime
   that yields plotly JSON is ready for it.
4. More vendored libraries by adding files to the registry.

## 11. To verify in the first smoke (not assumptions the design depends on)

- `withAutoprint(exprs, evaluated = TRUE, echo = FALSE, local = env)` and
  the `captureR` `env` option behave as described; fallback is
  `source(exprs = …, local = env, print.eval = TRUE)`.
- Canvas device size/pointsize for crisp export (§5.4).
- webR loading cross-origin from the CDN in the app AND in xplainer's
  vendored engine (xplainer already does this with `latest`).
- `installPackages` on an already-present package is cheap.
- Brython first-load parse time on a mid-range laptop (the "order of a
  second" in §6.6 is an estimate, not a measurement).
