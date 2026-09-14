// The drawn control panel (design 2026-09-14 addendum "Controls in the pane,
// and the movie rule", §3): `pane: controls` on a code element draws one ROW
// per control instead of source lines — a slider, a row of choice chips, a
// toggle pill, a boxed value, a button. Pure geometry, mirroring how the
// code pane's own lines and `<id>_out` are built in code.ts.
//
// Parsed TWICE, like the code pane's own text: the ORIGINAL script gives each
// control's kind and shape (a slider's min/max, a choice's options — a
// rewritten slider is just a bare number, which no longer carries them); the
// DEFAULT-REWRITTEN script (the same text codeDrawables shows) gives the
// CURRENT value, so a re-run relayouts the knob onto the new value the same
// way a code line already updates itself.
//
// Ids: `<id>_ctl_<name>` is one row (a group of its label + widget + value —
// the same group shape `<id>_out` uses), a real top-level drawable reachable
// on its own. `<id>_ctls` is NOT a drawable — it is a GROUP ID (`ctx.groups`,
// the same map a spec `type: "group"` element populates) that expands to
// every row id, so `draw: [sim_ctls]` draws the whole panel by drawing each
// row once, rather than a wrapper drawable that would draw a row's ink AGAIN
// whenever both it and the wrapper went unmentioned and fell to the
// implicit final draw (render/plan.ts).

