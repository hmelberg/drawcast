// The pyodide runtime: boot once (memoized in-flight promise — the openstat
// bootstrap pattern, which fixes the half-initialized-interpreter race), run
// serialized, capture stdout/stderr, echo a trailing expression like a
// notebook, and harvest matplotlib figures as PNG data URIs with their pixel
// dimensions (layout needs the aspect; PNG bytes 16-24 carry w/h).
//
// Reached ONLY via dynamic import from run.ts. Never import this module
// statically anywhere: that would put pyodide's loader chunk on every page.
//
// Honest limitations (M1): no interrupt — pyodide can only be interrupted
// with a SharedArrayBuffer + COOP/COEP headers, which this app does not set —
// so a timeout returns an error envelope to the caller while the WASM finishes
// in the background, and the next queued run still waits for it to complete.

import { PYODIDE_VERSION, type CodeFigure, type CodeRunRequest, type CodeRunResult, type CodeTable } from "./run";
import { dataHarvestScript, parseHarvest } from "./harvest";

const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
const RUN_TIMEOUT_MS = 180_000;

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
  loadPackage(name: string): Promise<unknown>;
  setStdout(opts?: { batched: (s: string) => void }): void;
  setStderr(opts?: { batched: (s: string) => void }): void;
}

declare global {
  interface Window {
    loadPyodide?: (opts?: object) => Promise<Pyodide>;
  }
}

let bootPromise: Promise<Pyodide> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Marks an error as "the runtime itself couldn't start", not a script bug —
 *  read back in runPython's envelope() below so codeExecutionErrors can warn
 *  instead of blocking generation on it. */
function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function boot(): Promise<Pyodide> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("python needs a browser to run in");
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = PYODIDE_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(unavailable("could not load the Python runtime (offline?)"));
        document.head.appendChild(script);
      });
    }
    return window.loadPyodide!();
  })();
  // A failed boot must not poison every later run: clear so the next render retries.
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

/** Hidden runtime deps that a library needs present the first time it is
 *  imported (they aren't visible top-level imports, so loadPackagesFromImports
 *  misses them, and the library memoizes a failed lookup if they're absent). */
const KNOWN_DEPS: Record<string, string[]> = {
  plotly: ["numpy", "pandas"],
};

/** Install one package and PROVE it imports. Live-probed ground truth (v314):
 *  loadPackage installs distribution wheels and silently no-ops for names it
 *  doesn't know; micropip installs pure-PyPI packages and can fail for
 *  distribution ones. Neither installer's silence can be trusted, so verify by
 *  import after each and only a verified import counts. */
async function installPackage(
  py: { loadPackage(n: string): Promise<unknown>; runPythonAsync(c: string): Promise<unknown> },
  pkg: string,
): Promise<boolean> {
  const importable = () => py.runPythonAsync(`import importlib as __il\n__il.import_module(${JSON.stringify(pkg)})`);
  try {
    await py.loadPackage(pkg).catch(() => undefined);
    await importable();
    return true;
  } catch {
    /* fall through to micropip */
  }
  try {
    await py.loadPackage("micropip");
    await py.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(pkg)})`);
    await importable();
    return true;
  } catch {
    return false;
  }
}

/** Notebook semantics: exec the body, eval a trailing expression, print it. */
function execWrapper(code: string): string {
  return [
    "import ast as __ast",
    `__code = ${JSON.stringify(code)}`,
    "__tree = __ast.parse(__code) if __code.strip() else None",
    // Each run is an independent script, not a notebook cell: a fresh
    // namespace per run stops scripts from contaminating each other's
    // globals, which would otherwise make the IndexedDB cache order-dependent.
    '__g = {"__name__": "__main__"}',
    "if __tree and __tree.body and isinstance(__tree.body[-1], __ast.Expr):",
    "    __expr = __ast.Expression(__tree.body[-1].value)",
    "    __body = __ast.Module(__tree.body[:-1], type_ignores=[])",
    "    exec(compile(__body, '<code>', 'exec'), __g)",
    "    __result = eval(compile(__expr, '<code>', 'eval'), __g)",
    "    if __result is not None:",
    // A trailing DataFrame is drawn as a ruled TABLE (harvested below), not
    // printed as its cramped text repr — checked by type name so a script
    // that never imports pandas pays nothing.
    "        if type(__result).__name__ == 'DataFrame':",
    "            __g['__show_table'] = __result",
    "        else:",
    "            print(__result)",
    "elif __tree:",
    "    exec(compile(__tree, '<code>', 'exec'), __g)",
  ].join("\n");
}

/** Harvest plotly figures: any plotly Figure left in a variable by the run
 *  (the wrapper's __g namespace survives between runPythonAsync calls) comes
 *  back as its to_json() — rendered to a static PNG by plotly.js below. */
const PLOTLY_HARVEST = `
import json as __json
__pl = []
try:
    import plotly.graph_objects as __pgo
    for __v in list(__g.values()):
        if isinstance(__v, __pgo.Figure):
            __pl.append(__v.to_json())
except Exception:
    pass
