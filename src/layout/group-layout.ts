// Where a group's members go when the group says `row`, `column` or `grid`.
// Pure geometry: it is handed each member's size and returns where each
// member's CENTRE belongs, in the assembly's own coordinates. It knows
// nothing of drawables, context or the spec beyond one helper — the natural
// size of a node, which has to agree with what nodeDrawables actually draws.
import { heuristicMeasure } from "./measure";
import type { Pt } from "./model";
import type { SpecElement } from "../spec/types";
import { iconRingsOf } from "../spec/icon-data";

/** Space between neighbours. Written rarely: the point is not to write it. */
export const DEFAULT_GAP = 40;

export type GroupLayout = "row" | "column" | "grid";

export interface SlotOpts {
  gap?: number;
  /** grid: members per row (default: a square-ish arrangement). */
  columns?: number;
  /** Cross-axis alignment (default center). */
  align?: "center" | "start" | "end";
}

export interface Size {
  w: number;
  h: number;
}

/** Where a member's centre sits on the cross axis, given the band it shares. */
function crossCentre(band: number, own: number, align: SlotOpts["align"]): number {
  if (align === "start") return band - own / 2;
  if (align === "end") return own / 2;
  return band / 2;
}

/**
 * The centre of each member's slot, in the assembly's own coordinates:
 * origin at the bottom-left of the whole arrangement, y UP, like the canvas.
 * The caller translates the result to wherever the group ends up.
 */
export function slotCentres(layout: GroupLayout, sizes: Size[], opts: SlotOpts = {}): Pt[] {
  if (sizes.length === 0) return [];
  const gap = opts.gap ?? DEFAULT_GAP;
  const columns = columnsOf(layout, sizes.length, opts.columns);
  const { rows, rowHeights, rowWidths, totalW, totalH } = assemble(sizes, columns, gap);

  const out: Pt[] = [];
  let top = totalH; // y of the current row's top edge, counting down
  rows.forEach((row, ri) => {
    const band = rowHeights[ri];
    // A grid lines its COLUMNS up, so a short last row starts where every
    // other row starts. Only a column has a horizontal cross axis to align.
    const across = layout === "column" ? opts.align : "start";
    let x = across === "start" ? 0 : across === "end" ? totalW - rowWidths[ri] : (totalW - rowWidths[ri]) / 2;
    for (const s of row) {
      const cx = x + s.w / 2;
      // The row's band runs from `top - band` up to `top`; place within it.
      const cy = top - band + crossCentre(band, s.h, layout === "column" ? "center" : opts.align);
      out.push([cx, cy]);
      x += s.w + gap;
    }
    top -= band + gap;
  });

  // A column is a grid one wide; a row is a grid as wide as it is long. Both
  // fall out of the loop above, so there is one placement rule, not three.
  return out;
}

/** How many members go on one line: a row is all of them, a column one, a
 *  grid what it was told — or ⌈√n⌉ when nobody chose (the caller that knows
 *  the region, tier-2's layoutGroup, chooses with bestColumns instead). */
function columnsOf(layout: GroupLayout, n: number, columns: number | undefined): number {
  if (layout === "row") return n;
  if (layout === "column") return 1;
  return Math.max(1, columns ?? Math.ceil(Math.sqrt(n)));
}

/** The arrangement's lines and its overall size, `columns` members a line. */
function assemble(sizes: Size[], columns: number, gap: number) {
  // Row by row, top row first — the order a reader expects.
  const rows: Size[][] = [];
  for (let i = 0; i < sizes.length; i += columns) rows.push(sizes.slice(i, i + columns));

  const rowHeights = rows.map((r) => Math.max(...r.map((s) => s.h)));
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);

  // The widest row sets the assembly's width; a narrower row is placed within
  // it. For a COLUMN that IS the cross axis — a narrow box among wide ones is
  // centred, or pushed to one side by `align` — so alignment follows the
  // layout's cross axis rather than always meaning the same direction.
  const rowWidths = rows.map((r) => r.reduce((a, s) => a + s.w, 0) + gap * (r.length - 1));
  const totalW = Math.max(...rowWidths);
  return { rows, rowHeights, rowWidths, totalW, totalH };
}

