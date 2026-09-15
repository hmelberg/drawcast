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
//
// The label column: one width, shared by every row, sized to the longest
// label among the panel's OWN controls (`labelColumnWidth`) — never a fixed
// character budget, since a `Slider(..., label="...")` can name anything. A
// label past the column's 45%-of-panel cap wraps onto its own line above
// its control instead of overflowing into it; `controlsPaneHeight` (which
// `code.ts` must call before any row exists, to settle the pane's height)
// makes the identical per-row decision from the labels alone, so the two
// never disagree about how tall the panel is.

import { formatValue, parseControls, withControlDefaults, type ControlSpec } from "../code/controls";
import { COLORS, SKETCH_MS, Z_AREA, Z_STROKE, Z_TEXT, defaultStyle, type Drawable, type GroupDrawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import { CHAR_W } from "./code";
import type { SpecElement } from "../spec/types";

/** Row height, × fontSize — a little airier than a code line. */
export const CTL_ROW_H = 1.9;
/** Gap after the label column, and inside a row's own content. */
const PAD = 10;
/** Height of a row's own widget (pill/box), independent of the row's pitch. */
const FIELD_H_EM = 1.05;
/** A wrapped row (label on its own line above the control) is this many
 *  ordinary row-heights tall — 0.75 for the label's own line, 1.0 (a full
 *  ordinary row) for the control's line underneath it. */
const WRAP_MULT = 1.75;

/** A label's estimated width — the code pane's own per-character width
 *  assumption (`CHAR_W`, code.ts), so a label and a code line size text the
 *  same way (final wave item 6; this file used to keep its own, slightly
 *  different, 0.6 constant). */
function labelWidthEstimate(label: string, fontSize: number): number {
  return label.length * CHAR_W * fontSize;
}

/**
 * The panel-wide label column width: sized to the LONGEST label among the
 * panel's controls, plus one character of breathing room, but never past
 * 45% of the panel — a label past that cap does not shrink the column
 * further, it wraps onto its own line instead (see `controlsPane`'s
 * per-row `wraps` check, which reuses this same `labelW`).
 */
function labelColumnWidth(labels: string[], fontSize: number, w: number): number {
  const maxChars = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.min(0.45 * w, (maxChars + 1) * CHAR_W * fontSize);
}

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
 * The pane's content height for these controls' LABELS — known before any
 * row is positioned, from the labels and the panel width alone (the same
 * two numbers `controlsPane` uses for its own per-row wrap decision, so the
 * two never disagree). `code.ts` needs this FIRST: `codeTop` for
 * `show: "below"` is derived from the code pane's content height, so the
 * height has to settle before `controlsPane` (which needs `codeTop` as its
 * box's `top`) can run. `labels` is the ORIGINAL-parse label per control, in
 * `el.controls` order — the same parse `controlsPane` takes as its optional
 * last argument, so a caller that already parsed for one reuses it for both.
 */
export function controlsPaneHeight(labels: string[], fontSize: number, w: number): number {
  if (labels.length === 0) return 0;
  const rowH = fontSize * CTL_ROW_H;
  const labelW = labelColumnWidth(labels, fontSize, w);
  return labels.reduce((sum, label) => sum + (labelWidthEstimate(label, fontSize) <= labelW ? rowH : WRAP_MULT * rowH), 0);
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
  /** The ORIGINAL-parse controls, when the caller already has them (`code.ts`
   *  parses once for `controlsPaneHeight` and passes the same parse here) —
   *  parsed fresh from `code`/`names` when omitted (every direct caller,
   *  tests included). */
  origControls?: ControlSpec[],
): ControlsPaneLayout {
  const orig = origControls ?? parseControls(language, code, names).controls;
  const cur = parseControls(language, withControlDefaults(language, code, names), names).controls;

  // One resolved style for both text and ink (final wave item 7 — these used
  // to be two identically-computed `resolveStyle(style, {})` calls).
  const inkStyle = resolveStyle(style, {});
  const textDraw = resolveDrawOpts(draw, { mode: "sketch", duration: SKETCH_MS.text });
  const inkDraw = resolveDrawOpts(draw, { mode: "sketch", duration: SKETCH_MS.node });
  // Low-alpha fill for the chosen chip — the same wash the marker pen and the
  // panel's own region tint use elsewhere in code.ts (COLORS.region1 @ 0.42).
  const fillStyle = resolveStyle(style, { fill: COLORS.region1, opacity: 0.42 });

  // The label column is sized to the LONGEST label among ALL the panel's
  // controls (not just this row's) — one column, shared by every row, so
  // the tracks/chips/boxes all start at the same x. A label that still
  // doesn't fit (the column hit its 45%-of-panel cap) wraps onto its own
  // line above the control instead of overflowing into it (the wtp-slider
  // defect this replaces): decided per row, below.
  const labels = names.map((name) => orig.find((c) => c.name === name)?.label ?? name);
  const labelW = labelColumnWidth(labels, fontSize, box.w);
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
    style: inkStyle,
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

  // Cumulative top: a wrapped row is taller, so a row's y no longer follows
  // from its index alone — each row's top is the previous rows' bottom.
  let rowTop = box.top;

  names.forEach((name, i) => {
    const label = labels[i];
    const wraps = labelWidthEstimate(label, fontSize) > labelW;
    const thisRowH = wraps ? WRAP_MULT * rowH : rowH;
    const top = rowTop;
    rowTop -= thisRowH;

    // Both parses must have found this control — an invalid/missing one (the
    // controls lint reports it) draws nothing but still holds its row's slot
    // (the height claimed above), so the rows below it don't creep up.
    const o = orig.find((c) => c.name === name);
    const c = cur.find((c) => c.name === name);
    if (!o || !c) return;

    const rowId = `${id}_ctl_${name}`;
    // Unwrapped: one line, label and control share it (contentX, the
    // panel-wide column). Wrapped: the label gets its own line (0.75 of a
    // row) above the control's line (a full row), and the control starts
    // at the row's own left edge, full width — the label column is not
    // subtracted since nothing shares this row with it.
    const labelY = wraps ? top - 0.5 * (WRAP_MULT - 1) * rowH : top - 0.5 * rowH;
    const cy = wraps ? top - (WRAP_MULT - 1) * rowH - 0.5 * rowH : labelY;
    const rowContentX = wraps ? box.x : contentX;
    const rowContentW = box.x + box.w - rowContentX;
    const children: Drawable[] = [mkText(`${rowId}__label`, [box.x, labelY], label, "start")];

    if (o.kind === "slider") {
      const min = o.min ?? 0;
      const max = o.max ?? 1;
      const value = typeof c.default === "number" ? c.default : Number(c.default);
      const valueW = 4 * fontSize * CHAR_W;
      const trackW = rowContentW - valueW - PAD;
      const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
      const kx = rowContentX + trackW * frac;
      const knobR = 0.28 * fontSize;
      children.push(
        mkStrokeLine(`${rowId}__track`, [rowContentX, cy], [rowContentX + trackW, cy]),
        mkStrokeCircle(`${rowId}__knob`, [kx, cy], knobR),
        mkText(`${rowId}__value`, [box.x + box.w, cy], formatValue(language, o, value), "end"),
      );
    } else if (o.kind === "choice") {
      const options = o.options ?? [];
      const chosen = String(c.default);
      const gap = 0.5 * fontSize;
      let cursorX = rowContentX;
      options.forEach((opt, k) => {
        const chipW = Math.max(2.4 * fontSize, opt.length * fontSize * CHAR_W + 1.4 * fontSize);
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
      const knobCx = value ? rowContentX + pillW - fieldH / 2 : rowContentX + fieldH / 2;
      children.push(
        mkStrokeRect(`${rowId}__pill`, rowContentX, pillY, pillW, fieldH),
        mkStrokeCircle(`${rowId}__knob`, [knobCx, cy], knobR),
        mkText(`${rowId}__value`, [box.x + box.w, cy], value ? "on" : "off", "end"),
      );
    } else if (o.kind === "text" || o.kind === "number") {
      const boxW = rowContentW;
      const boxY = cy - fieldH / 2;
      // formatValue already quotes AND escapes a text default (backslash
      // first, then the quote — final wave item 8; this used to interpolate
      // the raw value between bare quotes, so a value containing one drew a
      // syntactically broken literal).
      const shown = formatValue(language, o, c.default);
      children.push(mkStrokeRect(`${rowId}__box`, rowContentX, boxY, boxW, fieldH), mkText(`${rowId}__value`, [rowContentX + boxW / 2, cy], shown, "middle"));
    } else if (o.kind === "button") {
      const boxW = rowContentW;
      const boxY = cy - fieldH / 2;
      children.push(
        mkStrokeRect(`${rowId}__pill`, rowContentX, boxY, boxW, fieldH),
        mkText(`${rowId}__value`, [rowContentX + boxW / 2, cy], o.caption ?? label, "middle"),
      );
    }

    rows.push({ id: rowId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children });
    order.push(rowId);
    anchors[rowId] = [box.x, cy];
  });

  const height = controlsPaneHeight(labels, fontSize, box.w);
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
