# Code runtimes M3 — Brython: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `language: brython` code elements run in the viewer's browser through pinned Brython 3.12.0 with the openstat pure-Python library set (pandas, plotly.express, numpy, matplotlib, scipy.stats, statsmodels, seaborn emulations), behind the same facade and envelope as pyodide and R — and the compiler learns to prefer it for scripts that need no heavy numerics.

**Architecture:** A dialect-neutral runner script (`drawcast_runner.py`, vendored beside the libraries under `public/pylib/<PYLIB_VERSION>/`) owns everything Python: fresh globals per run, stdout capture, the statement-aware trailing expression, table/figure/data harvest, and lazy module registration. `pylib.ts` holds the library registry, the import scan and the base-URL probe; `dialect.ts` turns the runner's JSON envelope into a `CodeRunResult` (plotly figures through the shared renderer); `brython.ts` is only the loader plus the queue. A shared `serial.ts` extracts the queue + watchdog that pyodide and webR each carried.

**Tech Stack:** TypeScript (Vite, vitest), Brython 3.12.0 from jsdelivr, the openstat `brython/*.py` libraries (snapshot 2026-09-03), plotly.js 2.32.0 (existing), CPython 3.13 locally as the sanity harness (the libraries run under it).

**Spec:** `docs/superpowers/specs/2026-09-03-code-runtimes-design.md` (§4.7, §6, §7, §8, §9).

## Global Constraints

- Core edits: only `src/code/run.ts` (dispatch entry), `src/spec/schema.ts` (the `language` description), the prompt bullet, examples/few-shots. Nothing in layout/render/resolve/hoist/player/export.
- Brython pinned `3.12.0`; `PYLIB_VERSION = "2026-09-03"`; cache tag `bry3.12.0+2026-09-03` (already in `languages.ts`).
- Vendored library files are byte-identical copies of openstat's; openstat's engine JS is NOT copied.
- Runner Python must be valid under CPython 3.13 (sanity harness), Brython 3.12 and, where cheap, MicroPython (no `ast`, no `sys.stdout` swap assumed, no `traceback` assumed) — M4 finishes the MicroPython side.
- Caps and messages identical to `harvest.ts` (5000 numbers, 200 rows, 30 table rows; caps are errors).
- Failures are envelopes, never throws; never cached; `runtimeUnavailable` for a runtime that could not start.
- `npm test`, `tsc`, both builds green at every commit; commit per task; push at the end.

---

### Task 1: `serial.ts` — one queue + watchdog for every runtime

**Files:**
- Create: `src/code/serial.ts`
- Modify: `src/code/pyodide.ts` (replace `runPython`'s body), `src/code/webr.ts` (replace `runR`'s body)
- Test: `tests/code-dialect.test.ts` (new; first describe)

**Interfaces:**
- Produces: `class RunQueue { constructor(timeoutMs = 180_000); run(work: () => Promise<CodeRunResult>): Promise<CodeRunResult> }` — serializes, maps a throw to an envelope (with `runtimeUnavailable` passthrough), races a watchdog, clears the timer when the real run settles first, and chains the queue on the REAL execution (not the raced result).

- [ ] **Step 1: Failing test**

```ts
// tests/code-dialect.test.ts
import { describe, expect, test } from "vitest";
import { RunQueue } from "../src/code/serial";
import type { CodeRunResult } from "../src/code/run";

const ok = (stdout: string): CodeRunResult => ({ ok: true, stdout, stderr: "", figures: [] });

describe("RunQueue — serialized runs, envelopes, watchdog", () => {
  test("runs are serialized in order; a throw becomes an envelope and does not block the next", async () => {
    const q = new RunQueue(1000);
    const order: string[] = [];
    const a = q.run(async () => { await new Promise((r) => setTimeout(r, 20)); order.push("a"); return ok("a"); });
    const b = q.run(async () => { order.push("b"); throw new Error("boom"); });
    const c = q.run(async () => { order.push("c"); return ok("c"); });
    expect((await a).stdout).toBe("a");
    expect((await b).error).toBe("boom");
    expect((await c).stdout).toBe("c");
    expect(order).toEqual(["a", "b", "c"]);
  });
  test("a tagged unavailable error keeps its tag", async () => {
    const q = new RunQueue(1000);
    const res = await q.run(async () => { const e = new Error("offline") as Error & { runtimeUnavailable?: boolean }; e.runtimeUnavailable = true; throw e; });
    expect(res.runtimeUnavailable).toBe(true);
  });
  test("the watchdog returns a timeout envelope while the next run still waits for the slow one", async () => {
    const q = new RunQueue(30);
    let slowDone = false;
    const slow = q.run(async () => { await new Promise((r) => setTimeout(r, 80)); slowDone = true; return ok("slow"); });
    const next = q.run(async () => ok(slowDone ? "after" : "before"));
    expect((await slow).error).toMatch(/timed out/);
    expect((await next).stdout).toBe("after");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/code/serial.ts
// One promise queue and one watchdog per runtime, so runs never interleave
// and a hung WASM cannot hang the caller. Shared by every runtime module.
//
// The queue chains on the REAL execution, not the raced result: a timed-out
// run returns early to its caller, but the next run still waits until the
// abandoned execution actually finishes — otherwise its late output would be
// misattributed into the next run's buffers (no runtime here can interrupt).
import type { CodeRunResult } from "./envelope";

export const RUN_TIMEOUT_MS = 180_000;

export function errorEnvelope(err: unknown): CodeRunResult {
  return {
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: err instanceof Error ? err.message : String(err),
    runtimeUnavailable: (err as { runtimeUnavailable?: boolean } | undefined)?.runtimeUnavailable === true,
  };
}

export class RunQueue {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly timeoutMs = RUN_TIMEOUT_MS) {}

  run(work: () => Promise<CodeRunResult>): Promise<CodeRunResult> {
    const real = this.queue.then(work);
    this.queue = real.catch(() => undefined);
    const settled = real.catch(errorEnvelope);
    let timeoutId!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<CodeRunResult>((resolve) => {
      timeoutId = setTimeout(
        () => resolve({ ok: false, stdout: "", stderr: "", figures: [], error: `timed out after ${this.timeoutMs / 1000}s` }),
        this.timeoutMs,
      );
    });
    // Clear the watchdog once the real run settles first, so a fast script
    // doesn't leave a 3-minute timer alive (keeping node/test processes open).
    settled.then(() => clearTimeout(timeoutId));
    return Promise.race([settled, timeout]);
  }
}
```

