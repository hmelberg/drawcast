// The hand in a typeset formula (Hans 2026-09-16: formulas "do not have the
// same handwritten font type or feeling that much of the other text and even
// charts have"). MathJax gives exact glyph outlines; this module gives each
// one the small imperfections a pen leaves — the same idea as matplotlib's
// xkcd sketch filter on text paths — and nothing else. Pure geometry, no DOM.
//
// Three deformations per glyph, all DETERMINISTIC from a seed (the element id
// and the glyph's index in the formula): a tween frame, a replayed sketch
// beat and a re-layout all land on identical points, so nothing shimmers —
// and a morph's matched pair keeps a fixed node list (layout/math.ts).
//
//  1. a rigid nudge: a rotation of up to ±2° about the glyph's centre and a
//     shift of a few percent of the size — letters that sit a hair off the
//     line, as written ones do;
//  2. a smooth SPATIAL wobble field — a displacement that varies with
//     position, not with the point's index along its ring — so a glyph's
//     counters deform together with its outline and can never cross it;
//  3. nothing on the stroke: the shapes stay filled outlines, drawn exactly
//     (precise areas), so the hand comes from the geometry, never from
//     rough.js's hachure or a stroke that would fatten the stems.
//
// Every amplitude is a fraction of `size` (the formula's font size), so the
// hand scales with the text: the same relative wobble at 20 as at 40.
import type { Pt } from "./model";

/** Rotation bound, radians (about 2°). */
const HAND_ROT = 0.035;
/** Rigid shift bounds as fractions of size: sideways, up/down. */
const HAND_DX = 0.02;
const HAND_DY = 0.03;
/** Wobble field amplitude and wavelength as fractions of size. The strain
 *  (2π·A/λ ≈ 0.15) is what keeps the field a small deformation: a counter
 *  and its outline move almost alike, so the counter stays open. */
const HAND_AMP = 0.03;
const HAND_WAVELENGTH = 1.3;
/** The most any point moves, as a fraction of size (rotation of a glyph
 *  under one em ≈ 0.035 × 0.5, shift 0.03, field 1.5 × 0.03) — tests pin it. */
export const HAND_MAX_SHIFT = 0.12;

/** FNV-1a over the seed string, a 32-bit state for the generator below. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator, uniform on [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HandShape { pts: Pt[]; holes: Pt[][] }

/**
 * One glyph's outline and counters, in canvas coordinates, given a hand.
 * `seed` identifies the glyph (element id + glyph index); `size` is the
 * formula's font size in logical units. Same inputs, same output, always.
 */
export function handShape(shape: HandShape, seed: string, size: number): HandShape {
  const next = rng(hash32(seed));
  const sym = () => next() * 2 - 1;
  // Rigid part: rotate about the outline's box centre, then shift.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of shape.pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rot = sym() * HAND_ROT;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const dx = sym() * HAND_DX * size, dy = sym() * HAND_DY * size;
  // Field part: four phases, one wavelength.
  const k = (2 * Math.PI) / (HAND_WAVELENGTH * size);
  const amp = HAND_AMP * size;
  const p1 = next() * 2 * Math.PI, p2 = next() * 2 * Math.PI, p3 = next() * 2 * Math.PI, p4 = next() * 2 * Math.PI;
  const move = ([x, y]: Pt): Pt => {
    const rx = cx + (x - cx) * cos - (y - cy) * sin + dx;
    const ry = cy + (x - cx) * sin + (y - cy) * cos + dy;
    const fx = amp * (Math.sin(k * rx + p1) + 0.5 * Math.sin(k * ry + p2));
    const fy = amp * (Math.sin(k * ry + p3) + 0.5 * Math.sin(k * rx + p4));
    return [rx + fx, ry + fy];
  };
  return { pts: shape.pts.map(move), holes: shape.holes.map((h) => h.map(move)) };
}
