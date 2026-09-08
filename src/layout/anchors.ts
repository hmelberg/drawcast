// Named points on elements (design §2.1). Pure geometry: the universal nine
// come from a bounding box, the geometric ones from the points a tier-2
// element was laid out with. The planner maps them through the pose.
import type { BBox } from "./geometry";
import { centroid } from "./geometry";
import type { Pt } from "./model";

export const UNIVERSAL_ANCHORS = ["center", "top", "bottom", "left", "right", "top_left", "top_right", "bottom_left", "bottom_right"] as const;

export function isUniversalAnchor(name: string): boolean {
  return (UNIVERSAL_ANCHORS as readonly string[]).includes(name);
}

/** The named point of a box; an unknown name is the centre. */
export function boxAnchor(box: BBox, name: string): Pt {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (name) {
    case "top": return [cx, box.y + box.h];
    case "bottom": return [cx, box.y];
    case "left": return [box.x, cy];
    case "right": return [box.x + box.w, cy];
    case "top_left": return [box.x, box.y + box.h];
    case "top_right": return [box.x + box.w, box.y + box.h];
    case "bottom_left": return [box.x, box.y];
    case "bottom_right": return [box.x + box.w, box.y];
    default: return [cx, cy];
  }
}

export function ptsBox(pts: Pt[]): BBox | null {
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** vertex_k in point order, side_k = midpoint of vertex k → k+1 (wrapping), centroid. */
export function polygonAnchors(pts: Pt[]): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  const n = pts.length;
  pts.forEach((p, i) => { out[`vertex_${i + 1}`] = p; });
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    out[`side_${i + 1}`] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  if (n >= 3) out.centroid = centroid(pts);
  return out;
}

const DEG = Math.PI / 180;

export function sectorAnchors(c: Pt, r: number, fromDeg: number, toDeg: number): Record<string, Pt> {
  const at = (deg: number): Pt => [c[0] + r * Math.cos(deg * DEG), c[1] + r * Math.sin(deg * DEG)];
  const mid = (fromDeg + toDeg) / 2;
  return { apex: c, centroid: [c[0] + 0.6 * r * Math.cos(mid * DEG), c[1] + 0.6 * r * Math.sin(mid * DEG)], arc: at(mid), start: at(fromDeg), end: at(toDeg) };
}

export function polylineAnchors(pts: Pt[], kind: "path" | "arrow" | "arc"): Record<string, Pt> {
  const out: Record<string, Pt> = {};
  if (pts.length === 0) return out;
  const first = pts[0], last = pts[pts.length - 1], mid = pts[Math.floor(pts.length / 2)];
  if (kind === "arrow") { out.tail = first; out.tip = last; out.mid = mid; return out; }
  out.start = first; out.end = last; out.mid = mid;
  if (kind === "path") pts.forEach((p, i) => { out[`point_${i + 1}`] = p; });
  return out;
}
