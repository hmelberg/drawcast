// The microdata runtime: the real microdata.no emulator (m2py.py, vendored
// into public/mdlib/<version>/) running on the SAME pyodide the `python`
// language uses. microdata is not a Python dialect — it is its own command
// language — but its interpreter is a Python program, so drawcast runs it
// rather than reimplementing 10k lines of parser.
//
// Reached ONLY via dynamic import from run.ts. It imports ./pyodide, which
// must likewise never be imported statically anywhere.
//
// The division of labour: this module fetches, installs and calls; every
// rule about what the emulator's answer MEANS lives in ./microdata-output,
// which node can test, and the Python seam is ./mdlib's runner, which
// scripts/mdlib-sanity.py runs under local CPython.

import { dataHarvestScript, parseHarvest } from "./harvest";
import { fetchMdlibFile, resolveMdlib } from "./mdlib";
import { missingModule, parseMicrodataOutput, unknownVariableError } from "./microdata-output";
import { renderPlotlyFigures } from "./plotly-render";
import { KNOWN_DEPS, bootPyodide, installPackage, pyodideQueue, type Pyodide } from "./pyodide";
import { publishMicrodataVariables } from "./vocabulary";
import type { CodeFigure, CodeRunRequest, CodeRunResult } from "./run";

/** Where the snapshot is written inside pyodide's filesystem. */
const FS_DIR = "/home/pyodide/mdlib";

/** What m2py.py and functions.py import at module load. plotly, statsmodels
 *  and lifelines are NOT here: the emulator imports them inside the commands
 *  that need them, and the miss-and-retry below installs whichever a script
 *  turns out to want — so a script that only tabulates never pays for them. */
const CORE_PACKAGES = ["numpy", "pandas", "scipy"];

/** The emulator's own default (index.html's getImportLimit), so a number a
 *  learner sees here is the number they will see on microdata.no. */
const DEFAULT_ROWS = 10000;

let bootPromise: Promise<Booted> | null = null;

/** Boot pyodide, write the snapshot into its filesystem, and build the
 *  emulator. Memoized; a failure clears it so a later render retries. */
interface Booted {
  py: Pyodide;
  /** Every FDB variable the shipped catalogue knows — the only thing that can
   *  tell a real variable from an invented one, since the mock-data engine
   *  happily fabricates a column for either. */
  variables: Set<string>;
}

function boot(status: (phase: "loading" | "running", detail: string) => void): Promise<Booted> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    status("loading", "Loading Python…");
    const py = await bootPyodide();
    status("loading", "Loading pandas…");
    await py.loadPackage([...CORE_PACKAGES]).catch(() => undefined);
    status("loading", "Loading the microdata emulator…");
    const { base, runner, files } = await resolveMdlib();
    await py.runPythonAsync(runner);
    await py.runPythonAsync(`import os\nos.makedirs(${JSON.stringify(FS_DIR)}, exist_ok=True)`);
    await call(py, "_md_setup", [FS_DIR]);
    // Every file the snapshot's manifest names — the emulator, the metadata
    // it reads, and the codelists it opens by relative path at run time.
    const sources = await Promise.all(files.map(async (f) => [f, await fetchMdlibFile(base, f)] as const));
    for (const [name, source] of sources) await call(py, "_md_install", [name, source]);
    const catalog = sources.find(([n]) => n === "variable_metadata.json")?.[1] ?? "";
    await call(py, "_md_boot", [catalog, String(DEFAULT_ROWS)]);
    const variables = catalogVariables(catalog);
    // The editors' word list reads these through code/vocabulary — real
    // variable names are the one thing that stops a viewer inventing one,
    // and the mock engine fabricates a column for an invented name.
    publishMicrodataVariables(variables);
    return { py, variables };
  })();
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

/** The catalogue's variable names. Its shape is either {variables: {...}} or
 *  the mapping itself — the runner folds the same two shapes. */
function catalogVariables(text: string): Set<string> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const vars = (parsed?.variables as Record<string, unknown>) ?? parsed;
    return new Set(Object.keys(vars ?? {}));
  } catch {
    return new Set();
  }
}

