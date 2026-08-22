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

  COLORS,
  CANVAS,
  SKETCH_MS,
};

Object.freeze(kit);
