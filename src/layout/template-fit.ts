// The template box (docs/2026-09-15-template-box-spec.md): a template lays
// out on the whole canvas as it always has, and this module then fits what
// it returned — drawables, label requests, anchors, curve samples — into the
// box the spec asked for. A DEFAULT plus one transform, not a layout engine:
// the five data templates that declare `box` themselves never come here.
//
// Two rules that are not obvious from the code. Uniform scale only: a figure
// squeezed on one axis is a different figure. And text holds at the lint's
// readable floor while the geometry shrinks — a 15-unit label at half width
// is 7 units, 3 px on a phone — which is what a hand does when it draws the
// same figure small. Labels then take a larger share of the box; the label
// solver moves them and the overlap lints report what no longer fits. The
// floor is the readable minimum (TEXT_MIN, W30) for text the template drew
// at or above it, so a box only a little smaller than the canvas no longer
// takes a 22-unit label to 17; text drawn smaller on purpose keeps the
// lint's floor.
//
// The fit is recomputed on every relayout (animate, sweep). The box is
// stable; `s` follows that frame's ink union, so a template whose OUTERMOST
// ink moves with an animated param breathes slightly. Acceptable today;
// pinning the boundary fit into layoutSpec is the fix if a lesson shows it.

import { FONT_FLOOR } from "../lint/lint";
import { TEXT_MIN } from "./readable";
import { CANVAS } from "./canvas";
import type { SceneLayout } from "../scenes/types";
import { unionBBoxForId, unionBoxes } from "./boxes";
import { mapLabelRequest, preferredLabelBox } from "./labels";
import type { BBox } from "./geometry";
import type { MeasureFn } from "./measure";
import type { Drawable, Pt } from "./model";
import { fitTransform, mapPoints, scaleDrawables } from "./place";
import { fitRegion, isFitName } from "./regions";
import { contentBox } from "./page";

export interface TemplateFit {
  s: number;
  dx: number;
  dy: number;
  box: BBox;
  /** Of `dy`, the page's vertical settling (layout/settle.ts): the part
   *  that moves canvas coordinates too, not only a template's own. */
  settle?: number;
}

/** Padding around the ink union before fitting — room for the labels the
 *  solver has not placed yet, so they tend to land inside the box too. */
export const FIT_PAD = 24;

/** A region name → its region; a finite positive rectangle → a copy; else null. */
export function resolveTemplateBox(v: unknown): BBox | null {
  if (isFitName(v)) return fitRegion(v);
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  const ok = ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k] as number));
  if (!ok) return null;
  const { x, y, w, h } = b as { x: number; y: number; w: number; h: number };
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

/** A text drawn at `before` and scaled by `s`: never under the lint's floor,
 *  and never under the readable minimum when it was drawn at least that big. */
export function fittedTextSize(before: number, s: number, floor: number = TEXT_MIN): number {
  return Math.max(before * s, Math.min(before, floor), FONT_FLOOR);
}

/** Clamp every text size, groups included, after a scale by `s` (sizes
 *  already scaled): the lint's floor, and the readable minimum for text that
 *  was drawn at or above it (fittedTextSize). */
export function floorTextSizes(ds: Drawable[], s = 1, floor: number = TEXT_MIN): void {
  for (const d of ds) {
    if (d.kind === "group") floorTextSizes(d.children, s, floor);
    else if (d.kind === "text") d.fontSize = s > 0 ? fittedTextSize(d.fontSize / s, s, floor) : Math.max(d.fontSize, FONT_FLOOR);
  }
}

/**
 * Fit the scene's ink into `box` IN PLACE and say what transform did it.
 * Null when the scene drew nothing (nothing to fit; the caller leaves it).
 */
