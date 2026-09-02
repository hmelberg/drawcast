// Code execution facade: one narrow envelope between the drawcast spec and
// whatever runtime actually runs the script. Runtime modules (pyodide.ts,
// later webr.ts) are reached ONLY via dynamic import, so a spec without a
// code element never loads a byte of them; tests inject a fake runner.
//
// Results are cached in IndexedDB (the portrait/source store) keyed by
// language + pinned runtime version + a hash of the code, so a script
// executes once per browser — replays, scrubs and re-renders hit the cache.
// Failures come back as envelopes, never thrown, and are never cached: an
// offline or transient CDN failure must retry on the next render.

import { cacheGet, cachePut } from "../render/portrait";
import { CODE_VERSION, decodeCodeResult, type CodeRunResult } from "./envelope";
import { RUNTIME_VERSION, cacheTag, type Language } from "./languages";

// Envelope shape lives in ./envelope (dependency-free — layout imports it
// directly from there); re-exported here so every existing
// `from "../code/run"` import keeps working unchanged.
export { CODE_VERSION, decodeCodeResult, type CodeFigure, type CodeRunResult, type CodeTable } from "./envelope";

// Languages, their pinned versions and cache tags live in ./languages (one
// declaration for types, schema, dispatch and the check); re-exported here.
export { LANGUAGES, RUNTIME_VERSION, cacheTag, type Language } from "./languages";

/** pyodide's pin — kept under its old name for existing importers. */
export const PYODIDE_VERSION = RUNTIME_VERSION.python;

export interface CodeRunRequest {
  language: Language;
  code: string;
  /** Dotted paths to harvest after the run ("y", "df.gdp"). Empty/absent = no harvest. */
  paths?: string[];
  onStatus?: (phase: "loading" | "running", detail: string) => void;
}

export interface CodeRunDeps {
  runner?: (req: CodeRunRequest) => Promise<CodeRunResult>;
  cacheGet?: (key: string) => Promise<string | null>;
  cachePut?: (key: string, value: string) => Promise<void>;
}

/** FNV-1a — the same short stable tag render/source.ts uses for quotes. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code" | "paths">): string {
  const tag = cacheTag(req.language);
  // The code length rides along with the hash to kill hash-collision risk
  // (two different scripts landing on the same 32-bit FNV-1a digest).
  // Requested paths are part of the key: a spec that adds a reference re-runs
  // once; a scrub or animate tick never does. Sorted, so order can't miss.
  const paths = [...(req.paths ?? [])].sort().join(",");
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}|${req.code.length}|${hash(paths)}`;
}

type RuntimeModule = { run: (req: CodeRunRequest) => Promise<CodeRunResult> };

/** Every runtime module exports run(req). Reached only here, only lazily —
 *  each entry is its own code-split chunk, so a spec without that language
 *  never loads a byte of it. */
const RUNTIMES: Record<Language, () => Promise<RuntimeModule>> = {
  python: () => import("./pyodide"),
  r: () => import("./webr"),
  brython: () => import("./not-yet"),
  micropython: () => import("./not-yet"),
};

async function defaultRunner(req: CodeRunRequest): Promise<CodeRunResult> {
  let mod: RuntimeModule;
  try {
    mod = await RUNTIMES[req.language]();
  } catch (err) {
    // A failed chunk load (offline, CDN down) is a runtime problem, not a
    // script bug — tag it so codeExecutionErrors can warn instead of
    // blocking generation on it.
    const tagged = new Error((err as Error).message) as Error & { runtimeUnavailable?: boolean };
    tagged.runtimeUnavailable = true;
    throw tagged;
  }
  return mod.run(req);
}

export async function runCode(req: CodeRunRequest, deps: CodeRunDeps = {}): Promise<CodeRunResult> {
  const get = deps.cacheGet ?? cacheGet;
  const put = deps.cachePut ?? cachePut;
  const key = codeCacheKey(req);
  const hit = decodeCodeResult((await get(key).catch(() => null)) ?? undefined);
  if (hit) return hit;
  let result: CodeRunResult;
  try {
    result = await (deps.runner ?? defaultRunner)(req);
  } catch (err) {
    result = {
      ok: false,
      stdout: "",
      stderr: "",
      figures: [],
      error: (err as Error).message,
      runtimeUnavailable: (err as { runtimeUnavailable?: boolean } | undefined)?.runtimeUnavailable === true,
    };
  }
  if (result.ok) await put(key, JSON.stringify(result)).catch(() => undefined);
  return result;
}
