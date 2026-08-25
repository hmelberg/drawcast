// Deterministic layout for the two_by_two_table scene: a fixed 2×2 grid
// (test result × disease status, treatment × outcome, a payoff matrix, ...)
// with row/column headers and captions. Everything here is exact-position
// content, not narration — a table's cells and headers are geometry, so all
// text uses kit.text (never kit.label's collision solver).

import {
  COLORS,
  Z_STROKE,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";
import { kit } from "../kit";

export interface TwoByTwoParams {
  /** Caption for the row axis, e.g. "Test result". */
  row_label: string;
  /** Caption for the column axis, e.g. "Disease status". */
  col_label: string;
  /** The two row category names, top row first. */
  row_values: [string, string];
  /** The two column category names, left column first. */
  col_values: [string, string];
  /** 2×2 cell values, row-major: cells[row][col]. */
  cells: [[string, string], [string, string]];
  /** Small sub-text under a cell's main value, same [row][col] shape as cells. */
  cell_notes?: (string | null)[][];
  /** [row, col] pairs (0/1 each) to shade — e.g. [[0, 0]] for the true-positive cell. */
  highlight?: [number, number][];
  title?: string;
}

const CX = 500;
const CY = 360;
const W = 460;
const H = 300;
const ROWS = 2;
const COLS = 2;
const X0 = CX - W / 2;
const Y0 = CY - H / 2;
const CELL_W = W / COLS;
const CELL_H = H / ROWS;

// Row 0 is the TOP row (y-up), matching kit.table's own convention.
const rowY = (r: number): number => Y0 + H - CELL_H * (r + 0.5);
const colX = (c: number): number => X0 + CELL_W * (c + 0.5);

export function layoutTwoByTwoTable(params: TwoByTwoParams): SceneLayout {
  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const text = (
    id: string,
    pos: Pt,
    s: string,
    o: { fontSize?: number; color?: string; anchor?: "start" | "middle" | "end" } = {},
  ) => {
    push(kit.text(id, pos, s, o));
    anchors[id] = pos;
  };

  // Grid lines only — kit.table's own cell/header id scheme (`${id}__c0_0`,
  // `${id}__rh0`, ...) doesn't match this scene's element ids, so cell
  // values and captions are placed by hand below; only the grid geometry
  // (and its cell-center anchors) comes from kit.table.
  const t = kit.table("grid", { x: X0, y: Y0, w: W, h: H, rows: ROWS, cols: COLS });
  const gridGroup = t.drawables[0];
  gridGroup.id = "grid";
  push(gridGroup);
  anchors["grid"] = [CX, CY];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const center = t.anchors[`grid__c${r}_${c}`] ?? [colX(c), rowY(r)];
      const note = params.cell_notes?.[r]?.[c];
      const children: Drawable[] = [];
      const mainY = note ? center[1] + 16 : center[1];
      children.push(kit.text(`cell_${r}_${c}__val`, [center[0], mainY], params.cells[r][c], { fontSize: 32 }));
      if (note) {
        children.push(kit.text(`cell_${r}_${c}__note`, [center[0], center[1] - 24], note, { fontSize: 16, color: COLORS.guide }));
      }
      push({ id: `cell_${r}_${c}`, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children });
      anchors[`cell_${r}_${c}`] = center;
    }
  }

  for (let r = 0; r < ROWS; r++) {
    if (!params.row_values[r]) continue;
    text(`row_header_${r}`, [X0 - 30, rowY(r)], params.row_values[r], { fontSize: 22, color: COLORS.guide, anchor: "end" });
  }
  for (let c = 0; c < COLS; c++) {
    if (!params.col_values[c]) continue;
    text(`col_header_${c}`, [colX(c), Y0 + H + 40], params.col_values[c], { fontSize: 22, color: COLORS.guide });
  }

  // Sits just above the top row header, in the same column — reads as a
  // caption for the row-header list below it, and keeps clear of the
  // canvas's left edge even for a fairly long row_label (unlike centering
  // it beside the grid, which runs out of room to the left).
  if (params.row_label) text("row_title", [X0 - 30, rowY(0) + 52], params.row_label, { fontSize: 24, color: COLORS.guide, anchor: "end" });
  if (params.col_label) text("col_title", [CX, Y0 + H + 85], params.col_label, { fontSize: 24, color: COLORS.guide });
  if (params.title) text("title", [CX, Y0 + H + 130], params.title, { fontSize: 30 });

  for (const [r, c] of params.highlight ?? []) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    const left = X0 + CELL_W * c;
    const right = left + CELL_W;
    const top = Y0 + H - CELL_H * r;
    const bottom = top - CELL_H;
    const id = `hl_${r}_${c}`;
    push(
      kit.area(
        id,
        [
          [left, bottom],
          [right, bottom],
          [right, top],
          [left, top],
        ],
        COLORS.region1,
      ),
    );
    anchors[id] = [(left + right) / 2, (top + bottom) / 2];
  }

  return { drawables, labels, anchors, order };
}
