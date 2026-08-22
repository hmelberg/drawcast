// Deterministic protein secondary-structure strip (SSDraw-style shorthand):
// helix = coil, β-strand = block arrow, loop = shallow curve, N → C left to
// right. Accepts either an explicit segments list or a compact ss string
// like "CCHHHHHCCEEEECC" (H = helix, E = strand, C = coil/loop).

import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { CANVAS } from "../../layout/canvas";

export interface ProteinSegment {
  kind: "helix" | "sheet" | "loop";
  label?: string;
}

export interface ProteinSecondaryParams {
  /** Explicit segment list (takes precedence over ss). */
  segments?: ProteinSegment[];
  /** Compact secondary-structure string: H = helix, E = strand, C = loop. Runs become segments; length scales with run length. */
  ss?: string;
  title?: string;
}

const MID_Y = 380;
const NATURAL = { helix: 230, sheet: 210, loop: 110 } as const;

export function layoutProteinSecondary(params: ProteinSecondaryParams): SceneLayout {
  const segs = params.segments ?? (params.ss ? segmentsFromSS(params.ss) : defaultSegments());
  const widths = segs.map((s) => NATURAL[s.kind] * ("weight" in s ? (s as { weight?: number }).weight ?? 1 : 1));
  const total = widths.reduce((a, b) => a + b, 0);
  const scale = Math.min(1, 820 / total);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const text = (id: string, pos: Pt, s: string, color: string, fontSize = 30) => {
    drawables.push({ id, kind: "text", pos, text: s, fontSize, anchor: "middle", z: Z_TEXT, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    order.push(id);
  };

  let x = (CANVAS.w - total * scale) / 2;
  text("n_term", [x - 34, MID_Y], "N", COLORS.guide);

  segs.forEach((seg, i) => {
    const w = widths[i] * scale;
    const id = `seg_${i}`;
    anchors[id] = [x + w / 2, MID_Y];
    if (seg.kind === "helix") {
      const pts: Pt[] = [];
      for (let t = 0; t <= w; t += 4) pts.push([x + t, MID_Y + 30 * Math.sin((t / 46) * 2 * Math.PI)]);
      drawables.push({ id, kind: "stroke", pts, z: Z_STROKE, style: defaultStyle({ color: COLORS.accent, strokeWidth: 5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve) });
    } else if (seg.kind === "sheet") {
      const h = 19, headW = Math.min(52, w * 0.4), headH = 40;
      const bodyEnd = x + w - headW;
      const poly: Pt[] = [
        [x, MID_Y - h],
        [bodyEnd, MID_Y - h],
        [bodyEnd, MID_Y - headH],
        [x + w, MID_Y],
        [bodyEnd, MID_Y + headH],
        [bodyEnd, MID_Y + h],
        [x, MID_Y + h],
      ];
      drawables.push({ id: `${id}_fill`, kind: "area", pts: poly, z: Z_AREA, style: defaultStyle({ fill: COLORS.supply, opacity: 0.3, strokeWidth: 0 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region) });
      drawables.push({ id, kind: "stroke", pts: poly, closed: true, z: Z_STROKE, style: defaultStyle({ color: COLORS.supply, strokeWidth: 4 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.stroke) });
    } else {
      const pts: Pt[] = [];
      for (let t = 0; t <= w; t += 6) pts.push([x + t, MID_Y + 16 * Math.sin((t / w) * Math.PI) * (i % 2 === 0 ? 1 : -1)]);
      drawables.push({ id, kind: "stroke", pts, z: Z_STROKE, style: defaultStyle({ color: COLORS.guide, strokeWidth: 3.5 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector) });
    }
    if (seg.label) {
      labels.push({ id: `label_${i}`, anchor: [x + w / 2, MID_Y + 52], side: "above", text: seg.label, fontSize: 26, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") });
      order.push(`label_${i}`);
    }
    order.push(id);
    x += w;
  });

  text("c_term", [x + 34, MID_Y], "C", COLORS.guide);

  if (params.title) {
    labels.push({ id: "strip_title", anchor: [CANVAS.w / 2, MID_Y + 170], side: "above", text: params.title, fontSize: 30, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") });
    order.push("strip_title");
  }

  return { drawables, labels, anchors, order };
}

function defaultSegments(): ProteinSegment[] {
  return [
    { kind: "loop" },
    { kind: "helix", label: "α-helix" },
    { kind: "loop" },
    { kind: "sheet", label: "β-strand" },
    { kind: "loop" },
  ];
}

/** Runs of H/E/C become segments; longer runs get proportionally more width. */
function segmentsFromSS(ss: string): (ProteinSegment & { weight?: number })[] {
  const clean = ss.toUpperCase().replace(/[^HEC]/g, "");
  if (!clean) return defaultSegments();
  const out: (ProteinSegment & { weight?: number })[] = [];
  let i = 0;
  let labeledHelix = false, labeledSheet = false;
  while (i < clean.length) {
    let j = i;
    while (j < clean.length && clean[j] === clean[i]) j++;
    const run = j - i;
    const kind = clean[i] === "H" ? "helix" : clean[i] === "E" ? "sheet" : "loop";
    const seg: ProteinSegment & { weight?: number } = { kind, weight: Math.max(0.5, Math.min(2, run / 4)) };
    if (kind === "helix" && !labeledHelix) {
      seg.label = "α-helix";
      labeledHelix = true;
    }
    if (kind === "sheet" && !labeledSheet) {
      seg.label = "β-strand";
      labeledSheet = true;
    }
    out.push(seg);
    i = j;
  }
  return out;
}