/**
 * The scale at which an arrangement fits `region`, capped at 1: once every
 * member shows at the size it was built, a larger scale buys nothing, and the
 * choice should go to the arrangement that reads most naturally instead.
 */
export function arrangementScale(layout: GroupLayout, sizes: Size[], region: Size, opts: SlotOpts = {}): number {
  if (sizes.length === 0) return 1;
  const { totalW, totalH } = assemble(sizes, columnsOf(layout, sizes.length, opts.columns), opts.gap ?? DEFAULT_GAP);
  return Math.min(1, region.w / totalW, region.h / totalH);
}

/**
 * The column count that shows the members largest in `region` — which is
 * how a grid with no `columns` decides. One rule, not a table of thresholds:
 * a row while the members fit at their own size, then 2 × 2, 3 × 2, 3 × 3 as
 * pictures stop fitting, and a single column (a list) for wide, flat items.
 * Equal scales (within 2 %) go to the fewest empty slots, then to a single
 * line (a row or a column reads in one direction), then to more columns.
 */
export function bestColumns(sizes: Size[], region: Size, gap = DEFAULT_GAP): number {
  const n = sizes.length;
  if (n <= 1) return 1;
  let best = { c: n, s: -1, empty: 0, line: true };
  for (let c = n; c >= 1; c--) {
    const rows = Math.ceil(n / c);
    const s = arrangementScale("grid", sizes, region, { gap, columns: c });
    const cand = { c, s, empty: c * rows - n, line: c === n || c === 1 };
    const better =
      cand.s > best.s * 1.02 ||
      (cand.s >= best.s / 1.02 &&
        (cand.empty < best.empty || (cand.empty === best.empty && cand.line && !best.line)));
    if (better) best = cand;
  }
  return best.c;
}

/** A node's text size when it declares none. */
export const NODE_FONT = 24;

/**
 * A node's text size: its own `font_size` when it gives one, else NODE_FONT.
 * It used to be NODE_FONT always — a node's font_size was silently dropped,
 * and a group that sized its boxes to their text sized them to 24 whatever
 * the text was drawn at (2026-09-30).
 */
export function nodeFontSize(el: SpecElement): number {
  return typeof el.font_size === "number" && el.font_size > 0 ? el.font_size : NODE_FONT;
}

/** How much taller a text-fitted rect node grows to hold an icon above its text (round 5 §3.3). */
export const NODE_ICON_EXTRA = 40;

/**
 * A rect node's resolved icon rings (0..1, y-down — decodeIcon), or null
 * when it has no icon, the icon is not resolved (no `icon_strokes`), or the
 * node is not a rect. Null means the node lays out exactly as without one.
 */
export function nodeIconRings(el: SpecElement): [number, number][][] | null {
  if (el.type !== "node" || (el.shape ?? "circle") !== "rect" || el.icon === undefined || !el.icon_strokes) return null;
  // Either form of icon data (spec/icon-data.ts): an SVG is traced, rings are read.
  return iconRingsOf(el.icon_strokes);
}

/** A text-fitted rect node's height: 62 at the default size, taller for a larger font. */
export function nodeRectHeight(fontSize: number): number {
  return Math.max(62, Math.round(fontSize * 1.25 + 32));
}

/**
 * The size a node takes when it declares none — the same arithmetic
 * nodeDrawables uses for a rect, so an equalized width is a width that
 * actually gets drawn. Null for anything that is not a node: a text, a
 * formula and an image keep whatever size they came out at.
 */
export function naturalNodeSize(el: SpecElement): Size | null {
  if (el.type !== "node") return null;
  const shape = el.shape ?? "circle";
  if (shape !== "rect" && shape !== "decision") return null;
  const fs = nodeFontSize(el);
  const textW = el.text ? heuristicMeasure(el.text, fs).w : 0;
  return {
    w: el.width ?? (shape === "decision" ? 56 : Math.max(130, textW + 36)),
    h: el.height ?? (shape === "decision" ? 56 : nodeRectHeight(fs) + (nodeIconRings(el) ? NODE_ICON_EXTRA : 0)),
  };
}
