// The sweep's runtime half (spec 2026-09-15 §4.2): a runner that turns one
// value map into a script + envelope through the SAME path a knob uses
// (applyControls on the AUTHORED script — its tuples intact — then runCode
// with its IndexedDB cache), the idle precompute at first play, and the pure
// patch application the render closure uses for both frames and commits.
import type { Spec, SpecElement } from "../spec/types";
import { applyControls, parseControls } from "../code/controls";
import { runCode, type CodeRunDeps } from "../code/run";
import { pathsByCodeId, scanDataTokens } from "../code/tokens";
import type { Plan } from "./plan";
import type { CodePatch, SweepRunner } from "./player";

/**
 * One script's sweep runner. `authored` is the spec as passed to render (NOT
 * the resolved clone): the clone's `code` has already been rewritten to the
 * controls' defaults, so its literals are numbers and `parseControls` would
 * find nothing to rewrite. Deps default to runCode's own — the same runtime
 * and the same cache the author's resolve pass and the tray's Run go through,
 * which is what makes the idle precompute below pay off.
 */
export function sweepRunnerFor(authored: Spec, deps: CodeRunDeps = {}): SweepRunner {
  return async (codeId, values) => {
    const el = authored.elements?.find((e) => e.id === codeId);
    if (!el || el.type !== "code" || !el.language || !el.code || !el.controls?.length) throw new Error(`run: "${codeId}" is not a code element with controls`);
    const { controls } = parseControls(el.language, el.code, el.controls);
    const code = applyControls(el.language, el.code, controls, values);
    // The data bridge's paths ride along exactly as in render/code.ts, or a
    // swept script would miss the cache the resolve pass filled (and harvest
    // nothing for a "{id.path}" param).
    const paths = pathsByCodeId(scanDataTokens(authored.params))[el.id] ?? [];
    const result = await runCode({ language: el.language, code, chart: el.chart, paths }, deps);
    return { code, result: JSON.stringify(result) };
  };
}

/** Warm the cache for every run step, in order; failures are the step's own business later. */
export async function precomputeSweeps(plan: Plan, runner: SweepRunner): Promise<void> {
  for (const step of plan.steps) {
    if (step.kind !== "run") continue;
    for (const v of step.values) {
      try {
        await runner(step.code, v);
      } catch {
        /* the step reports its own failure when it plays */
      }
    }
  }
}

/** The swept script as the layout must see it: its code and its fresh
 *  envelope, in place of the authored ones. Pure, and returns the SAME array
 *  when there is nothing to patch (the unpatched path allocates nothing). */
export function applyCodePatches(elements: SpecElement[], patches: ReadonlyMap<string, CodePatch>): SpecElement[] {
  if (patches.size === 0) return elements;
  return elements.map((e) => {
    const p = patches.get(e.id);
    return p ? { ...e, code: p.code, code_result: p.result } : e;
  });
}
