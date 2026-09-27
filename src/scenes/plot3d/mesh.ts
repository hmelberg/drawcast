// plot3d's filled surface (style "mesh" / "solid"): each grid cell a flat,
// exact quad, coloured by its height or lit by a light that stays with the
// viewer, painted back to front; and the hidden-line pass that keeps a wire
// behind a nearer part of the surface from being drawn over it.
//
// Pure geometry and colour — layout.ts turns what this returns into
// drawables. Everything runs on every layout (an orbit or a scrub re-runs
// it each frame), so it is written flat: a 20 × 20 grid is 361 cells and
// ~1500 visibility probes, well under a millisecond.
import type { Pt } from "../../layout/model";
import { COLORS } from "../../layout/model";
import type { Vec3 } from "./model";

/** A projected grid point: screen x, y (logical, y-up) and camera depth (larger = farther). */
export interface Proj {
  x: number;
  y: number;
  depth: number;
}

// ---- colour ------------------------------------------------------------------

/**
 * The height ramp, low → high: the house blue (COLORS.supply) through the
 * sage of region2 to the gold of region1 — the app's own inks, so a filled
 * surface sits in the same drawing as its axes and labels. Sequential in
 * lightness (relative luminance rises at every step: tests/plot3d-mesh), so
 * "higher" reads as "lighter" for a colour-blind viewer or in greyscale too,
 * and the blue end stays clear of the ink wires drawn over it.
 */
export const HEIGHT_RAMP: string[] = [COLORS.supply, "#5b8b8f", COLORS.region2, "#c5b85c", COLORS.region1];
/** The one hue of color_by "shade" and "flat". */
export const SHADE_BASE = "#6f9cbc";

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const RAMP_RGB = HEIGHT_RAMP.map(hexRgb);
const SHADE_RGB = hexRgb(SHADE_BASE);
const toHex = (r: number, g: number, b: number): string => {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
};

