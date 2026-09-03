# Code runtimes M4 — MicroPython: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `language: micropython` code elements run through the pinned MicroPython 1.27.0 WebAssembly build with the openstat pandas and plotly.express emulations, through the same dialect runner, envelope and data bridge as Brython — available on request, never chosen by the compiler.

**Architecture:** M3 built the runner dialect-neutral: `drawcast_runner.py` already tolerates a refused `sys.stdout` swap, uses `sys.print_exception` when `traceback` is absent, and stands `_Mod` in for `types.ModuleType`. M4 adds only a loader (`micropython.ts`: `loadMicroPython` with a stdout line buffer, `mp.globals.get` handles), a two-entry registry (`MICROPYTHON_LIBS`), the vendored files, and the dispatch entry; `not-yet.ts` is deleted.

**Tech Stack:** `@micropython/micropython-webassembly-pyscript@1.27.0` from jsdelivr (openstat's pin; `micropython.mjs` + `micropython.wasm`, 0.5 MB raw), openstat's `micropython/pandas_mpy.py` and `plotly_express_mpy.py`, CPython 3.13 locally as the sanity harness (these libraries run under it too).

**Spec:** `docs/superpowers/specs/2026-09-03-code-runtimes-design.md` (§6.1, §6.2, §6.4 "micropython — only when the author asks", §8, §9).

## Global Constraints

- Core edits: `src/code/run.ts` (dispatch entry), `src/spec/schema.ts` (description), the prompt sentence, one bundled example. Nothing else outside `src/code/`.
- `RUNTIME_VERSION.micropython = "1.27.0"`, cache tag `mpy1.27.0+2026-09-03` (already declared).
- The runner file is shared with Brython; a change to it must keep Brython's smoke green and `scripts/pylib-sanity.py` passing.
- Stdout comes from the engine's line buffer (MicroPython forbids the `sys.stdout` swap); the runner's envelope `stdout` is `''` and `envelopeToResult`'s `stdout` override supplies it.
- Failures are envelopes; never cached; `runtimeUnavailable` when the runtime cannot start.

---

### Task 1: Vendor the two libraries, extend the registry and the sanity harness

**Files:**
- Create (copies): `public/pylib/2026-09-03/micropython/{pandas_mpy,plotly_express_mpy}.py`
- Modify: `src/code/pylib.ts` (add `MICROPYTHON_LIBS`), `scripts/pylib-sanity.py` (a `--mpy` mode registering the MicroPython set)
- Test: `tests/code-dialect.test.ts` (registry + vendored-file checks for the MicroPython set)

**Interfaces:**
- `MICROPYTHON_LIBS: Record<string, PyLib>` = `{ pandas_mpy: { file: "micropython/pandas_mpy.py", aliases: ["pandas"], deps: [] }, plotly_express_mpy: { file: "micropython/plotly_express_mpy.py", aliases: ["plotly", "plotly.express"], deps: [], tokens: [".plot"] } }`.

- [ ] **Step 1: Tests** (append to `tests/code-dialect.test.ts`)

```ts
import { MICROPYTHON_LIBS } from "../src/code/pylib";

describe("MicroPython registry — pandas and plotly.express only", () => {
  test("import forms and the .plot token resolve to the two vendored modules", () => {
    expect(libsFor("import pandas as pd", MICROPYTHON_LIBS)).toEqual(["pandas_mpy"]);
    expect(libsFor("import plotly.express as px", MICROPYTHON_LIBS)).toEqual(["plotly_express_mpy"]);
    expect(libsFor("df.plot(kind='bar')", MICROPYTHON_LIBS)).toEqual(["plotly_express_mpy"]);
    expect(libsFor("import numpy as np", MICROPYTHON_LIBS)).toEqual([]);
  });
  test("every MicroPython registry file is vendored", () => {
    for (const lib of Object.values(MICROPYTHON_LIBS)) {
      expect(readFileSync(new URL(`../public/pylib/${PYLIB_VERSION}/${lib.file}`, import.meta.url), "utf8").length).toBeGreaterThan(1000);
    }
  });
});
```

- [ ] **Step 2: Copy + registry + harness**

```bash
mkdir -p public/pylib/2026-09-03/micropython
cp ../openstat/micropython/pandas_mpy.py public/pylib/2026-09-03/micropython/
cp ../openstat/micropython/plotly_express_mpy.py public/pylib/2026-09-03/micropython/
```

`pylib.ts` gains `MICROPYTHON_LIBS` (above). `scripts/pylib-sanity.py`: when run with `--mpy`, register `[('pandas_mpy', ['pandas']), ('plotly_express_mpy', ['plotly', 'plotly.express'])]` from `micropython/` instead, and run the pandas/px cases (table, px figure, data bridge, error).

- [ ] **Step 3: Verify + commit**

```bash
python3 scripts/pylib-sanity.py --mpy && npx vitest run tests/code-dialect.test.ts
git add public/pylib/2026-09-03/micropython src/code/pylib.ts scripts/pylib-sanity.py tests/code-dialect.test.ts
git commit -m "feat(code): the MicroPython library set — pandas and plotly.express emulations vendored and registered"
```

---

### Task 2: `micropython.ts` + dispatch; delete `not-yet.ts`

**Files:**
- Create: `src/code/micropython.ts`
- Modify: `src/code/run.ts` (`micropython: () => import("./micropython")`)
- Delete: `src/code/not-yet.ts`

**Interfaces:** `run(req)`; in node, `boot()` throws `runtimeUnavailable` before any import.

- [ ] **Step 1: Implement**

```ts
// src/code/micropython.ts
// The MicroPython runtime: the pyscript WebAssembly build (openstat's pin),
// booted once, the drawcast runner loaded with mp.runPython and its
// functions taken as handles from mp.globals. MicroPython cannot swap
// sys.stdout, so the engine collects print() lines through loadMicroPython's
// stdout callback and hands the buffer to envelopeToResult. The lightest
// tier: half a megabyte, a boot in milliseconds, a partial standard library.
//
// Reached ONLY via dynamic import from run.ts.
import type { CodeRunRequest, CodeRunResult } from "./run";
import { RUNTIME_VERSION } from "./languages";
import { RunQueue } from "./serial";
import { MICROPYTHON_LIBS, fetchLib, libsFor, resolvePylib } from "./pylib";
import { envelopeToResult, parseRunnerEnvelope, type StatusFn } from "./dialect";

const MPY_BASE = `https://cdn.jsdelivr.net/npm/@micropython/micropython-webassembly-pyscript@${RUNTIME_VERSION.micropython}/`;

interface MicroPython {
  runPython(code: string): unknown;
  globals: { get(name: string): (...args: string[]) => string };
}
interface Booted {
  mp: MicroPython;
  base: string;
  run: (code: string, pathsJson: string) => string;
  registerModule: (name: string, source: string) => string;
  aliasModule: (alias: string, canonical: string) => string;
}

let bootPromise: Promise<Booted> | null = null;
const registered = new Set<string>();
const queue = new RunQueue();
const stdoutLines: string[] = [];

function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function boot(): Promise<Booted> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("MicroPython needs a browser to run in");
    let esm: { loadMicroPython(opts: { url: string; stdout: (line: string) => void; linebuffer: boolean }): Promise<MicroPython> };
    try {
      esm = (await import(/* @vite-ignore */ `${MPY_BASE}micropython.mjs`)) as typeof esm;
    } catch {
      throw unavailable("could not load the MicroPython runtime (offline?)");
    }
    const mp = await esm.loadMicroPython({ url: `${MPY_BASE}micropython.wasm`, stdout: (line) => stdoutLines.push(line), linebuffer: true });
    const { base, runner } = await resolvePylib().catch((e: Error) => {
      throw unavailable(e.message);
    });
    mp.runPython(runner);
    return {
      mp,
      base,
      run: mp.globals.get("_run"),
      registerModule: mp.globals.get("_register_module"),
      aliasModule: mp.globals.get("_alias_module"),
    };
  })();
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function ensureLibs(b: Booted, names: string[], status: StatusFn): Promise<void> {
  for (const name of names) {
    if (registered.has(name)) continue;
    const lib = MICROPYTHON_LIBS[name];
    status("loading", `Loading ${lib.aliases[0] ?? name}…`);
    const source = await fetchLib(b.base, lib.file);
    const err = b.registerModule(name, source);
    if (err) throw new Error(`could not load ${name}: ${err}`);
    for (const alias of lib.aliases) {
      const aerr = b.aliasModule(alias, name);
      if (aerr) throw new Error(`could not alias ${alias}: ${aerr}`);
    }
    registered.add(name);
  }
}

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status: StatusFn = req.onStatus ?? (() => undefined);
  status("loading", "Loading MicroPython…");
  const b = await boot();
  await ensureLibs(b, libsFor(req.code, MICROPYTHON_LIBS), status);
  status("running", "Running…");
  const paths = req.paths ?? [];
  stdoutLines.length = 0;
  let raw: string;
  try {
    raw = b.run(req.code, JSON.stringify(paths));
  } catch (err) {
    return { ok: false, stdout: stdoutLines.join("\n"), stderr: "", figures: [], error: `MicroPython failed inside the script: ${(err as Error).message}` };
  }
  const env = parseRunnerEnvelope(raw);
  if (!env) throw new Error("the MicroPython runner returned no envelope");
  return envelopeToResult(env, { paths, stdout: stdoutLines.join("\n"), status });
}

