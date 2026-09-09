// Attribution lines for a drawcast's borrowed artwork — Commons photos
// (render/image.ts) and icon-set glyphs, gathered for the credits download
// alongside a video/GIF export and the player's "credits" menu item. Reads,
// never resolves: this only collects what the resolvers already stamped
// onto elements' `credit` field, in element order, deduplicated.

import type { Spec } from "../spec/types";

/**
 * Every distinct credit line across a set of specs (typically a playlist's
 * items), in first-seen order. An element with no `credit` (unresolved,
 * user-provided, or a type that carries none) contributes nothing.
 */
export function creditsOf(specs: Spec[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spec of specs) {
    for (const el of spec.elements ?? []) {
      if (el.type !== "image" && el.type !== "icon") continue;
      if (!el.credit || seen.has(el.credit)) continue;
      seen.add(el.credit);
      out.push(el.credit);
    }
  }
  return out;
}
