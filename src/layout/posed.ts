// The posed lookup view (design 2026-09-10 §2.5): geometry of an element as
// it stands under a pose (offset/turn) and a morph (shapes), for the elements
// DEFINED in terms of it to read. The element's own drawables stay in their
// original frame — the renderer applies the pose transform.
//
// Layering: layout/ imports render/pose.ts here — the pure pose math, no DOM.
import { poseOf, type Turn } from "../render/pose";
import type { Drawable, GroupDrawable, Pt } from "./model";

export interface PoseOverride {
  offset: Pt;
  turn?: Turn;
}

export interface LayoutOverrides {
  poses?: Record<string, PoseOverride>;
  /** Morphed ORIGINAL-frame leaf points: element id → leaf id → points. */
  shapes?: Record<string, Record<string, Pt[]>>;
  /** A math element's current TeX (and, mid-morph, where it comes from and how far along). */
  math?: Record<string, { tex: string; from?: string; t?: number }>;
  /** Cloned elements: new id → source element id (design §2.5). */
  copies?: Record<string, string>;
}

export type LeafDrawable = Exclude<Drawable, GroupDrawable>;

export function poseMapOf(ov: PoseOverride): { map: (p: Pt) => Pt; scale: number } {
  return { map: poseOf(ov.offset, ov.turn), scale: ov.turn?.scale ?? 1 };
}

/**
 * A leaf under a point map: text and images move, a circle hint keeps its
 * centre and scales its radius, a rect hint becomes its four mapped corners
 * (a closed stroke), everything else maps its points (morphed `shapes` first).
 */
export function mapLeaf(leaf: LeafDrawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): LeafDrawable {
  if (leaf.kind === "text") return { ...leaf, pos: map(leaf.pos) };
  if (leaf.kind === "image") return { ...leaf, pos: map(leaf.pos), w: leaf.w * scale, h: leaf.h * scale };
  if (leaf.kind === "stroke" && leaf.shapeHint?.type === "circle") {
    const c = map(leaf.shapeHint.c);
    return { ...leaf, pts: [c], shapeHint: { type: "circle", c, r: leaf.shapeHint.r * scale } };
  }
  if (leaf.kind === "stroke" && leaf.shapeHint?.type === "rect") {
    const h = leaf.shapeHint;
    const corners: Pt[] = [[h.x, h.y], [h.x + h.w, h.y], [h.x + h.w, h.y + h.h], [h.x, h.y + h.h]];
    const { shapeHint: _drop, ...rest } = leaf;
    return { ...rest, pts: corners.map(map), closed: true };
  }
  const pts = (shapes?.[leaf.id] ?? leaf.pts).map(map);
  return leaf.kind === "area" ? { ...leaf, pts, holes: leaf.holes?.map((ring) => ring.map(map)) } : { ...leaf, pts };
}

/** mapLeaf through groups (a group's nominal box becomes the box of its mapped corners). */
export function mapDrawable(d: Drawable, map: (p: Pt) => Pt, scale: number, shapes?: Record<string, Pt[]>): Drawable {
  if (d.kind !== "group") return mapLeaf(d, map, scale, shapes);
  const children = d.children.map((c) => mapDrawable(c, map, scale, shapes));
  if (!d.box) return { ...d, children };
  const b = d.box;
  const cs = ([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] as Pt[]).map(map);
  const xs = cs.map((p) => p[0]);
  const ys = cs.map((p) => p[1]);
  return { ...d, children, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
}

export function isEmptyOverrides(ov?: LayoutOverrides): boolean {
  return (
    !ov ||
    (Object.keys(ov.poses ?? {}).length === 0 &&
      Object.keys(ov.shapes ?? {}).length === 0 &&
      Object.keys(ov.math ?? {}).length === 0 &&
      Object.keys(ov.copies ?? {}).length === 0)
  );
}

/** A stable key for caches and the player's "what is mounted" comparison; "" when nothing is overridden. */
export function overridesKey(ov?: LayoutOverrides): string {
  if (isEmptyOverrides(ov)) return "";
  const poses = Object.entries(ov!.poses ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const shapes = Object.entries(ov!.shapes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const math = Object.entries(ov!.math ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const copies = Object.entries(ov!.copies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([poses, shapes, math, copies]);
}
