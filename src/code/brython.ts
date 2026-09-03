// The Brython runtime: pinned core + stdlib from jsdelivr, the drawcast
// runner compiled once with __BRYTHON__.runPythonSource, vendored libraries
// registered lazily per script through the runner's _register_module.
// Brython transpiles Python to JavaScript, so a script runs in the page's
// own thread — no worker, no interrupt. The RunQueue watchdog covers the
// async waits (downloads, library fetches); a synchronous infinite loop in
// a script hangs the tab, exactly as pyodide on the main thread would.
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
interface BrythonWindow {
  brython?: () => void;
  __BRYTHON__?: { runPythonSource(src: string, name: string): RunnerModule };
}

let bootPromise: Promise<Booted> | null = null;
const registered = new Set<string>();
const queue = new RunQueue();

/** Marks an error as "the runtime itself couldn't start", not a script bug. */
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
    const w = window as unknown as BrythonWindow;
    if (!w.__BRYTHON__) {
      await addScript(CORE_URL);
      await addScript(STDLIB_URL);
    }
    const { base, runner } = await resolvePylib().catch((e: Error) => {
      throw unavailable(e.message);
    });
    try {
      w.brython!();
      const mod = withAlertMuted(() => w.__BRYTHON__!.runPythonSource(runner, "drawcast_runner"));
      return { mod, base };
    } catch (err) {
      throw unavailable(`the Brython runtime could not start: ${(err as Error).message}`);
    }
  })();
  // A failed boot must not poison every later run: clear so the next render retries.
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

/** Brython reports some internal failures (a stdlib module that fails to
 *  compile, say) through window.alert — a modal that freezes the page for
 *  every viewer. While the runner is busy, alert() logs instead; the
 *  script's own failure still comes back as an error envelope. */
function withAlertMuted<T>(fn: () => T): T {
  const w = window as unknown as { alert?: (m?: unknown) => void };
  const original = w.alert;
  w.alert = (m?: unknown) => console.warn("[drawcast brython] alert muted:", String(m ?? ""));
  try {
    return fn();
  } finally {
    w.alert = original;
  }
}

async function ensureLibs(b: Booted, names: string[], status: StatusFn): Promise<void> {
  for (const name of names) {
    if (registered.has(name)) continue;
    const lib = BRYTHON_LIBS[name];
    status("loading", `Loading ${lib.aliases[0] ?? name}…`);
    // Our vendored file failing to arrive or to compile is never the
    // script's fault: tagged unavailable so the check warns, not errors.
    let source: string;
    try {
      source = await fetchLib(b.base, lib.file);
    } catch (err) {
      throw unavailable(`could not fetch the ${name} library: ${(err as Error).message}`);
    }
    const err = withAlertMuted(() => b.mod._register_module(name, source));
    if (err) throw unavailable(`could not load ${name}: ${err}`);
    for (const alias of lib.aliases) {
      const aerr = b.mod._alias_module(alias, name);
      if (aerr) throw unavailable(`could not alias ${alias}: ${aerr}`);
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
  let raw: string;
  try {
    raw = withAlertMuted(() => b.mod._run(req.code, JSON.stringify(paths)));
  } catch (err) {
    // A JavaScript-level failure inside Brython (a stdlib module that
    // half-imported, say) is not a Python exception the runner can catch:
    // name the runtime so the panel's message reads as its fault, not the
    // script's.
    return { ok: false, stdout: "", stderr: "", figures: [], error: `Brython failed inside the script: ${(err as Error).message}` };
  }
  const env = parseRunnerEnvelope(raw);
  if (!env) throw new Error("the Brython runner returned no envelope");
  return envelopeToResult(env, { paths, status });
}

export function runBrython(req: CodeRunRequest): Promise<CodeRunResult> {
  return queue.run(() => runOne(req));
}

/** The runtime-module contract run.ts dispatches through. */
export const run = runBrython;
