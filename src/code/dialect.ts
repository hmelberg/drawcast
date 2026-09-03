// The TS half of the Python-dialect runner (public/pylib/<v>/
// drawcast_runner.py): parse its JSON envelope and finish it into a
// CodeRunResult — plotly figures through the shared renderer, the data
// bridge in parseHarvest's shape. Brython and MicroPython differ only in
// how they load and where stdout comes from, so both end here.
import type { CodeRunResult, CodeTable } from "./envelope";
import { renderPlotlyFigures } from "./plotly-render";

export type StatusFn = (phase: "loading" | "running", detail: string) => void;

export interface RunnerEnvelope {
  stdout: string;
  /** Captured sys.stderr (warnings.warn, sys.stderr.write); '' when the
   *  dialect could not capture it. */
  stderr: string;
  error: string;
  table: CodeTable | null;
  figures: string[];
  data?: Record<string, unknown>;
  errors?: Record<string, string>;
}

export function parseRunnerEnvelope(raw: unknown): RunnerEnvelope | null {
  if (typeof raw !== "string") return null;
  try {
    const p = JSON.parse(raw) as Partial<RunnerEnvelope> | null;
    if (!p || typeof p !== "object") return null;
    if (typeof p.stdout !== "string" || typeof p.error !== "string" || !Array.isArray(p.figures)) return null;
    return {
      stdout: p.stdout,
      stderr: typeof p.stderr === "string" ? p.stderr : "",
      error: p.error,
      table: p.table && typeof p.table === "object" ? (p.table as CodeTable) : null,
      figures: p.figures.filter((f): f is string => typeof f === "string"),
      data: p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : undefined,
      errors:
        p.errors && typeof p.errors === "object"
          ? Object.fromEntries(Object.entries(p.errors as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
          : undefined,
    };
  } catch {
    return null;
  }
}

/** `stdout`/`stderr` override the envelope's when the dialect could not
 *  capture them (MicroPython: the engine's own line buffers). */
export async function envelopeToResult(
  env: RunnerEnvelope,
  opts: { paths: string[]; stdout?: string; stderr?: string; status: StatusFn },
): Promise<CodeRunResult> {
  const error = env.error !== "" ? env.error : undefined;
  const stdout = (opts.stdout ?? env.stdout).replace(/\n$/, "");
  const stderr = (opts.stderr ?? env.stderr).replace(/\n$/, "");
  let figures: CodeRunResult["figures"] = [];
  if (!error && env.figures.length > 0) {
    opts.status("running", "Rendering charts…");
    try {
      figures = await renderPlotlyFigures(env.figures);
    } catch {
      /* a failed chart render loses the chart, not the run */
    }
  }
  const dataErrors = env.errors && Object.keys(env.errors).length > 0 ? env.errors : undefined;
  return {
    ok: !error,
    stdout,
    stderr,
    figures,
    tables: !error && env.table ? [env.table] : [],
    error,
    ...(!error && opts.paths.length > 0 && env.data !== undefined ? { data: env.data } : {}),
    ...(!error && dataErrors !== undefined ? { dataErrors } : {}),
  };
}