/** Call one of the runner's JS-facing functions. Arguments are bound as
 *  globals, never interpolated into the source — one of them is the 640 kB
 *  variable catalogue, and another is the viewer's own script. They answer
 *  with '' or a message, so a failure is a returned string, not a throw. */
async function call(py: Pyodide, fn: string, args: string[]): Promise<string> {
  const names = args.map((_, i) => `_md_arg${i}`);
  args.forEach((a, i) => py.globals.set(names[i], a));
  try {
    const out = await py.runPythonAsync(`${fn}(${names.join(", ")})`);
    const text = typeof out === "string" ? out : "";
    if (fn !== "_md_run" && text !== "") throw new Error(`microdata ${fn}: ${text}`);
    return text;
  } finally {
    for (const n of names) {
      try {
        py.globals.delete(n);
      } catch {
        /* a namespace that will not let go of a name is not worth failing over */
      }
    }
  }
}

async function runOne(req: CodeRunRequest): Promise<CodeRunResult> {
  const status = req.onStatus ?? (() => undefined);
  const { py, variables } = await boot(status);
  // Before running: the emulator invents data for ANY name, so a script that
  // imports a variable the catalogue lacks would run clean and teach a
  // variable that does not exist. Fail it here and the repair round fixes it.
  const invented = unknownVariableError(req.code, variables);
  if (invented) return fail(invented);
  status("running", "Running…");

  // The emulator LOGS a missing import as a failed command instead of
  // raising it, so the "install what the script wanted and retry" loop
  // pyodide.ts runs on exceptions runs here on the output text. At most
  // three installs: plotly for a chart, statsmodels for a regression,
  // lifelines for a survival curve.
  let parsed = parseMicrodataOutput("");
  for (let attempt = 0; ; attempt++) {
    const raw = await call(py, "_md_run", [req.code]);
    const envelope = JSON.parse(raw) as { output: string; error: string };
    if (envelope.error !== "") return fail(envelope.error);
    parsed = parseMicrodataOutput(envelope.output);
    const pkg = missingModule(parsed.error);
    if (!pkg || attempt >= 2) break;
    status("loading", `Installing ${pkg}…`);
    try {
      for (const dep of KNOWN_DEPS[pkg] ?? []) await installPackage(py, dep);
      if (!(await installPackage(py, pkg))) break;
    } catch {
      break;
    }
  }

  let figures: CodeFigure[] = [];
  if (!parsed.error && parsed.figures.length > 0) {
    status("running", "Rendering charts…");
    try {
      figures = await renderPlotlyFigures(parsed.figures);
    } catch {
      /* a failed chart render loses the chart, not the run */
    }
  }

  // The data bridge reads the same `__g` the runner filled with every
  // dataset by name (and `df` for the active one), through the shared
  // harvest — so "{md.df}" and "{md.demo.inntekt}" obey exactly the rules
  // every other runtime obeys.
  let data: Record<string, unknown> | undefined;
  let dataErrors: Record<string, string> | undefined;
  const paths = req.paths ?? [];
  if (!parsed.error && paths.length > 0) {
    status("running", "Reading data…");
    try {
      const harvested = parseHarvest(await py.runPythonAsync(dataHarvestScript(paths)));
      data = harvested.data;
      dataErrors = harvested.errors;
    } catch (err) {
      dataErrors = Object.fromEntries(paths.map((p) => [p, `harvest failed: ${String(err)}`]));
    }
  }

  return {
    ok: !parsed.error,
    stdout: parsed.stdout,
    stderr: "",
    figures,
    tables: parsed.tables,
    ...(parsed.error !== undefined ? { error: parsed.error } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(dataErrors !== undefined && Object.keys(dataErrors).length > 0 ? { dataErrors } : {}),
  };
}

function fail(error: string): CodeRunResult {
  return { ok: false, stdout: "", stderr: "", figures: [], tables: [], error };
}

export function run(req: CodeRunRequest): Promise<CodeRunResult> {
  // The SAME queue the python runtime uses: one pyodide, one script at a time.
  return pyodideQueue.run(() => runOne(req));
}
