// The shared state of ONE run's template authoring (llm/multi.ts). A course
// pours every lecture's parts into one pool and the lectures finish in
// parallel, so what one lecture authors must be visible to the others, and
// the cap must count across the whole run — one object, created by whoever
// starts the run (the course panel, the multi-part Generate), handed down
// through GenerateConfig.onDemandRun. Without one, generateFromOutline makes
// a private run with the default cap, so a lone lecture behaves the same.

import type { TemplateDoc } from "../scenes/doc";

/** Templates authored in one multi-part run or course when nothing else is set (Settings → templatesOnDemandMax). */
export const DEFAULT_ON_DEMAND_MAX = 3;

export interface OnDemandRun {
  /** The cap this run was created with. */
  readonly max: number;
  /** Slots not yet taken. */
  readonly left: number;
  /** Templates authored so far. */
  authored: number;
  /** Template-less parts left freehand because the cap was reached. */
  skipped: number;
  /** The documents authored in this run, by template id — what a re-routed part embeds so it publishes intact. */
  readonly docs: Map<string, TemplateDoc>;
  /** Claim one authoring slot; false once the cap is reached. A slot is spent whether or not the authoring succeeds — the cap bounds spend. */
  take(): boolean;
  /**
   * Run fn alone: one template is authored at a time across the whole run,
   * so the next template-less part looks at the registry AFTER the previous
   * template landed and can reuse it instead of authoring a twin. Callers
   * queue in arrival order; a throw releases the lock and reaches its
   * caller only.
   */
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

export function createOnDemandRun(max: number = DEFAULT_ON_DEMAND_MAX): OnDemandRun {
  const cap = Number.isFinite(max) && max >= 0 ? Math.floor(max) : DEFAULT_ON_DEMAND_MAX;
  let left = cap;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    max: cap,
    get left() {
      return left;
    },
    authored: 0,
    skipped: 0,
    docs: new Map(),
    take() {
      if (left === 0) return false;
      left--;
      return true;
    },
    lock<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(fn, fn);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** What the status line appends after a run: "", " · 2 templates authored", " · 3 templates authored · 1 part left freehand (cap 3)". */
export function onDemandSummary(run: OnDemandRun): string {
  const parts: string[] = [];
  if (run.authored > 0) parts.push(`${run.authored} template${run.authored === 1 ? "" : "s"} authored`);
  if (run.skipped > 0) parts.push(`${run.skipped} part${run.skipped === 1 ? "" : "s"} left freehand (cap ${run.max})`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}
