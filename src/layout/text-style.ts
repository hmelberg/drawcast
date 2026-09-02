// Global text size, family and weight — the spec's `text:` block, the
// viewer's Playback settings, and the app default, resolved into ONE style
// (Hans 2026-09-02: "User explicit changes in player should override
// drawcast makers spec, but arguments in the spec are the defaults").
//
// Applied at the two boundaries rather than in the seventy-odd places the
// layout picks a size: measuring (so layout reserves room for the text that
// will actually be drawn) and the drawables handed to the renderer (so it
// draws what was measured). Templates and element code stay untouched.
// Frames sized directly from a font size do not grow with it — the reason
// for the clamp below.

import type { Drawable } from "./model";
import type { LayoutResult } from "./layout";
import type { MeasureFn } from "./measure";

/** CSS generic families — the vocabulary the compiler prompt teaches. */
export type TextFamily = "cursive" | "sans-serif" | "monospace";
export type TextWeight = "normal" | "bold";

/** The spec's `text:` block: CSS property names, snake_cased like the rest of the spec. */
export interface SpecText {
  /** Base size in logical units. Every size in the drawing scales by font_size / 26. */
  font_size?: number;
  font_family?: TextFamily;
  font_weight?: TextWeight;
}

/** The viewer's override (Settings → Playback). null = follow the drawcast. */
export interface TextOverride {
  fontSize?: number | null;
  family?: TextFamily | null;
}

export interface TextStyle {
  /** Multiplier on every font size the layout chose. */
  scale: number;
  family: TextFamily;
  weight: TextWeight;
}

/** What the layout's sizes are written against. */
export const BASE_FONT_SIZE = 26;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 48;

export const DEFAULT_TEXT_STYLE: TextStyle = { scale: 1, family: "cursive", weight: "normal" };

/** Viewer's setting if set, else the spec's block, else the app default. */
export function effectiveTextStyle(spec: { text?: SpecText }, override?: TextOverride): TextStyle {
  const size = override?.fontSize ?? spec.text?.font_size ?? BASE_FONT_SIZE;
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  return {
    scale: clamped / BASE_FONT_SIZE,
    family: override?.family ?? spec.text?.font_family ?? DEFAULT_TEXT_STYLE.family,
    weight: spec.text?.font_weight ?? DEFAULT_TEXT_STYLE.weight,
  };
}

/** A measurer that reports the size the text will be DRAWN at. */
export function scaledMeasure(base: MeasureFn, scale: number): MeasureFn {
  if (scale === 1) return base;
  return (text, fontSize) => base(text, fontSize * scale);
}

/** The layout with every text drawable scaled and stamped — a new tree; the input is untouched. */
export function applyTextStyle(layout: LayoutResult, style: TextStyle): LayoutResult {
  const walk = (d: Drawable): Drawable => {
    if (d.kind === "group") return { ...d, children: d.children.map(walk) };
    if (d.kind === "text") return { ...d, fontSize: d.fontSize * style.scale, family: style.family, weight: style.weight };
    return d;
  };
  return { ...layout, drawables: layout.drawables.map(walk) };
}
