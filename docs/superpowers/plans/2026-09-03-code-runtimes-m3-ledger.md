# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-runtimes-m3-brython.md

Spec: docs/superpowers/specs/2026-09-03-code-runtimes-design.md (§4.7, §6, §7–§9). Branch: main (same pre-authorization as M2). Base at start: 0374401 (M2 pushed).

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| T1 ↔ pyodide/webr | both carried an identical queue + watchdog; `RunQueue.run(work)` replaces them verbatim | agree — pure refactor |
| T2 ↔ openstat libs | the seven `brython/*.py` files import each other by their FILE names (`import plotly_express_brython as _pe`, `import scipy_stats_brython`) | so the registry keys ARE the file names and the public import names are aliases — `import pandas` → `pandas_brython` |
| T2 ↔ CPython | the libraries run under local CPython 3.13 (openstat tests them so) | the runner too: `scripts/pylib-sanity.py` is the pre-browser harness |
| T2 self | pandas_brython's `NaN` is its own class, not `float('nan')`; `DataFrame.columns` is a tuple, `.values` a list of rows | the runner's `_isna` matches by type name; the harvest walks `columns`/`values`, not `itertuples` |
| T2 self | matplotlib_brython's `show()` prints openstat's embed marker to stdout | **→ Ruling A** |
| T3 self | both Vite builds use `base: "./"`, so `import.meta.env.BASE_URL` cannot tell app from engine | **→ Ruling B** |
| T4 ↔ dispatch | node has no `document`, so `brython.ts` throws `runtimeUnavailable` before touching the network | the T1 dispatch test holds for all four languages |
| T5 | `df.groupby(...)["x"].mean().reset_index()`, `as_index=`, named `agg(mean_x=…)` are NOT in the emulation; `df.groupby("g").mean().reset_index()` names the key column `index` | the bundled example uses a computed column + `sort_values` instead of groupby, so it teaches no emulation-only idiom |

Ruling A: the runner patches `matplotlib_brython.show` (and its `_show` alias) per run to append the current figure's plotly JSON to the envelope and reset; a figure left unshown at the end is harvested too. `plt.show()` twice = two figures = the `figures: K` beats, verified live. Cost if wrong: a `fig.show()` through `_FigureHandle` would print a marker into stdout — not seen in the smoke.

Ruling B: `resolvePylib()` probes candidates in order — `window.DRAWCAST_PYLIB_BASE`, the page's own `pylib/<version>/`, then `https://hmelberg.github.io/drawcast/pylib/<version>/` — and the first that serves `drawcast_runner.py` wins (memoized; a failure clears it). The app (dev, Pages, Netlify) hits its own copy; the engine vendored into xplainer falls through to the published origin after one 404. Cost if wrong: one failed request in embedded hosts.

Ruling C (found by the browser smoke): Brython reports some internal failures through `window.alert` — an empty modal froze the page during the `dataclasses` import. `withAlertMuted()` swaps `alert` for a console warning around every runner call; a JS-level throw out of `_run` becomes an envelope whose message names the runtime. Cost if wrong: none for the app (it never alerts); a host page that alerts during a code run would see a console line instead.

Ruling D (the cwd trap, controller-side): a `cd` in one Bash call persists into later calls, and one batch of heredocs landed in the openstat checkout. Every file was moved, openstat's tree verified clean (`git status` empty), and every later command is absolute-pathed. No commit was affected.

## Progress

- T1 — e558692: `serial.ts` (RunQueue), pyodide/webr refactored. db6e1c3: the watchdog measures execution, not queue wait (the T1 test caught the old semantics: a run queued behind a slow one was timed out for the other's sins).
- T2 — b1cc269: `public/pylib/2026-09-03/` (runner + seven libraries, byte copies), `scripts/pylib-sanity.py`.
- T3 + T4 — f1cda01: `pylib.ts`, `dialect.ts`, `brython.ts`, dispatch; `tests/code-dialect.test.ts` (13 tests).
- T5 — 3e87ba5: schema voice, prompt policy (Brython the light tier), dice few-shot through a token, GDP bundled example.
- Smoke fixes — the alert guard + JS-error envelope + the prompt's known-gaps clause (this commit).

## Smoke (controller, Playwright vs dev :5178, Brython 3.12.0 live, Chromium)

Boot (core + stdlib from HTTP cache, runner compiled): 193 ms to the first `print`.

1. `print` + trailing expression → stdout "sum 6\n3"; order `p1, p1_line_1..3, p1_out`; lint clean.
2. Trailing `pd.DataFrame` with `None` → table `[["1.5","p"],["2","q"],["","s"]]`; `px.bar` in a variable → one 1400 × 900 figure (plotly.js at 2×). 614 ms including the pandas + plotly library loads.
3. `df.plot(kind="bar")` (the `.plot` token loads plotly without an import) → figure; matplotlib-style `plt.plot` + `plt.show()` + `plt.figure()` + `plt.bar` with `figures: 2` → two figures, `m1_fig_1`, `m1_fig_2` in order.
4. Unsupported pandas (`agg(mean_x=…)`) → `ok: false`, traceback "TypeError: agg() got an unexpected keyword argument" — the repair round's input; statsmodels `ols` → slope 1.94 printed.
5. seaborn `barplot` → figure.
6. Tokens: `bar_chart` from `frames` (two stages, pure-Python `random`) substituted; `scatter_plot` `x`/`y` from pandas columns → 12 points + fit. Lint clean.
7. Bundled "GDP per capita, light Python": stdout table text + figure, lint clean. Pyodide and R examples still render (regression).
8. AI-idiom gate (spec §6.4): 8 / 10 clean on the first try — f-strings with `:,`/`:.2f`, `itertools.accumulate`, `Counter`, seeded `random.gauss`, dict comprehension + `sorted(key=)`, `math`, pandas `groupby().mean()` as a trailing table, `px.scatter(color=)`. Failed: `statistics` (the module's CPython 3.12 source imports `math.sumprod`, absent in Brython 3.12.0 — every function fails, and after the first failure the half-imported module yields a JS "Cannot read properties of null" on later runs) and `dataclasses` (SyntaxError in Brython's own `dataclasses.py` line 631, and 15 s spent compiling before it fails). Also verified fine: `namedtuple`, `typing`, `!r`/width f-strings. Gate passed → the prompt policy is on, with the two gaps named in the prompt.

Console: Brython's parser logs ("error, C $B.parser.NodeCtx …") on the dataclasses failure; nothing else.

## Final verification

`npm test` 3560 green (197 files), `tsc` clean, both builds clean (`brython-*.js` chunk 4.7 kB in each).

## Deferred / notes for M4

- MicroPython reuses `drawcast_runner.py` unchanged in intent: the runner already tolerates a refused `sys.stdout` swap (`captured = False`) and falls back to `sys.print_exception`; `_Mod` stands in for `types.ModuleType`. The engine supplies stdout from its own line buffer (`envelopeToResult`'s `stdout` override).
- A failed stdlib import poisons `sys.modules` for later runs in the same page (the `statistics` case). A runner-side cleanup (drop modules whose import raised) is a candidate if it bites AI-written scripts.
- Brython's first `dataclasses` import costs 15 s before failing — the prompt steers away from it.