export function runMicroPython(req: CodeRunRequest): Promise<CodeRunResult> {
  return queue.run(() => runOne(req));
}

export const run = runMicroPython;
```

- [ ] **Step 2: Verify + commit**

```bash
git rm -q src/code/not-yet.ts
npx tsc --noEmit && npm test && npm run build && npm run build:engine
git add src/code/micropython.ts src/code/run.ts
git commit -m "feat(code): MicroPython runs the dialect runner — the lightest tier, stdout from the engine's line buffer"
```

---

### Task 3: Schema voice, prompt sentence, a bundled example

- Schema `language` description: replace "micropython is not available yet — never emit it." with "micropython = the minimal tier (half a megabyte, boots in milliseconds; pandas and plotly.express emulations, a partial standard library) — only when the request asks for it."
- Prompt: replace "Never emit `\"micropython\"` yet." with "Emit `\"language\": \"micropython\"` only when the request asks for it (the minimal tier: pandas and plotly.express, a partial standard library)."
- Test (`tests/code-runtimes.test.ts`): the prompt contains `"language": "micropython"` and no longer contains `Never emit `"micropython"``.
- Bundled example: a MicroPython data-only script feeding `bar_chart` (the GDP frames), `show: "none"`, three beats.
- Verify `npm test`; commit.

---

### Task 4: Smoke, ledger, push

- Browser (Playwright vs dev :5178): boot timing; `print` + trailing expression; `pd.DataFrame` → table; `px.bar` → figure; `df.plot` token; tokens into `bar_chart` and `scatter_plot`; an error → envelope; a Brython regression (one), pyodide + R (one each).
- Ledger `docs/superpowers/plans/2026-09-03-code-runtimes-m4-ledger.md`; push; `ls-remote`.
