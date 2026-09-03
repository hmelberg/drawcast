# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-runtimes-m4-micropython.md

Spec: docs/superpowers/specs/2026-09-03-code-runtimes-design.md (§6.1, §6.2, §6.4, §8, §9). Branch: main (same pre-authorization as M2/M3). Base at start: f5802a8 (M3 pushed).

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| runner ↔ MicroPython | `drawcast_runner.py` needs no `ast`, no `traceback`, no `types.ModuleType`, tolerates a refused `sys.stdout` swap | already true since M3 — the file is unchanged in M4 |
| runner ↔ pandas_mpy | `DataFrame.columns` is a tuple, `.values` a `@property` list of rows, `NaN` its own class, `pd.isna` present; `_px()` imports `plotly_express_mpy` lazily | the `.plot` token loads plotly; `_isna` matches by type name |
| T1 ↔ CPython | both MicroPython libraries run under local CPython 3.13 | `scripts/pylib-sanity.py --mpy` is the pre-browser harness |
| T2 ↔ stdout | MicroPython forbids `sys.stdout = …` (openstat's fase-0 note) | `loadMicroPython({stdout})` fills a line buffer; `envelopeToResult`'s `stdout` override reads it |
| T2 ↔ handles | `mp.globals.get("_run")` returns a callable that takes and returns JS strings | openstat's engine relies on exactly this |
| T3 ↔ examples test | a template + token example must satisfy `templateParamErrors` offline | the bundled example is element-only (compound interest), so no token string meets a strict array schema |

Ruling A (found by the browser smoke): MicroPython dicts keep NO insertion order — `list({"Norway": 87, "Sweden": 52, "Denmark": 58}.values())` came back `[58, 87, 52]`, which would have labelled the bars wrong with no error anywhere. CPython 3.7+ guarantees the order, so AI-written scripts assume it. The prompt's MicroPython clause now says to build ordered data as lists, never from `dict.values()`. Cost if wrong: none — the rule is safe on every dialect.

## Progress

- T1 — d652929: `public/pylib/2026-09-03/micropython/` (two libraries, byte copies), `MICROPYTHON_LIBS`, the sanity harness's `--mpy` mode, registry tests.
- T2 — 9e8154e: `micropython.ts`, dispatch entry, `not-yet.ts` deleted.
- T3 — 33a68fb: schema voice, prompt sentence, bundled "Compound interest, minimal Python" example; the prompt test now checks every language is offered and no "never emit" sentence remains.
- Ruling A prompt clause: this commit.

## Smoke (controller, Playwright vs dev :5178, MicroPython 1.27.0 live, Chromium)

Boot (mjs + wasm from HTTP cache, runner loaded): 37 ms to the first `print` — the fastest tier by far.

1. `print` + trailing expression → stdout "sum 6\n3" from the engine's line buffer; order `p1, p1_line_1..3, p1_out`; lint clean.
2. Trailing `pd.DataFrame` with `None` → table `[["1.5","p"],["2","q"],["","s"]]`; `px.bar` in a variable → one 1400 × 900 figure. 247 ms including both library loads (0.36 MB of Python source compiled by the VM).
3. `df.plot(kind="bar")` via the `.plot` token → figure; `1 / 0` after a `print` → `ok: false`, stdout keeps "before", error carries the MicroPython traceback ("ZeroDivisionError: divide by zero").
4. Tokens: `bar_chart` from `frames` built from dict values → substituted, but in hash order → Ruling A; `scatter_plot` `x`/`y` from pandas columns → 12 points + fit. Lint clean.
5. Bundled "Compound interest, minimal Python": six stepped lines, stdout five rows + the trailing `0.276`, lint clean. Brython, pyodide and R examples still render (regression; all from the run cache).

Console: nothing.

## Final verification

`npm test` 3571 green (197 files), `tsc` clean, both builds clean (`micropython-*.js` chunk 1.9 kB in each; `not-yet.ts` gone).

## Final review of the whole round (2fb3b38..454de68) — fix wave

Dispatched to an independent reviewer (general-purpose, read-only) over all 22 commits with the spec; it verified claims with tsc, the suite, the real `R_WRAPPER` under Rscript, the pinned `micropython.mjs` source and the published pylib URL. Verdict: fix-first on three bugs; architecture, isolation, injection hygiene and never-cache-failures hold.

Fixed (one commit after 454de68):

- **A (bug)** `webr.ts` memoized a FAILED package install for the page's lifetime, so one CDN hiccup on `jsonlite` broke every later tokened R run. Now only a successful install is memoized.
- **B (bug)** the R wrapper's "harvest failed: jsonlite did not load" branch was unreachable: `jsonlite::unbox` in the error path and `toJSON` ran outside any handler, so a missing jsonlite halted R and read as a script error (a repair round for an infrastructure failure). Now guarded by `requireNamespace("jsonlite", quietly = TRUE)`; proven locally with `requireNamespace` shadowed to FALSE → `data_json` empty, run still ok.
- **C (bug, cache poisoning)** MicroPython flushes a stdout line only on its newline, so `print(x, end="")` surfaced as the NEXT run's first line — and that envelope was cached under the wrong script. The runner now ends an uncaptured run with a bare `print()`; verified live: "partial" then "second", no bleed.
- **D/E (risk)** every boot stage (R.wasm + init + boot script; Brython's `brython()` + runner compile; MicroPython's wasm + runner) and every vendored-library fetch/compile now throw `runtimeUnavailable`, so the authoring check warns instead of burning a repair round on our infrastructure.
- **F (latent)** `resolvePylib` accepts a 200 only when the body is the runner (`def _run(`), so an SPA host's index.html fallback cannot be memoized as the base.
- **G/H/I (nits)** other control characters in R table cells → space (a raw `\001` used to drop the whole table at `JSON.parse`); an unknown `language` returns an honest envelope from the facade; ImageBitmaps are closed on the R error path too.
- **stderr for the dialects** (spec §1 said "stdout and stderr"; the dialects hard-coded `""`): the runner captures `sys.stderr` (Brython: `warnings.warn` and `sys.stderr.write` verified live), MicroPython wires the engine's `stderr` callback, the envelope carries `stderr`.
- **Drift**: the prompt's own data-bridge example now uses `brython` (it was the very pandas-only script the policy says to write in Brython); comments in `run.ts`, `check.ts`, `pyodide.ts`, `serial.ts`, `brython.ts` (the watchdog does NOT preempt a synchronous infinite loop — say so) and the test header; the spec's §5.1/§5.4/§5.5/§6.2 now describe what was built (rulings B and E, the base-R table serializer, the probe order); `scripts/pylib-sanity.py` reads `PYLIB_VERSION` from `languages.ts`; the cache-tag test's dot-escaping regex was `/\\./` (backslash + any) — now `/\./`; a test that every registry `deps` entry is a key.

Not done from the review (recorded): `test.skipIf(!Rscript)`/`python3` harness tests in vitest (the local harnesses exist as scripts; wiring them into the suite is a follow-up); the webr.mjs jsdelivr fallback URL; excluding recommended R packages from the pre-scan (harmless install call).

Re-verified after the wave: `npm test` 3576 green, tsc clean, both builds clean; live: MicroPython partial-line isolation, Brython stderr, R tokens through jsonlite, pyodide, and the unknown-language envelope.

## Notes for later

- MicroPython's `json.dumps` and float repr differ from CPython in places (openstat's notes); nothing bit the smoke.
- A MicroPython run's stdout buffer is engine-global; the RunQueue serializes runs, so it is never shared between two scripts.