export function fitSceneLayout(scene: SceneLayout, box: BBox, measure: MeasureFn, floor: number = TEXT_MIN): TemplateFit | null {
  const ids = [...new Set(scene.drawables.map((d) => d.id))];
  // The labels count as ink at their preferred spots: they scale with the
  // figure, and a fit blind to them filled the box with shapes alone.
  const labelBoxes = scene.labels.filter((l) => l.text.trim() !== "").map((l) => preferredLabelBox(l, measure));
  const union = unionBoxes([...ids.map((id) => unionBBoxForId(scene.drawables, id, measure)), ...labelBoxes]);
  if (!union) return null;
  const padded: BBox = { x: union.x - FIT_PAD, y: union.y - FIT_PAD, w: union.w + 2 * FIT_PAD, h: union.h + 2 * FIT_PAD };
  const { s, dx, dy } = fitTransform(padded, box);
  const map = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  scaleDrawables(scene.drawables, s, dx, dy);
  floorTextSizes(scene.drawables, s, floor);
  for (const l of scene.labels) {
    mapLabelRequest(l, map);
    l.fontSize = fittedTextSize(l.fontSize, s, floor);
  }
  mapPoints(scene.anchors, map);
  if (scene.curveSamples) {
    for (const k of Object.keys(scene.curveSamples)) scene.curveSamples[k] = scene.curveSamples[k].map(map);
  }
  return { s, dx, dy, box };
}

/** Where a template may grow into: the page frame's content area — under
 *  the heading, clear of the caption band (was x 40–960, y 40–685, into the
 *  captions, until 2026-10-04). */
export const GROW_REGION: BBox = Object.freeze(contentBox());
/** The same on a page with no heading: up into the heading strip. */
export const GROW_REGION_BARE: BBox = Object.freeze(contentBox({ heading: false }));
/** A template grows at most this much… */
export const GROW_MAX = 2.5;
/** …and only when it would gain at least this much (else it is left as drawn). */
export const GROW_MIN = 1.2;
/** Its words grow far less than its figure: a label at 1.8× would shout. */
const TEXT_GROW_MAX = 1.4;

function capGrownText(ds: Drawable[], s: number): void {
  for (const d of ds) {
    if (d.kind === "group") capGrownText(d.children, s);
    else if (d.kind === "text") d.fontSize = Math.min(d.fontSize, (d.fontSize / s) * TEXT_GROW_MAX);
  }
}

/**
 * A template that draws small on a canvas it could fill — a Lewis structure
 * at 4 % of it, an equation ladder at 16 % — is enlarged, uniformly, into
 * the content area (ledger, "templates draw at a fixed small scale", every revision
 * round). The figure grows up to 2.5×, its words at most 1.4× (so a label
 * stays a label). Null — and nothing touched — when the gain would be under
 * 1.2×. The caller decides WHETHER a page may grow (no box, no overlays at
 * fixed coordinates, no widget with fixed hit geometry).
 */
export function growSceneLayout(scene: SceneLayout, measure: MeasureFn, region: BBox = GROW_REGION): TemplateFit | null {
  const ids = [...new Set(scene.drawables.map((d) => d.id))];
  const union = unionBoxes(ids.map((id) => unionBBoxForId(scene.drawables, id, measure)));
  if (!union) return null;
  // Never a rescue: ink already off the canvas is a broken template, and
  // the lint that says so must still see it.
  if (union.x < 0 || union.y < 0 || union.x + union.w > CANVAS.w || union.y + union.h > CANVAS.h) return null;
  const padded: BBox = { x: union.x - FIT_PAD, y: union.y - FIT_PAD, w: union.w + 2 * FIT_PAD, h: union.h + 2 * FIT_PAD };
  const t = fitTransform(padded, region);
  if (t.s < GROW_MIN) return null;
  const s = Math.min(t.s, GROW_MAX);
  // Centred in the region at the capped scale.
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
  const ux = padded.x + padded.w / 2, uy = padded.y + padded.h / 2;
  const dx = cx - ux * s, dy = cy - uy * s;
  const map = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  scaleDrawables(scene.drawables, s, dx, dy);
  capGrownText(scene.drawables, s);
  for (const l of scene.labels) {
    mapLabelRequest(l, map);
    l.fontSize = l.fontSize * Math.min(s, TEXT_GROW_MAX);
  }
  mapPoints(scene.anchors, map);
  if (scene.curveSamples) {
    for (const k of Object.keys(scene.curveSamples)) scene.curveSamples[k] = scene.curveSamples[k].map(map);
  }
  return { s, dx, dy, box: region };
}
