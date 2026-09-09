// TeX as handwriting: a `math` element's LaTeX, laid out by the mathjax
// engine and drawn as the glyphs' own filled outlines — the same construction
// the `equation_steps` template uses (scenes/packs/mathlogic.yaml), lifted out
// so a freehand spec can write an equation anywhere on the canvas.
import type { BBox } from "./geometry";
import { simplifyPolyline } from "./geometry";
import { Z_AREA, SKETCH_MS, type Drawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { MathJaxEngine } from "../scenes/engines";
import type { SpecElement } from "../spec/types";

/** An x-height row is this fraction of `size` — the engine normalises the
 *  layout so one unit of y IS one x-height, so this is the whole scale. */
export const MATH_X_HEIGHT = 0.5;
export const MATH_DEFAULT_SIZE = 28;

/** Ring simplification tolerance, logical units. Glyph curves arrive at 8
 *  segments each; at figure size that is far more detail than the paper
 *  shows, and every point is a point the renderer walks. */
const RING_EPS = 0.35;

/**
 * TeX → precise filled outlines (with their counters as holes), scaled so an
 * x-height row is MATH_X_HEIGHT × size, centred on (cx, cy).
 *
 * One drawable per FILLED SHAPE, wrapped in one group under the element's id:
 * the group is what commands, boxes and anchors address, the children are
 * what gets painted. Throws when the TeX does not parse — the caller turns
 * that into an issue.
 */
export function mathDrawables(
  el: SpecElement,
  mathjax: MathJaxEngine,
  cx: number,
  cy: number,
): { drawables: Drawable[]; box: BBox } {
  const size = el.size ?? el.font_size ?? MATH_DEFAULT_SIZE;
  const laid = mathjax.layoutTeX(el.tex ?? "", { display: false });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of laid.outlines) {
    for (const [x, y] of o.pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // TeX that renders no ink at all (`\;`, `\hspace{1em}`): nothing to draw,
  // and no box to place — a zero-size box at the requested point.
  if (!(maxX >= minX) || !(maxY >= minY)) return { drawables: [], box: { x: cx, y: cy, w: 0, h: 0 } };

  const s = size * MATH_X_HEIGHT;
  const w = (maxX - minX) * s, h = (maxY - minY) * s;
  // The engine already flipped y back to the canvas's y-up sense, so the map
  // is a plain scale-and-shift: no negation (mathlogic.yaml does the same).
  const tx = (x: number) => cx - w / 2 + (x - minX) * s;
  const ty = (y: number) => cy - h / 2 + (y - minY) * s;
  const place = (ring: [number, number][]): Pt[] => simplifyPolyline(ring.map(([x, y]) => [tx(x), ty(y)] as Pt), RING_EPS);

  const ink = resolveStyle(el.style);
  const style = resolveStyle(el.style, { fill: ink.color, opacity: 1 });
  const drawOpts = resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text });
  const children: Drawable[] = [];
  for (const o of laid.outlines) {
    const pts = place(o.pts);
    // A ring that simplifies away encloses no area — dropped, here and for
    // the counters (a hole of fewer than 3 points punches nothing out).
    if (pts.length < 3) continue;
    const holes = (o.holes ?? []).map(place).filter((r) => r.length >= 3);
    children.push({
      id: `${el.id}__g${children.length}`,
      kind: "area",
      pts,
      ...(holes.length > 0 ? { holes } : {}),
      precise: true,
      z: Z_AREA + 1,
      style,
      drawOpts,
    });
  }
  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  if (children.length === 0) return { drawables: [], box };
  return {
    drawables: [{ id: el.id, kind: "group", children, z: Z_AREA + 1, style: ink, drawOpts: resolveDrawOpts(el.draw) }],
    box,
  };
}
