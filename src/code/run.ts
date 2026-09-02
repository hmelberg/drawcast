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

/** Bump whenever the envelope shape or the capture pipeline changes. */
export const CODE_VERSION = 1;

/** Pinned runtime version (openstat-verified) — part of the cache key, so a
 *  runtime upgrade misses cleanly instead of replaying stale output. */
export const PYODIDE_VERSION = "314.0.2";

export interface CodeRunRequest {
  language: "python" | "r";
  code: string;
  onStatus?: (phase: "loading" | "running", detail: string) => void;
}

export interface CodeFigure {
  /** PNG data URI (self-contained, export-safe — the ImageDrawable contract). */
  href: string;
  /** Pixel dimensions, read from the PNG bytes — layout needs the aspect. */
  w: number;
  h: number;
}

export interface CodeRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  figures: CodeFigure[];
  /** Set when the run itself failed (boot failure, timeout, thrown error). */
  error?: string;
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
  return `c${CODE_VERSION}|${tag}|${hash(req.code)}`;
}

export function decodeCodeResult(raw: string | undefined): CodeRunResult | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as CodeRunResult;
    if (typeof p !== "object" || p === null) return null;
    if (typeof p.ok !== "boolean" || typeof p.stdout !== "string" || typeof p.stderr !== "string") return null;
    if (!Array.isArray(p.figures)) return null;
    return p;
  } catch {
    return null;
  }
}

async function defaultRunner(req: CodeRunRequest): Promise<CodeRunResult> {
  if (req.language === "python") return (await import("./pyodide")).runPython(req);
  return { ok: false, stdout: "", stderr: "", figures: [], error: "the R runtime arrives in M2 — use language: python" };
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
    result = { ok: false, stdout: "", stderr: "", figures: [], error: (err as Error).message };
  }
  if (result.ok) await put(key, JSON.stringify(result)).catch(() => undefined);
  return result;
}
