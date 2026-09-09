// Attribution lines for a drawcast's borrowed artwork — Commons photos
// (render/image.ts) and icon-set glyphs, gathered for the credits download
// alongside a video/GIF export and the player's "credits" menu item. Reads,
// never resolves: this only collects what the resolvers already stamped
// onto elements' `credit` field, in element order, deduplicated.
//
// `type: "image"`/`"icon"` and `credit` are not in spec/types.ts yet
// (freehand-figures Task 7 is split across two dispatches) — read through a
// narrow local type here, same as render/image.ts, so `tsc --noEmit` stays
// clean without touching the schema.

import type { Spec, SpecElement } from "../spec/types";

type CreditedEl = SpecElement & { credit?: string };

/**
 * Every distinct credit line across a set of specs (typically a playlist's
 * items), in first-seen order. An element with no `credit` (unresolved,
 * user-provided, or a type that carries none) contributes nothing.
 */
export function creditsOf(specs: Spec[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spec of specs) {
    for (const raw of spec.elements ?? []) {
      const el = raw as CreditedEl;
      if ((el.type as string) !== "image" && (el.type as string) !== "icon") continue;
      if (!el.credit || seen.has(el.credit)) continue;
      seen.add(el.credit);
      out.push(el.credit);
    }
  }
  return out;
}
