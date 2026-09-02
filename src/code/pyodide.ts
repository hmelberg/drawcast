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

import { PYODIDE_VERSION, type CodeFigure, type CodeRunRequest, type CodeRunResult } from "./run";

const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
const RUN_TIMEOUT_MS = 180_000;

interface Pyodide {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<unknown>;
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
    "        print(__result)",
    "elif __tree:",
    "    exec(compile(__tree, '<code>', 'exec'), __g)",
  ].join("\n");
}

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
  py.setStdout({ batched: (s) => (stdout += s + "\n") });
  py.setStderr({ batched: (s) => (stderr += s + "\n") });
  let error: string | undefined;
  try {
    status("running", "Running…");
    await py.runPythonAsync(execWrapper(req.code));
  } catch (err) {
    // Pyodide's PythonError message carries the full Python traceback.
    error = (err as Error).message;
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
  py.setStdout();
  py.setStderr();
  return { ok: !error, stdout: stdout.replace(/\n$/, ""), stderr: stderr.replace(/\n$/, ""), figures, error };
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
