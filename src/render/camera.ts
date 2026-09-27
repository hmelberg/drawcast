// Pure camera math: where the camera rests, what a `camera` command frames,
// and the viewer's paused pan/zoom. No DOM — the planner, the player, the
// backend and ui/view-pan.ts all read these.
//
// Two coordinates meet here. The PAGE is the 1000 × 750 canvas, and every
// zoom number is relative to it (zoom 2 shows half a page wide, as it always
// has). The WORLD is what a figure occupies: the page, or — when a template
// reports `SceneLayout.world` — a larger extent round it (a decision tree
// three pages wide). The camera at rest shows the whole world, grown to the
// page's 4 : 3 so the view never distorts; with no world that is FULL_VIEW
// exactly, so every figure that does not opt in behaves as before.

import { CANVAS, FULL_VIEW, worldBounds } from "../layout/canvas";
import { unionBoxes } from "./effects";
import type { BBox } from "../layout/geometry";

/** The page's aspect, w / h. Every camera box keeps it. */
export const PAGE_ASPECT = CANVAS.w / CANVAS.h;
/** The closest a camera goes: 8× the page (a `camera` command and the viewer alike). */
export const MAX_ZOOM = 8;
/** The smallest view box width MAX_ZOOM allows. */
export const MIN_VIEW_W = CANVAS.w / MAX_ZOOM;

/** A box grown on one axis to `aspect`, about its centre (letterboxing, never cropping). */
export function growToAspect(b: BBox, aspect = PAGE_ASPECT): BBox {
  if (!(b.w > 0) || !(b.h > 0)) return { ...b };
  if (b.w / b.h > aspect) {
    const h = b.w / aspect;
    return { x: b.x, y: b.y + b.h / 2 - h / 2, w: b.w, h };
  }
  const w = b.h * aspect;
  return { x: b.x + b.w / 2 - w / 2, y: b.y, w, h: b.h };
}

/** A usable world box: finite, positive, and not the page itself. */
export function isWorld(b: unknown): b is BBox {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number)) && (o.w as number) > 0 && (o.h as number) > 0;
}

/**
 * The camera at rest: FULL_VIEW for a figure on one page, else the world
 * together with the page (the card heading and anything placed in page
 * coordinates stay in the overview), grown to 4 : 3 about its centre.
 */
export function restView(world?: BBox | null): BBox {
  const u = isWorld(world) ? worldBounds(world) : null;
  // `+ 0` turns FULL_VIEW's -0 (a zero VIEW_PAD, negated) into 0.
  if (!u) return { x: FULL_VIEW.x + 0, y: FULL_VIEW.y + 0, w: FULL_VIEW.w, h: FULL_VIEW.h };
  return growToAspect(unionBoxes([u, FULL_VIEW])!);
}

/** The zoom (page-relative) the rest view stands at: 1 for one page, below 1 for a larger world. */
export function restZoom(rest: BBox): number {
  return CANVAS.w / rest.w;
}

/**
 * Keep a view inside the rest view: its width between MIN_VIEW_W and the
 * rest's (aspect kept), then slid, not shrunk, back inside. A box as wide
 * as the rest (or wider) is the rest.
 */
export function clampView(b: BBox, rest: BBox, minW = MIN_VIEW_W): BBox {
  const w = Math.max(Math.min(b.w, rest.w), Math.min(minW, rest.w));
  if (w >= rest.w - 1e-9) return { ...rest };
  const h = w / PAGE_ASPECT;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const x = Math.min(Math.max(cx - w / 2, rest.x), rest.x + rest.w - w);
  const y = Math.min(Math.max(cy - h / 2, rest.y), rest.y + rest.h - h);
  return { x, y, w, h };
}

/** Whether a view is (all but) the rest view — the viewer's "nothing to reset". */
export function atRest(b: BBox | null, rest: BBox): boolean {
  if (!b) return true;
  const tol = rest.w * 1e-3;
  return Math.abs(b.x - rest.x) < tol && Math.abs(b.y - rest.y) < tol && Math.abs(b.w - rest.w) < tol && Math.abs(b.h - rest.h) < tol;
}

/**
 * A `camera` command's box: `zoom` (page-relative) about the centre (cx, cy),
 * kept inside the rest view. Null — the rest view — when the zoom is at or
 * below the rest's own. `lift` raises the centre by that fraction of the view
 * height (zoom "fit": the caption band covers the bottom of the frame).
 */
