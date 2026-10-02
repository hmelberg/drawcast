// What an ask's `on` stands for (spec 2026-10-01-guess-and-reveal §4) —
// spec-only, with no layout behind it, so the lint can ask too without the
// lint → layout → lint import cycle guess/handles.ts would bring.

import type { Spec } from "../spec/types";

/** The part ids `on` stands for: "all" expanded to every guessable part of the
 *  template; anything else as written (lower-cased ids are kept as given). */
export function guessParts(spec: Pick<Spec, "template" | "params">, on: string | string[] | undefined): string[] {
  if (on === undefined) return [];
  const list = Array.isArray(on) ? on : [on];
  const out: string[] = [];
  for (const id of list) {
    if (id === "all") out.push(...allParts(spec));
    else out.push(id);
  }
  return [...new Set(out)];
}

function allParts(spec: Pick<Spec, "template" | "params">): string[] {
  const p = spec.params ?? {};
  if (spec.template === "bar_chart") {
    const labels = Array.isArray(p["labels"]) ? (p["labels"] as unknown[]).length : 0;
    return Array.from({ length: labels }, (_, i) => `bar_${i + 1}`);
  }
  if (spec.template === "line_chart") {
    const n = Array.isArray(p["series"]) ? (p["series"] as unknown[]).length : p["values"] !== undefined ? 1 : 0;
    return Array.from({ length: n }, (_, i) => `line_${i + 1}`);
  }
  if (spec.template === "pie_chart") return ["pie"];
  return [];
}

/** The curves a market guess can move (spec 2026-10-03 §3). */
export const MARKET_CURVES = ["supply_curve", "demand_curve"] as const;

/** The parts that are market curves on this figure (a supply_demand). */
export function marketParts(spec: Pick<Spec, "template">, parts: string[]): string[] {
  return spec.template === "supply_demand" ? parts.filter((p) => (MARKET_CURVES as readonly string[]).includes(p)) : [];
}
