// TeX as handwriting: a `math` element's LaTeX, laid out by the mathjax
// engine and drawn as the glyphs' own filled outlines — the same construction
// the `equation_steps` template uses (scenes/packs/mathlogic.yaml), lifted out
// so a freehand spec can write an equation anywhere on the canvas.
//
// Layering: layout/ imports render/morph.ts here — the pure resampling math
// a tween needs, no DOM (as posed.ts does for render/pose.ts).
import type { BBox } from "./geometry";
import { simplifyPolyline } from "./geometry";
import { Z_AREA, SKETCH_MS, type Drawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { MathJaxEngine, MathOutline } from "../scenes/engines";
import { matchShapes, normalizeTex } from "./math-morph";
import { morphPair } from "../render/morph";
import type { SpecElement } from "../spec/types";

/** An x-height row is this fraction of `size` — the engine normalises the
 *  layout so one unit of y IS one x-height, so this is the whole scale. */
export const MATH_X_HEIGHT = 0.5;
export const MATH_DEFAULT_SIZE = 28;

/** Ring simplification tolerance, logical units. Glyph curves arrive at 8
 *  segments each; at figure size that is far more detail than the paper
 *  shows, and every point is a point the renderer walks. */
const RING_EPS = 0.35;

/** One placed shape: its outer ring and counters in canvas coordinates, next
 *  to the engine outline it came from (token/chain, for colour and matching). */
interface PlacedShape { pts: Pt[]; holes: Pt[][]; outline: MathOutline }

/**
 * TeX-outline geometry → canvas placement, scaled so an x-height row is
 * MATH_X_HEIGHT × size, centred on (cx, cy). Shared by `mathDrawables` and
 * `mathMorphDrawables`.
 *
 * `shapes` is INDEX-ALIGNED with `laid.outlines` (one entry per outline, in
 * the same order) — `null` where a ring simplifies away to fewer than 3
 * points and so is dropped, same rule as its holes. The alignment is what
 * lets `mathMorphDrawables` look a matched pair `[i, j]` up as `A[i]`/`B[j]`,
 * the same index space `matchShapes` (math-morph.ts) hands back.
 */
function placeFormula(
  laid: { outlines: MathOutline[]; w: number; h: number },
  cx: number,
  cy: number,
  size: number,
): { shapes: (PlacedShape | null)[]; box: BBox } {
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
  if (!(maxX >= minX) || !(maxY >= minY)) return { shapes: [], box: { x: cx, y: cy, w: 0, h: 0 } };

  const s = size * MATH_X_HEIGHT;
  const w = (maxX - minX) * s, h = (maxY - minY) * s;
  // The engine already flipped y back to the canvas's y-up sense, so the map
  // is a plain scale-and-shift: no negation (mathlogic.yaml does the same).
  const tx = (x: number) => cx - w / 2 + (x - minX) * s;
  const ty = (y: number) => cy - h / 2 + (y - minY) * s;
  const place = (ring: [number, number][]): Pt[] => simplifyPolyline(ring.map(([x, y]) => [tx(x), ty(y)] as Pt), RING_EPS);

  const shapes: (PlacedShape | null)[] = laid.outlines.map((o) => {
    const pts = place(o.pts);
    // A ring that simplifies away encloses no area — dropped, here and for
    // the counters (a hole of fewer than 3 points punches nothing out).
    if (pts.length < 3) return null;
    const holes = (o.holes ?? []).map(place).filter((r) => r.length >= 3);
    return { pts, holes, outline: o };
  });
  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  return { shapes, box };
}

/** The union of two boxes — the extent either formula can occupy mid-morph. */
function unionBox(a: BBox, b: BBox): BBox {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Same "deepest chain entry" rule as colorFor, but names which raw key of
 *  `colors` won — so callers can report the keys that never matched. */
function matchedColorKey(chain: string[], colors: Record<string, string> | undefined): string | null {
  if (!colors) return null;
  const byNorm = new Map(Object.keys(colors).map((k) => [normalizeTex(k), k] as const));
  for (const entry of chain) {
    const hit = byNorm.get(normalizeTex(entry));
    if (hit !== undefined) return hit;
  }
  return null;
}

function lerpPts(a: Pt[], b: Pt[], t: number): Pt[] {
  return a.map((p, i): Pt => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
}

/**
 * TeX → precise filled outlines (with their counters as holes), scaled so an
 * x-height row is MATH_X_HEIGHT × size, centred on (cx, cy).
 *
 * One drawable per FILLED SHAPE, wrapped in one group under the element's id:
 * the group is what commands, boxes and anchors address, the children are
 * what gets painted. Throws when the TeX does not parse — the caller turns
 * that into an issue.
 *
 * `el.colors` (a TeX-snippet → colour map) colours the shapes whose token
 * chain names a key, deepest match wins (colorFor, math-morph.ts); everything
 * else keeps the element's own ink. `unusedColors` names the keys that
 * matched no shape at all, for the caller to warn about.
 */
export function mathDrawables(
  el: SpecElement,
  mathjax: MathJaxEngine,
  cx: number,
  cy: number,
): { drawables: Drawable[]; box: BBox; unusedColors: string[] } {
  const size = el.size ?? el.font_size ?? MATH_DEFAULT_SIZE;
  const laid = mathjax.layoutTeX(el.tex ?? "", { display: false });
  const { shapes, box } = placeFormula(laid, cx, cy, size);

  const ink = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text });
  const usedKeys = new Set<string>();
  const children: Drawable[] = [];
  for (const shape of shapes) {
    if (shape === null) continue;
    const key = matchedColorKey(shape.outline.token.chain, el.colors);
    if (key !== null) usedKeys.add(key);
    const color = key !== null ? el.colors![key] : ink.color;
    const style = resolveStyle(el.style, { color, fill: color, opacity: 1 });
    children.push({
      id: `${el.id}__g${children.length}`,
      kind: "area",
      pts: shape.pts,
      ...(shape.holes.length > 0 ? { holes: shape.holes } : {}),
      precise: true,
      z: Z_AREA + 1,
      style,
      drawOpts,
    });
  }
  const unusedColors = el.colors ? Object.keys(el.colors).filter((k) => !usedKeys.has(k)) : [];
  if (children.length === 0) return { drawables: [], box, unusedColors };
  return {
    drawables: [{ id: el.id, kind: "group", role: "math", children, z: Z_AREA + 1, style: ink, drawOpts: resolveDrawOpts(el.draw) }],
    box,
    unusedColors,
  };
}

/**
 * The interpolated formula at progress `t` (design 2026-09-10 §2.3): `from`
 * and `to` are laid out and placed independently (each centred on (cx, cy)
 * at the element's own size), matched shape for shape (matchShapes,
 * math-morph.ts), and tweened.
 *
 * The node list is the SAME at every t — matched pairs stay matched, unmatched
 * shapes stay unmatched — only points, holes, colour and opacity move; a
 * caller animating t therefore never adds or removes drawables mid-morph.
 * Matched shapes sit at opacity 1 throughout (their identity survives); an
 * unmatched old shape fades out (1 − t) as an unmatched new shape fades in
 * (t) — at t = 0 that leaves the old formula solid and the new one invisible,
 * and at t = 1 the reverse.
 */
export function mathMorphDrawables(
  el: SpecElement,
  mathjax: MathJaxEngine,
  cx: number,
  cy: number,
  from: string,
  to: string,
  t: number,
): { drawables: Drawable[]; box: BBox; unusedColors: string[] } {
  const size = el.size ?? el.font_size ?? MATH_DEFAULT_SIZE;
  const laidFrom = mathjax.layoutTeX(from, { display: false });
  const laidTo = mathjax.layoutTeX(to, { display: false });
  const A = placeFormula(laidFrom, cx, cy, size);
  const B = placeFormula(laidTo, cx, cy, size);
  const m = matchShapes(laidFrom, laidTo);

  const ink = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text });
  const usedKeys = new Set<string>();
  const children: Drawable[] = [];

  const emit = (pts: Pt[], holes: Pt[][], chain: string[], opacity: number) => {
    const key = matchedColorKey(chain, el.colors);
    if (key !== null) usedKeys.add(key);
    const color = key !== null ? el.colors![key] : ink.color;
    const style = resolveStyle(el.style, { color, fill: color, opacity });
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
  };

  for (const [i, j] of m.pairs) {
    const a = A.shapes[i], b = B.shapes[j];
    // A shape that simplified away on either side leaves nothing to draw —
    // same "dropped" rule as mathDrawables, just applied to a pair.
    if (a === null || b === null) continue;
    const pair = morphPair(a.pts, true, b.pts, true);
    const pts = lerpPts(pair.from, pair.to, t);
    // A counter that cannot be paired (the glyph's hole COUNT changed) does
    // not drag from one shape to the other — it simply appears once the new
    // shape is more than halfway in, same as an unmatched shape would.
    const holes = a.holes.length === b.holes.length
      ? a.holes.map((h, k) => { const hp = morphPair(h, true, b.holes[k], true); return lerpPts(hp.from, hp.to, t); })
      : (t >= 0.5 ? b.holes : []);
    emit(pts, holes, b.outline.token.chain, 1);
  }
  for (const i of m.unmatchedFrom) {
    const a = A.shapes[i];
    if (a === null) continue;
    emit(a.pts, a.holes, a.outline.token.chain, 1 - t);
  }
  for (const j of m.unmatchedTo) {
    const b = B.shapes[j];
    if (b === null) continue;
    emit(b.pts, b.holes, b.outline.token.chain, t);
  }

  const box = unionBox(A.box, B.box);
  const unusedColors = el.colors ? Object.keys(el.colors).filter((k) => !usedKeys.has(k)) : [];
  if (children.length === 0) return { drawables: [], box, unusedColors };
  return {
    drawables: [{ id: el.id, kind: "group", role: "math", children, z: Z_AREA + 1, style: ink, drawOpts: resolveDrawOpts(el.draw) }],
    box,
    unusedColors,
  };
}
