// Attribution lines for a drawcast's borrowed artwork — Commons photos
// (render/image.ts), icon-set glyphs (render/icon.ts) and the icon a freehand
// figure was SEEDED from (llm/seed.ts stamps that one on the surviving
// `group`, not on any image/icon element) — gathered for the credits download
// alongside a video/GIF export and the player's "credits" menu item. Reads,
// never resolves: this only collects what the resolvers already stamped
// onto elements' `credit` field, in element order, deduplicated. Every
// element type is read: `credit` lives on the shared element shape, and
// filtering by type is how the seed credit went missing.

import type { Spec } from "../spec/types";

/**
 * Every distinct credit line across a set of specs (typically a playlist's
 * items), in first-seen order. An element with no `credit` (unresolved,
 * user-provided, or a type that never carries one) contributes nothing.
 */
export function creditsOf(specs: Spec[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const spec of specs) {
    const add = (c: unknown): void => {
      if (typeof c !== "string" || c === "" || seen.has(c)) return;
      seen.add(c);
      out.push(c);
    };
    for (const el of spec.elements ?? []) {
      add(el.credit);
      // A cards element's icons (round 5 §3.3) are credited on its items.
      if (el.type === "cards" && Array.isArray(el.items)) {
        for (const it of el.items) {
          if (typeof it === "object" && it !== null) {
            add(it.credit);
            add(it.match_credit);
          }
        }
      }
    }
  }
  return out;
}
