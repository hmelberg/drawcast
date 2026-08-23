// sceneKit v1 — the stdlib handed to template layout bodies as `kit`.
// Layout bodies cannot import anything; every helper they need lives here.
// The doc comments double as the authoring-prompt documentation (M2).
//
// Two rules every layout must follow:
// 1. Text that IS geometry (atom symbols, termini) = kit.text (exact position);
//    text that NAMES things = kit.label (the collision solver may move it).
// 2. Repeated micro-strokes (bonds, dots, hatching) go in ONE kit.group —
//    groups are the narration/annotation beats.

import { CANVAS } from "../layout/canvas";
import {
  COLORS,
  SKETCH_MS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  type AreaDrawable,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type ShapeHint,
  type StrokeDrawable,
  type TextDrawable,
} from "../layout/model";
import type { LabelRequest } from "../layout/labels";
import type { Side } from "../spec/types";

export const KIT_VERSION = 1;

export interface StrokeOpts {
  closed?: boolean;
  arrowhead?: "end" | "start" | "both";
  shapeHint?: ShapeHint;
  color?: string;
  fill?: string;
  strokeWidth?: number;
  dash?: boolean;
  opacity?: number;
  /** Sketch duration ms (default SKETCH_MS.stroke). */
  ms?: number;
  /** Draw instantly instead of sketching. */
  instant?: boolean;
}

export interface TextOpts {
  fontSize?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
}

export interface NewickNode {
  name?: string;
  length?: number;
  children: NewickNode[];
}

export interface SSSegment {
  kind: "helix" | "sheet" | "loop";
  length: number;
}

export interface Edge {
  from: string;
  to: string;
  effect: "activates" | "inhibits" | "converts";
}

export type Vec3 = [number, number, number];

export interface Camera3 {
  /** Degrees; orbit around the vertical axis. */
  azimuth: number;
  /** Degrees; tilt up/down. */
  elevation: number;
  /** World units from the target; smaller = stronger perspective. */
  distance: number;
  /** Projection strength (default 900). */
  fov?: number;
  /** Screen center (defaults 500, 375). */
  cx?: number;
  cy?: number;
  /**
   * Atmospheric depth fade 0–1 (default 0): farther primitives render more
   * transparent — the strongest static 3D cue in a sketchy style.
   */
  fade?: number;
}

export type Prim3 =
  | { kind: "sphere"; id: string; c: Vec3; r: number; color?: string; fill?: string; shade?: boolean; style?: "solid" | "wire"; ms?: number }
  | { kind: "seg"; id: string; a: Vec3; b: Vec3; w?: number; color?: string; dash?: boolean; trimA?: number; trimB?: number; ms?: number }
  | { kind: "arrow"; id: string; a: Vec3; b: Vec3; w?: number; color?: string; dash?: boolean; trimA?: number; trimB?: number; ms?: number }
  | { kind: "text3"; id: string; p: Vec3; text: string; fontSize?: number; color?: string }
  | { kind: "face3"; id: string; pts: Vec3[]; color?: string; fill?: string; opacity?: number; ms?: number }
  | { kind: "box3"; id: string; c: Vec3; size: Vec3; color?: string; fill?: string; hidden_edges?: boolean };

/**
 * Lighten/darken a hex color toward white/black. factor 1 → pure white (lighter);
 * factor 0 → pure black (darker); factor 0.5 → the color unchanged. Used by
 * project3d's face3 flat-shading AND the sphere gradient stops (spec §3a).
 */
