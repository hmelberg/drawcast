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
import { TEXT_MIN } from "../../layout/readable";

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
  /** The headers', captions' and totals' size (18–40); the cell values grow with it. */
  label_size?: number;
  /** Margin totals summed from numeric cells: a column of row totals, a row of column totals, the grand total. */
  totals?: boolean;
  /** Row totals as written (top row first) — instead of, or without, totals: true. */
  row_totals?: [string, string];
  /** Column totals as written (left column first). */
  col_totals?: [string, string];
  /** The grand total as written. */
  total?: string;
  /** The word heading the totals (default "Total"). */
  total_label?: string;
  /** The small a/b/c/d letters in the cells' corners (epidemiology's names for them). Default off. */
  cell_letters?: boolean;
  /** The region the whole table — headers, captions, totals — lays itself out in. */
  box?: { x: number; y: number; w: number; h: number };
}

const ROWS = 2;
const COLS = 2;
/** The table as it has always been drawn, when no box is given. */
const CX = 500;
const CY = 360;
const W_DEFAULT = 460;
const H_DEFAULT = 300;
/** The grid's edge → a header's near edge (row headers left, totals right). */
const SIDE_GAP = 30;
/** Inside a box: a frame of air round the table's words. */
const BOX_PAD = 6;
const LETTERS = [["a", "b"], ["c", "d"]];

/** A cell as a number — "1,200" (thousands), "0,5" (a decimal comma), "12.5" — or null. */
function cellNumber(s: string): { v: number; dec: number; group: boolean; comma: boolean } | null {
  const t = s.trim().replace(/[\s  ]/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) {
    const v = Number(t.replace(/,/g, ""));
    return { v, dec: (t.split(".")[1] ?? "").length, group: true, comma: false };
  }
  if (/^-?\d+,\d+$/.test(t)) return { v: Number(t.replace(",", ".")), dec: t.split(",")[1].length, group: false, comma: true };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { v: Number(t), dec: (t.split(".")[1] ?? "").length, group: false, comma: false };
  return null;
}

/** A sum written the way the cells were: their decimals, grouping and decimal mark. */
function formatLike(v: number, like: NonNullable<ReturnType<typeof cellNumber>>[]): string {
  const dec = Math.max(0, ...like.map((n) => n.dec));
  let s = v.toFixed(dec);
  if (like.some((n) => n.group)) {
    const [int, frac] = s.split(".");
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
  }
  return like.some((n) => n.comma) ? s.replace(".", ",") : s;
}

