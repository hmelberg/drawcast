// Multi-part generation, shared by #playlist (one drawcast of N parts) and the
// course runner (one lecture of N parts). One outline call, then one ordinary
// generateSpec per part — per-part generation stays inside the quality envelope
// tuned for single figures, which one giant completion would not.

import { generateOutline, generateSpec, type GenerateConfig, type GenerationOutcome } from "./compile";
import { buildPartRequest, type Outline } from "./outline";
import { generationGate } from "./limit";
import type { Spec } from "../spec/types";

export interface PartsRequest {
  /** The request with tags already stripped. */
  request: string;
  parts: number | null;
  /** Directing brief built from #tags. */
  brief: string;
  /** Author-declared chapters; the outline distributes parts among them. */
  chapters?: string[];
}

export interface PartsResult {
  outline: Outline | null;
  specs: Spec[];
  /** The chapter each spec falls under, parallel to `specs`. */
  chapterOf: (string | undefined)[];
  /** 1-based numbers of the parts that produced no spec. */
  failed: number[];
  error?: string;
}

export interface PartsHooks {
  onOutline?: (outline: Outline) => void;
  onPart?: (done: number, total: number, index: number, outcome: GenerationOutcome) => void;
}

export async function generateParts(req: PartsRequest, cfg: GenerateConfig, hooks: PartsHooks = {}): Promise<PartsResult> {
  const empty: PartsResult = { outline: null, specs: [], chapterOf: [], failed: [] };
  let outline: Outline | null;
  try {
    outline = await generateOutline(req.request, { apiKey: cfg.apiKey, model: cfg.model }, req.parts, cfg.signal, req.chapters);
  } catch (err) {
    return { ...empty, error: (err as Error).message };
  }
  if (!outline) return { ...empty, error: "the model could not outline this into parts" };
  if (!outline.title) outline.title = req.request;
  const plan = outline;
  hooks.onOutline?.(plan);

  // Parts depend only on the outline (bridging uses outline titles, not each
  // other's specs), so they generate in parallel — the gate caps how many.
  const n = plan.parts.length;
  let finished = 0;
  const outcomes = await Promise.all(
    plan.parts.map((_, i) =>
      generationGate(() => generateSpec(buildPartRequest(req.request, plan, i, req.brief), cfg)).then((outcome) => {
        finished++;
        hooks.onPart?.(finished, n, i, outcome);
        return outcome;
      }),
    ),
  );

  const specs: Spec[] = [];
  const chapterOf: (string | undefined)[] = [];
  const failed: number[] = [];
  outcomes.forEach((outcome, i) => {
    if (!outcome.spec) {
      failed.push(i + 1);
      return;
    }
    outcome.spec.title ??= plan.parts[i].title;
    outcome.spec.level ??= plan.parts[i].level ?? undefined;
    specs.push(outcome.spec);
    chapterOf.push(plan.parts[i].chapter);
  });
  return {
    outline: plan,
    specs,
    chapterOf,
    failed,
    error: specs.length === 0 ? (outcomes[0]?.error ?? "no spec") : undefined,
  };
}