export function shadeColor(hex: string, factor: number): string {
  const t = Math.max(0, Math.min(1, factor));
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  const toward = t < 0.5 ? 0 : 255;
  const blend = t < 0.5 ? (0.5 - t) * 2 : (t - 0.5) * 2;
  const mix = (c: number) => Math.round(c + (toward - c) * blend);
  const hx = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${hx(mix(r))}${hx(mix(g))}${hx(mix(b))}`;
}

export interface SceneKit {
  // ---- factories ----
  stroke(id: string, pts: Pt[], o?: StrokeOpts): StrokeDrawable;
  area(id: string, pts: Pt[], fill: string, o?: { opacity?: number; ms?: number }): AreaDrawable;
  text(id: string, pos: Pt, s: string, o?: TextOpts): TextDrawable;
  label(id: string, anchor: Pt, side: Side, s: string, o?: { fontSize?: number; color?: string }): LabelRequest;
  group(id: string, children: Drawable[]): GroupDrawable;
  // ---- geometry (all return points in logical y-up coordinates) ----
  polygon(c: Pt, r: number, n: number, rot?: number): Pt[];
  arc(c: Pt, r: number, a0: number, a1: number, n?: number): Pt[];
  ellipse(c: Pt, rx: number, ry: number, n?: number): Pt[];
  /** Organic closed blob: ellipse with seeded low-frequency wobble. */
  blob(c: Pt, rx: number, ry: number, wobble?: number, phase?: number, n?: number): Pt[];
  /** Horizontal sine wave starting at `from`, extending `length` to the right. */
  wave(from: Pt, length: number, amplitude: number, wavelength: number, step?: number): Pt[];
  /** Catmull–Rom smoothing through the given points. */
  smooth(pts: Pt[], per?: number): Pt[];
  /** Polyline offset by d to the left of travel (double bonds, membranes). */
  parallelOffset(pts: Pt[], d: number): Pt[];
  /** Closed 7-point block-arrow polygon from → to (β-strands, big arrows). */
  blockArrow(from: Pt, to: Pt, bodyW: number, headW: number, headL: number): Pt[];
  /** n short hatch ticks along from→to (ground, walls). dir −1 = below/right. */
  hatch(from: Pt, to: Pt, n?: number, len?: number, dir?: 1 | -1): [Pt, Pt][];
  /** Deterministic pseudo-random in (−1, 1). NEVER use Math.random. */
  jitter(i: number): number;
  // ---- standard-notation parsers ----
  /** "CCHHHEEE" (H helix / E sheet / C loop) → run-length segments. */
  parseSS(s: string): SSSegment[];
  /** Newick tree string, e.g. "((A:1,B:2)AB,C);" */
  parseNewick(s: string): NewickNode;
  /** "A -> B; B -| C; X => Y" (activates / inhibits / converts). */
  parseEdgeList(s: string): Edge[];
  // ---- static 3D → flat drawables (spec §3a; validated by the 2026-08-22 spike) ----
  /**
   * Project 3D primitives into ordinary flat drawables: orbit camera
   * (azimuth/elevation in degrees, distance in world units), perspective
   * projection, painter's-algorithm depth sort. Bond segments split at their
   * midpoint and can be trimmed at sphere surfaces (trimA/trimB, world units)
   * so sticks vanish into balls. Returned `order` is far-to-near — draw in
   * that order so occlusion stays correct during progressive drawing.
   * Spheres default to `shade: true`: the ball is ONE circle whose radial-
   * gradient fill is lit from up-left (bright core toward the light, darkened
   * limb) — volumetric with no extra drawables. `style: "wire"` draws the
   * textbook wireframe instead: outline plus equator, front half solid
   * (`id__eq`), back half dashed (`id__eqb`), no fill. face3
   * (a flat 3D polygon) and box3 (an axis-aligned solid, visible faces only,
   * optional dashed hidden edges) use the same flat-shaded-face lighting.
   * Reliable scope: ball-and-stick, 3D vectors/axes, small lattices/solids.
   * Not for intersecting surfaces or large structures.
   */
  project3d(camera: Camera3, prims: Prim3[]): { drawables: Drawable[]; anchors: Record<string, Pt>; order: string[] };
  // ---- constants ----
  COLORS: typeof COLORS;
  CANVAS: typeof CANVAS;
  SKETCH_MS: typeof SKETCH_MS;
}

// `kit` is one shared, live object handed to every compiled template body
// (src/scenes/compile.ts). It is frozen below (and COLORS/CANVAS/SKETCH_MS
// are frozen at their source in layout/model.ts and layout/canvas.ts) so a
// body can never mutate a factory or a constant and poison later renders —
// `kit.stroke = ...` or `kit.COLORS.ink = "red"` throws instead of sticking.
export const kit: SceneKit = {
  stroke(id, pts, o = {}) {
    return {
      id,
      kind: "stroke",
      pts,
      closed: o.closed,
      arrowhead: o.arrowhead,
      shapeHint: o.shapeHint,
      z: Z_STROKE,
      style: defaultStyle({
        ...(o.color !== undefined && { color: o.color }),
        ...(o.fill !== undefined && { fill: o.fill }),
        ...(o.strokeWidth !== undefined && { strokeWidth: o.strokeWidth }),
        ...(o.dash !== undefined && { dash: o.dash }),
        ...(o.opacity !== undefined && { opacity: o.opacity }),
      }),
      drawOpts: o.instant ? defaultDrawOpts("instant") : defaultDrawOpts("sketch", o.ms ?? SKETCH_MS.stroke),
    };
  },
  area(id, pts, fill, o = {}) {
    return {
      id,
      kind: "area",
      pts,
      z: Z_AREA,
      style: defaultStyle({ fill, opacity: o.opacity ?? 0.35, strokeWidth: 0 }),
      drawOpts: defaultDrawOpts("sketch", o.ms ?? SKETCH_MS.region),
    };
  },
  text(id, pos, s, o = {}) {
    return {
      id,
      kind: "text",
      pos,
      text: s,
      fontSize: o.fontSize ?? 28,
      anchor: o.anchor ?? "middle",
      z: Z_TEXT,
      style: defaultStyle(o.color !== undefined ? { color: o.color } : {}),
      drawOpts: defaultDrawOpts("instant"),
    };
  },
  label(id, anchor, side, s, o = {}) {
    return {
      id,
      anchor,
      side,
      text: s,
      fontSize: o.fontSize ?? 26,
      style: defaultStyle(o.color !== undefined ? { color: o.color } : {}),
      drawOpts: defaultDrawOpts("instant"),
    };
  },
  group(id, children) {
    return { id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children };
  },

  polygon(c, r, n, rot = Math.PI / 2) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = rot + (i * 2 * Math.PI) / n;
      pts.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
    }
    return pts;
  },
  arc(c, r, a0, a1, n = 24) {
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const th = a0 + ((a1 - a0) * i) / n;
      pts.push([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
    }
    return pts;
  },
  ellipse(c, rx, ry, n = 48) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      pts.push([c[0] + rx * Math.cos(th), c[1] + ry * Math.sin(th)]);
    }
    return pts;
  },
  blob(c, rx, ry, wobble = 0.05, phase = 0, n = 64) {
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      const w = 1 + wobble * Math.sin(3 * th + phase) + wobble * 0.6 * Math.sin(7 * th + phase * 2);
      pts.push([c[0] + rx * w * Math.cos(th), c[1] + ry * w * Math.sin(th)]);
    }
    return pts;
  },
  wave(from, length, amplitude, wavelength, step = 4) {
    const pts: Pt[] = [];
    for (let t = 0; t <= length; t += step) {
      pts.push([from[0] + t, from[1] + amplitude * Math.sin((t / wavelength) * 2 * Math.PI)]);
    }
    return pts;
  },
  smooth(pts, per = 8) {
    if (pts.length < 3) return pts.map((p): Pt => [p[0], p[1]]);
    const P = [pts[0], ...pts, pts[pts.length - 1]];
    const out: Pt[] = [];
    for (let i = 0; i + 3 < P.length; i++) {
      const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    return out;
  },
  parallelOffset(pts, d) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      out.push([pts[i][0] - ((b[1] - a[1]) / len) * d, pts[i][1] + ((b[0] - a[0]) / len) * d]);
    }
    return out;
  },
  blockArrow(from, to, bodyW, headW, headL) {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const neck: Pt = [to[0] - ux * headL, to[1] - uy * headL];
    const h = bodyW / 2, H = headW / 2;
    return [
      [from[0] + nx * h, from[1] + ny * h],
      [neck[0] + nx * h, neck[1] + ny * h],
      [neck[0] + nx * H, neck[1] + ny * H],
      [to[0], to[1]],
      [neck[0] - nx * H, neck[1] - ny * H],
      [neck[0] - nx * h, neck[1] - ny * h],
      [from[0] - nx * h, from[1] - ny * h],
    ];
  },
  hatch(from, to, n = 18, len = 20, dir = -1) {
    const segs: [Pt, Pt][] = [];
    const dx = to[0] - from[0], dy = to[1] - from[1];
    const dlen = Math.hypot(dx, dy) || 1;
    // 45° tick: half back along the line, half perpendicular.
    const tx = (-dx / dlen + (dy / dlen) * -dir) * (len * Math.SQRT1_2);
    const ty = (-dy / dlen + (-dx / dlen) * -dir) * (len * Math.SQRT1_2);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const p: Pt = [from[0] + dx * t, from[1] + dy * t];
      segs.push([p, [p[0] + tx, p[1] + ty]]);
    }
    return segs;
  },
  jitter(i) {
    return Math.sin(i * 12.9898 + 4.1414) % 1;
  },

  parseSS(s) {
    const clean = s.toUpperCase().replace(/[^HEC]/g, "");
    const out: SSSegment[] = [];
    let i = 0;
    while (i < clean.length) {
      let j = i;
      while (j < clean.length && clean[j] === clean[i]) j++;
      out.push({ kind: clean[i] === "H" ? "helix" : clean[i] === "E" ? "sheet" : "loop", length: j - i });
      i = j;
    }
    return out;
  },
  parseNewick(s) {
    const src = s.trim().replace(/;\s*$/, "");
    let i = 0;
    const node = (): NewickNode => {
      const n: NewickNode = { children: [] };
      if (src[i] === "(") {
        i++;
        n.children.push(node());
        while (src[i] === ",") {
          i++;
          n.children.push(node());
        }
        if (src[i] !== ")") throw new Error(`newick: expected ")" at ${i}`);
        i++;
      }
      let name = "";
      while (i < src.length && !"(),:".includes(src[i])) name += src[i++];
      if (name.trim()) n.name = name.trim();
      if (src[i] === ":") {
        i++;
        let num = "";
        while (i < src.length && !"(),".includes(src[i])) num += src[i++];
        n.length = Number(num);
      }
      return n;
    };
    const root = node();
    if (i !== src.length) throw new Error(`newick: trailing input at ${i}`);
    return root;
  },
  parseEdgeList(s) {
    const out: Edge[] = [];
    for (const part of s.split(/[;\n]/)) {
      const m = part.trim().match(/^(.+?)\s*(->|-\||=>)\s*(.+)$/);
      if (!m) continue;
      out.push({
        from: m[1].trim(),
        to: m[3].trim(),
        effect: m[2] === "->" ? "activates" : m[2] === "-|" ? "inhibits" : "converts",
      });
    }
    return out;
  },

  project3d(camera, prims) {
    const fov = camera.fov ?? 900;
    const cx = camera.cx ?? 500;
    const cy = camera.cy ?? 375;
    const az = (camera.azimuth * Math.PI) / 180;
    const el = (camera.elevation * Math.PI) / 180;
    const proj = (p: Vec3): { x: number; y: number; s: number; depth: number } => {
      const x1 = p[0] * Math.cos(az) - p[2] * Math.sin(az);
      const z1 = p[0] * Math.sin(az) + p[2] * Math.cos(az);
      const y2 = p[1] * Math.cos(el) - z1 * Math.sin(el);
      const z2 = p[1] * Math.sin(el) + z1 * Math.cos(el);
      const depth = camera.distance - z2;
      const s = fov / Math.max(0.1, depth);
      return { x: cx + x1 * s, y: cy + y2 * s, s, depth };
    };
    // Rotate a direction (no translation) by the same orbit camera, to test
    // face-normal visibility: rotatedZ(v) > 0 means the direction faces the
    // camera (mirrors proj()'s x1/z1/y2/z2, dropped down to just the sign
    // that matters).
    const rotatedZ = (v: Vec3): number => {
      const z1 = v[0] * Math.sin(az) + v[2] * Math.cos(az);
      return v[1] * Math.sin(el) + z1 * Math.cos(el);
    };
    const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const trim = (a: Vec3, b: Vec3, tA = 0, tB = 0): [Vec3, Vec3] => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      return [lerp3(a, b, tA / len), lerp3(b, a, tB / len)];
    };
    // World-space light, fixed regardless of camera (v1 ruling) — used by face3's flat shading.
    const lightLen = Math.hypot(-0.5, 0.7, 0.5);
    const LIGHT: Vec3 = [-0.5 / lightLen, 0.7 / lightLen, 0.5 / lightLen];
    const faceNormal = (pts: Vec3[]): Vec3 => {
      const [a, b, c] = pts;
      const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      return [nx / len, ny / len, nz / len];
    };
    const centroid = (pts: Pt[]): Pt => [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];

    interface Piece {
      depth: number;
      drawable: Drawable;
    }
    const pieces: Piece[] = [];
    const anchors: Record<string, Pt> = {};

    // Shared by the face3 prim and by box3's per-visible-face expansion: a flat
    // 3D polygon becomes a closed outline stroke + a flat-shaded fill area
    // (grouped under one id — only "area" fills actually paint solid/hachure
    // in this pipeline, so the fill needs its own leaf), lit by LIGHT in world
    // space before projection.
    const buildFacePiece = (
      id: string,
      pts3: Vec3[],
      color: string | undefined,
      fill: string | undefined,
      opacity: number | undefined,
      ms: number | undefined,
    ): Piece => {
      const qs = pts3.map(proj);
      const screenPts: Pt[] = qs.map((q) => [q.x, q.y]);
      const depth = qs.reduce((s, q) => s + q.depth, 0) / qs.length;
      const n = faceNormal(pts3);
      const lit = 0.55 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const strokeColor = color ?? COLORS.ink;
      const baseFill = fill ?? color ?? COLORS.ink;
      const area: AreaDrawable = {
        id: `${id}__area`,
        kind: "area",
        pts: screenPts,
        z: Z_STROKE,
        style: defaultStyle({ fill: shadeColor(baseFill, lit), opacity: opacity ?? 1, strokeWidth: 0 }),
        drawOpts: defaultDrawOpts("sketch", ms ?? SKETCH_MS.region),
      };
      const line: StrokeDrawable = {
        id: `${id}__line`,
        kind: "stroke",
        pts: screenPts,
        closed: true,
        z: Z_STROKE,
        style: defaultStyle({ color: strokeColor, strokeWidth: 3 }),
        drawOpts: defaultDrawOpts("sketch", ms ?? SKETCH_MS.connector),
      };
      anchors[id] = centroid(screenPts);
      return {
        depth,
        drawable: { id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: [area, line] },
      };
    };

    for (const prim of prims) {
      if (prim.kind === "sphere") {
        const q = proj(prim.c);
        anchors[prim.id] = [q.x, q.y];
        const resolvedColor = prim.color ?? COLORS.ink;
        if (prim.style === "wire") {
          // Textbook wireframe: outline circle + the world-space equator,
          // front half solid, back half dashed — the geometry-class "this is
          // a sphere" cue. No fill at all.
          pieces.push({
            depth: q.depth,
            drawable: {
              id: prim.id,
              kind: "stroke",
              pts: [[q.x, q.y]],
              shapeHint: { type: "circle", c: [q.x, q.y], r: prim.r * q.s },
              z: Z_STROKE,
              style: defaultStyle({ color: resolvedColor, strokeWidth: 3 }),
              drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.node),
            },
          });
          // Sample the equator (world-space horizontal circle through the
          // center), classify each point front/back against the center's own
          // depth, and keep the LONGEST run of each class — in general
          // position the equator crosses the silhouette exactly twice, so
          // that IS the front and the back half; a degenerate edge-on camera
          // just gets a partial arc, which still reads correctly.
          const N = 48;
          const samples = Array.from({ length: N }, (_, i) => {
            const t = (i / N) * 2 * Math.PI;
            const p = proj([prim.c[0] + prim.r * Math.cos(t), prim.c[1], prim.c[2] + prim.r * Math.sin(t)]);
            return { pt: [p.x, p.y] as Pt, back: p.depth > q.depth };
          });
          const boundary = samples.findIndex((s, i) => s.back !== samples[(i + N - 1) % N].back);
          const ordered = boundary <= 0 ? samples : [...samples.slice(boundary), ...samples.slice(0, boundary)];
          const runs: { back: boolean; pts: Pt[] }[] = [];
          for (const s of ordered) {
            const last = runs[runs.length - 1];
            if (last && last.back === s.back) last.pts.push(s.pt);
            else runs.push({ back: s.back, pts: [s.pt] });
          }
          // Bridge each run to the start of the next so the halves meet at the silhouette.
          runs.forEach((r, i) => {
            const next = runs[(i + 1) % runs.length];
            if (next !== r) r.pts.push(next.pts[0]);
          });
          const longest = (back: boolean) =>
            runs.filter((r) => r.back === back && r.pts.length >= 2).sort((a, b) => b.pts.length - a.pts.length)[0];
          const front = longest(false);
          const back = longest(true);
          if (back) {
            pieces.push({
              depth: q.depth + 1e-6,
              drawable: {
                id: `${prim.id}__eqb`,
                kind: "stroke",
                pts: back.pts,
                z: Z_STROKE,
                style: defaultStyle({ color: resolvedColor, strokeWidth: 2, dash: true, opacity: 0.65 }),
                drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.guides),
              },
            });
          }
          if (front) {
            pieces.push({
              depth: q.depth - 1e-6,
              drawable: {
                id: `${prim.id}__eq`,
                kind: "stroke",
                pts: front.pts,
                z: Z_STROKE,
                style: defaultStyle({ color: resolvedColor, strokeWidth: 2.5 }),
                drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.guides),
              },
            });
          }
        } else {
          // Solid ball: ONE circle whose radial-gradient fill carries the
          // volume — bright core offset toward the fixed up-left light,
          // darkened limb (screen-space light, camera-independent, matching
          // the previous crescent convention). No overlay drawables, so the
          // ball is complete the instant its circle finishes drawing.
          const base = prim.fill ?? shadeColor(resolvedColor, 0.85);
          const shaded = prim.shade !== false;
          pieces.push({
            depth: q.depth,
            drawable: {
              id: prim.id,
              kind: "stroke",
              pts: [[q.x, q.y]],
              shapeHint: { type: "circle", c: [q.x, q.y], r: prim.r * q.s },
              z: Z_STROKE,
              style: defaultStyle({
                color: resolvedColor,
                ...((prim.fill !== undefined || shaded) && { fill: base }),
                ...(shaded && {
                  fillGradient: {
                    fx: 0.32,
                    fy: 0.3,
                    r: 0.75,
                    stops: [
                      { offset: 0, color: shadeColor(base, 0.78) },
                      { offset: 0.55, color: base },
                      { offset: 1, color: shadeColor(base, 0.3) },
                    ],
                  },
                }),
                strokeWidth: 3,
              }),
              drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.node),
            },
          });
        }
      } else if (prim.kind === "face3") {
        pieces.push(buildFacePiece(prim.id, prim.pts, prim.color, prim.fill, prim.opacity, prim.ms));
      } else if (prim.kind === "box3") {
        const [bx, by, bz] = prim.c;
        const [sx, sy, sz] = prim.size;
        const hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const qCenter = proj(prim.c);
        anchors[prim.id] = [qCenter.x, qCenter.y];
        // Six axis-aligned faces, each wound (right-hand rule) so faceNormal
        // matches the listed canonical normal — verified by construction.
        const faces: { normal: Vec3; pts: Vec3[] }[] = [
          { normal: [1, 0, 0], pts: [[bx + hx, by - hy, bz - hz], [bx + hx, by + hy, bz - hz], [bx + hx, by + hy, bz + hz], [bx + hx, by - hy, bz + hz]] },
          { normal: [-1, 0, 0], pts: [[bx - hx, by - hy, bz + hz], [bx - hx, by + hy, bz + hz], [bx - hx, by + hy, bz - hz], [bx - hx, by - hy, bz - hz]] },
          { normal: [0, 1, 0], pts: [[bx - hx, by + hy, bz - hz], [bx - hx, by + hy, bz + hz], [bx + hx, by + hy, bz + hz], [bx + hx, by + hy, bz - hz]] },
          { normal: [0, -1, 0], pts: [[bx - hx, by - hy, bz + hz], [bx - hx, by - hy, bz - hz], [bx + hx, by - hy, bz - hz], [bx + hx, by - hy, bz + hz]] },
          { normal: [0, 0, 1], pts: [[bx - hx, by - hy, bz + hz], [bx + hx, by - hy, bz + hz], [bx + hx, by + hy, bz + hz], [bx - hx, by + hy, bz + hz]] },
          { normal: [0, 0, -1], pts: [[bx + hx, by - hy, bz - hz], [bx - hx, by - hy, bz - hz], [bx - hx, by + hy, bz - hz], [bx + hx, by + hy, bz - hz]] },
        ];
        const visible = faces.map((f) => rotatedZ(f.normal) > 0);
        const faceDepths: number[] = [];
        faces.forEach((f, i) => {
          if (!visible[i]) return;
          const piece = buildFacePiece(`${prim.id}__f${i}`, f.pts, prim.color, prim.fill, undefined, undefined);
          faceDepths.push(piece.depth);
          pieces.push(piece);
        });
        if (prim.hidden_edges) {
          // The 12 box edges, each the intersection of two faces differing
          // in exactly one axis sign; an edge is hidden only when BOTH its
          // faces are hidden (the geometry-textbook wireframe cue). Solid
          // faces would otherwise occlude them completely (they're strictly
          // behind the box), so — like the sphere's shading — they're
          // forced just nearer than this box's own visible faces to stay
          // visible as the classic dashed "X-ray" reference lines.
          const corner = (sxs: 1 | -1, sys: 1 | -1, szs: 1 | -1): Vec3 => [bx + sxs * hx, by + sys * hy, bz + szs * hz];
          const faceIx = (axis: 0 | 1 | 2, sign: 1 | -1): number => (axis === 0 ? (sign > 0 ? 0 : 1) : axis === 1 ? (sign > 0 ? 2 : 3) : sign > 0 ? 4 : 5);
          const signs: (1 | -1)[] = [1, -1];
          const edges: { a: Vec3; b: Vec3; f1: number; f2: number }[] = [];
          for (const sy of signs) for (const sz of signs) edges.push({ a: corner(-1, sy, sz), b: corner(1, sy, sz), f1: faceIx(1, sy), f2: faceIx(2, sz) });
          for (const sx of signs) for (const sz of signs) edges.push({ a: corner(sx, -1, sz), b: corner(sx, 1, sz), f1: faceIx(0, sx), f2: faceIx(2, sz) });
          for (const sx of signs) for (const sy of signs) edges.push({ a: corner(sx, sy, -1), b: corner(sx, sy, 1), f1: faceIx(0, sx), f2: faceIx(1, sy) });
          const nearFace = (faceDepths.length ? Math.min(...faceDepths) : qCenter.depth) - 1e-5;
          edges.forEach((e, i) => {
            if (visible[e.f1] || visible[e.f2]) return;
            const qa = proj(e.a), qb = proj(e.b);
            pieces.push({
              depth: nearFace - i * 1e-7,
              drawable: {
                id: `${prim.id}__e${i}`,
                kind: "stroke",
                pts: [[qa.x, qa.y], [qb.x, qb.y]],
                z: Z_STROKE,
                style: defaultStyle({ color: prim.color ?? COLORS.guide, strokeWidth: 2, dash: true, opacity: 0.7 }),
                drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
              },
            });
          });
        }
      } else if (prim.kind === "seg" || prim.kind === "arrow") {
        const [a, b] = trim(prim.a, prim.b, prim.trimA, prim.trimB);
        const style = defaultStyle({
          ...(prim.color !== undefined && { color: prim.color }),
          strokeWidth: prim.w ?? 4,
          ...(prim.dash !== undefined && { dash: prim.dash }),
        });
        const opts = defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.connector);
        if (prim.kind === "arrow") {
          const qa = proj(a), qb = proj(b);
          anchors[prim.id] = [qb.x, qb.y];
          pieces.push({
            depth: (qa.depth + qb.depth) / 2,
            drawable: { id: prim.id, kind: "stroke", pts: [[qa.x, qa.y], [qb.x, qb.y]], arrowhead: "end", z: Z_STROKE, style, drawOpts: opts },
          });
        } else {
          // Split at the midpoint so each half sorts near its own end.
          const mid = lerp3(a, b, 0.5);
          const halves: [Vec3, Vec3, string][] = [
            [a, mid, prim.id],
            [mid, b, `${prim.id}__f`],
          ];
          const qm = proj(mid);
          anchors[prim.id] = [qm.x, qm.y];
          for (const [u, v, id] of halves) {
            const qu = proj(u), qv = proj(v);
            pieces.push({
              depth: (qu.depth + qv.depth) / 2,
              drawable: { id, kind: "stroke", pts: [[qu.x, qu.y], [qv.x, qv.y]], z: Z_STROKE, style, drawOpts: opts },
            });
          }
        }
      } else {
        const q = proj(prim.p);
        anchors[prim.id] = [q.x, q.y];
        pieces.push({
          depth: q.depth - 1e-6, // labels win ties against their own geometry
          drawable: {
            id: prim.id,
            kind: "text",
            pos: [q.x, q.y],
            text: prim.text,
            fontSize: prim.fontSize ?? 26,
            anchor: "middle",
            z: Z_TEXT,
            style: defaultStyle(prim.color !== undefined ? { color: prim.color } : {}),
            drawOpts: defaultDrawOpts("instant"),
          },
        });
      }
    }

    pieces.sort((a, b) => b.depth - a.depth); // far first — paint back to front

    const fade = Math.min(1, Math.max(0, camera.fade ?? 0));
    if (fade > 0 && pieces.length > 1) {
      const depths = pieces.map((p) => p.depth);
      const dMin = Math.min(...depths);
      const span = Math.max(1e-6, Math.max(...depths) - dMin);
      // Groups (face3) aren't painted directly — only their leaf children
      // are — so the fade factor has to land on the children's own style.
      const fadeOne = (d: Drawable, factor: number) => {
        d.style = { ...d.style, opacity: d.style.opacity * factor };
      };
      for (const p of pieces) {
        const t = (p.depth - dMin) / span; // 0 = nearest, 1 = farthest
        const factor = 1 - fade * t;
        if (p.drawable.kind === "group") p.drawable.children.forEach((c) => fadeOne(c, factor));
        else fadeOne(p.drawable, factor);
      }
    }

    return {
      drawables: pieces.map((p) => p.drawable),
      anchors,
      order: pieces.map((p) => p.drawable.id),
    };
  },

  COLORS,
  CANVAS,
  SKETCH_MS,
};

Object.freeze(kit);