__json.dumps(__pl)
`;

/** openstat's production pin — the family's verified plotly.js. */
const PLOTLY_JS_URL = "https://cdn.plot.ly/plotly-2.32.0.min.js";

interface PlotlyJs {
  newPlot(el: HTMLElement, data: unknown[], layout: object, config?: object): Promise<unknown>;
  toImage(el: HTMLElement, opts: { format: string; width: number; height: number; scale?: number }): Promise<string>;
  purge(el: HTMLElement): void;
}

let plotlyPromise: Promise<PlotlyJs> | null = null;
function loadPlotly(): Promise<PlotlyJs> {
  if (plotlyPromise) return plotlyPromise;
  plotlyPromise = new Promise<PlotlyJs>((resolve, reject) => {
    const w = window as unknown as { Plotly?: PlotlyJs };
    if (w.Plotly) return resolve(w.Plotly);
    const script = document.createElement("script");
    script.src = PLOTLY_JS_URL;
    script.onload = () => (w.Plotly ? resolve(w.Plotly) : reject(new Error("plotly.js loaded but exposed no global")));
    script.onerror = () => reject(new Error("could not load plotly.js"));
    document.head.appendChild(script);
  });
  plotlyPromise.catch(() => {
    plotlyPromise = null;
  });
  return plotlyPromise;
}

/** Each plotly figure (fig.to_json()) → offscreen render → static PNG data
 *  URI at 2× scale, so it drops into the SVG scene and the video export like
 *  any matplotlib image. Live interactivity is the v2 overlay, not this. */
async function renderPlotlyFigures(jsons: string[]): Promise<CodeFigure[]> {
  const plotly = await loadPlotly();
  const out: CodeFigure[] = [];
  for (const j of jsons) {
    const fig = JSON.parse(j) as { data?: unknown[]; layout?: { width?: number; height?: number } };
    const w = fig.layout?.width ?? 700;
    const h = fig.layout?.height ?? 450;
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;";
    document.body.appendChild(holder);
    try {
      await plotly.newPlot(holder, fig.data ?? [], { ...fig.layout, width: w, height: h }, { staticPlot: true });
      const href = await plotly.toImage(holder, { format: "png", width: w, height: h, scale: 2 });
      out.push({ href, w: w * 2, h: h * 2 });
    } finally {
      plotly.purge(holder);
      holder.remove();
    }
  }
  return out;
}

/** Harvest a trailing DataFrame (stashed as __g['__show_table'] by the
 *  wrapper) as columns + stringified rows, capped so a giant frame can't
 *  bloat the cached envelope. Everything is stringified HERE, so layout stays
 *  pure geometry. */
const TABLE_CAP = 30;
const TABLE_HARVEST = `
import json as __json
__tables = []
try:
    import pandas as __pd
    __t = __g.get('__show_table')
    if __t is not None:
        __cols = [str(c) for c in __t.columns]
        __all = [['' if __pd.isna(__x) else str(__x) for __x in __r]
                 for __r in __t.itertuples(index=False, name=None)]
        __cap = ${TABLE_CAP}
        __tables.append({
            "columns": __cols,
            "rows": __all[:__cap],
            "truncated": max(0, len(__all) - __cap),
        })
except Exception:
    pass
__json.dumps(__tables)
`;

/** Harvest matplotlib figures as base64 PNG + pixel dims; no-op without matplotlib. */
const HARVEST = `
import json as __json, io as __io, base64 as __b64, struct as __struct
__figs = []
try:
    import matplotlib.pyplot as __plt
except Exception:
    __plt = None
if __plt is not None:
    for __n in __plt.get_fignums():
        __fig = __plt.figure(__n)
        __buf = __io.BytesIO()
        __fig.savefig(__buf, format="png", bbox_inches="tight", dpi=110)
        __data = __buf.getvalue()
        __w, __h = __struct.unpack(">II", __data[16:24])
        __figs.append({"data": __b64.b64encode(__data).decode("ascii"), "w": __w, "h": __h})
    __plt.close("all")
