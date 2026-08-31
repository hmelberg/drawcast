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
 * Parses a self-contained `<svg>…</svg>` string (e.g. brand/mark.ts's
 * markSvg()) into a live, appendable element — `h()` only accepts Node/string
 * children, and a string child becomes an inert text node, not markup.
 */
export function svgFromMarkup(markup: string): SVGSVGElement {
  return new DOMParser().parseFromString(markup, "image/svg+xml").documentElement as unknown as SVGSVGElement;
}

/** A pointer event mapped through the stage svg's LIVE viewBox (camera-proof)
 *  into logical y-up coordinates, or null when the svg is missing/zero-sized. */
export function logicalPoint(stage: HTMLElement, e: MouseEvent): [number, number] | null {
  const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const vb = svg.viewBox.baseVal;
  const sx = vb.x + ((e.clientX - r.left) / r.width) * vb.width;
  const sy = vb.y + ((e.clientY - r.top) / r.height) * vb.height;
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
  const cx = r.left + ((p[0] - vb.x) / vb.width) * r.width - sr.left;
  const cy = r.top + ((CANVAS.h - p[1] - vb.y) / vb.height) * r.height - sr.top;
  return [cx, cy];
}
