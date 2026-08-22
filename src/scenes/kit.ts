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
  | { kind: "sphere"; id: string; c: Vec3; r: number; color?: string; fill?: string; ms?: number }
  | { kind: "seg"; id: string; a: Vec3; b: Vec3; w?: number; color?: string; dash?: boolean; trimA?: number; trimB?: number; ms?: number }
  | { kind: "arrow"; id: string; a: Vec3; b: Vec3; w?: number; color?: string; dash?: boolean; trimA?: number; trimB?: number; ms?: number }
  | { kind: "text3"; id: string; p: Vec3; text: string; fontSize?: number; color?: string };

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
   * Reliable scope: ball-and-stick, 3D vectors/axes, small lattices. Not for
   * intersecting surfaces or large structures.
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
    const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const trim = (a: Vec3, b: Vec3, tA = 0, tB = 0): [Vec3, Vec3] => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      return [lerp3(a, b, tA / len), lerp3(b, a, tB / len)];
    };

    interface Piece {
      depth: number;
      drawable: Drawable;
    }
    const pieces: Piece[] = [];
    const anchors: Record<string, Pt> = {};

    for (const prim of prims) {
      if (prim.kind === "sphere") {
        const q = proj(prim.c);
        anchors[prim.id] = [q.x, q.y];
        pieces.push({
          depth: q.depth,
          drawable: {
            id: prim.id,
            kind: "stroke",
            pts: [[q.x, q.y]],
            shapeHint: { type: "circle", c: [q.x, q.y], r: prim.r * q.s },
            z: Z_STROKE,
            style: defaultStyle({
              ...(prim.color !== undefined && { color: prim.color }),
              ...(prim.fill !== undefined && { fill: prim.fill }),
              strokeWidth: 3,
            }),
            drawOpts: defaultDrawOpts("sketch", prim.ms ?? SKETCH_MS.node),
          },
        });
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
      for (const p of pieces) {
        const t = (p.depth - dMin) / span; // 0 = nearest, 1 = farthest
        p.drawable.style = { ...p.drawable.style, opacity: p.drawable.style.opacity * (1 - fade * t) };
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
