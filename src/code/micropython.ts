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
interface MicroPythonModule {
  loadMicroPython(opts: { url: string; stdout: (line: string) => void; stderr?: (line: string) => void; linebuffer: boolean }): Promise<MicroPython>;
}
interface Booted {
  base: string;
  run: (code: string, pathsJson: string) => string;
  registerModule: (name: string, source: string) => string;
  aliasModule: (alias: string, canonical: string) => string;
}

let bootPromise: Promise<Booted> | null = null;
const registered = new Set<string>();
const queue = new RunQueue();
/** print() lines since the current run started (the queue serializes runs,
 *  so the buffer is never shared between two scripts). The VM flushes a line
 *  only on its newline, so the runner ends every run with a bare print():
 *  a partial last line lands in THIS run's buffer, never the next one's. */
const stdoutLines: string[] = [];
const stderrLines: string[] = [];

/** Marks an error as "the runtime itself couldn't start", not a script bug. */
function unavailable(message: string): Error & { runtimeUnavailable: true } {
  const err = new Error(message) as Error & { runtimeUnavailable: true };
  err.runtimeUnavailable = true;
  return err;
}

function boot(): Promise<Booted> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (typeof document === "undefined") throw unavailable("MicroPython needs a browser to run in");
    let esm: MicroPythonModule;
    try {
      esm = (await import(/* @vite-ignore */ `${MPY_BASE}micropython.mjs`)) as MicroPythonModule;
    } catch {
      throw unavailable("could not load the MicroPython runtime (offline?)");
    }
    // Everything up to a working VM with the runner loaded is the runtime's
    // problem, never the script's.
    try {
      const mp = await esm.loadMicroPython({
        url: `${MPY_BASE}micropython.wasm`,
        stdout: (line) => stdoutLines.push(line),
        stderr: (line) => stderrLines.push(line),
        linebuffer: true,
      });
      const { base, runner } = await resolvePylib();
      mp.runPython(runner);
      return {
        base,
        run: mp.globals.get("_run"),
        registerModule: mp.globals.get("_register_module"),
        aliasModule: mp.globals.get("_alias_module"),
      };
    } catch (err) {
      throw unavailable(`the MicroPython runtime could not start: ${(err as Error).message}`);
    }
  })();
  // A failed boot must not poison every later run: clear so the next render retries.
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
    // Our vendored file failing to arrive or to compile is never the
    // script's fault: tagged unavailable so the check warns, not errors.
    let source: string;
    try {
      source = await fetchLib(b.base, lib.file);
    } catch (err) {
      throw unavailable(`could not fetch the ${name} library: ${(err as Error).message}`);
    }
    const err = b.registerModule(name, source);
    if (err) throw unavailable(`could not load ${name}: ${err}`);
    for (const alias of lib.aliases) {
      const aerr = b.aliasModule(alias, name);
      if (aerr) throw unavailable(`could not alias ${alias}: ${aerr}`);
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
  stderrLines.length = 0;
  let raw: string;
  try {
    raw = b.run(req.code, JSON.stringify(paths));
  } catch (err) {
    // A VM-level failure is not a Python exception the runner can catch:
    // name the runtime so the panel's message reads as its fault.
    return {
      ok: false,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
      figures: [],
      error: `MicroPython failed inside the script: ${(err as Error).message}`,
    };
  }
  const env = parseRunnerEnvelope(raw);
  if (!env) throw new Error("the MicroPython runner returned no envelope");
  return envelopeToResult(env, { paths, stdout: stdoutLines.join("\n"), stderr: stderrLines.join("\n"), status });
}

export function runMicroPython(req: CodeRunRequest): Promise<CodeRunResult> {
  return queue.run(() => runOne(req));
}

/** The runtime-module contract run.ts dispatches through. */
export const run = runMicroPython;
