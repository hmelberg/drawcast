// Where a group's members go when the group says `row`, `column` or `grid`.
// Pure geometry: it is handed each member's size and returns where each
// member's CENTRE belongs, in the assembly's own coordinates. It knows
// nothing of drawables, context or the spec beyond one helper — the natural
// size of a node, which has to agree with what nodeDrawables actually draws.
import { heuristicMeasure } from "./measure";
import type { Pt } from "./model";
import type { SpecElement } from "../spec/types";

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
  const columns = layout === "grid" ? Math.max(1, opts.columns ?? Math.ceil(Math.sqrt(sizes.length))) : layout === "row" ? sizes.length : 1;

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

const NODE_FONT = 24;

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
  const textW = el.text ? heuristicMeasure(el.text, NODE_FONT).w : 0;
  return {
    w: el.width ?? (shape === "decision" ? 56 : Math.max(130, textW + 36)),
    h: el.height ?? (shape === "decision" ? 56 : 62),
  };
}