Then `pyodide.ts`: `const queue = new RunQueue(); export function runPython(req) { return queue.run(() => runOne(req)); }` and delete its `RUN_TIMEOUT_MS`, `queue` variable and the old body. Same in `webr.ts` for `runR`. Keep `unavailable()` helpers.

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit && npm test
git add src/code/serial.ts src/code/pyodide.ts src/code/webr.ts tests/code-dialect.test.ts
git commit -m "refactor(code): one RunQueue (serialization + watchdog) shared by every runtime"
```

---

### Task 2: The vendored libraries and `drawcast_runner.py`

**Files:**
- Create: `public/pylib/2026-09-03/drawcast_runner.py`
- Create (copies): `public/pylib/2026-09-03/brython/{pandas_brython,plotly_express_brython,numpy_brython,matplotlib_brython,scipy_stats_brython,statsmodels_brython,seaborn_brython}.py`
- Create: `scripts/pylib-sanity.py` (CPython harness; not shipped)
- Test: `tests/code-dialect.test.ts` (second describe: runner contract as text)

**Interfaces (the runner's JS-facing functions; every argument and return is a str):**
- `_register_module(name, source) -> ''` or a traceback; `_alias_module(alias, canonical) -> ''` or a message.
- `_run(code, paths_json) -> json` with `{stdout, error, table, figures, data, errors}`: `stdout` (captured text, `''` when the dialect refused the capture — the JS side then supplies its own buffer), `error` (traceback text or `''`), `table` (`{columns, rows, truncated}` or null), `figures` (list of plotly JSON strings), `data`/`errors` (the bridge, only when paths were given).

- [ ] **Step 1: Copy the libraries**

```bash
mkdir -p public/pylib/2026-09-03/brython
for f in pandas_brython plotly_express_brython numpy_brython matplotlib_brython scipy_stats_brython statsmodels_brython seaborn_brython; do
  cp ../openstat/brython/$f.py public/pylib/2026-09-03/brython/$f.py
done
```

- [ ] **Step 2: Write the runner**

```python
# public/pylib/<version>/drawcast_runner.py
# drawcast's Python-dialect runner, shared by Brython and MicroPython. Runs a
# script in fresh globals with stdout captured, echoes a trailing expression
# the notebook way, and harvests what the envelope needs: a trailing
# DataFrame as a ruled table, plotly figures (plotly.express, and the
# plotly-backed matplotlib/seaborn emulations), and the {id.path} data
# bridge under the same rules and caps as src/code/harvest.ts.
#
# Dialect-neutral on purpose: no `ast` (MicroPython lacks it), the stdout
# swap is attempted and reported (MicroPython forbids it — the engine reads
# its own buffer instead), tracebacks via `traceback` or
# `sys.print_exception`. Valid CPython too: scripts/pylib-sanity.py runs it
# against the vendored libraries locally.
import sys, json
from io import StringIO

_CAP_N = 5000
_CAP_ROWS = 200
_TABLE_CAP = 30


def _format_exc(e):
    if hasattr(sys, 'print_exception'):        # MicroPython
        buf = StringIO()
        sys.print_exception(e, buf)
        return buf.getvalue()
    import traceback                            # CPython / Brython
    return traceback.format_exc()


class _Mod:
    """MicroPython has no types.ModuleType: a bare namespace object stands in."""
    def __init__(self, name, g):
        self.__name__ = name
        for k in g:
            setattr(self, k, g[k])


def _register_module(name, source):
    """Make `source` importable as `name`; idempotent; '' or a traceback."""
    if name in sys.modules:
        return ''
    try:
        import types
        mod = types.ModuleType(name)
        g = mod.__dict__
    except Exception:
        mod = None
        g = {'__name__': name}
    try:
        exec(compile(source, name + '.py', 'exec'), g)
    except Exception as e:
        return _format_exc(e)
    sys.modules[name] = mod if mod is not None else _Mod(name, g)
    return ''


def _alias_module(alias, canonical):
    """`import alias` -> the registered `canonical`. A dotted alias needs
    its parent registered first; the child is set as the parent's attribute
    so `import a.b as x` binds x."""
    if canonical not in sys.modules:
        return 'unknown module: ' + canonical
    if '.' in alias:
        parent, _, child = alias.rpartition('.')
        if parent not in sys.modules:
            return 'unknown parent module: ' + parent
        setattr(sys.modules[parent], child, sys.modules[canonical])
    sys.modules[alias] = sys.modules[canonical]
    return ''


# ── trailing expression (ported from openstat's runners: no `ast`) ─────────

