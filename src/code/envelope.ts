// The code-execution result envelope: CodeFigure, CodeRunResult, and the
// decoder that turns cached/stamped JSON back into a typed result.
//
// Dependency-free on purpose — no IndexedDB, no runtime loaders — so the
// pure geometry layer (src/layout/code.ts) can read the envelope shape
// without transitively pulling render/portrait (and its IndexedDB use)
// into the layout module. src/code/run.ts imports and re-exports everything
// here, so existing `from "../code/run"` imports keep working unchanged.

/** Bump whenever the envelope shape or the capture pipeline changes. */
export const CODE_VERSION = 3;

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
  /** Set when the RUNTIME could not load or run at all (offline CDN, no
   *  browser, a failed dynamic import) — as opposed to a genuine bug in the
   *  script. Callers (the authoring-time check) use this to warn instead of
   *  blocking generation: an offline author should never burn a repair round
   *  on code that was never actually verified. */
  runtimeUnavailable?: boolean;
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
