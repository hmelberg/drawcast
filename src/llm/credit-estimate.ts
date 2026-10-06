// Credit estimates before a run (credit plan delivery 1, 2026-10-06). A
// credit is a cent and every call on credit costs MARKUP times its true
// cost, so a dollar estimate (cost-estimate.ts) becomes credits by ×400.
// Estimates are only ever shown as a RANGE — Hans: "be careful when we give
// estimates" — and the charge is always the true cost, known at the end.
// The range is wide on purpose: the upper end is what a run must have in
// hand before it starts.

import type { Effort } from "./client";
import { priorUsdPerOutline, priorUsdPerPart } from "./cost-estimate";

export const MARKUP = 4;
export const CREDITS_PER_USD = 100;
/** The range around a point estimate: real runs land well inside it. */
export const RANGE_LOW = 0.6;
export const RANGE_HIGH = 1.8;

export interface CreditRange {
  low: number;
  high: number;
}

/** `markup`: 4, or 2 for a subscriber (credit plan delivery 4). */
export function creditRange(usd: number, markup: number = MARKUP): CreditRange {
  const credits = usd * markup * CREDITS_PER_USD;
  return { low: Math.max(1, Math.floor(credits * RANGE_LOW)), high: Math.max(1, Math.ceil(credits * RANGE_HIGH)) };
}

export function formatCreditRange(r: CreditRange): string {
  if (r.low === r.high) return `about ${r.high} credit${r.high === 1 ? "" : "s"}`;
  return `about ${r.low}–${r.high} credits`;
}

/** One drawcast: its parts plus the planning call. */
export function castUsd(model: string, effort: Effort, look: boolean, parts = 1): number {
  return parts * priorUsdPerPart(model, effort, look) + priorUsdPerOutline(model);
}

/**
 * The sentence that stops a run the balance cannot cover — null when it
 * can. Compared against the HIGH end: a run that starts must be able to
 * finish.
 */
export function shortfall(balanceCredits: number, range: CreditRange): string | null {
  if (balanceCredits >= range.high) return null;
  return `This needs ${formatCreditRange(range)} and you have ${Math.max(0, Math.floor(balanceCredits))}. Buy credit, or add your own Anthropic key, to go on.`;
}
