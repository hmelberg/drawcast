// The icon seed: when the router names a subject but no template fits, an
// icon resolved for that subject (src/render/icon.ts) rides along in the
// user turn as ready-made path elements — a starting shape the compiler may
// keep, edit, rename, extend or drop. Credit follows whichever seed paths
// survive into the final spec (spec §3.7 licence policy).

import { simplifyPolyline } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Spec } from "../spec/types";

export interface SeedBlock {
  text: string;
  ids: string[];
  credit: string;
}

const BOX = 300, CX = 500, CY = 375;

/**
 * `rings` in [0,1]×[0,1] icon space (y-up) become path elements in a
 * 300×300 box centred on (CX, CY), simplified to at most 40 points each so
 * the compiler's context stays cheap. Wrapped in one `seed` group fitted
 * left, with a note explaining what the parts are for.
 */
export function seedBlock(subject: string, rings: Pt[][], credit: string): SeedBlock {
  const ids: string[] = [];
  const elements: unknown[] = rings.map((r, k) => {
    const id = `seed_${k + 1}`;
    ids.push(id);
    let eps = 0.004, pts = r;
    // Each pass re-simplifies from the ORIGINAL ring `r`, never from `pts`
    // (the previous pass's result) — re-running RDP on an already-simplified
    // polyline would compound its error instead of refining it.
    while (pts.length > 40 && eps < 0.2) {
      pts = simplifyPolyline(r, eps);
      eps *= 1.6;
    }
    // A ring with fine detail spread evenly across its span (a zigzag, say)
    // can still exceed 40 points when eps hits its 0.2 ceiling — RDP has
    // nothing left to collapse. Decimate deterministically to exactly 40 by
    // even index sampling, keeping the first and last point.
    if (pts.length > 40) {
      const n = pts.length;
      pts = Array.from({ length: 40 }, (_, i) => pts[Math.round((i * (n - 1)) / 39)]);
    }
    return {
      id,
      type: "path",
      closed: r.length > 2,
      smooth: true,
      points: pts.map(([u, v]) => [Math.round(CX - BOX / 2 + u * BOX), Math.round(CY + BOX / 2 - v * BOX)]),
    };
  });
  elements.push({ id: "seed", type: "group", members: ids, fit: "left" });
  const text = `Seed for "${subject}" — a keyword icon's outlines as ready path elements (${credit}). Use them as the starting shape of the thing: keep, edit, rename, extend or drop them; name the parts a viewer should know.\n\n${JSON.stringify(elements)}`;
  return { text, ids, credit };
}

/**
 * Sets `credit` on whichever group still owns a surviving seed path — the
 * `seed` group itself if the compiler kept its name, else the first group
 * that absorbed a `seed_k` member. Returns whether any seed path survived.
 */
export function attachSeedCredit(spec: Spec, seed: SeedBlock): boolean {
  const els = spec.elements ?? [];
  const survivors = new Set(els.filter((e) => seed.ids.includes(e.id)).map((e) => e.id));
  if (survivors.size === 0) return false;
  const group = els.find((e) => e.type === "group" && e.id === "seed") ?? els.find((e) => e.type === "group" && (e.members ?? []).some((m) => survivors.has(m)));
  if (group) group.credit = `based on ${seed.credit}`;
  return true;
}
