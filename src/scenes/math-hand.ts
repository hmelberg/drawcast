// Formulas in the drawing's own hand: MathJax lays a formula out with Fira
// Math (positions, sizes, fraction bars, radicals, stretchy brackets), and the
// glyphs a hand actually writes are then drawn with a handwriting face's
// outlines in Fira's slots (Hans 2026-09-16: formulas should have "the same
// handwritten font type or feeling that much of the other text and even
// charts have"; a geometric wobble on Fira's glyphs was tried first and
// judged ugly). Two faces:
//
//  - Patrick Hand, the face every label and chart is written in: Latin
//    letters, digits, punctuation, the math symbols it has (≤ ≥ ≠ ≈ ∞ ± × ÷
//    ∑ ∫ · −) and its four Greek letters (λ μ π Ω) — preferred wherever it
//    has the glyph, so a formula matches the label beside it.
//  - Playpen Sans at weight 400 for the rest of Greek — of the four
//    handwriting faces with a Greek set, Playpen at 400 is the one whose
//    stroke weight and upright, rounded forms sit beside Patrick Hand as one
//    hand (surveyed 2026-09-16, scripts/build-patrickhand-glyphs.py).
//
// Anything MathJax STRETCHES — a delimiter grown to a tall fraction, a
// radical, a big operator in display size — keeps Fira: the slot is far
// taller than the hand's glyph, and a small glyph parked at the bottom of a
// tall slot is worse than a printed bracket (the guard is on the slot's
// height, so it needs no knowledge of which glyphs stretch).
//
// Pure: the mapping from a MathJax glyph (its `data-c` codepoint and its own
// path, in 1000-units-per-em, y-up font coordinates) to the hand's rings in
// the SAME local space, fitted so the swapped glyph sits where Fira's did —
// baseline kept, ink centred on Fira's ink, scaled so the x-heights agree,
// and never past Fira's ink sideways or vertically (a hand's letters are
// narrower, its capitals and digits a little taller — a squeeze of a few
// percent, only when needed, keeps a superscript inside MathJax's box).
import { sampleSvgPath } from "./svgpath";
import latinData from "./mathjax-fonts/patrickhand.json";
import greekData from "./mathjax-fonts/playpen-greek.json";

type Ring = [number, number][];

interface HandFont { upm: number; x_height: number; cap_height: number; glyphs: Record<string, { d: string; adv: number }> }
const LATIN = latinData as HandFont;
const GREEK = greekData as HandFont;

/** Fira Math's x-height in 1000-per-em units (its MathJax params.x_height). */
const FIRA_X_HEIGHT = 527;
/** Uniform scale that puts a face's x-height on Fira's. */
export const HAND_SCALE = FIRA_X_HEIGHT / LATIN.x_height;
export const GREEK_SCALE = FIRA_X_HEIGHT / GREEK.x_height;
/** A slot taller than this many times the hand's glyph is a stretched
 *  glyph (delimiter, radical, display-size operator) — kept in Fira. */
export const STRETCH_RATIO = 1.3;

const GREEK_CAPS = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ";
const GREEK_SMALL = "αβγδεζηθικλμνξοπρςστυφχψω";
/** The tail of each Mathematical Greek block after ∇: ∂ and the six variant forms. */
const GREEK_TAIL = "∂ϵϑϰϕϱϖ";
/** Where the five styled Greek blocks start (bold, italic, bold italic, sans bold, sans bold italic): 58 codepoints each. */
const GREEK_BLOCKS = [0x1d6a8, 0x1d6e2, 0x1d71c, 0x1d756, 0x1d790];
/** Forms the Greek face lacks, written as the plain letter — which is what a hand writes for them. */
const GREEK_FALLBACK: Record<string, string> = { "ϵ": "ε", "ϕ": "φ", "ϱ": "ρ", "ϰ": "κ", "ϴ": "Θ" };

