// Deterministic layout for the timeline scene: a horizontal arrow with 2–8
// evenly spaced milestones. Dots are drawn as small filled octagons
// (kit.polygon's low-poly "circle" — matches the sketchy style everywhere
// else); milestone labels alternate above/below the line as a starting
// preference, then the shared collision solver (kit.label) nudges them
// apart from there, so hand-tuning isn't needed for the common case.

import {
  COLORS,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export interface MilestoneSpec {
  label: string;
  /** Short secondary text shown alongside the label. */
  sublabel?: string;
  /** Draws this milestone larger, in the accent color. */
  emphasize?: boolean;
}

export interface TimelineParams {
  title?: string;
  /** Small caption at the left end of the line, e.g. "Diagnosis". */
  start_label?: string;
  /** Small caption at the right end of the line, e.g. "Today". */
  end_label?: string;
  /** 2–8 ordered milestones, left to right. */
  milestones: MilestoneSpec[];
}

const X0 = 90;
const X1 = 930;
const LINE_Y = 375;

export function layoutTimeline(params: TimelineParams): SceneLayout {
  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], t: string, color: string = COLORS.ink, fontSize = 24) => {
    labels.push({ id, anchor, side, text: t, fontSize, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    anchors[id] = anchor;
    order.push(id);
  };

  const lineChildren: Drawable[] = [
    {
      id: "line__arrow",
      kind: "stroke",
      pts: [
        [X0, LINE_Y],
        [X1, LINE_Y],
      ],
      arrowhead: "end",
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
    },
  ];
  if (params.start_label) {
    lineChildren.push(kit.text("line__start", [X0, LINE_Y - 34], params.start_label, { fontSize: 20, color: COLORS.guide }));
  }
  if (params.end_label) {
    lineChildren.push(kit.text("line__end", [X1 - 24, LINE_Y - 34], params.end_label, { fontSize: 20, color: COLORS.guide, anchor: "end" }));
  }
  push({ id: "line", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: lineChildren });
  anchors["line"] = [(X0 + X1) / 2, LINE_Y];

  const milestones = params.milestones.slice(0, 8);
  const n = milestones.length;
  milestones.forEach((m, i) => {
    const x = n <= 1 ? (X0 + X1) / 2 : X0 + ((X1 - X0) * i) / (n - 1);
    const c: Pt = [x, LINE_Y];
    const r = m.emphasize ? 11 : 7;
    const color = m.emphasize ? COLORS.accent : COLORS.ink;
    const dotId = `dot_${i}`;
    push(kit.stroke(dotId, kit.polygon(c, r, 8), { closed: true, color, fill: color, strokeWidth: 2.5, ms: SKETCH_MS.dot }));
    anchors[dotId] = c;

    const text = m.sublabel ? `${m.label} — ${m.sublabel}` : m.label;
    const side: LabelRequest["side"] = i % 2 === 0 ? "above" : "below";
    label(`label_${i}`, c, side, text, m.emphasize ? COLORS.accent : COLORS.ink, m.emphasize ? 27 : 24);
  });

  if (params.title) {
    push(kit.text("title", [(X0 + X1) / 2, 700], params.title, { fontSize: 32 }));
  }

  return { drawables, labels, anchors, order };
}
