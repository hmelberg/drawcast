// AI-cost estimate for a course run: what pressing Generate would likely cost
// in Anthropic API dollars — the confirm before a run only ever said how many
// AI calls it would make, never what those calls are actually billed at
// (Hans 2026-09-18). This module estimates that from a prior when nothing has
// been measured yet, and from the previous run's own ledger once it has.
//
// PRIOR_USD_PER_PART and PRIOR_USD_PER_OUTLINE below are ESTIMATES from a
// code read on 2026-09-18 — rough tiers by model and effort, not
// measurements. The moment a real course run finishes, src/ui/course.ts
// divides that run's ledger total (src/llm/client.ts's costSummary) by its
// partsGenerated and blends it into Settings.costPerPart via learnRate,
// which the next confirm reads before it ever falls back to the prior below.

import type { Course } from "../course/document";
import { isPending, missingOf, partsOf } from "../course/run";
import type { Effort } from "./client";

/** `${model}|${effort}` — the key both the learned rates and the confirm's lookup are keyed by. */
export function rateKey(model: string, effort: Effort): string {
  return `${model}|${effort}`;
}

type Tier = "opus" | "sonnet" | "haiku";

/** Tier by model id prefix; an id this doesn't recognise prices as Opus — an estimate that errs high is the honest one (the same rule src/llm/client.ts's priceFor uses). */
function tierOf(model: string): Tier {
  if (model.startsWith("claude-opus") || model.startsWith("claude-fable")) return "opus";
  if (model.startsWith("claude-sonnet")) return "sonnet";
  if (model.startsWith("claude-haiku")) return "haiku";
  return "opus";
}

/**
 * Rough $ per generated PART (one figure), by tier and effort — ESTIMATES
 * from a code read on 2026-09-18, not measurements.
 */
export const PRIOR_USD_PER_PART: Record<Tier, Record<Effort, number>> = {
  opus: { high: 0.6, medium: 0.45, low: 0.35 },
  sonnet: { high: 0.25, medium: 0.18, low: 0.14 },
  haiku: { high: 0.1, medium: 0.08, low: 0.06 },
};

/** Rough $ per outline call (one lecture's plan) — smaller and effort-independent. Also an estimate from the same 2026-09-18 read. */
export const PRIOR_USD_PER_OUTLINE: Record<Tier, number> = {
  opus: 0.06,
  sonnet: 0.025,
  haiku: 0.01,
};

export function priorUsdPerPart(model: string, effort: Effort): number {
  return PRIOR_USD_PER_PART[tierOf(model)][effort];
}

export function priorUsdPerOutline(model: string): number {
  return PRIOR_USD_PER_OUTLINE[tierOf(model)];
}

export interface CourseCostEstimate {
  usd: number;
  parts: number;
  outlines: number;
  /** "measured": the part rate came from a finished run via Settings.costPerPart; "default": the prior. */
  source: "measured" | "default";
}

/**
 * What running Generate now would cost, counting exactly what a run would
 * generate — the same walk estimateCalls (src/course/run.ts) does over the
 * document: a pending lecture spends one outline plus its parts, a partial
 * one (its status names what is missing) spends only those missing parts,
 * against the plan it already has, so no outline.
 */
export function estimateCourseUsd(course: Course, model: string, effort: Effort, learned: Record<string, number>): CourseCostEstimate {
  let parts = 0;
  let outlines = 0;
  for (const lecture of course.lectures) {
    if (!isPending(lecture)) continue;
    const missing = missingOf(lecture);
    if (missing) {
      parts += missing.length;
    } else {
      outlines += 1;
      parts += partsOf(lecture);
    }
  }
  const key = rateKey(model, effort);
  const learnedRate = learned[key];
  const partRate = learnedRate ?? priorUsdPerPart(model, effort);
  const outlineRate = priorUsdPerOutline(model);
  const usd = parts * partRate + outlines * outlineRate;
  return { usd, parts, outlines, source: learnedRate !== undefined ? "measured" : "default" };
}

/**
 * A run's measured $/part, blended 50/50 with the previous learned rate — one
 * run moves the estimate halfway there rather than replacing it outright, so
 * a single unusually cheap or expensive run cannot swing the number the whole
 * way. The first measurement (no previous rate yet) is taken as-is. A
 * non-finite or non-positive measurement (nothing generated, or a ledger
 * anomaly) leaves the previous rate untouched, or 0 when there is none —
 * never NaN or a negative rate.
 */
export function learnRate(previous: number | undefined, measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return previous ?? 0;
  return previous === undefined ? measured : previous * 0.5 + measured * 0.5;
}

/** Whole dollars above $10 (nobody needs cents on a $22 estimate); two decimals below it. */
function formatUsd(usd: number): string {
  return usd > 10 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

/**
 * "≈ $22 in AI calls with Opus 5 — best quality at high effort (from your
 * last run)" once a rate has been measured, or "...(a rough default until a
 * run has been measured)" before one ever finishes.
 */
export function formatCourseEstimate(e: CourseCostEstimate, modelLabel: string, effort: Effort): string {
  const basis = e.source === "measured" ? "from your last run" : "a rough default until a run has been measured";
  return `≈ ${formatUsd(e.usd)} in AI calls with ${modelLabel} at ${effort} effort (${basis})`;
}
