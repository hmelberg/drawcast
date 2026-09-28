// A drawn control panel (params-ui): one row per parameter, drawn on the
// figure itself so the movie exports it at its current values — a slider
// (name, value, track, knob) for a bounded parameter, a number box for the
// rest or when asked. Ids per parameter:
//
//   name_<p>    its label              value_<p>   its current value
//   slider_<p>  the track              knob_<p>    the knob on it
//   box_<p>     a number box's outline
//
// Drawing a row's slider_<p> (or box_<p>) brings its name, value and knob
// with it (drawnWith), and they follow it (attached). A row is drawn in its
// parameter's colour — label, value, knob, a box's outline — the colour of
// its letter and number in the equation (params.ts Param.color); the track
// stays a guide. The widget side — which part does what under the pointer —
// is controls.ts.
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { kit } from "../kit";
import { digitsOf, type Param } from "./params";

export const PANEL_W = 235;
export const ROW_H = 84;
export const KNOB_R = 10;

/** The panel's column on the page, logical y-up: left and right edges, and the y its rows centre on. */
export interface PanelColumn {
  x0: number;
  x1: number;
  yMid: number;
}

export interface PanelRow {
  param: Param;
  kind: "slider" | "box";
  /** Track ends (a slider): the x a value maps to. */
  x0: number;
  x1: number;
  /** The track's y, and the label/value line's y. */
  trackY: number;
  textY: number;
}

/** Where each row goes: stacked, centred on the column's yMid. */
export function panelRows(panel: Param[], col: PanelColumn): PanelRow[] {
  const top = col.yMid + (panel.length * ROW_H) / 2;
  return panel.map((param, i) => {
    const textY = top - i * ROW_H - 26;
    return { param, kind: param.control, x0: col.x0 + KNOB_R, x1: col.x1 - KNOB_R, trackY: textY - 36, textY };
  });
}

/** Slider value ↔ x along the track. */
export const sliderX = (row: PanelRow, v: number): number => row.x0 + ((v - row.param.min!) / (row.param.max! - row.param.min!)) * (row.x1 - row.x0);

export interface DrawnPanel {
  drawables: Drawable[];
  anchors: Record<string, Pt>;
  /** Every id, in draw order. */
  ids: string[];
  drawnWith: Record<string, string[]>;
  attached: Record<string, string[]>;
}

export function drawPanel(rows: PanelRow[]): DrawnPanel {
  const out: DrawnPanel = { drawables: [], anchors: {}, ids: [], drawnWith: {}, attached: {} };
  const push = (d: Drawable, at: Pt): void => {
    out.drawables.push(d);
    out.anchors[d.id] = at;
    out.ids.push(d.id);
  };
  for (const row of rows) {
    const p = row.param;
    const nameId = `name_${p.name}`;
    const valueId = `value_${p.name}`;
    const color = p.color ?? COLORS.ink;
    const left = row.x0 - KNOB_R;
    const right = row.x1 + KNOB_R;
    const digits = kit.num(Number(digitsOf(p)), p.decimals);
    push(kit.text(nameId, [left, row.textY], p.label, { fontSize: 24, anchor: "start", color }), [left, row.textY]);
    if (row.kind === "slider") {
      push(kit.text(valueId, [right, row.textY], digits, { fontSize: 24, anchor: "end", color }), [right - 20, row.textY]);
      push(kit.stroke(`slider_${p.name}`, [[row.x0, row.trackY], [row.x1, row.trackY]], { color: COLORS.guide, strokeWidth: 3, ms: SKETCH_MS.guides }), [row.x1, row.trackY]);
      const kc: Pt = [sliderX(row, Math.min(p.max!, Math.max(p.min!, p.value))), row.trackY];
      push(kit.stroke(`knob_${p.name}`, kit.circle(kc, KNOB_R, 20), { closed: true, shapeHint: { type: "circle", c: kc, r: KNOB_R }, color, fill: color, strokeWidth: 2, ms: SKETCH_MS.dot }), kc);
      out.drawnWith[`slider_${p.name}`] = [nameId, valueId, `knob_${p.name}`];
      out.attached[`slider_${p.name}`] = [nameId, valueId, `knob_${p.name}`];
    } else {
      const bw = 96;
      const bh = 40;
      const bx = right - bw;
      const by = row.textY - 12;
      push(kit.stroke(`box_${p.name}`, kit.rect(bx, by, bw, bh), { closed: true, color: p.color ?? COLORS.guide, strokeWidth: 2.5, ms: SKETCH_MS.guides }), [bx + bw / 2, by + bh / 2]);
      push(kit.text(valueId, [bx + bw / 2, row.textY], digits, { fontSize: 24, anchor: "middle", color }), [bx + bw / 2, row.textY]);
      out.drawnWith[`box_${p.name}`] = [nameId, valueId];
      out.attached[`box_${p.name}`] = [nameId, valueId];
    }
  }
  return out;
}
