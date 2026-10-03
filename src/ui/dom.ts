// Tiny DOM helpers shared across the UI.

import { CANVAS } from "../layout/canvas";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

/**
 * How the svg's viewBox sits in its client rect: the drawn scale and the
 * offset of the viewBox's origin. The figure's svg keeps the default
 * preserveAspectRatio (xMidYMid meet): when its box is not the canvas's
 * shape (a stage squeezed by a caption band or a headline), the drawing is
 * centred and letterboxed, so dividing by the rect alone would drift.
 */
export function svgFrame(r: { left: number; top: number; width: number; height: number }, vb: { x: number; y: number; width: number; height: number }, par: string | null = null): { sx: number; sy: number; ox: number; oy: number } {
  if (par === "none") return { sx: r.width / vb.width, sy: r.height / vb.height, ox: r.left, oy: r.top };
  const s = Math.min(r.width / vb.width, r.height / vb.height);
  return { sx: s, sy: s, ox: r.left + (r.width - vb.width * s) / 2, oy: r.top + (r.height - vb.height * s) / 2 };
}

/** A pointer event mapped through the stage svg's LIVE viewBox (camera-proof)
 *  into logical y-up coordinates, or null when the svg is missing/zero-sized. */
export function logicalPoint(stage: HTMLElement, e: MouseEvent): [number, number] | null {
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const vb = svg.viewBox.baseVal;
  const f = svgFrame(r, vb, svg.getAttribute?.("preserveAspectRatio") ?? null);
  const sx = vb.x + (e.clientX - f.ox) / f.sx;
  const sy = vb.y + (e.clientY - f.oy) / f.sy;
  return [sx, CANVAS.h - sy];
}

/** The client-pixel center (relative to the stage) of a logical y-up point —
 *  where an overlay marker for that point belongs. Null when unmeasurable. */
export function clientPointFor(stage: HTMLElement, p: [number, number]): [number, number] | null {
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  if (r.width === 0) return null;
  const vb = svg.viewBox.baseVal;
  const f = svgFrame(r, vb, svg.getAttribute?.("preserveAspectRatio") ?? null);
  const cx = f.ox + (p[0] - vb.x) * f.sx - sr.left;
  const cy = f.oy + (CANVAS.h - p[1] - vb.y) * f.sy - sr.top;
  return [cx, cy];
}
