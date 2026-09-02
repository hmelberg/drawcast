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

// Envelope shape lives in ./envelope (dependency-free — layout imports it
// directly from there); re-exported here so every existing
// `from "../code/run"` import keeps working unchanged.
export { CODE_VERSION, decodeCodeResult, type CodeFigure, type CodeRunResult } from "./envelope";

/** Pinned runtime version (openstat-verified) — part of the cache key, so a
 *  runtime upgrade misses cleanly instead of replaying stale output. */
export const PYODIDE_VERSION = "314.0.2";

export interface CodeRunRequest {
  language: "python" | "r";
  code: string;
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

export function codeCacheKey(req: Pick<CodeRunRequest, "language" | "code">): string {
  const tag = req.language === "python" ? `py${PYODIDE_VERSION}` : "r0";
  // The code length rides along with the hash to kill hash-collision risk
  // (two different scripts landing on the same 32-bit FNV-1a digest).
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}|${req.code.length}`;
}

async function defaultRunner(req: CodeRunRequest): Promise<CodeRunResult> {
  if (req.language === "python") {
    let mod: typeof import("./pyodide");
    try {
      mod = await import("./pyodide");
    } catch (err) {
      // A failed chunk load (offline, CDN down) is a runtime problem, not a
      // script bug — tag it so codeExecutionErrors can warn instead of
      // blocking generation on it.
      const tagged = new Error((err as Error).message) as Error & { runtimeUnavailable?: boolean };
      tagged.runtimeUnavailable = true;
      throw tagged;
    }
    return mod.runPython(req);
  }
  return {
    ok: false,
    stdout: "",
    stderr: "",
    figures: [],
    error: "the R runtime arrives in M2 — use language: python",
    runtimeUnavailable: true,
  };
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