import { formatValue, parseControls, withControlDefaults } from "../code/controls";
import { COLORS, SKETCH_MS, Z_AREA, Z_STROKE, Z_TEXT, defaultStyle, type Drawable, type GroupDrawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** Row height, × fontSize — a little airier than a code line. */
export const CTL_ROW_H = 1.9;
/** Gap after the label column, and inside a row's own content. */
const PAD = 10;
/** Height of a row's own widget (pill/box), independent of the row's pitch. */
const FIELD_H_EM = 1.05;

export interface ControlsPaneLayout {
  /** Top-level: one `GroupDrawable` per row (`<id>_ctl_<name>`) — `<id>_ctls` is not among them (see `groups`). */
  drawables: Drawable[];
  /** Row ids, in `el.controls` order — what `ctx.extraOrder` gets. `<id>_ctls` is deliberately absent: a group id is never itself command-addressable (layout.ts skips a spec `type: "group"` the same way). */
  order: string[];
  height: number;
  anchors: Record<string, Pt>;
  /** `<id>_ctls` → its row ids, merged into `ctx.groups` — the same map a spec `type: "group"` element populates, so `draw: [sim_ctls]` expands to every row (`expandGroup`, render/plan.ts) instead of a wrapper drawable duplicating their ink. */
  groups: Record<string, string[]>;
}

/**
 * The pane's content height for `count` controls — known from the row count
 * alone, before any row is positioned. `code.ts` needs this FIRST: `codeTop`
 * for `show: "below"` is derived from the code pane's content height, so the
 * height has to settle before `controlsPane` (which needs `codeTop` as its
 * box's `top`) can run.
 */
export function controlsPaneHeight(count: number, fontSize: number): number {
  return count * fontSize * CTL_ROW_H;
}

function rectPts(x: number, y: number, w: number, h: number): Pt[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** Eight points, evenly spaced from angle 0 — symmetric, so its centroid is exactly the circle's center. */
function circlePts(c: Pt, r: number): Pt[] {
  const n = 8;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Rows for `el.controls` parsed from `code` (default-rewritten), laid out in
 * the pane box: `x` = left edge of the content area, `top` = y of its top
 * edge (logical, y-up), `w` = content width.
 */
export function controlsPane(
  id: string,
  language: string,
  code: string,
  names: string[],
  box: { x: number; top: number; w: number },
  fontSize: number,
  style: SpecElement["style"],
  draw: SpecElement["draw"],
): ControlsPaneLayout {
  const orig = parseControls(language, code, names).controls;
  const cur = parseControls(language, withControlDefaults(language, code, names), names).controls;

  const textStyle = resolveStyle(style, {});
  const textDraw = resolveDrawOpts(draw, { mode: "sketch", duration: SKETCH_MS.text });
  const inkStyle = resolveStyle(style, {});
  const inkDraw = resolveDrawOpts(draw, { mode: "sketch", duration: SKETCH_MS.node });
  // Low-alpha fill for the chosen chip — the same wash the marker pen and the
  // panel's own region tint use elsewhere in code.ts (COLORS.region1 @ 0.42).
  const fillStyle = resolveStyle(style, { fill: COLORS.region1, opacity: 0.42 });

  const labelW = Math.min(0.32 * box.w, 9 * fontSize * 0.6);
  const contentX = box.x + labelW + PAD;
  const rowH = fontSize * CTL_ROW_H;
  const fieldH = fontSize * FIELD_H_EM;

  const mkText = (rid: string, pos: Pt, value: string, anchor: "start" | "middle" | "end"): Drawable => ({
    id: rid,
    kind: "text",
    pos,
    text: value,
    fontSize,
    anchor,
    font: "mono",
    z: Z_TEXT,
    style: textStyle,
    drawOpts: textDraw,
  });
  const mkStrokeRect = (rid: string, x: number, y: number, w: number, h: number): Drawable => ({
    id: rid,
    kind: "stroke",
    pts: rectPts(x, y, w, h),
    closed: true,
    shapeHint: { type: "rect", x, y, w, h },
    z: Z_STROKE,
    style: inkStyle,
    drawOpts: inkDraw,
  });
  const mkFillRect = (rid: string, x: number, y: number, w: number, h: number): Drawable => ({
    id: rid,
    kind: "area",
    pts: rectPts(x, y, w, h),
    precise: true,
    z: Z_AREA,
    style: fillStyle,
    drawOpts: inkDraw,
  });
  const mkStrokeCircle = (rid: string, c: Pt, r: number): Drawable => ({
    id: rid,
    kind: "stroke",
    pts: circlePts(c, r),
    closed: true,
    shapeHint: { type: "circle", c, r },
    z: Z_STROKE,
    style: inkStyle,
    drawOpts: inkDraw,
  });
  const mkStrokeLine = (rid: string, a: Pt, b: Pt): Drawable => ({
    id: rid,
    kind: "stroke",
    pts: [a, b],
    z: Z_STROKE,
    style: inkStyle,
    drawOpts: inkDraw,
  });

  const rows: GroupDrawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};

  names.forEach((name, i) => {
    // Both parses must have found this control — an invalid/missing one (the
    // controls lint reports it) draws nothing but still holds its row's slot,
    // so the rows below it don't creep up.
    const o = orig.find((c) => c.name === name);
    const c = cur.find((c) => c.name === name);
    if (!o || !c) return;

    const rowId = `${id}_ctl_${name}`;
    const cy = box.top - (i + 0.5) * rowH;
    const children: Drawable[] = [mkText(`${rowId}__label`, [box.x, cy], o.label ?? name, "start")];

    if (o.kind === "slider") {
      const min = o.min ?? 0;
      const max = o.max ?? 1;
      const value = typeof c.default === "number" ? c.default : Number(c.default);
      const valueW = 4 * fontSize * 0.6;
      const trackW = box.w - labelW - PAD - valueW - PAD;
      const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
      const kx = contentX + trackW * frac;
      const knobR = 0.28 * fontSize;
      children.push(
        mkStrokeLine(`${rowId}__track`, [contentX, cy], [contentX + trackW, cy]),
        mkStrokeCircle(`${rowId}__knob`, [kx, cy], knobR),
        mkText(`${rowId}__value`, [box.x + box.w, cy], formatValue(language, o, value), "end"),
      );
    } else if (o.kind === "choice") {
      const options = o.options ?? [];
      const chosen = String(c.default);
      const gap = 0.5 * fontSize;
      let cursorX = contentX;
      options.forEach((opt, k) => {
        const chipW = Math.max(2.4 * fontSize, opt.length * fontSize * 0.6 + 1.4 * fontSize);
        const chipY = cy - fieldH / 2;
        const isChosen = opt === chosen;
        children.push(
          isChosen ? mkFillRect(`${rowId}__chip_${k}`, cursorX, chipY, chipW, fieldH) : mkStrokeRect(`${rowId}__chip_${k}`, cursorX, chipY, chipW, fieldH),
          mkText(`${rowId}__chiptext_${k}`, [cursorX + chipW / 2, cy], opt, "middle"),
        );
        cursorX += chipW + gap;
      });
    } else if (o.kind === "toggle") {
      const value = c.default === true || c.default === "true";
      const pillW = 2.2 * fontSize;
      const pillY = cy - fieldH / 2;
      const knobR = fieldH * 0.4;
      const knobCx = value ? contentX + pillW - fieldH / 2 : contentX + fieldH / 2;
      children.push(
        mkStrokeRect(`${rowId}__pill`, contentX, pillY, pillW, fieldH),
        mkStrokeCircle(`${rowId}__knob`, [knobCx, cy], knobR),
        mkText(`${rowId}__value`, [box.x + box.w, cy], value ? "on" : "off", "end"),
      );
    } else if (o.kind === "text" || o.kind === "number") {
      const boxW = box.x + box.w - contentX;
      const boxY = cy - fieldH / 2;
      const shown =
        o.kind === "text" ? `"${String(c.default)}"` : formatValue(language, o, typeof c.default === "number" ? c.default : Number(c.default));
      children.push(mkStrokeRect(`${rowId}__box`, contentX, boxY, boxW, fieldH), mkText(`${rowId}__value`, [contentX + boxW / 2, cy], shown, "middle"));
    } else if (o.kind === "button") {
      const boxW = box.x + box.w - contentX;
      const boxY = cy - fieldH / 2;
      children.push(
        mkStrokeRect(`${rowId}__pill`, contentX, boxY, boxW, fieldH),
        mkText(`${rowId}__value`, [contentX + boxW / 2, cy], o.caption ?? o.label ?? name, "middle"),
      );
    }

    rows.push({ id: rowId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children });
    order.push(rowId);
    anchors[rowId] = [box.x, cy];
  });

  const height = controlsPaneHeight(names.length, fontSize);
  // `<id>_ctls` is NOT a drawable — it is a GROUP ID (the same mechanism a
  // spec `type: "group"` element registers in `LayoutResult.groups`): it
  // expands to the row ids at plan time (`expandGroup`, render/plan.ts), so
  // `draw: [sim_ctls]` draws every row and an UNMENTIONED row is still swept
  // into the implicit final draw exactly once — nesting the same row
  // GroupDrawables a second time under a wrapper would have drawn each row's
  // ink twice whenever both the wrapper and its rows went unmentioned.
  const groups: Record<string, string[]> = { [`${id}_ctls`]: [...order] };
  // A group element gets an anchor at its members' union box center
  // (tier2.ts's own `type: "group"` case) — the panel's box is already known
  // here, so its center is exact rather than measured.
  anchors[`${id}_ctls`] = [box.x + box.w / 2, box.top - height / 2];

  return { drawables: rows, order, height, anchors, groups };
}
