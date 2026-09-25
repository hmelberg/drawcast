// When the words written on the drawing (ink in a paper halo, figure-
// style.ts) would sit on something DARK — a photo, a Commodore screen, a
// solid dark fill — the halo turns every word into a pale patch. For those
// moments the caption goes back to the dark band with light letters, the one
// style that reads on any ground (Hans, 2026-09-25: "but what happens if the
// background is black?").
//
// Decided from the layout, not from pixels: which top-level elements have a
// dark leaf reaching into the strip the overlay covers. The player asks, for
// each caption, whether any of them is on screen.

import { bboxOfPts } from "../layout/geometry";
import { leafDrawables, type Drawable } from "../layout/model";

/** How high (logical units from the canvas floor) the overlaid caption reaches: three lines. */
export const CAPTION_STRIP = 115;
/** A fill this dark (relative luminance) is dark ground for ink letters. */
const DARK_LUMINANCE = 0.3;

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Is this leaf dark ground: a picture, or a solid-ish dark fill? */
function darkLeaf(d: Drawable): boolean {
  // A photo's brightness is unknown here; a picture under the words is busy
  // at best, so it gets the band.
  if (d.kind === "image") return true;
  if (d.kind !== "area" && d.kind !== "stroke") return false;
  const fill = d.style.fill;
  if (!fill || (d.style.opacity ?? 1) < 0.6) return false;
  const l = luminance(fill);
  return l !== null && l < DARK_LUMINANCE;
}

function lowY(d: Drawable): number | null {
  if (d.kind === "image") return d.pos[1] - d.h / 2;
  if ((d.kind === "area" || d.kind === "stroke") && d.pts.length > 0) return bboxOfPts(d.pts).y;
  return null;
}

/** Top-level ids whose ink includes a dark leaf reaching into the caption strip. */
export function darkUnderCaption(drawables: Drawable[]): Set<string> {
  const out = new Set<string>();
  for (const top of drawables) {
    for (const leaf of leafDrawables([top])) {
      const y = lowY(leaf);
      if (y !== null && y < CAPTION_STRIP && darkLeaf(leaf)) {
        out.add(top.id);
        break;
      }
    }
  }
  return out;
}

/** How high the words' strip reaches when it is reserved: two lines. */
export const CAPTION_STRIP_TWO = 85;

/**
 * Does anything the viewer must READ or find lie in the bottom strip a
 * caption would cover — text, a formula, a picture, a small marker? Then,
 * with subtitles on and no room below the drawing, the player shrinks the
 * drawing a little and writes the words in a strip of their own (Hans,
 * 2026-09-25) rather than over it. Decided once per cast: lines and fills
 * passing under the words do not count, and nothing jumps mid-cast.
 */
export function contentUnderCaption(drawables: Drawable[]): boolean {
  const low = (y: number | null) => y !== null && y < CAPTION_STRIP_TWO;
  const walk = (ds: Drawable[]): boolean =>
    ds.some((d) => {
      if (d.kind === "group") {
        // A formula is words: its glyph rings count as text.
        if (d.role === "math") return d.children.some((c) => (c.kind === "area" || c.kind === "stroke") && c.pts.length > 0 && low(bboxOfPts(c.pts).y)) || walk(d.children);
        return walk(d.children);
      }
      if (d.kind === "text") return d.text.trim() !== "" && low(d.pos[1] - d.fontSize * 0.6);
      if (d.kind === "image") return low(lowY(d));
      if (d.kind === "stroke" && d.shapeHint?.type === "circle" && d.shapeHint.r <= 14) return low(d.shapeHint.c[1] - d.shapeHint.r);
      return false;
    });
  return walk(drawables);
}
