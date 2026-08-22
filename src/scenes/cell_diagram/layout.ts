// Deterministic cell cross-section: membrane blob (double line) + selectable
// organelles, with collision-solved leader labels. All blobs use seeded
// deterministic wobble — same params, identical drawing.

import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export type Organelle = "nucleus" | "mitochondria" | "er" | "golgi" | "ribosomes";

export interface CellDiagramParams {
  /** Which organelles to include (default: all). */
  organelles?: Organelle[];
  /** Show organelle name labels (default true). */
  labels?: boolean;
}

const CX = 470, CY = 380;

export function layoutCellDiagram(params: CellDiagramParams): SceneLayout {
  const on = new Set<Organelle>(params.organelles ?? ["nucleus", "mitochondria", "er", "golgi", "ribosomes"]);
  const showLabels = params.labels !== false;

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string = COLORS.ink, fontSize = 26) => {
    if (!showLabels) return;
    labels.push({ id, anchor, side, text, fontSize, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    order.push(id);
  };

  const outer = blob(CX, CY, 375, 285, 0.05, 1);
  push({ id: "cytoplasm", kind: "area", pts: outer, z: Z_AREA, style: defaultStyle({ fill: COLORS.region1, opacity: 0.12, strokeWidth: 0 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region) });
  push({ id: "membrane", kind: "stroke", pts: outer, closed: true, z: Z_STROKE, style: defaultStyle({ strokeWidth: 4.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve) });
  push({ id: "membrane_inner", kind: "stroke", pts: blob(CX, CY, 358, 268, 0.05, 1), closed: true, z: Z_STROKE, style: defaultStyle({ strokeWidth: 2.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve) });
  anchors["membrane"] = [CX - 190, CY + 245];
  label("label_membrane", [CX - 190, CY + 245], "above-left", "Cell membrane");

  if (on.has("nucleus")) {
    const nc: Pt = [590, 420];
    push({ id: "nucleus_fill", kind: "area", pts: blob(nc[0], nc[1], 100, 92, 0.03, 2), z: Z_AREA, style: defaultStyle({ fill: COLORS.accent, opacity: 0.15, strokeWidth: 0 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region) });
    push({ id: "nucleus", kind: "stroke", pts: blob(nc[0], nc[1], 100, 92, 0.03, 2), closed: true, z: Z_STROKE, style: defaultStyle({ color: COLORS.accent, strokeWidth: 4 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.node) });
    push({ id: "nucleolus", kind: "area", pts: blob(nc[0] + 22, nc[1] - 12, 26, 24, 0.06, 3), z: Z_AREA, style: defaultStyle({ fill: COLORS.accent, opacity: 0.5, strokeWidth: 0 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.dot) });
    anchors["nucleus"] = nc;
    label("label_nucleus", nc, "right", "Nucleus", COLORS.accent);
  }

  if (on.has("mitochondria")) {
    const mc: Pt = [300, 470];
    push({ id: "mito", kind: "stroke", pts: blob(mc[0], mc[1], 88, 44, 0.04, 4), closed: true, z: Z_STROKE, style: defaultStyle({ color: COLORS.demand, strokeWidth: 3.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.node) });
    const cristae: Drawable[] = [];
    for (let k = 0; k < 4; k++) {
      const bx = mc[0] - 48 + k * 30;
      const pts: Pt[] = [];
      for (let t = 0; t <= 1; t += 0.12) {
        const yr = 30 * (1 - Math.abs(k - 1.5) * 0.18);
        pts.push([bx + 7 * Math.sin(t * Math.PI * 2 + k), mc[1] - yr + 2 * yr * t]);
      }
      cristae.push({ id: `crista_${k}`, kind: "stroke", pts, z: Z_STROKE, style: defaultStyle({ color: COLORS.demand, strokeWidth: 2.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides) });
    }
    push({ id: "cristae", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: cristae });
    anchors["mito"] = mc;
    label("label_mito", [mc[0], mc[1] - 44], "below", "Mitochondrion", COLORS.demand);
  }

  if (on.has("er")) {
    const er: Drawable[] = [];
    for (let k = 0; k < 3; k++) {
      er.push({ id: `er_${k}`, kind: "stroke", pts: arc(590, 420, 130 + k * 22, Math.PI * 0.75, Math.PI * 1.35), z: Z_STROKE, style: defaultStyle({ color: COLORS.supply, strokeWidth: 3 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides) });
    }
    push({ id: "er", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: er });
    anchors["er"] = [428, 300];
    label("label_er", [428, 292], "above-left", "Endoplasmic reticulum", COLORS.supply, 24);
  }

  if (on.has("golgi")) {
    const gg: Drawable[] = [];
    for (let k = 0; k < 4; k++) {
      gg.push({ id: `golgi_${k}`, kind: "stroke", pts: arc(320, 300 - k * 20, 80 * (1 - k * 0.16), Math.PI * 0.15, Math.PI * 0.85), z: Z_STROKE, style: defaultStyle({ color: COLORS.shifted, strokeWidth: 3.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides) });
    }
    push({ id: "golgi", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: gg });
    anchors["golgi"] = [320, 320];
    label("label_golgi", [320, 350], "above", "Golgi apparatus", COLORS.shifted, 24);
  }

  if (on.has("ribosomes")) {
    const dots: Drawable[] = [];
    const spots: Pt[] = [];
    for (let k = 0; k < 14; k++) {
      const th = jitter(k) * Math.PI * 2;
      const rr = 0.45 + 0.5 * Math.abs(jitter(k + 40));
      const p: Pt = [CX + 340 * rr * Math.cos(th), CY + 250 * rr * Math.sin(th)];
      if (Math.hypot(p[0] - 590, p[1] - 420) < 130) continue; // keep out of nucleus
      if (Math.hypot(p[0] - 300, p[1] - 470) < 110) continue; // and mitochondrion
      spots.push(p);
      dots.push({ id: `ribo_${k}`, kind: "stroke", pts: [p], shapeHint: { type: "circle", c: p, r: 5 }, z: Z_STROKE, style: defaultStyle({ fill: COLORS.ink, strokeWidth: 2.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.dot) });
    }
    push({ id: "ribosomes", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: dots });
    anchors["ribosomes"] = spots[0] ?? [CX, CY];
    label("label_ribo", spots[0] ?? [CX, CY], "above-right", "Ribosomes", COLORS.ink, 24);
  }

  return { drawables, labels, anchors, order };
}

/** Deterministic jitter in [-1, 1] — layout code must never use Math.random. */
function jitter(i: number): number {
  return Math.sin(i * 12.9898 + 4.1414) % 1;
}

/** Closed organic blob: ellipse with low-frequency radial wobble. */
function blob(cx: number, cy: number, rx: number, ry: number, wobble: number, phase: number, n = 64): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(3 * th + phase) + wobble * 0.6 * Math.sin(7 * th + phase * 2);
    pts.push([cx + rx * w * Math.cos(th), cy + ry * w * Math.sin(th)]);
  }
  return pts;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 24): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
  }
  return pts;
}
