// Spot it on the picture (spec/spot.ts): the pure geometry the plan, the
// gate and the movie share — is a tap on the place, how far off it is, the
// nearest point of the place to it, and a point well inside the place (the
// movie's pointer taps there: a country's box centre can lie in its
// neighbour — Norway's is in Sweden).

import type { BBox } from "./geometry";
import type { Pt } from "./model";

/** A place: its box, and its outline when it has one (an organ, a country). */
export interface SpotShape {
  box: BBox;
  rings?: Pt[][];
}

/** Inside any one ring. Not even-odd across them: a part's outline comes
 *  as its fill AND its closed stroke (the same ring twice), which even-odd
 *  would cancel — the same rule as ui/hit.ts. */
function insideRings(rings: readonly Pt[][], p: Pt): boolean {
  return rings.some((ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return ring.length >= 3 && inside;
  });
}

function nearestOnSegment(a: Pt, b: Pt, p: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/** The nearest point of the place's edge to p (its outline, else its box). */
export function nearestEdge(shape: SpotShape, p: Pt): Pt {
  const rings = (shape.rings ?? []).filter((r) => r.length >= 2);
  const loops: Pt[][] = rings.length > 0
    ? rings
    : [[[shape.box.x, shape.box.y], [shape.box.x + shape.box.w, shape.box.y], [shape.box.x + shape.box.w, shape.box.y + shape.box.h], [shape.box.x, shape.box.y + shape.box.h]]];
  let best: Pt = loops[0][0];
  let bestD = Infinity;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const q = nearestOnSegment(loop[i], loop[(i + 1) % loop.length], p);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best;
}

/** Inside the place: its outline when it has one, else its box. */
export function insideSpot(shape: SpotShape, p: Pt): boolean {
  const rings = (shape.rings ?? []).filter((r) => r.length >= 3);
  if (rings.length > 0) return insideRings(rings, p);
  const b = shape.box;
  return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
}

/** How near counts (logical units): `tolerance` × the place's diagonal, at least `floor` (a finger's width). */
export function spotReach(shape: SpotShape, tolerance = 0.1, floor = 14): number {
  return Math.max(floor, tolerance * Math.hypot(shape.box.w, shape.box.h));
}

export interface SpotVerdict {
  ok: boolean;
  inside: boolean;
  /** How far outside the place the tap is (0 inside). */
  off: number;
  /** The nearest point of the place's edge (where a miss's line goes). */
  nearest: Pt;
}

/** Judge a tap: inside, or within reach of the edge. */
export function judgeSpot(shape: SpotShape, p: Pt, tolerance?: number): SpotVerdict {
  const inside = insideSpot(shape, p);
  const nearest = nearestEdge(shape, p);
  const off = inside ? 0 : Math.hypot(nearest[0] - p[0], nearest[1] - p[1]);
  return { ok: inside || off <= spotReach(shape, tolerance), inside, off, nearest };
}

/**
 * A point well inside the place — of a grid over its box, the inside point
 * farthest from the edge (its box centre when nothing is inside: a place
 * with no outline, or one too thin for the grid).
 */
export function spotPoint(shape: SpotShape, n = 16): Pt {
  const b = shape.box;
  const centre: Pt = [b.x + b.w / 2, b.y + b.h / 2];
  if (!shape.rings || shape.rings.length === 0) return centre;
  if (insideSpot(shape, centre) && distToEdge(shape, centre) >= 0.2 * Math.min(b.w, b.h)) return centre;
  let best: Pt = centre;
  let bestD = -1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p: Pt = [b.x + ((i + 0.5) / n) * b.w, b.y + ((j + 0.5) / n) * b.h];
      if (!insideSpot(shape, p)) continue;
      const d = distToEdge(shape, p);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function distToEdge(shape: SpotShape, p: Pt): number {
  const q = nearestEdge(shape, p);
  return Math.hypot(q[0] - p[0], q[1] - p[1]);
}
