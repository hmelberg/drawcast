import type { BBox } from "./geometry";

/** Named canvas regions a group can be fitted into (spec §3.2). Same
 *  margin (60) and band (y 95, h 560) the code/figure split uses
 *  (figure-split.ts MARGIN, BAND), with its 40-unit gutter between halves. */
export const FIT_NAMES = ["left", "right", "top", "bottom", "full"] as const;
export type FitName = (typeof FIT_NAMES)[number];

const MARGIN = 60, GUTTER = 40, BAND_Y = 95, BAND_H = 560, CANVAS_W = 1000;
const FULL_W = CANVAS_W - 2 * MARGIN;          // 880
const HALF_W = (FULL_W - GUTTER) / 2;          // 420
const HALF_H = (BAND_H - GUTTER) / 2;          // 260

export function fitRegion(name: FitName): BBox {
  switch (name) {
    case "left": return { x: MARGIN, y: BAND_Y, w: HALF_W, h: BAND_H };
    case "right": return { x: MARGIN + HALF_W + GUTTER, y: BAND_Y, w: HALF_W, h: BAND_H };
    case "top": return { x: MARGIN, y: BAND_Y + HALF_H + GUTTER, w: FULL_W, h: HALF_H };
    case "bottom": return { x: MARGIN, y: BAND_Y, w: FULL_W, h: HALF_H };
    case "full": return { x: MARGIN, y: BAND_Y, w: FULL_W, h: BAND_H };
  }
}

export function isFitName(v: unknown): v is FitName {
  return typeof v === "string" && (FIT_NAMES as readonly string[]).includes(v);
}
