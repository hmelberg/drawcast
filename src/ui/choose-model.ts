// Choose on the figure (spec 2026-10-03-round6 §4) — the pure half: which
// option a tap lands on. DOM-free so node tests cover it; ui/choose-gate.ts
// maps the pointer into logical y-up coordinates and calls this.
//
// Only the options are candidates — a tap on blank paper, or on a drawn
// thing that is not an option, answers nothing. Each option is hit the way
// its geometry allows: by its OUTLINE when it has one (a node's box, an
// organ, a closed shape), else by its STROKES (a curve, an icon's lines —
// within reach), else by its BOX (a word). A group or a template part
// stands for its members: their outlines, strokes and boxes together.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { isIdentity, poseOf, type Turn } from "../render/pose";
import { pointInRing, polylineDistance } from "./hit";

export interface ChooseTarget {
  id: string;
  /** The box round all its members, or null when nothing of it is drawn. */
  box: BBox | null;
  /** Closed outlines (any member's). */
  rings: Pt[][];
  /** Open strokes (members that have no outline). */
  lines: Pt[][];
  /** Boxes of members with neither outline nor strokes (text). */
  boxes: BBox[];
}

/** A tap this near (logical units) to an option's ink takes it: a stroke's
 *  reach, and a near miss on an outline or a word (fat fingers). */
export const CHOOSE_SLOP = 18;

const union = (bs: BBox[]): BBox | null => {
  if (bs.length === 0) return null;
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Each option's hit geometry from the layout's per-id maps (elementBBoxes,
 *  elementRings, elementLines), its members standing in for it. */
export function chooseTargets(
  options: readonly { id: string; members: readonly string[] }[],
  boxes: ReadonlyMap<string, BBox>,
  rings: ReadonlyMap<string, Pt[][]>,
  lines: ReadonlyMap<string, Pt[][]>,
): ChooseTarget[] {
  return options.map((o) => {
    const ids = o.members.length > 0 ? o.members : [o.id];
    const t: ChooseTarget = { id: o.id, box: null, rings: [], lines: [], boxes: [] };
    const all: BBox[] = [];
    for (const id of ids) {
      const b = boxes.get(id);
      if (b) all.push(b);
      const r = rings.get(id);
      const l = lines.get(id);
      if (r && r.length > 0) t.rings.push(...r);
      else if (l && l.length > 0) t.lines.push(...l);
      else if (b) t.boxes.push(b);
    }
    // The option's own id may carry geometry of its own (a template part
    // that is not a group): a member list of one is itself, handled above.
    t.box = union(all);
    return t;
  });
}

/** Per-id geometry as the layout drew it — elementBBoxes / elementRings / elementLines. */
export interface ChooseGeometry {
  boxes: ReadonlyMap<string, BBox>;
  rings: ReadonlyMap<string, Pt[][]>;
  lines: ReadonlyMap<string, Pt[][]>;
}

/**
 * The geometry where things stand NOW: each id the scene has moved, turned
 * or scaled (its offsets/turns) is mapped through its pose — a box becomes
 * the bounds of its four mapped corners. `baked` ids are already drawn at
 * their pose in the layout (the player lays out what others are defined by
 * at their pose), so they are left as they are.
 */
export function poseGeometry(geo: ChooseGeometry, offsets: Readonly<Record<string, Pt>>, turns: Readonly<Record<string, Turn>>, baked: ReadonlySet<string> = new Set()): ChooseGeometry {
  const posed = (id: string): ((p: Pt) => Pt) | null => {
    if (baked.has(id)) return null;
    const o = offsets[id];
    const t = turns[id];
    if ((!o || (o[0] === 0 && o[1] === 0)) && isIdentity(t)) return null;
    return poseOf(o ?? [0, 0], t);
  };
  const boxes = new Map<string, BBox>();
  for (const [id, b] of geo.boxes) {
    const f = posed(id);
    if (!f) {
      boxes.set(id, b);
      continue;
    }
    const cs = ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Pt[]).map(f);
    boxes.set(id, union(cs.map(([x, y]) => ({ x, y, w: 0, h: 0 })))!);
  }
  const mapAll = (m: ReadonlyMap<string, Pt[][]>): Map<string, Pt[][]> => {
    const out = new Map<string, Pt[][]>();
    for (const [id, list] of m) {
      const f = posed(id);
      out.set(id, f ? list.map((pts) => pts.map(f)) : list);
    }
    return out;
  };
  return { boxes, rings: mapAll(geo.rings), lines: mapAll(geo.lines) };
}

const inBox = (b: BBox, p: Pt): boolean => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const boxDistance = (b: BBox, p: Pt): number => Math.hypot(Math.max(b.x - p[0], 0, p[0] - (b.x + b.w)), Math.max(b.y - p[1], 0, p[1] - (b.y + b.h)));
const area = (b: BBox | null): number => (b ? b.w * b.h : Infinity);

/** How far p is from the option's ink: 0 inside an outline or a text box,
 *  else the distance to the nearest outline edge, stroke or text box. */
function distanceTo(t: ChooseTarget, p: Pt): number {
  let d = Infinity;
  for (const r of t.rings) {
    if (r.length >= 3 && pointInRing(r, p)) return 0;
    d = Math.min(d, polylineDistance([...r, r[0]], p));
  }
  for (const b of t.boxes) {
    if (inBox(b, p)) return 0;
    d = Math.min(d, boxDistance(b, p));
  }
  for (const l of t.lines) d = Math.min(d, polylineDistance(l, p));
  return d;
}

/**
 * The option under p, or null. Inside an outline or a text box beats a
 * near stroke; among those inside, the smallest box wins (a door's handle
 * inside the door). A stroke counts within STROKE_REACH; anything else
 * within `slop` is a near miss, nearest first.
 */
export function hitChoice(targets: readonly ChooseTarget[], p: Pt, slop = CHOOSE_SLOP): string | null {
  let best: ChooseTarget | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const d = distanceTo(t, p);
    if (d > slop) continue;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && area(t.box) < area(best?.box ?? null))) {
      best = t;
      bestD = d;
    }
  }
  return best?.id ?? null;
}
