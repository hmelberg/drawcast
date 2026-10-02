import { type Pt, type TextDrawable } from "./model";
import type { MeasureFn } from "./measure";

/** Axis-aligned box in logical y-up coordinates; (x, y) is the min corner. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxesOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function expandBox(b: BBox, pad: number): BBox {
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

export function bboxOfPts(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Text position is the horizontal anchor at the vertical center of the block. */
export function bboxOfText(t: TextDrawable, measure: MeasureFn): BBox {
  let w: number;
  let h: number;
  if (t.font === "c64") {
    // The Commodore face is a grid: every glyph fills a cell one em square,
    // and rows sit exactly one em apart — no ascender room, no line gap. The
    // handwriting's measure would call two adjacent screen rows an overlap.
    w = t.text.length * t.fontSize;
    h = t.fontSize;
  } else if (t.lines && t.lines.length > 1) {
    w = Math.max(...t.lines.map((line) => measure(line, t.fontSize).w));
    h = t.lines.length * t.fontSize * 1.25;
  } else {
    ({ w, h } = measure(t.text, t.fontSize));
  }
  const x = t.anchor === "start" ? t.pos[0] : t.anchor === "end" ? t.pos[0] - w : t.pos[0] - w / 2;
  return { x, y: t.pos[1] - h / 2, w, h };
}

/** Liang–Barsky segment-vs-box test. */
export function segmentIntersectsBox(a: Pt, b: Pt, box: BBox): boolean {
  const [x0, y0] = a;
  const dx = b[0] - x0;
  const dy = b[1] - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - box.x, box.x + box.w - x0, y0 - box.y, box.y + box.h - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export function polylineIntersectsBox(pts: Pt[], box: BBox): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (segmentIntersectsBox(pts[i], pts[i + 1], box)) return true;
  }
  return false;
}

export function centroid(pts: Pt[]): Pt {
  let sx = 0, sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const n = pts.length || 1;
  return [sx / n, sy / n];
}

/** Ramer–Douglas–Peucker. Keeps endpoints; drops points within epsilon of the chord. */
export function simplifyPolyline(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= epsilon) return [a, b];
  const left = simplifyPolyline(pts.slice(0, idx + 1), epsilon);
  const right = simplifyPolyline(pts.slice(idx), epsilon);
  return left.slice(0, -1).concat(right);
}

function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return Math.hypot(p[0] - qx, p[1] - qy);
}

/** A corner radius clamped to [0, half the shorter side]; 0 when unset or not a number. */
export function clampRadius(r: number | undefined, w: number, h: number): number {
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return 0;
  return Math.min(r, w / 2, h / 2);
}

/**
 * A rounded rect's ring, in tier2 rectPts' order (lower-left, lower-right,
 * upper-right, upper-left in y-up units): each corner a quarter arc of four
 * segments (five points). `r` is clamped to half the shorter side; 0 is the
 * plain rect.
 */
export function roundedRectPts(c: Pt, w: number, h: number, r: number): Pt[] {
  const rr = clampRadius(r, w, h);
  const x0 = c[0] - w / 2, x1 = c[0] + w / 2, y0 = c[1] - h / 2, y1 = c[1] + h / 2;
  if (rr <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const corners: [number, number, number][] = [
    [x0 + rr, y0 + rr, 180],
    [x1 - rr, y0 + rr, 270],
    [x1 - rr, y1 - rr, 0],
    [x0 + rr, y1 - rr, 90],
  ];
  const out: Pt[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + (k * 90) / 4) * Math.PI) / 180;
      out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return out;
}
