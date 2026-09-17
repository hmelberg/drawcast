// The inset element (spec docs/superpowers/specs/2026-09-17-inset-design.md):
// a small picture of ANOTHER playlist item's final frame on this page. This
// module is the pure geometry — where a default-column thumbnail goes and how
// a stored picture is fitted into its slot. Building the picture itself is
// render/inset.ts (it needs the source's layout and plan); drawing the frame
// and the group is tier2.ts's `insetDrawable`.
import { CANVAS } from "./canvas";
import { expandBox, type BBox } from "./geometry";
import type { Drawable } from "./model";
import { fitTransform, relAt, scaleDrawables } from "./place";
import type { Spec, SpecElement } from "../spec/types";

/** Thumbnail size (4:3 like the canvas, ~1/6 of its width) and the column it stacks in. */
export const INSET_W = 160;
export const INSET_H = 120;
export const INSET_GAP = 16;
/** The column's right edge and the top of its first slot (y-up). */
export const INSET_RIGHT = 980;
export const INSET_TOP = 730;
/** The lowest y the column may reach. */
export const INSET_BOTTOM = 20;
/** Thumbnails at full size; more shrink the column uniformly and lint warns. */
export const INSET_MAX = 5;
/** Between the frame and the picture. */
export const INSET_FRAME_PAD = 6;
/** Around the ink union when cropping. */
export const INSET_CROP_PAD = 12;
/** A scaled stroke never goes thinner than this (logical units). */
export const INSET_STROKE_FLOOR = 0.8;
/** The template's default box on a page with default-column insets: the
 *  `full` region cut to stop 20 units short of the column at x = 820. */
export const INSET_MAIN: BBox = Object.freeze({ x: 60, y: 95, w: 740, h: 560 });

/** What render/inset.ts stores on the element clone: the source's final
 *  frame as re-homed leaves, its ink union, the source elements' boxes (for
 *  the read-only anchors), and the authored source for the modal. */
export interface InsetPicture {
  drawables: Drawable[];
  ink: BBox | null;
  boxes: Record<string, BBox>;
  spec: Spec;
  /** The source's index among the playlist's items (for "Go to page"). */
  index: number;
}
/** The resolver could not build the picture: the frame draws alone and tier-2 warns. */
export interface InsetError {
  error: string;
}

/** An inset with no position of its own: it takes the next column slot. */
export function isDefaultColumn(el: SpecElement): boolean {
  return el.type === "inset" && el.x === undefined && el.y === undefined && !relAt(el)?.ref;
}

export function hasDefaultColumnInsets(elements: SpecElement[] | undefined): boolean {
  return (elements ?? []).some(isDefaultColumn);
}

/** The n column slots, top down. Up to INSET_MAX at the fixed size; beyond
 *  that the column shrinks uniformly (4:3 kept) so every slot fits above
 *  INSET_BOTTOM. */
export function columnSlots(n: number): BBox[] {
  if (n <= 0) return [];
  let w = INSET_W;
  let h = INSET_H;
  if (n > INSET_MAX) {
    h = (INSET_TOP - INSET_BOTTOM - (n - 1) * INSET_GAP) / n;
    w = (h * 4) / 3;
  }
  const out: BBox[] = [];
  for (let k = 0; k < n; k++) {
    const top = INSET_TOP - k * (h + INSET_GAP);
    out.push({ x: INSET_RIGHT - w, y: top - h, w, h });
  }
  return out;
}

/**
 * The picture fitted into a slot: a deep copy of its leaves scaled uniformly
 * into the slot's inner box (crop: the ink union padded; else the whole
 * canvas, so every uncropped inset shares one scale). scaleDrawables scales
 * geometry and font sizes but not styles — rough.js works in absolute units —
 * so stroke width and roughness are scaled down with the picture, multiplied by
 * the fit scale s here (a 1/6 picture with full-size wobble is six times too
 * rough), width floored so lines stay visible on a phone. Draw durations shrink
 * with the picture, so a thumbnail of a ten-second page draws in under two. The
 * input is untouched.
 */
export function fitPicture(picture: Pick<InsetPicture, "drawables" | "ink">, slot: BBox, crop: boolean): { children: Drawable[]; s: number; dx: number; dy: number } {
  const inner = expandBox(slot, -INSET_FRAME_PAD);
  const source = crop && picture.ink ? expandBox(picture.ink, INSET_CROP_PAD) : { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
  const { s, dx, dy } = fitTransform(source, inner);
  const children = structuredClone(picture.drawables);
  scaleDrawables(children, s, dx, dy);
  thin(children, s);
  return { children, s, dx, dy };
}

function thin(ds: Drawable[], s: number): void {
  for (const d of ds) {
    if (d.kind === "group") {
      thin(d.children, s);
      continue;
    }
    d.style = { ...d.style, strokeWidth: Math.max(INSET_STROKE_FLOOR, d.style.strokeWidth * s), roughness: d.style.roughness * s };
    d.drawOpts = { ...d.drawOpts, duration: Math.max(20, Math.round(d.drawOpts.duration * s)) };
  }
}
