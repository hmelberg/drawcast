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
// solver moves them and the overlap lints report what no longer fits.

import { FONT_FLOOR } from "../lint/lint";
import type { SceneLayout } from "../scenes/types";
import { unionBBoxForId, unionBoxes } from "./boxes";
import type { BBox } from "./geometry";
import type { MeasureFn } from "./measure";
import type { Drawable, Pt } from "./model";
import { fitTransform, mapPoints, scaleDrawables } from "./place";
import { fitRegion, isFitName } from "./regions";

export interface TemplateFit {
  s: number;
  dx: number;
  dy: number;
  box: BBox;
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

/** Clamp every text size, groups included, to the lint's floor. */
export function floorTextSizes(ds: Drawable[]): void {
  for (const d of ds) {
    if (d.kind === "group") floorTextSizes(d.children);
    else if (d.kind === "text") d.fontSize = Math.max(d.fontSize, FONT_FLOOR);
  }
}

/**
 * Fit the scene's ink into `box` IN PLACE and say what transform did it.
 * Null when the scene drew nothing (nothing to fit; the caller leaves it).
 */
export function fitSceneLayout(scene: SceneLayout, box: BBox, measure: MeasureFn): TemplateFit | null {
  const ids = [...new Set(scene.drawables.map((d) => d.id))];
  const union = unionBoxes(ids.map((id) => unionBBoxForId(scene.drawables, id, measure)));
  if (!union) return null;
  const padded: BBox = { x: union.x - FIT_PAD, y: union.y - FIT_PAD, w: union.w + 2 * FIT_PAD, h: union.h + 2 * FIT_PAD };
  const { s, dx, dy } = fitTransform(padded, box);
  const map = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  scaleDrawables(scene.drawables, s, dx, dy);
  floorTextSizes(scene.drawables);
  for (const l of scene.labels) {
    l.anchor = map(l.anchor);
    l.fontSize = Math.max(l.fontSize * s, FONT_FLOOR);
  }
  mapPoints(scene.anchors, map);
  if (scene.curveSamples) {
    for (const k of Object.keys(scene.curveSamples)) scene.curveSamples[k] = scene.curveSamples[k].map(map);
  }
  return { s, dx, dy, box };
}
