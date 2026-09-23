// The `music` element's drawables (design 2026-09-24-music-notation-and-staff
// §4.3): SMuFL glyphs as exact filled areas — the fill-only kind letterforms
// use, so a small head is never stroked into a blob — and a note's stem as a
// pen line, which starts where the font says the stem meets the head.

import type { MusicEngine } from "../scenes/engines";
import { symbolPlan } from "../scenes/music/symbols";
import type { GlyphShape } from "../scenes/music/geometry";
import type { Drawable, Pt } from "./model";
import { SKETCH_MS, Z_AREA, Z_STROKE } from "./model";
import type { BBox } from "./geometry";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** One staff space in logical units when the element gives no size: note_sheet's own gap. */
export const MUSIC_SIZE = 26;

export function musicDrawables(el: SpecElement, music: MusicEngine, center: Pt): { drawables: Drawable[]; box: BBox } | null {
  const plan = symbolPlan(el.symbol ?? "", el.time);
  if (!plan) return null;
  const sp = el.size ?? MUSIC_SIZE;
  const ink = resolveStyle(el.style);
  const fillStyle = resolveStyle(el.style, { color: ink.color, fill: ink.color, opacity: 1 });
  const drawOpts = resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text });
  const children: Drawable[] = [];
  const area = (suffix: string, g: GlyphShape): void => {
    children.push({ id: `${el.id}__${suffix}`, kind: "area", pts: g.pts, ...(g.holes ? { holes: g.holes } : {}), precise: true, z: Z_AREA + 1, style: fillStyle, drawOpts });
  };

  if ("note" in plan) {
    const n = music.note(plan.note, center, sp, { stem: el.stem, dots: el.dots });
    area("oval", n.head);
    if (n.stem) {
      children.push({
        id: `${el.id}__stem`,
        kind: "stroke",
        pts: [n.stem.from, n.stem.to],
        z: Z_STROKE,
        style: resolveStyle(el.style, { strokeWidth: Math.max(2, n.stem.width), roughness: 0.3 }),
        drawOpts,
      });
    }
    if (n.flag) area("flag", n.flag);
    n.dots.forEach((d, k) => area(`dot${k}`, d));
  } else if ("row" in plan) {
    // Glyphs side by side (mp, ff), the row centred on `center`.
    const widths = plan.row.map((g) => {
      const [x0, , x1] = music.bboxOf(g);
      return (x1 - x0) * sp;
    });
    const gap = 0.1 * sp;
    let x = center[0] - (widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)) / 2;
    plan.row.forEach((g, k) => {
      area(`g${k}`, music.glyphCentered(g, [x + widths[k] / 2, center[1]], sp));
      x += widths[k] + gap;
    });
  } else {
    // A time signature: the two numbers stacked, touching at the centre line
    // (each number's own height, measured — the font's digits are not all
    // exactly two staff spaces).
    plan.time.forEach((digits, row) => {
      const widths = digits.map((g) => (music.bboxOf(g)[2] - music.bboxOf(g)[0]) * sp);
      const half = (Math.max(...digits.map((g) => music.bboxOf(g)[3] - music.bboxOf(g)[1])) * sp) / 2;
      const cy = center[1] + (row === 0 ? 1 : -1) * (half + 0.05 * sp);
      let x = center[0] - widths.reduce((a, b) => a + b, 0) / 2;
      digits.forEach((g, k) => {
        area(`t${row}_${k}`, music.glyphCentered(g, [x + widths[k] / 2, cy], sp));
        x += widths[k];
      });
    });
  }

  const pts: Pt[] = children.flatMap((d) => (d.kind === "area" || d.kind === "stroke" ? d.pts : []));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { drawables: [{ id: el.id, kind: "group", children, z: Z_AREA + 1, style: ink, drawOpts: resolveDrawOpts(el.draw), box }], box };
}