__json.dumps(__figs)
`;

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status = req.onStatus ?? (() => undefined);
  status("loading", "Loading Python…");
  const py = await boot();
  status("loading", "Loading packages…");
  await py.loadPackagesFromImports(req.code).catch(() => undefined);
  let stdout = "";
  let stderr = "";
  let error: string | undefined;
  // Distribution packages auto-load above (numpy, pandas, matplotlib, …). A
  // pure-PyPI package the distribution lacks surfaces as ModuleNotFoundError:
  // install it with micropip and retry the WHOLE script — fresh namespace,
  // fresh buffers, so a half-run attempt leaves no trace — at most twice.
  for (let attempt = 0; ; attempt++) {
    stdout = "";
    stderr = "";
    py.setStdout({ batched: (s) => (stdout += s + "\n") });
    py.setStderr({ batched: (s) => (stderr += s + "\n") });
    error = undefined;
    try {
      status("running", "Running…");
      await py.runPythonAsync(execWrapper(req.code));
    } catch (err) {
      // Pyodide's PythonError message carries the full Python traceback.
      error = (err as Error).message;
    }
    py.setStdout();
    py.setStderr();
    if (!error || attempt >= 4) break;
    // Two shapes of "package missing": Python's own ModuleNotFoundError, and
    // the courtesy ImportError some libraries raise instead (plotly express:
    // "Plotly Express requires numpy to be installed").
    const requires = /requires\s+([A-Za-z0-9_.]+)\s+to\s+be\s+installed/.exec(error);
    const missing = /ModuleNotFoundError: No module named '([^']+)'/.exec(error) ?? requires;
    if (!missing) break;
    const pkg = missing[1].split(".")[0];
    status("loading", `Installing ${pkg}…`);
    try {
      // A package's HIDDEN runtime deps must be present the FIRST time it
      // imports far enough to check for them — plotly memoizes a failed numpy
      // lookup deep in _plotly_utils, and clearing sys.modules does not undo
      // that. So preload known deps BEFORE installing the package itself.
      // (loadPackagesFromImports only sees the top-level import, not these.)
      for (const dep of KNOWN_DEPS[pkg] ?? []) await installPackage(py, dep);
      if (!(await installPackage(py, pkg))) break; // not installable anywhere
    } catch {
      break;
    }
  }
  let figures: CodeFigure[] = [];
  if (!error && /\b(matplotlib|pyplot|plt)\b/.test(req.code)) {
    try {
      const raw = await py.runPythonAsync(HARVEST);
      if (typeof raw === "string") {
        figures = (JSON.parse(raw) as { data: string; w: number; h: number }[]).map((f) => ({
          href: `data:image/png;base64,${f.data}`,
          w: f.w,
          h: f.h,
        }));
      }
    } catch {
      /* a failed harvest loses the plot, not the run */
    }
  }
  let tables: CodeTable[] = [];
  if (!error && /\b(pandas|DataFrame)\b/.test(req.code)) {
    try {
      const raw = await py.runPythonAsync(TABLE_HARVEST);
      if (typeof raw === "string") tables = JSON.parse(raw) as CodeTable[];
    } catch {
      /* a failed table harvest loses the table, not the run */
    }
  }
  if (!error && /\bplotly\b/.test(req.code)) {
    try {
      const raw = await py.runPythonAsync(PLOTLY_HARVEST);
      const jsons = typeof raw === "string" ? (JSON.parse(raw) as string[]) : [];
      if (jsons.length > 0) {
        status("running", "Rendering charts…");
        figures = figures.concat(await renderPlotlyFigures(jsons));
      }
    } catch {
      /* a failed chart render loses the chart, not the run */
    }
  }
  // Data harvest for the template bridge: only the paths the spec referenced,
  // only after a clean run. A failed harvest is an error PER PATH (the
  // resolver drops that param and the template default applies) — never a
  // lost run.
  let data: Record<string, unknown> | undefined;
  let dataErrors: Record<string, string> | undefined;
  const paths = req.paths ?? [];
  if (!error && paths.length > 0) {
    status("running", "Reading data…");
    try {
      const harvested = parseHarvest(await py.runPythonAsync(dataHarvestScript(paths)));
      data = harvested.data;
      dataErrors = harvested.errors;
    } catch (err) {
      // String(err), not err.message: a pyodide PythonError arrives with the
      // traceback in its message, but a thrown non-Error (a string, a proxy)
      // has no .message at all and would read "harvest failed: undefined".
      dataErrors = Object.fromEntries(paths.map((p) => [p, `harvest failed: ${String(err)}`]));
    }
  }
  return {
    ok: !error,
    stdout: stdout.replace(/\n$/, ""),
    stderr: stderr.replace(/\n$/, ""),
    figures,
    tables,
    error,
    ...(data !== undefined ? { data } : {}),
    ...(dataErrors !== undefined && Object.keys(dataErrors).length > 0 ? { dataErrors } : {}),
  };
}

export function runPython(req: CodeRunRequest): Promise<CodeRunResult> {
  const run = queue.then(() => runOne(req));
  // The queue chains on the REAL execution, not the raced result: a timed-out
  // run returns early to its caller below, but the next run still waits here
  // until the abandoned execution actually finishes — otherwise its late
  // output would be misattributed into the next run's buffers.
  queue = run.catch(() => undefined);
  const envelope = (err: unknown): CodeRunResult => ({
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: (err as Error).message,
    runtimeUnavailable: (err as { runtimeUnavailable?: boolean } | undefined)?.runtimeUnavailable === true,
  });
  const settled = run.catch(envelope);
  // Definite-assignment: the executor below runs synchronously, so the id is
  // set before anything reads it.
  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<CodeRunResult>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ ok: false, stdout: "", stderr: "", figures: [], error: `timed out after ${RUN_TIMEOUT_MS / 1000}s` }),
      RUN_TIMEOUT_MS,
    );
  });
  // Clear the watchdog once the real run settles first, so a fast script
  // doesn't leave a 3-minute timer alive (keeping node/test processes open).
  settled.then(() => clearTimeout(timeoutId));
  return Promise.race([settled, timeout]);
}
