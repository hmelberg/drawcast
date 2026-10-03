import type { BBox } from "./geometry";
import { FIT_BAND, GUTTER, MARGIN, PAGE_W } from "./page";

/** Named canvas regions a group can be fitted into (spec §3.2): the page
 *  frame's fit band (page.ts) and its halves, a gutter between them. */
export const FIT_NAMES = ["left", "right", "top", "bottom", "full"] as const;
export type FitName = (typeof FIT_NAMES)[number];

const BAND_Y = FIT_BAND.y, BAND_H = FIT_BAND.h;
const FULL_W = PAGE_W - 2 * MARGIN;            // 880
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
