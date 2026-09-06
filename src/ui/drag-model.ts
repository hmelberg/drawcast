// The drag question's rules, DOM-free: what each chip's target is (an element's
// outline and box, or a piano key / chess square by name), how a drop point is
// judged against it, and the words the card uses. The gate (drag-gate.ts) and
// the planner both lean on this; node tests cover it.

import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { pointInRing } from "./hit";

export interface DragItem {
  id: string;
  label: string;
}

export interface DragTarget {
  id: string;
  label: string;
  box: BBox;
  rings?: Pt[][];
  /** An element of the figure (can be shown and glowed) — false for a note or a square. */
  element: boolean;
}

export type DragGrade = "in" | "near" | "far";

export interface DragJudgement {
  hit: boolean;
  grade: DragGrade;
  /** Distance outside the outline as a fraction of the target's bbox diagonal; 0 inside. */
  distance: number;
}

/** "kidney_left" → "Kidney left". Authors give better labels; this is the fallback. */
export function humanLabel(id: string): string {
  const s = id.replace(/_+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeItems(items: (string | { id: string; label?: string })[]): DragItem[] {
  return items.map((it) => (typeof it === "string" ? { id: it, label: humanLabel(it) } : { id: it.id, label: it.label ?? humanLabel(it.id) }));
}

/** Element ids first (the layout's boxes; outlines when it has them), then a
 *  note on a piano figure, then a square on a chess figure. What nothing
 *  locates is reported, in order, and left out. */
export function resolveDragTargets(
  items: DragItem[],
  geo: {
    boxes: ReadonlyMap<string, BBox>;
    rings: ReadonlyMap<string, Pt[][]>;
    noteBox?: (note: string) => BBox | null;
    squareBox?: (square: string) => BBox | null;
  },
): { targets: DragTarget[]; missing: string[] } {
  const targets: DragTarget[] = [];
  const missing: string[] = [];
  for (const it of items) {
    const box = geo.boxes.get(it.id);
    if (box) {
      const rings = geo.rings.get(it.id);
      targets.push({ id: it.id, label: it.label, box, ...(rings ? { rings } : {}), element: true });
      continue;
    }
    const other = geo.noteBox?.(it.id) ?? geo.squareBox?.(it.id) ?? null;
    if (other) targets.push({ id: it.id, label: it.label, box: other, element: false });
    else missing.push(it.id);
  }
  return { targets, missing };
}

const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
};
const distToRing = (p: Pt, ring: Pt[]): number => {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, distToSegment(p, ring[j], ring[i]));
  return d;
};
const inBox = (p: Pt, b: BBox): boolean => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const distToBox = (p: Pt, b: BBox): number => Math.hypot(Math.max(b.x - p[0], 0, p[0] - (b.x + b.w)), Math.max(b.y - p[1], 0, p[1] - (b.y + b.h)));

/** Inside (even-odd over the rings, or the box when there are none) → in.
 *  Otherwise the distance to the outline over the bbox diagonal: within the
 *  tolerance → near (a hit), else far. */
export function judgeDrop(p: Pt, target: Pick<DragTarget, "box" | "rings">, tolerance: number): DragJudgement {
  const rings = (target.rings ?? []).filter((r) => r.length >= 3);
  const inside = rings.length > 0 ? rings.reduce((acc, r) => acc !== pointInRing(r, p), false) : inBox(p, target.box);
  if (inside) return { hit: true, grade: "in", distance: 0 };
  const d = rings.length > 0 ? Math.min(...rings.map((r) => distToRing(p, r))) : distToBox(p, target.box);
  const diag = Math.hypot(target.box.w, target.box.h) || 1;
  const distance = d / diag;
  const hit = distance <= tolerance;
  return { hit, grade: hit ? "near" : "far", distance };
}

/** The card's last line. */
export function dragSummary(judged: DragJudgement[]): string {
  const hits = judged.filter((j) => j.hit).length;
  const n = judged.length;
  if (n === 1) return hits === 1 ? "In place" : "Not quite";
  return hits === n ? `All ${n} in place` : `${hits} of ${n} in place`;
}