def _split_tail(code):
    """(head_src, tail_src) with tail the final top-level expression, or
    (code, None). Column-0 lines scanned from the end; the first candidate
    whose tail compiles as an expression AND whose head compiles as a
    module wins (a lone ')' or an unindented continuation is skipped)."""
    lines = code.split('\n')
    while lines and lines[-1].strip() == '':
        lines.pop()
    if not lines:
        return code, None
    candidates = []
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if line and line[:1] not in (' ', '\t'):
            candidates.append(i)
            if len(candidates) >= 1000:
                break
    if 0 not in candidates:
        candidates.append(0)
    for i in candidates:
        tail = '\n'.join(lines[i:])
        stripped = tail.strip()
        if not stripped or stripped.startswith('#'):
            continue
        try:
            compile(tail, '<code>', 'eval')
        except SyntaxError:
            continue
        head = '\n'.join(lines[:i]) or 'pass'
        try:
            compile(head, '<code>', 'exec')
        except SyntaxError:
            continue
        return head, tail
    return code, None


def _suppressed(tail):
    """A bare `_name` (matplotlib's `_ = plt.hist(...)` idiom) or a trailing
    ';' asks for silence; the expression still runs."""
    t = tail.split('#', 1)[0].strip() if '#' in tail else tail.strip()
    if t.endswith(';'):
        return True
    if not t.startswith('_'):
        return False
    for ch in t:
        if not (ch == '_' or ch.isalpha() or ch.isdigit()):
            return False
    return True


# ── harvest helpers (the harvest.ts rules) ─────────────────────────────────

def _is_df(v):
    return type(v).__name__ == 'DataFrame'


def _is_series(v):
    return type(v).__name__ == 'Series'


def _isna(v):
    if type(v).__name__ in ('NaN', 'NAType', 'NaTType'):
        return True
    return isinstance(v, float) and v != v


def _cell(v):
    return '' if _isna(v) or v is None else str(v)


def _table(df):
    cols = [str(c) for c in df.columns]
    rows = [list(r) for r in df.values]
    return {
        'columns': cols,
        'rows': [[_cell(x) for x in r] for r in rows[:_TABLE_CAP]],
        'truncated': max(0, len(rows) - _TABLE_CAP),
    }


def _scalar(v):
    if v is None or _isna(v):
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return None if (f != f or f in (float('inf'), float('-inf'))) else v
    if isinstance(v, str):
        return v
    if hasattr(v, 'item'):
        try:
            return _scalar(v.item())
        except Exception:
            pass
    return str(v)


def _count(v):
    if isinstance(v, (list, tuple)):
        return sum(_count(x) for x in v)
    if isinstance(v, dict):
        if 'rows' in v and 'columns' in v and isinstance(v['rows'], list):
            return len(v['rows']) * max(1, len(v['columns']))
        return sum(_count(x) for x in v.values())
    return 1


