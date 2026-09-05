// The code-execution result envelope: CodeFigure, CodeRunResult, and the
// decoder that turns cached/stamped JSON back into a typed result.
//
// Dependency-free on purpose — no IndexedDB, no runtime loaders — so the
// pure geometry layer (src/layout/code.ts) can read the envelope shape
// without transitively pulling render/portrait (and its IndexedDB use)
// into the layout module. src/code/run.ts imports and re-exports everything
// here, so existing `from "../code/run"` imports keep working unchanged.

import type { C64Screen } from "./c64";

/** Bump whenever the envelope shape or the capture pipeline changes. */
export const CODE_VERSION = 7; // v7: a run may leave a C64 screen behind (language: basic)

export interface CodeFigure {
  /** PNG data URI (self-contained, export-safe — the ImageDrawable contract). */
  href: string;
  /** Pixel dimensions, read from the PNG bytes — layout needs the aspect. */
  w: number;
  h: number;
}

/** A pandas DataFrame left as the trailing expression, drawn as a ruled grid
 *  (all cells stringified in Python, so layout stays pure geometry). */
export interface CodeTable {
  columns: string[];
  rows: string[][];
  /** Rows beyond the harvest cap that were dropped (0 = the whole frame). */
  truncated?: number;
}

export interface CodeRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  figures: CodeFigure[];
  /** DataFrames drawn as tables (absent on old cached envelopes — treat as []). */
  tables?: CodeTable[];
  /** The 40 × 25 screen a BASIC run left behind (code/c64.ts) — drawn as ink
   *  in place of stdout when present. */
  screen?: C64Screen;
  /** Harvested script variables keyed by the requested dotted path ("y",
   *  "df.gdp") — plain JSON: numbers, strings, lists, objects, and
   *  {columns, rows} for a DataFrame (see code/harvest.ts). */
  data?: Record<string, unknown>;
  /** Per-path harvest failures (missing name, not data, over a cap). The run
   *  itself succeeded; only these paths could not be served. */
  dataErrors?: Record<string, string>;
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
