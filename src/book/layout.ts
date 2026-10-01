// A book's geometry (spec 2026-10-01-book-layout §6.1): pure arithmetic from
// the room the page gives, so it is tested without a DOM.
//
// Everything follows the HEIGHT. Columns: the figure is as tall as the book
// (4:3, so its width follows) and the text column is share/(100 − share) of
// the figure's width beside it; too wide for the room, both shrink together.
// Rows: the figure takes (100 − share) % of the height, the column is exactly
// as wide as the figure, and the text gets the rest of the height — so the
// figure is always whole and text lines never run wider than the plot.
// Either way the result is centred, so a wide screen gets wide margins.

import type { BookSettings } from "../spec/types";

export type BookView = "text" | "figure" | "both";

export interface BookRoom {
  /** The width the page offers the book. */
  w: number;
  /** The height it offers (the viewport below the book's top, minus furniture). */
  h: number;
  /** What the figure pane needs under its 4:3 stage (the control bar). */
  barH: number;
}

export interface BookBox {
  /** The whole book. */
  w: number;
  h: number;
  /** Columns side by side, or rows stacked. */
  dir: "row" | "column";
  text: { w: number; h: number };
  /** The figure pane, control bar included. */
  figure: { w: number; h: number };
  /** The text pane's font size, px. */
  fontPx: number;
}

/** The text pane's share when the book does not say: 40 % beside, 28 % under. */
export function defaultShare(layout: BookSettings["layout"]): number {
  return layout === "rows" ? 28 : 40;
}

const MIN_STAGE = 160;

/** Lay a book out in `room`, showing `view`. */
export function bookLayout(room: BookRoom, book: BookSettings | undefined, view: BookView = "both"): BookBox {
  const layout = book?.layout ?? "columns";
  const s = Math.min(100, Math.max(0, book?.share ?? defaultShare(layout))) / 100;
  const W = Math.max(0, room.w);
  const H = Math.max(0, room.h);
  const bar = Math.max(0, room.barH);
  const fontPx = Math.round(Math.min(26, Math.max(15, H / 40)));
  // The stage's width for a given figure-pane height: 4:3 under the bar.
  const stageWForH = (h: number): number => Math.max(MIN_STAGE, ((h - bar) * 4) / 3);
  const figHForW = (w: number): number => (w * 3) / 4 + bar;

  if (layout === "rows") {
    let figW = stageWForH(H * (1 - s));
    if (figW > W) figW = W;
    if (view === "figure") figW = Math.min(W, stageWForH(H));
    let figH = figHForW(figW);
    if (view === "text" || s >= 1) figH = 0;
    if (view === "figure" || s <= 0) figH = Math.min(H, figHForW(figW));
    const textH = Math.max(0, H - figH);
    return { w: figW, h: H, dir: "column", text: { w: figW, h: view === "figure" ? 0 : textH }, figure: { w: figW, h: figH }, fontPx };
  }

  let figW = stageWForH(H);
  let textW = s >= 1 ? figW : (figW * s) / (1 - s);
  if (figW + textW > W) {
    const k = W / (figW + textW);
    figW *= k;
    textW *= k;
  }
  if (view === "figure" || s <= 0) {
    figW = Math.min(W, stageWForH(H));
    textW = 0;
  } else if (view === "text" || s >= 1) {
    textW = Math.min(W, figW + textW);
    figW = 0;
  }
  return { w: figW + textW, h: H, dir: "row", text: { w: textW, h: H }, figure: { w: figW, h: Math.min(H, figHForW(figW)) }, fontPx };
}