def _convert(v):
    if _is_df(v):
        rows = [list(r) for r in v.values]
        if len(rows) > _CAP_ROWS:
            raise ValueError('%d rows, the cap is %d — aggregate or sample in the script' % (len(rows), _CAP_ROWS))
        return {'columns': [str(c) for c in v.columns], 'rows': [[_scalar(x) for x in r] for r in rows]}
    if _is_series(v) or (hasattr(v, 'tolist') and not isinstance(v, (str, bytes))):
        v = v.tolist()
    if isinstance(v, range):
        v = list(v)
    if isinstance(v, (list, tuple)):
        if len(v) > _CAP_N:
            raise ValueError('%d values, the cap is %d — downsample or aggregate in the script' % (len(v), _CAP_N))
        return [_convert(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _convert(x) for k, x in v.items()}
    if v is None or _isna(v) or isinstance(v, (bool, int, float, str)):
        return _scalar(v)
    if hasattr(v, 'item'):
        return _scalar(v)
    raise TypeError('%s is not data (a number, string, list, dict, Series or DataFrame)' % type(v).__name__)


def _harvest_data(g, paths):
    out = {'data': {}, 'errors': {}}
    for p in paths:
        try:
            segs = p.split('.')
            if segs[0] not in g:
                raise NameError('no variable %s' % segs[0])
            obj = g[segs[0]]
            for s in segs[1:]:
                if _is_df(obj) and s in [str(c) for c in obj.columns]:
                    obj = obj[s]
                elif isinstance(obj, dict) and s in obj:
                    obj = obj[s]
                elif hasattr(obj, s):
                    obj = getattr(obj, s)
                else:
                    raise ValueError('no column, key or attribute %s' % s)
            val = _convert(obj)
            if _count(val) > _CAP_N:
                raise ValueError('%d values, the cap is %d — downsample or aggregate in the script' % (_count(val), _CAP_N))
            out['data'][p] = val
        except Exception as e:
            out['errors'][p] = '%s' % e
    return out


def _is_figure(v):
    return hasattr(v, 'to_plotly_json_str') and callable(getattr(v, 'to_plotly_json_str', None))


# ── the run ────────────────────────────────────────────────────────────────

def _run(code, paths_json):
    paths = json.loads(paths_json) if paths_json else []
    g = {'__name__': '__main__'}
    figures = []
    mpl = sys.modules.get('matplotlib_brython')
    if mpl is not None:
        # plt.show() (and savefig) hand the current figure to us instead of
        # printing openstat's embed marker; plt.figure() resets, so several
        # shows are several figures — the `figures: K` beats.
        def _show():
            if mpl._state['traces'] or mpl._state['layout']:
                figures.append(mpl.gcf().to_plotly_json_str())
            mpl._reset()
        mpl.show = _show
        mpl._show = _show
        mpl._reset()
    buf = StringIO()
    old = sys.stdout
    captured = True
    try:
        sys.stdout = buf
    except Exception:
        captured = False                          # MicroPython: engine buffers
    error = ''
    table = None
    tail_value = None
    try:
        head, tail = _split_tail(code)
        if tail is None:
            exec(compile(code, '<code>', 'exec'), g)
        else:
            exec(compile(head, '<code>', 'exec'), g)
            tail_value = eval(compile(tail, '<code>', 'eval'), g)
            if tail_value is not None and not _suppressed(tail):
                if _is_df(tail_value):
                    table = _table(tail_value)
                elif _is_figure(tail_value):
                    pass                          # harvested below
                else:
                    print(tail_value)
    except BaseException as e:
        if not isinstance(e, Exception):
            raise
        error = _format_exc(e)
    finally:
        if captured:
            try:
                sys.stdout = old
            except Exception:
                pass
    if not error:
        if mpl is not None and (mpl._state['traces'] or mpl._state['layout']):
            figures.append(mpl.gcf().to_plotly_json_str())
            mpl._reset()
        seen = set()
        for v in list(g.values()) + ([tail_value] if tail_value is not None else []):
            if _is_figure(v) and id(v) not in seen:
                seen.add(id(v))
                try:
                    figures.append(v.to_plotly_json_str())
                except Exception:
                    pass
    env = {'stdout': buf.getvalue() if captured else '', 'error': error, 'table': table, 'figures': figures}
    if not error and paths:
        h = _harvest_data(g, paths)
        env['data'] = h['data']
        env['errors'] = h['errors']
    return json.dumps(env)
```

- [ ] **Step 3: CPython sanity harness** — `scripts/pylib-sanity.py`:

```python
# Runs drawcast_runner.py + the vendored libraries under local CPython, the
# way the browser will (module registration, then _run). Not shipped; a
# developer check before the browser smoke. `python3 scripts/pylib-sanity.py`.
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public', 'pylib', '2026-09-03')
src = open(os.path.join(ROOT, 'drawcast_runner.py')).read()
g = {'__name__': 'drawcast_runner'}
exec(compile(src, 'drawcast_runner.py', 'exec'), g)
LIBS = [('pandas_brython', ['pandas']), ('plotly_express_brython', ['plotly', 'plotly.express']),
        ('numpy_brython', ['numpy']), ('matplotlib_brython', ['matplotlib', 'matplotlib.pyplot']),
        ('scipy_stats_brython', ['scipy', 'scipy.stats']),
        ('statsmodels_brython', ['statsmodels', 'statsmodels.formula', 'statsmodels.formula.api']),
        ('seaborn_brython', ['seaborn'])]
for name, aliases in LIBS:
    err = g['_register_module'](name, open(os.path.join(ROOT, 'brython', name + '.py')).read())
    assert err == '', err
    for a in aliases:
        assert g['_alias_module'](a, name) == ''
def run(title, code, paths=()):
    env = json.loads(g['_run'](code, json.dumps(list(paths))))
    print('===', title, '===')
    print(json.dumps({k: (v[:60] + '…' if isinstance(v, str) and len(v) > 60 else v) for k, v in env.items() if k != 'figures'}, ensure_ascii=False))
    print('figures:', [f[:50] for f in env['figures']])
run('console + table', 'import pandas as pd\nx = [1, 2, 3]\nprint("sum", sum(x))\ndf = pd.DataFrame({"a": [1.5, 2, None], "b": ["p", "q", "s"]})\ndf', ['x', 'df', 'df.b', 'nope', 'df.zz'])
run('px figure in a variable', 'import pandas as pd\nimport plotly.express as px\ndf = pd.DataFrame({"c": ["a", "b"], "v": [3, 5]})\nfig = px.bar(df, x="c", y="v")')
run('matplotlib two figures', 'import matplotlib.pyplot as plt\nplt.figure()\n_ = plt.plot([1, 2], [3, 4])\nplt.show()\nplt.figure()\n_ = plt.bar(["a", "b"], [1, 2])')
run('error', 'y = 1\nz = y / 0\nprint("never")')
run('suppressed + trailing expr', 'import numpy as np\na = np.array([1, 2, 3])\n_x = a.tolist()\na.tolist()', ['a', '_x'])
run('statsmodels', 'import pandas as pd\nimport statsmodels.formula.api as smf\ndf = pd.DataFrame({"x": [1, 2, 3, 4], "y": [2.1, 3.9, 6.2, 7.8]})\nm = smf.ols("y ~ x", data=df).fit()\nprint(round(m.params["x"], 2))')
```

- [ ] **Step 4: Node test on the runner text** (append to `tests/code-dialect.test.ts`):

```ts
import { readFileSync } from "node:fs";
import { PYLIB_VERSION } from "../src/code/languages";

describe("drawcast_runner.py — contract as text", () => {
  const src = readFileSync(new URL(`../public/pylib/${PYLIB_VERSION}/drawcast_runner.py`, import.meta.url), "utf8");
  test("exposes the three JS-facing functions and the harvest caps", () => {
    for (const fn of ["def _run(code, paths_json)", "def _register_module(name, source)", "def _alias_module(alias, canonical)"]) expect(src).toContain(fn);
    expect(src).toContain("_CAP_N = 5000");
    expect(src).toContain("_CAP_ROWS = 200");
    expect(src).toContain("_TABLE_CAP = 30");
    expect(src).toContain("downsample or aggregate in the script");
  });
  test("never imports ast (MicroPython) and tolerates a refused stdout swap", () => {
    expect(src).not.toMatch(/^\s*import ast/m);
    expect(src).toContain("captured = False");
  });
});
```

- [ ] **Step 5: Run the sanity harness and the tests; commit**

```bash
python3 scripts/pylib-sanity.py
npx vitest run tests/code-dialect.test.ts
git add public/pylib scripts/pylib-sanity.py tests/code-dialect.test.ts
git commit -m "feat(code): the dialect runner and the vendored openstat library snapshot (2026-09-03)"
```

Expected from the harness: table with `""` for the None cell; `x` → `[1,2,3]`, `df` → `{columns, rows}` with `null`, `df.b` → strings, `nope`/`df.zz` errors; one figure from px; two matplotlib figures; the error envelope carries a ZeroDivisionError traceback and stdout is empty; `_x` suppressed but harvested; statsmodels prints a slope near 1.93.

---

### Task 3: `pylib.ts` — registry, import scan, base-URL probe

**Files:**
- Create: `src/code/pylib.ts`
- Test: `tests/code-dialect.test.ts` (third describe)

**Interfaces:**
- `interface PyLib { file: string; aliases: string[]; deps: string[]; tokens?: string[] }`
- `BRYTHON_LIBS: Record<string, PyLib>`; `MICROPYTHON_LIBS` added in M4.
- `libsFor(code: string, libs: Record<string, PyLib>): string[]` — canonical names in load order (deps first, deduplicated).
- `resolvePylib(): Promise<{ base: string; runner: string }>` — memoized; candidates: `window.DRAWCAST_PYLIB_BASE`, `new URL("pylib/<v>/", document.baseURI)`, `https://hmelberg.github.io/drawcast/pylib/<v>/`; the first whose `drawcast_runner.py` fetches OK wins.
- `fetchLib(base: string, file: string): Promise<string>`.

- [ ] **Step 1: Failing tests**

```ts
import { BRYTHON_LIBS, libsFor } from "../src/code/pylib";

describe("pylib registry — which vendored modules a script needs", () => {
  test("import forms, aliases, dotted names, and the .plot token", () => {
    expect(libsFor("import pandas as pd\ndf = pd.DataFrame({})", BRYTHON_LIBS)).toEqual(["pandas_brython"]);
    expect(libsFor("import plotly.express as px", BRYTHON_LIBS)).toEqual(["plotly_express_brython"]);
    expect(libsFor("from scipy.stats import norm", BRYTHON_LIBS)).toEqual(["scipy_stats_brython"]);
    expect(libsFor("df.plot(kind='bar')", BRYTHON_LIBS)).toEqual(["plotly_express_brython"]);
  });
  test("dependencies come first, once", () => {
    expect(libsFor("import seaborn as sns\nimport matplotlib.pyplot as plt", BRYTHON_LIBS)).toEqual(["plotly_express_brython", "matplotlib_brython", "seaborn_brython"]);
    expect(libsFor("import statsmodels.formula.api as smf", BRYTHON_LIBS)).toEqual(["scipy_stats_brython", "statsmodels_brython"]);
  });
  test("an unknown import is not the registry's business (the script's own ModuleNotFoundError is)", () => {
    expect(libsFor("import sklearn\nimport json", BRYTHON_LIBS)).toEqual([]);
  });
  test("every alias's parent precedes it, so dotted aliases can register", () => {
    for (const lib of Object.values(BRYTHON_LIBS)) {
      for (const a of lib.aliases) {
        if (!a.includes(".")) continue;
        const parent = a.slice(0, a.lastIndexOf("."));
        expect(lib.aliases.indexOf(parent)).toBeLessThan(lib.aliases.indexOf(a));
      }
    }
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/code/pylib.ts
// The vendored pure-Python libraries the dialects load lazily: which file
// serves which import name, what it depends on, and which token in a script
// (df.plot) pulls it in without an import. Ported from openstat's
// LIB_REGISTRY + scanImports; over-matching is harmless (a library the
// script never uses loads once), under-matching surfaces as the script's
// own honest ModuleNotFoundError.
//
// Where the files live: PYLIB_BASE candidates in order — an explicit
// window.DRAWCAST_PYLIB_BASE, the app's own pylib/<version>/ (dev server,
// Pages, Netlify), and drawcast's published origin (the engine vendored
// into another host has no pylib folder of its own; the engine build has
// publicDir: false). The first candidate that serves the runner wins.
import { PYLIB_VERSION } from "./languages";

export interface PyLib {
  file: string;
  /** Import names that resolve to this module; a dotted alias must follow its parent. */
  aliases: string[];
  deps: string[];
  /** Substrings whose presence loads the module even without an import. */
  tokens?: string[];
}

export const BRYTHON_LIBS: Record<string, PyLib> = {
  pandas_brython: { file: "brython/pandas_brython.py", aliases: ["pandas"], deps: [] },
  plotly_express_brython: { file: "brython/plotly_express_brython.py", aliases: ["plotly", "plotly.express"], deps: [], tokens: [".plot"] },
  numpy_brython: { file: "brython/numpy_brython.py", aliases: ["numpy"], deps: [] },
  matplotlib_brython: { file: "brython/matplotlib_brython.py", aliases: ["matplotlib", "matplotlib.pyplot"], deps: ["plotly_express_brython"] },
  scipy_stats_brython: { file: "brython/scipy_stats_brython.py", aliases: ["scipy", "scipy.stats"], deps: [] },
  statsmodels_brython: {
    file: "brython/statsmodels_brython.py",
    aliases: ["statsmodels", "statsmodels.formula", "statsmodels.formula.api"],
    deps: ["scipy_stats_brython"],
  },
  seaborn_brython: { file: "brython/seaborn_brython.py", aliases: ["seaborn"], deps: ["matplotlib_brython", "plotly_express_brython"] },
};

const PUBLISHED_BASE = `https://hmelberg.github.io/drawcast/pylib/${PYLIB_VERSION}/`;

function canonicalOf(name: string, libs: Record<string, PyLib>): string | null {
  const root = name.split(".")[0];
  if (libs[root]) return root;
  for (const [key, lib] of Object.entries(libs)) if (lib.aliases.includes(root)) return key;
  return null;
}

/** Canonical module names a script needs, dependencies first, each once. */
export function libsFor(code: string, libs: Record<string, PyLib>): string[] {
  const wanted: string[] = [];
  const want = (name: string) => {
    const c = canonicalOf(name, libs);
    if (c && !wanted.includes(c)) wanted.push(c);
  };
  for (const [key, lib] of Object.entries(libs)) {
    if (lib.tokens?.some((t) => code.includes(t))) want(key);
  }
  const re = /^[ \t]*(?:from[ \t]+([A-Za-z_][A-Za-z0-9_.]*)|import[ \t]+([^#\r\n]+))/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m[1]) want(m[1]);
    else for (const part of m[2].split(",")) {
      const t = part.trim().split(/[ \t]/)[0];
      if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) want(t);
    }
  }
  const out: string[] = [];
  const visit = (name: string, trail: string[]) => {
    if (out.includes(name)) return;
    if (trail.includes(name)) throw new Error(`circular pylib dependency: ${[...trail, name].join(" → ")}`);
    for (const d of libs[name].deps) visit(d, [...trail, name]);
    out.push(name);
  };
  for (const w of wanted) visit(w, []);
  return out;
}

let resolved: Promise<{ base: string; runner: string }> | null = null;

export function resolvePylib(): Promise<{ base: string; runner: string }> {
  if (resolved) return resolved;
  resolved = (async () => {
    const w = window as unknown as { DRAWCAST_PYLIB_BASE?: string };
    const candidates = [
      w.DRAWCAST_PYLIB_BASE,
      new URL(`pylib/${PYLIB_VERSION}/`, document.baseURI).href,
      PUBLISHED_BASE,
    ].filter((c): c is string => typeof c === "string" && c !== "");
    for (const base of candidates) {
      try {
        const r = await fetch(base + "drawcast_runner.py");
        if (r.ok) return { base, runner: await r.text() };
      } catch {
        /* next candidate */
      }
    }
    throw new Error("could not find the Python library files (pylib)");
  })();
  resolved.catch(() => {
    resolved = null;
  });
  return resolved;
}

export async function fetchLib(base: string, file: string): Promise<string> {
  const r = await fetch(base + file);
  if (!r.ok) throw new Error(`could not fetch ${file} (${r.status})`);
  return r.text();
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run tests/code-dialect.test.ts && npx tsc --noEmit
git add src/code/pylib.ts tests/code-dialect.test.ts
git commit -m "feat(code): pylib registry — import scan, dependency order, base-URL probe"
```

---

### Task 4: `dialect.ts` + `brython.ts` + dispatch

**Files:**
- Create: `src/code/dialect.ts`, `src/code/brython.ts`
- Modify: `src/code/run.ts` (`brython: () => import("./brython")`)
- Test: `tests/code-dialect.test.ts` (fourth describe: envelope → result)

**Interfaces:**
- `dialect.ts`: `parseRunnerEnvelope(raw: unknown): RunnerEnvelope | null`; `envelopeToResult(env: RunnerEnvelope, opts: { paths: string[]; stdout?: string; status: StatusFn }): Promise<CodeRunResult>` — `stdout` overrides the envelope's when the dialect could not capture (MicroPython).
- `brython.ts`: `run(req)`.

- [ ] **Step 1: Failing tests**

```ts
import { envelopeToResult, parseRunnerEnvelope } from "../src/code/dialect";

describe("dialect envelope → CodeRunResult", () => {
  test("stdout, table, data and errors map straight through; a run error is the envelope's error", async () => {
    const env = parseRunnerEnvelope(JSON.stringify({ stdout: "hi\n", error: "", table: { columns: ["a"], rows: [["1"]], truncated: 0 }, figures: [], data: { x: [1, 2] }, errors: { y: "no variable y" } }));
    expect(env).not.toBeNull();
    const res = await envelopeToResult(env!, { paths: ["x", "y"], status: () => undefined });
    expect(res).toMatchObject({ ok: true, stdout: "hi", tables: [{ columns: ["a"] }], data: { x: [1, 2] }, dataErrors: { y: "no variable y" } });
    const bad = await envelopeToResult(parseRunnerEnvelope(JSON.stringify({ stdout: "", error: "Traceback…ZeroDivisionError", table: null, figures: [] }))!, { paths: [], status: () => undefined });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("ZeroDivisionError");
  });
  test("an engine-side stdout buffer replaces an uncaptured envelope stdout", async () => {
    const env = parseRunnerEnvelope(JSON.stringify({ stdout: "", error: "", table: null, figures: [] }))!;
    expect((await envelopeToResult(env, { paths: [], stdout: "from js\n", status: () => undefined })).stdout).toBe("from js");
  });
  test("junk is rejected", () => {
    expect(parseRunnerEnvelope("nope")).toBeNull();
    expect(parseRunnerEnvelope(JSON.stringify({ stdout: 1 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `dialect.ts`**

```ts
// src/code/dialect.ts
// The TS half of the Python-dialect runner (public/pylib/<v>/
// drawcast_runner.py): parse its JSON envelope and finish it into a
// CodeRunResult — plotly figures through the shared renderer, the data
// bridge through parseHarvest's shape. Brython and MicroPython differ only
// in how they load and where stdout comes from, so both end here.
import type { CodeRunResult, CodeTable } from "./envelope";
import { renderPlotlyFigures } from "./plotly-render";

export type StatusFn = (phase: "loading" | "running", detail: string) => void;

export interface RunnerEnvelope {
  stdout: string;
  error: string;
  table: CodeTable | null;
  figures: string[];
  data?: Record<string, unknown>;
  errors?: Record<string, string>;
}

export function parseRunnerEnvelope(raw: unknown): RunnerEnvelope | null {
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw) as Partial<RunnerEnvelope>;
    if (!p || typeof p !== "object") return null;
    if (typeof p.stdout !== "string" || typeof p.error !== "string" || !Array.isArray(p.figures)) return null;
    return {
      stdout: p.stdout,
      error: p.error,
      table: p.table && typeof p.table === "object" ? (p.table as CodeTable) : null,
      figures: p.figures.filter((f): f is string => typeof f === "string"),
      data: p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : undefined,
      errors: p.errors && typeof p.errors === "object" ? Object.fromEntries(Object.entries(p.errors).map(([k, v]) => [k, String(v)])) : undefined,
    };
  } catch {
    return null;
  }
}

export async function envelopeToResult(
  env: RunnerEnvelope,
  opts: { paths: string[]; stdout?: string; status: StatusFn },
): Promise<CodeRunResult> {
  const error = env.error !== "" ? env.error : undefined;
  const stdout = (opts.stdout ?? env.stdout).replace(/\n$/, "");
  let figures: CodeRunResult["figures"] = [];
  if (!error && env.figures.length > 0) {
    opts.status("running", "Rendering charts…");
    try {
      figures = await renderPlotlyFigures(env.figures);
    } catch {
      /* a failed chart render loses the chart, not the run */
    }
  }
  const dataErrors = env.errors && Object.keys(env.errors).length > 0 ? env.errors : undefined;
  return {
    ok: !error,
    stdout,
    stderr: "",
    figures,
    tables: !error && env.table ? [env.table] : [],
    error,
    ...(!error && opts.paths.length > 0 && env.data !== undefined ? { data: env.data } : {}),
    ...(!error && dataErrors !== undefined ? { dataErrors } : {}),
  };
}
```

- [ ] **Step 3: Implement `brython.ts`**

```ts
// src/code/brython.ts
// The Brython runtime: pinned core + stdlib from jsdelivr, the drawcast
// runner compiled once with __BRYTHON__.runPythonSource, vendored libraries
// registered lazily per script through the runner's _register_module.
// Brython transpiles Python to JavaScript, so a script runs in the page's
// own thread — no worker, no interrupt; the RunQueue watchdog is the guard.
//
// Reached ONLY via dynamic import from run.ts.
//
// Verified against the jsdelivr brython@3.12.0 bundle (openstat's notes):
// brython() takes no arguments; runPythonSource(source, name) takes the
// module name second and returns the module object, whose functions accept
// and return JS strings directly.
import type { CodeRunRequest, CodeRunResult } from "./run";
import { RUNTIME_VERSION } from "./languages";
import { RunQueue } from "./serial";
import { BRYTHON_LIBS, fetchLib, libsFor, resolvePylib } from "./pylib";
import { envelopeToResult, parseRunnerEnvelope, type StatusFn } from "./dialect";

const CDN = `https://cdn.jsdelivr.net/npm/brython@${RUNTIME_VERSION.brython}/`;
const CORE_URL = `${CDN}brython.min.js`;
const STDLIB_URL = `${CDN}brython_stdlib.js`;

interface RunnerModule {
  _register_module(name: string, source: string): string;
  _alias_module(alias: string, canonical: string): string;
  _run(code: string, pathsJson: string): string;
}
interface Booted {
  mod: RunnerModule;
  base: string;
}

let bootPromise: Promise<Booted> | null = null;
const registered = new Set<string>();
const queue = new RunQueue();

function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(unavailable("could not load the Brython runtime (offline?)"));
    document.head.appendChild(s);
  });
}

function boot(): Promise<Booted> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("Brython needs a browser to run in");
    const w = window as unknown as { brython?: () => void; __BRYTHON__?: { runPythonSource(src: string, name: string): RunnerModule } };
    if (!w.__BRYTHON__) {
      await addScript(CORE_URL);
      await addScript(STDLIB_URL);
    }
    const { base, runner } = await resolvePylib().catch((e) => {
      throw unavailable((e as Error).message);
    });
    w.brython!();
    const mod = w.__BRYTHON__!.runPythonSource(runner, "drawcast_runner");
    return { mod, base };
  })();
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function ensureLibs(b: Booted, names: string[], status: StatusFn): Promise<void> {
  for (const name of names) {
    if (registered.has(name)) continue;
    const lib = BRYTHON_LIBS[name];
    status("loading", `Loading ${lib.aliases[0] ?? name}…`);
    const source = await fetchLib(b.base, lib.file);
    const err = b.mod._register_module(name, source);
    if (err) throw new Error(`could not load ${name}: ${err}`);
    for (const alias of lib.aliases) {
      const aerr = b.mod._alias_module(alias, name);
      if (aerr) throw new Error(`could not alias ${alias}: ${aerr}`);
    }
    registered.add(name);
  }
}

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status: StatusFn = req.onStatus ?? (() => undefined);
  status("loading", "Loading Brython…");
  const b = await boot();
  await ensureLibs(b, libsFor(req.code, BRYTHON_LIBS), status);
  status("running", "Running…");
  const paths = req.paths ?? [];
  const raw = b.mod._run(req.code, JSON.stringify(paths));
  const env = parseRunnerEnvelope(raw);
  if (!env) throw new Error("the Brython runner returned no envelope");
  return envelopeToResult(env, { paths, status });
}

export function runBrython(req: CodeRunRequest): Promise<CodeRunResult> {
  return queue.run(() => runOne(req));
}

export const run = runBrython;
```

Then `run.ts`: `brython: () => import("./brython"),`.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run tests/code-dialect.test.ts tests/code-runtimes.test.ts && npx tsc --noEmit && npm run build && npm run build:engine
git add src/code/dialect.ts src/code/brython.ts src/code/run.ts tests/code-dialect.test.ts
git commit -m "feat(code): Brython runs the dialect runner — lazy vendored libraries, plotly through the shared renderer"
```

---

### Task 5: Prompt, schema voice, few-shot, example

**Files:**
- Modify: `src/spec/schema.ts` (`language` description), `src/llm/prompts/compiler-v1.md` (the tier sentence), `src/llm/prompts/fewshots.json` (+1), `src/examples.json` (+1)
- Test: `tests/code-runtimes.test.ts` (extend the prompt test: `"language": "brython"` present; the "never emit brython" clause gone)

The policy switch is gated on Task 6's AI-idiom smoke (spec §6.4). Write the prompt in Task 5 but keep the sentence "Never emit `"brython"` … yet" until Task 6 records the gate; Task 6 then flips it (one edit, one test line).

- [ ] **Step 1:** schema description → `"code: the runtime that executes the script. brython = the light tier (loads in about a second): CPython syntax and standard library, pandas, plotly.express, numpy, matplotlib, scipy.stats, statsmodels, seaborn emulations — the default for a script that needs no heavy numerics. python = full CPython via pyodide (real numpy/scipy/matplotlib, PyPI on demand; tens of megabytes). r = R via webR (base or tidyverse; library() auto-installs; a trailing data frame draws as a table, plots as figures). micropython is not available yet — never emit it."`

- [ ] **Step 2:** few-shot — a Brython script feeding `bar_chart` through a token (mirror the dice few-shot with pure Python `random`):

```json
{
  "request": "Show what happens to the shares of dice faces when you roll a hundred times, then ten thousand — in pure Python.",
  "spec": {
    "title": "Six faces, 100 rolls then 10,000",
    "template": "bar_chart",
    "params": { "labels": ["1", "2", "3", "4", "5", "6"], "values": "{dice.frames}", "stage": 0, "ylim": [0, 0.3], "y_label": "Share of rolls", "value_labels": true, "title": "Six faces, 100 rolls then 10,000" },
    "elements": [
      { "id": "dice", "type": "code", "language": "brython", "show": "none",
        "code": "import random\nrandom.seed(7)\ndef shares(n):\n    rolls = [random.randint(1, 6) for _ in range(n)]\n    return [round(rolls.count(f) / n, 3) for f in range(1, 7)]\nframes = [shares(100), shares(10000)]" }
    ],
    "commands": [
      { "draw": ["title"], "speak": "Is a die fair? Ask it a hundred times, then ten thousand." },
      { "draw": ["axes", "bar_1", "bar_2", "bar_3", "bar_4", "bar_5", "bar_6"], "parallel": true, "speak": "A hundred rolls: the faces come up unevenly." },
      { "animate": { "stage": 1 }, "duration": 3, "speak": "Ten thousand rolls, and every face settles toward one sixth." }
    ]
  }
}
```

- [ ] **Step 3:** bundled example — pandas + plotly.express in Brython, split view, stepped:

```json
{
  "request": "In light Python (Brython): group a small table with pandas and chart the means with plotly express",
  "spec": {
    "title": "Group means, light Python",
    "elements": [
      { "id": "grp", "type": "code", "language": "brython", "show": "split", "width": 900,
        "code": "import pandas as pd\nimport plotly.express as px\ndf = pd.DataFrame({\"group\": [\"a\", \"a\", \"b\", \"b\", \"c\"], \"x\": [2, 4, 6, 8, 10]})\nmeans = df.groupby(\"group\")[\"x\"].mean().reset_index()\nprint(means)\nfig = px.bar(means, x=\"group\", y=\"x\", title=\"Mean x per group\")" }
    ],
    "commands": [
      { "draw": ["grp", "grp_line_1", "grp_line_2"], "parallel": true, "speak": "pandas and plotly express — in a runtime that loads in a second." },
      { "draw": ["grp_line_3"], "speak": "Five rows, three groups." },
      { "draw": ["grp_line_4", "grp_line_5"], "speak": "Group, average, print." },
      { "draw": ["grp_line_6"], "speak": "And a bar chart left in a variable draws itself." },
      { "draw": ["grp_out"], "speak": "Means of three, seven and ten." }
    ]
  }
}
```

(Verify `groupby(...)["x"].mean().reset_index()` in the sanity harness first; if the emulation lacks `reset_index`, use `df.groupby("group").mean()` and adjust the print.)

- [ ] **Step 4:** run `npm test`; commit.

---

### Task 6: Smoke, the AI-idiom gate, the policy switch, ledger, push

- [ ] **Step 1:** dev server + Playwright harness as in M2. Brython list: `print`; trailing expression echo; `pd.DataFrame` → table; `px.bar` in a variable → chart; `df.plot` token; `plt.hist` + `plt.show()` twice with `figures: 2`; tokens feeding `bar_chart` and `scatter_plot`; an unsupported pandas call → error envelope; statsmodels ols; seaborn; the two bundled Brython specs; pyodide + R regression (one each).
- [ ] **Step 2: AI-idiom gate** — ten scripts in the style the compiler writes, run through Brython, pass/fail recorded in the ledger: f-string with `:,` and `:.2f`; `statistics.mean/stdev`; `itertools.accumulate`; `collections.Counter`; `dataclasses`; `random.gauss` seeded; dict comprehension + `sorted(key=lambda)`; `math` + list comprehension; pandas `groupby().mean()` + trailing frame; `px.scatter` with `color=`. Gate: ≥ 8/10 clean on the first try → flip the prompt policy (Brython default for light scripts); otherwise leave the "never emit" sentence and record why.
- [ ] **Step 3:** flip (or not) the prompt sentence + schema line + the test line; `npm test`, builds; commit.
- [ ] **Step 4:** ledger `docs/superpowers/plans/2026-09-03-code-runtimes-m3-ledger.md`; push; `git ls-remote` check.