export function layoutTwoByTwoTable(params: TwoByTwoParams): SceneLayout {
  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  // A cell's ink is its number; its box is the square (a label beside a cell
  // goes beside the square, not beside the number — 2026-10-05).
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const warnings: string[] = [];
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

  // label_size (2026-10-05, as bar_chart's): headers, captions and totals at
  // the author's size, the cell values grown in step. Absent, the sizes —
  // and every offset below — are the ones the table has always had.
  const LS = typeof params.label_size === "number" && Number.isFinite(params.label_size) ? Math.max(18, Math.min(40, params.label_size)) : 0;
  const HS = LS || 22; // row/column headers, totals
  const TS = LS || 24; // the two captions
  const VS = LS ? Math.min(52, Math.round((32 * LS) / 22)) : 32; // cell values
  const half = (size: number) => size * 0.625; // half a text box (1.25 em)
  const colHeadOff = LS ? 26 + half(HS) : 40;
  const colTitleOff = LS ? colHeadOff + half(HS) + half(TS) + 12 : 85;
  const titleOff = LS ? colTitleOff + half(TS) + half(30) + 12 : 130;
  const rowTitleOff = LS ? Math.max(52, half(HS) + half(TS) + 12) : 52;

  // Margin totals: written ones win; totals: true sums the numeric cells.
  const totalWord = params.total_label ?? "Total";
  let rowTotals: (string | undefined)[] = params.row_totals ? [...params.row_totals] : [];
  let colTotals: (string | undefined)[] = params.col_totals ? [...params.col_totals] : [];
  let grand: string | undefined = params.total;
  if (params.totals === true) {
    const nums = params.cells.map((row) => row.map(cellNumber));
    const all = nums.flat();
    if (all.every((n) => n !== null)) {
      const n = nums as NonNullable<ReturnType<typeof cellNumber>>[][];
      const like = n.flat();
      rowTotals = [0, 1].map((r) => rowTotals[r] ?? formatLike(n[r][0].v + n[r][1].v, like));
      colTotals = [0, 1].map((c) => colTotals[c] ?? formatLike(n[0][c].v + n[1][c].v, like));
      grand = grand ?? formatLike(like.reduce((t, x) => t + x.v, 0), like);
    } else {
      warnings.push(`totals: true needs numbers in every cell (${params.cells.flat().filter((s) => cellNumber(s) === null).map((s) => `"${s}"`).join(", ")} is not) — no totals drawn; write row_totals / col_totals instead`);
    }
  }
  const hasRowTotals = rowTotals.some((t) => t !== undefined && t !== "");
  const hasColTotals = colTotals.some((t) => t !== undefined && t !== "");
  const hasGrand = grand !== undefined && grand !== "";

  // The grid: the fixed one, or (box) what the box leaves once the headers,
  // captions and totals have their room — the words keep their size.
  let X0 = CX - W_DEFAULT / 2;
  let Y0 = CY - H_DEFAULT / 2;
  let W = W_DEFAULT;
  let H = H_DEFAULT;
  const box = params.box;
  if (box && [box.x, box.y, box.w, box.h].every((v) => typeof v === "number" && Number.isFinite(v))) {
    const widest = (xs: (string | undefined)[], size: number) => Math.max(0, ...xs.filter((s): s is string => !!s).map((s) => kit.textWidth(s, size)));
    const left = SIDE_GAP + Math.max(widest(params.row_values, HS), widest([params.row_label], TS), hasColTotals ? widest([totalWord], HS) : 0) + BOX_PAD;
    const right = hasRowTotals || hasGrand ? SIDE_GAP + Math.max(widest([...rowTotals, grand], HS), widest([totalWord], HS)) + BOX_PAD : BOX_PAD;
    const top = (params.title ? titleOff + half(30) : params.col_label ? colTitleOff + half(TS) : colHeadOff + half(HS)) + BOX_PAD;
    const bottom = hasColTotals || hasGrand ? colHeadOff + half(HS) + BOX_PAD : BOX_PAD;
    W = Math.max(120, box.w - left - right);
    H = Math.max(100, box.h - top - bottom);
    X0 = box.x + left;
    Y0 = box.y + bottom;
  }
  const CELL_W = W / COLS;
  const CELL_H = H / ROWS;
  const CXg = X0 + W / 2;
  // Row 0 is the TOP row (y-up), matching kit.table's own convention.
  const rowY = (r: number): number => Y0 + H - CELL_H * (r + 0.5);
  const colX = (c: number): number => X0 + CELL_W * (c + 0.5);

  // Grid lines only — kit.table's own cell/header id scheme (`${id}__c0_0`,
  // `${id}__rh0`, ...) doesn't match this scene's element ids, so cell
  // values and captions are placed by hand below; only the grid geometry
  // (and its cell-center anchors) comes from kit.table.
  const t = kit.table("grid", { x: X0, y: Y0, w: W, h: H, rows: ROWS, cols: COLS });
  const gridGroup = t.drawables[0];
  gridGroup.id = "grid";
  // a, b, c, d in the cells' top-left corners — the names epidemiology gives
  // them — only when asked (2026-10-05: they were wanted off by default).
  if (params.cell_letters === true && gridGroup.kind === "group") {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        gridGroup.children.push(kit.text(`grid__letter_${r}_${c}`, [X0 + CELL_W * c + 12, Y0 + H - CELL_H * r - 18], LETTERS[r][c], { fontSize: TEXT_MIN, color: COLORS.guide, anchor: "start" }));
      }
    }
  }
  push(gridGroup);
  anchors["grid"] = [CXg, Y0 + H / 2];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const center = t.anchors[`grid__c${r}_${c}`] ?? [colX(c), rowY(r)];
      const note = params.cell_notes?.[r]?.[c];
      const children: Drawable[] = [];
      const mainY = note ? center[1] + 16 : center[1];
      children.push(kit.text(`cell_${r}_${c}__val`, [center[0], mainY], params.cells[r][c], { fontSize: VS }));
      if (note) {
        children.push(kit.text(`cell_${r}_${c}__note`, [center[0], center[1] - 24], note, { fontSize: TEXT_MIN, color: COLORS.guide })); // W30: was 16
      }
      push({ id: `cell_${r}_${c}`, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children });
      anchors[`cell_${r}_${c}`] = center;
      boxes[`cell_${r}_${c}`] = { x: X0 + CELL_W * c, y: Y0 + H - CELL_H * (r + 1), w: CELL_W, h: CELL_H };
    }
  }

  for (let r = 0; r < ROWS; r++) {
    if (!params.row_values[r]) continue;
    text(`row_header_${r}`, [X0 - SIDE_GAP, rowY(r)], params.row_values[r], { fontSize: HS, color: COLORS.guide, anchor: "end" });
  }
  for (let c = 0; c < COLS; c++) {
    if (!params.col_values[c]) continue;
    text(`col_header_${c}`, [colX(c), Y0 + H + colHeadOff], params.col_values[c], { fontSize: HS, color: COLORS.guide });
  }

  // Sits just above the top row header, in the same column — reads as a
  // caption for the row-header list below it, and keeps clear of the
  // canvas's left edge even for a fairly long row_label (unlike centering
  // it beside the grid, which runs out of room to the left).
  if (params.row_label) text("row_title", [X0 - SIDE_GAP, rowY(0) + rowTitleOff], params.row_label, { fontSize: TS, color: COLORS.guide, anchor: "end" });
  if (params.col_label) text("col_title", [CXg, Y0 + H + colTitleOff], params.col_label, { fontSize: TS, color: COLORS.guide });
  if (params.title) text("title", [CXg, Y0 + H + titleOff], params.title, { fontSize: 30 });

  // The margins: a column of row totals right of the grid (headed like the
  // columns), a row of column totals under it (headed like the rows).
  const totalsX = X0 + W + SIDE_GAP;
  const totalsY = Y0 - colHeadOff;
  if (hasRowTotals || hasGrand) text("row_totals_head", [totalsX, Y0 + H + colHeadOff], totalWord, { fontSize: HS, color: COLORS.guide, anchor: "start" });
  rowTotals.forEach((s, r) => {
    if (s) text(`row_total_${r}`, [totalsX, rowY(r)], s, { fontSize: HS, anchor: "start" });
  });
  if (hasColTotals || hasGrand) text("col_totals_head", [X0 - SIDE_GAP, totalsY], totalWord, { fontSize: HS, color: COLORS.guide, anchor: "end" });
  colTotals.forEach((s, c) => {
    if (s) text(`col_total_${c}`, [colX(c), totalsY], s, { fontSize: HS });
  });
  if (hasGrand) text("grand_total", [totalsX, totalsY], grand!, { fontSize: HS, anchor: "start" });

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

  return { drawables, labels, anchors, boxes, order, ...(warnings.length > 0 ? { warnings } : {}) };
}