/** The ramp at t ∈ [0, 1] (clamped), as 0–255 channels. */
export function rampRgb(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (RAMP_RGB.length - 1);
  const k = Math.min(RAMP_RGB.length - 2, Math.floor(u));
  const f = u - k;
  const a = RAMP_RGB[k];
  const b = RAMP_RGB[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const heightColor = (t: number): string => toHex(...rampRgb(t));

/**
 * The light: fixed to the VIEWER, not the world — from the upper left and a
 * little in front, in camera space (x right, y up, z toward the eye) — so an
 * orbit turns the surface under a steady lamp and the form reads from every
 * side. AMBIENT keeps a cell facing away from reading as a hole.
 */
export const LIGHT_CAM: Vec3 = (() => {
  const v: Vec3 = [-0.45, 0.75, 0.5];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
export const AMBIENT = 0.35;

/** Brightness 0…1 of a cell whose camera-space normal is n (either side faces the viewer: two-sided). */
export function lambert(n: Vec3): number {
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return 1;
  const s = n[2] < 0 ? -1 / len : 1 / len; // flip to face the eye
  const d = (n[0] * LIGHT_CAM[0] + n[1] * LIGHT_CAM[1] + n[2] * LIGHT_CAM[2]) * s;
  return AMBIENT + (1 - AMBIENT) * Math.max(0, d);
}

/**
 * A cell's fill. height: the ramp at t, darkened toward black as the light
 * falls away when shaded (never below 55 %, so the hue still names the
 * height). shade: one hue, from deep to pale with the light. flat: that hue.
 */
export function cellColor(colorBy: "height" | "shade" | "flat", t: number, shading: boolean, light: number): string {
  if (colorBy === "height") {
    const [r, g, b] = rampRgb(t);
    if (!shading) return toHex(r, g, b);
    const k = 0.55 + 0.5 * light; // light 1 → 1.05 (a touch of highlight), 0.35 → 0.73
    return toHex(r * k, g * k, b * k);
  }
  const [r, g, b] = SHADE_RGB;
  if (colorBy === "flat" && !shading) return SHADE_BASE;
  // Lit: light 1 → halfway to white, light AMBIENT → a deep blue.
  const toward = light >= 0.7 ? 255 : 0;
  const f = light >= 0.7 ? (light - 0.7) / 0.3 * 0.5 : (0.7 - light) / 0.7 * 0.9;
  return toHex(r + (toward - r) * f, g + (toward - g) * f, b + (toward - b) * f);
}

// ---- cells -------------------------------------------------------------------

export interface Cell {
  i: number;
  j: number;
  /** Screen corners in ring order: (i, j), (i, j+1), (i+1, j+1), (i+1, j). */
  pts: Pt[];
  depth: number;
  color: string;
  /** 0…1 on the height scale (the cell's mean). */
  t: number;
  light: number;
}

/**
 * The grid's cells, sorted far → near (painter's order). `world[i][j]` and
 * `proj[i][j]` are the grid points; `rotate` takes a world vector into camera
 * space (for the normal); `tOf` maps a world height to the colour scale.
 */
export function buildCells(
  world: Vec3[][],
  proj: Proj[][],
  rotate: (v: Vec3) => Vec3,
  tOf: (worldHeight: number) => number,
  colorBy: "height" | "shade" | "flat",
  shading: boolean,
): Cell[] {
  const n = world.length;
  const cells: Cell[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < n - 1; j++) {
      const w00 = world[i][j];
      const w01 = world[i][j + 1];
      const w11 = world[i + 1][j + 1];
      const w10 = world[i + 1][j];
      const p00 = proj[i][j];
      const p01 = proj[i][j + 1];
      const p11 = proj[i + 1][j + 1];
      const p10 = proj[i + 1][j];
      // The normal of a (possibly warped) quad: the cross of its diagonals.
      const a: Vec3 = [w11[0] - w00[0], w11[1] - w00[1], w11[2] - w00[2]];
      const b: Vec3 = [w10[0] - w01[0], w10[1] - w01[1], w10[2] - w01[2]];
      const nw: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const light = shading ? lambert(rotate(nw)) : 1;
      const t = tOf((w00[1] + w01[1] + w11[1] + w10[1]) / 4);
      cells.push({
        i,
        j,
        pts: [
          [p00.x, p00.y],
          [p01.x, p01.y],
          [p11.x, p11.y],
          [p10.x, p10.y],
        ],
        depth: (p00.depth + p01.depth + p11.depth + p10.depth) / 4,
        color: cellColor(colorBy, t, shading, light),
        t,
        light,
      });
    }
  cells.sort((c, d) => d.depth - c.depth);
  return cells;
}

/**
 * A ring pushed out from its centroid by `px` logical units — neighbouring
 * cells overlap by a hair, so the anti-aliased edges of two exact fills never
 * leave a pale seam of paper between them.
 */
export function grow(pts: Pt[], px: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]): Pt => {
    const d = Math.hypot(x - cx, y - cy);
    return d < 1e-9 ? [x, y] : [x + ((x - cx) / d) * px, y + ((y - cy) / d) * px];
  });
}

/** A polygon cut to a box (Sutherland–Hodgman); fewer than 3 points when nothing is left. */
export function clipPolygon(pts: Pt[], b: { x0: number; y0: number; x1: number; y1: number }): Pt[] {
  if (pts.every(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) return pts;
  const edges: [(p: Pt) => boolean, (p: Pt, q: Pt) => Pt][] = [
    [(p) => p[0] >= b.x0, (p, q) => [b.x0, p[1] + ((q[1] - p[1]) * (b.x0 - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= b.x1, (p, q) => [b.x1, p[1] + ((q[1] - p[1]) * (b.x1 - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= b.y0, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y0 - p[1])) / (q[1] - p[1]), b.y0]],
    [(p) => p[1] <= b.y1, (p, q) => [p[0] + ((q[0] - p[0]) * (b.y1 - p[1])) / (q[1] - p[1]), b.y1]],
  ];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let k = 0; k < src.length; k++) {
      const p = src[k];
      const q = src[(k + 1) % src.length];
      const pin = inside(p);
      const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cut(p, q));
    }
    if (out.length === 0) break;
  }
  return out;
}

// ---- hidden lines ------------------------------------------------------------

/**
 * Which stretches of the wires a nearer part of the surface hides. Built once
 * per layout from the cells; `hidden(p, skip)` asks whether the projected
 * point p (with its depth) lies behind any cell but the ones in `skip` (the
 * cells the wire itself borders — a point on a cell's own edge is never
 * behind it). Cells are bucketed on a coarse screen grid, so a probe looks at
 * a handful of cells, not all of them.
 */
export function occluder(cells: Cell[], proj: Proj[][], eps: number): (p: Proj, skip: (i: number, j: number) => boolean) => boolean {
  const B = 24;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cells)
    for (const [x, y] of c.pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  const bw = Math.max(1e-9, (x1 - x0) / B);
  const bh = Math.max(1e-9, (y1 - y0) / B);
  const bins: Cell[][] = Array.from({ length: B * B }, () => []);
  const bin = (v: number, lo: number, w: number): number => Math.max(0, Math.min(B - 1, Math.floor((v - lo) / w)));
  for (const c of cells) {
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (const [x, y] of c.pts) {
      if (x < cx0) cx0 = x;
      if (x > cx1) cx1 = x;
      if (y < cy0) cy0 = y;
      if (y > cy1) cy1 = y;
    }
    for (let bx = bin(cx0, x0, bw); bx <= bin(cx1, x0, bw); bx++) for (let by = bin(cy0, y0, bh); by <= bin(cy1, y0, bh); by++) bins[by * B + bx].push(c);
  }
  /** Depth of triangle (a, b, c) at screen point p, or null when p is outside it. */
  const triDepth = (p: Proj, a: Proj, b: Proj, c: Proj): number | null => {
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-9) return null;
    const l1 = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
    const l2 = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const e = -1e-6;
    if (l1 < e || l2 < e || l3 < e) return null;
    return l1 * a.depth + l2 * b.depth + l3 * c.depth;
  };
  return (p, skip) => {
    if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return false;
    for (const c of bins[bin(p.y, y0, bh) * B + bin(p.x, x0, bw)]) {
      if (skip(c.i, c.j) || c.depth > p.depth + 1e3 * eps) continue;
      const q00 = proj[c.i][c.j];
      const q01 = proj[c.i][c.j + 1];
      const q11 = proj[c.i + 1][c.j + 1];
      const q10 = proj[c.i + 1][c.j];
      const d = triDepth(p, q00, q01, q11) ?? triDepth(p, q00, q11, q10);
      if (d !== null && d < p.depth - eps) return true;
    }
    return false;
  };
}
