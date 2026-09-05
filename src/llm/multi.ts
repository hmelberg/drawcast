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
  /** Why each of `failed` failed, in the same order. */
  errors?: string[];
  /** Set only when NO part produced a spec (the first part's error). */
  error?: string;
}

export interface PartsHooks {
  onOutline?: (outline: Outline) => void;
  onPart?: (done: number, total: number, index: number, outcome: GenerationOutcome) => void;
}

export const EMPTY_PARTS: PartsResult = { outline: null, specs: [], chapterOf: [], failed: [] };

/**
 * Phase one, on its own so a batch can run every outline first and then pour
 * all the parts into one pool. Outlines are small and independent; doing them
 * inside each lecture's turn leaves the generation gate idle while they run.
 */
export async function outlineParts(req: PartsRequest, cfg: GenerateConfig): Promise<{ outline: Outline | null; error?: string }> {
  let outline: Outline | null;
  try {
    outline = await generationGate(() =>
      // Same guard the parts have: an outline still queued when the run was
      // cancelled must not spend a call on its way out.
      cfg.signal?.aborted
        ? Promise.resolve(null)
        : generateOutline(req.request, { apiKey: cfg.apiKey, model: cfg.model }, req.parts, cfg.signal, req.chapters),
    );
  } catch (err) {
    return { outline: null, error: (err as Error).message };
  }
  if (!outline) return { outline: null, error: "the model could not outline this into parts" };
  if (!outline.title) outline.title = req.request;
  return { outline };
}

/** Phase two: the parts of one already-planned drawcast. */
export async function generateFromOutline(
  req: PartsRequest,
  plan: Outline,
  cfg: GenerateConfig,
  hooks: PartsHooks = {},
): Promise<PartsResult> {
  // Parts depend only on the outline (bridging uses outline titles, not each
  // other's specs), so they generate in parallel — the gate caps how many.
  const n = plan.parts.length;
  let finished = 0;
  const outcomes = await Promise.all(
    plan.parts.map((_, i) =>
      generationGate(() =>
        // A queued task whose run was cancelled while it waited must not spend
        // a call: after a cancel, dozens of doomed requests could still be
        // holding gate slots.
        cfg.signal?.aborted
          ? Promise.resolve({ spec: null, rounds: [], error: "cancelled", systemPromptChars: 0 } satisfies GenerationOutcome)
          : generateSpec(buildPartRequest(req.request, plan, i, req.brief), cfg),
      ).then((outcome) => {
        finished++;
        hooks.onPart?.(finished, n, i, outcome);
        return outcome;
      }),
    ),
  );

  const specs: Spec[] = [];
  const chapterOf: (string | undefined)[] = [];
  const failed: number[] = [];
  const errors: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (!outcome.spec) {
      failed.push(i + 1);
      errors.push(outcome.error ?? "no spec");
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
    errors,
    error: specs.length === 0 ? (outcomes[0]?.error ?? "no spec") : undefined,
  };
}

/** Both phases, for the single-drawcast path (#playlist / #parts=N). */
export async function generateParts(req: PartsRequest, cfg: GenerateConfig, hooks: PartsHooks = {}): Promise<PartsResult> {
  const { outline, error } = await outlineParts(req, cfg);
  if (!outline) return { ...EMPTY_PARTS, error };
  hooks.onOutline?.(outline);
  return generateFromOutline(req, outline, cfg, hooks);
}
