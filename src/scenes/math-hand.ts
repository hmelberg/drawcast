// Formulas in the drawing's own hand: MathJax lays a formula out with Fira
// Math (positions, sizes, fraction bars, radicals, stretchy brackets), and the
// glyphs a hand actually writes — letters, digits, the everyday operators —
// are then drawn with Patrick Hand's outlines, the face every label and
// chart in a drawcast is written in (Hans 2026-09-16: formulas should have
// "the same handwritten font type or feeling that much of the other text and
// even charts have"; a geometric wobble on Fira's glyphs was tried first and
// judged ugly). Greek, relation symbols the face lacks, and anything MathJax
// stretches stay Fira: a mixed page in one hand beats a wrong glyph.
//
// Pure: the mapping from a MathJax glyph (its `data-c` codepoint and its own
// path, in 1000-units-per-em, y-up font coordinates) to Patrick Hand's rings
// in the SAME local space, fitted so the swapped glyph sits where Fira's did —
// baseline kept, ink centred on Fira's ink, scaled so the x-heights agree,
// and never past Fira's ink sideways or vertically (a hand's letters are
// narrower, its capitals and digits a little taller — a squeeze of a few
// percent, only when needed, keeps a superscript inside MathJax's box).
import { sampleSvgPath } from "./svgpath";
import glyphData from "./mathjax-fonts/patrickhand.json";

type Ring = [number, number][];

interface HandFont { upm: number; x_height: number; cap_height: number; glyphs: Record<string, { d: string; adv: number }> }
const FONT = glyphData as HandFont;

/** Fira Math's x-height in 1000-per-em units (its MathJax params.x_height). */
const FIRA_X_HEIGHT = 527;
/** Uniform scale that puts Patrick Hand's x-height on Fira's. */
export const HAND_SCALE = FIRA_X_HEIGHT / FONT.x_height;

/**
 * The character Patrick Hand should write for a MathJax glyph codepoint, or
 * null to keep Fira's glyph. MathJax writes a variable with the Mathematical
 * Alphanumeric codepoint of its variant (italic x is U+1D465), so those
 * blocks map back to the letter; a hand has one style, so bold and italic
 * collapse onto it.
 */
export function handCharFor(codepoint: number): string | null {
  const cp = codepoint;
  if (cp >= 0x21 && cp <= 0x7e) return String.fromCodePoint(cp);
  // Mathematical Alphanumeric Symbols: bold, italic, bold italic — 52 letters each, A–Z then a–z.
  for (const base of [0x1d400, 0x1d434, 0x1d468]) {
    if (cp >= base && cp < base + 52) {
      const i = cp - base;
      return String.fromCodePoint(i < 26 ? 0x41 + i : 0x61 + (i - 26));
    }
  }
  if (cp === 0x210e) return "h"; // Planck constant: the italic h's codepoint
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String.fromCodePoint(0x30 + ((cp - 0x1d7ce) % 10)); // bold/sans/mono digits
  switch (cp) {
    case 0x2212: return "−";
    case 0x2223: return "|";  // \mid
    case 0x22c5: return "·";  // \cdot
    case 0x00b7: return "·";
    case 0x00d7: return "×";
    case 0x00f7: return "÷";
    case 0x00b1: return "±";
    case 0x00b0: return "°";
    case 0x2032: return "'";  // prime
    default: return null;
  }
}

interface HandGlyph { rings: Ring[]; x0: number; x1: number; y0: number; y1: number }
const cache = new Map<string, HandGlyph | null>();

/** Patrick Hand's rings for `ch`, scaled to Fira's x-height, memoised. */
function handGlyph(ch: string): HandGlyph | null {
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const g = FONT.glyphs[ch];
  let out: HandGlyph | null = null;
  if (g) {
    const rings = sampleSvgPath(g.d).map((r) => r.map(([x, y]) => [x * HAND_SCALE, y * HAND_SCALE] as [number, number]));
    if (rings.length > 0) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      out = { rings, x0, x1, y0, y1 };
    }
  }
  cache.set(ch, out);
  return out;
}

/**
 * The hand's rings for one MathJax glyph, in the glyph's own local space, or
 * null when the glyph keeps Fira's outline. `firaRings` is Fira's sampled
 * path (local space), which gives the slot the swap must fit.
 */
export function handRingsFor(codepoint: number, firaRings: Ring[]): Ring[] | null {
  const ch = handCharFor(codepoint);
  if (ch === null || firaRings.length === 0) return null;
  const g = handGlyph(ch);
  if (g === null) return null;
  let f0 = Infinity, f1 = -Infinity, fy0 = Infinity, fy1 = -Infinity;
  for (const r of firaRings) for (const [x, y] of r) { if (x < f0) f0 = x; if (x > f1) f1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
  const fw = f1 - f0, hw = g.x1 - g.x0;
  // Never wider than Fira's ink: squeeze sideways only when the hand's
  // letter would spill into its neighbour.
  const sx = hw > fw && hw > 0 ? fw / hw : 1;
  const dx = (f0 + f1) / 2 - ((g.x0 + g.x1) / 2) * sx;
  // Never past Fira's ink above or below the baseline either: a hand's
  // capitals and digits stand a little taller, and a superscript that rose
  // past the typeset box would be clipped by nothing but look misplaced.
  // (Fira ink that sits ON the baseline gives nothing to fit a hand's
  // slight undershoot to — a rounded bottom dips a hair under the line, and
  // that is a hand — so the bottom rule applies only where Fira descends.)
  let sy = 1;
  if (g.y1 > fy1 && fy1 > 0) sy = Math.min(sy, fy1 / g.y1);
  if (g.y0 < fy0 && fy0 < 0) sy = Math.min(sy, fy0 / g.y0);
  return g.rings.map((r) => r.map(([x, y]) => [x * sx + dx, y * sy] as [number, number]));
}