export function cameraBox(cx: number, cy: number, zoom: number, rest: BBox, lift = 0): BBox | null {
  const z = Math.min(MAX_ZOOM, zoom);
  if (!(z > restZoom(rest) + 1e-9)) return null;
  const w = CANVAS.w / z;
  const h = CANVAS.h / z;
  return clampView({ x: cx - w / 2, y: cy - h / 2 - lift * h, w, h }, rest);
}

/** A wide, short target (a table or matrix row) is framed at least this close, its ends cropped. */
export const FIT_SHORT_MIN_ZOOM = 1.4;
/** A small target is framed no closer than this: a cell at 17× is a cell and nothing else. */
export const FIT_MAX_ZOOM = 4;

/**
 * The zoom that frames `target` with `margin` on its tighter side
 * (page-relative) — within two limits. A small target stops at
 * FIT_MAX_ZOOM, with its neighbours round it. A wide, SHORT one — a matrix
 * row 830 wide and 40 tall — would frame at below page size, which the
 * camera clamps to no zoom at all, so "walk the matrix row by row" could not
 * move; when its height leaves room to spare it is framed at
 * FIT_SHORT_MIN_ZOOM instead, centred on it, its ends cropped at the sides
 * (2026-09-27).
 */
export function fitZoom(target: BBox, margin: number): number | null {
  if (!(target.w > 0) || !(target.h > 0)) return null;
  const byW = CANVAS.w / (target.w * margin);
  const byH = CANVAS.h / (target.h * margin);
  const z = Math.min(byW, byH);
  if (z < FIT_SHORT_MIN_ZOOM && byH >= 2 * FIT_SHORT_MIN_ZOOM) return FIT_SHORT_MIN_ZOOM;
  return Math.min(z, FIT_MAX_ZOOM);
}

/**
 * Zoom a view by `factor` (> 1 closer, < 1 farther) keeping the logical
 * point `pivot` where it is on screen — the wheel and pinch rule.
 */
export function zoomAbout(b: BBox, factor: number, pivot: [number, number], rest: BBox, minW = MIN_VIEW_W): BBox {
  if (!(factor > 0) || !Number.isFinite(factor)) return clampView(b, rest, minW);
  // The width clamp first, so the pivot rule uses the factor actually applied.
  const w = Math.max(Math.min(b.w / factor, rest.w), Math.min(minW, rest.w));
  const f = b.w / w;
  const [px, py] = pivot;
  return clampView({ x: px - (px - b.x) / f, y: py - (py - b.y) / f, w, h: w / PAGE_ASPECT }, rest, minW);
}

/** Slide a view by (dx, dy) logical units, kept inside the rest view. */
export function panBy(b: BBox, dx: number, dy: number, rest: BBox, minW = MIN_VIEW_W): BBox {
  return clampView({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }, rest, minW);
}

/**
 * One step of a two-finger pinch, in logical units: the fingers' midpoint
 * and spread before and after (both mapped through the view BEFORE the
 * step). The view zooms by the spread's ratio about the old midpoint, then
 * slides so that point lies under the new midpoint.
 */
export function pinchStep(
  b: BBox,
  before: { mid: [number, number]; spread: number },
  after: { mid: [number, number]; spread: number },
  rest: BBox,
  minW = MIN_VIEW_W,
): BBox {
  const factor = before.spread > 0 && after.spread > 0 ? after.spread / before.spread : 1;
  const z = zoomAbout(b, factor, before.mid, rest, minW);
  // The new midpoint was measured in the OLD view; in the zoomed view the
  // same screen spot is scaled toward the pivot by the applied factor.
  const f = b.w / z.w;
  const moved: [number, number] = [before.mid[0] + (after.mid[0] - before.mid[0]) / f, before.mid[1] + (after.mid[1] - before.mid[1]) / f];
  return panBy(z, before.mid[0] - moved[0], before.mid[1] - moved[1], rest, minW);
}

/** How much one wheel event zooms: > 1 closer. A trackpad pinch arrives as
 *  ctrl+wheel with small deltas (smooth); a mouse notch is ~100 px or one
 *  line, capped so a notch is about 1.6×. */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number }): number {
  const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const d = Math.max(-60, Math.min(60, px));
  return Math.exp(-d * 0.008);
}

/** A mouse wheel notch rather than a trackpad's two-finger scroll (which pans). */
export function looksLikeMouseWheel(e: { deltaX: number; deltaY: number; deltaMode: number }): boolean {
  if (e.deltaMode !== 0) return true;
  return e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
}