/**
 * The character the hand should write for a MathJax glyph codepoint, or
 * null to keep Fira's glyph. MathJax writes a variable with the Mathematical
 * Alphanumeric codepoint of its variant (italic x is U+1D465, italic α is
 * U+1D6FC), so those blocks map back to the letter; a hand has one style,
 * so bold and italic collapse onto it.
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
  // Greek: the plain block (upright capitals, as MathJax writes \Gamma)…
  if (cp >= 0x391 && cp <= 0x3c9 && cp !== 0x3a2) return greekOrFallback(String.fromCodePoint(cp));
  if (cp === 0x3f5 || cp === 0x3d1 || cp === 0x3f0 || cp === 0x3d5 || cp === 0x3f1 || cp === 0x3d6) return greekOrFallback(String.fromCodePoint(cp));
  // …and the five styled blocks: 25 capitals (with ϴ), ∇, 25 small (with ς), ∂ and six variants.
  for (const base of GREEK_BLOCKS) {
    if (cp >= base && cp < base + 58) {
      const i = cp - base;
      if (i < 25) return greekOrFallback(GREEK_CAPS[i]);
      if (i === 25) return null; // ∇
      if (i < 51) return greekOrFallback(GREEK_SMALL[i - 26]);
      return greekOrFallback(GREEK_TAIL[i - 51]);
    }
  }
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
    case 0x2202: return "∂";
    case 0x2264: return "≤";
    case 0x2265: return "≥";
    case 0x2260: return "≠";
    case 0x2248: return "≈";
    case 0x221e: return "∞";
    case 0x2211: return "∑";
    case 0x222b: return "∫";
    default: return null;
  }
}

function greekOrFallback(ch: string): string | null {
  if (faceFor(ch) !== null) return ch;
  const alt = GREEK_FALLBACK[ch];
  return alt !== undefined && faceFor(alt) !== null ? alt : null;
}

interface HandGlyph { rings: Ring[]; x0: number; x1: number; y0: number; y1: number }
const cache = new Map<string, HandGlyph | null>();

/** The face that writes `ch`, if any: Patrick Hand whenever it has the glyph, else Playpen (Greek). */
function faceFor(ch: string): { font: HandFont; scale: number } | null {
  if (LATIN.glyphs[ch]) return { font: LATIN, scale: HAND_SCALE };
  if (GREEK.glyphs[ch]) return { font: GREEK, scale: GREEK_SCALE };
  return null;
}
/** Which face writes `ch` — for tests and the curious. */
export function handFaceFor(ch: string): "patrickhand" | "playpen" | null {
  const f = faceFor(ch);
  return f === null ? null : f.font === LATIN ? "patrickhand" : "playpen";
}

/** The hand's rings for `ch`, scaled to Fira's x-height, memoised. */
function handGlyph(ch: string): HandGlyph | null {
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const face = faceFor(ch);
  let out: HandGlyph | null = null;
  if (face) {
    const g = face.font.glyphs[ch];
    const rings = sampleSvgPath(g.d).map((r) => r.map(([x, y]) => [x * face.scale, y * face.scale] as [number, number]));
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
  // A stretched glyph — the slot is far taller than the hand's own glyph.
  if (fy1 - fy0 > STRETCH_RATIO * (g.y1 - g.y0)) return null;
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
  //
  // Above and below the baseline are fitted APART. One factor for the whole
  // glyph shrank a p or g's bowl along with its tail — the hand's descender
  // is deeper than Fira's, so the squash pulled the bowl under the x-height
  // and the letter read as a subscript (Hans, 2026-09-26: "P(spam) — the p
  // is a bit strange … letters that go downwards, like p and g"). Now the
  // tail alone is shortened and the bowl keeps the x-height.
  const up = g.y1 > fy1 && fy1 > 0 ? fy1 / g.y1 : 1;
  const down = g.y0 < fy0 && fy0 < 0 ? fy0 / g.y0 : 1;
  return g.rings.map((r) => r.map(([x, y]) => [x * sx + dx, y * (y >= 0 ? up : down)] as [number, number]));
}
