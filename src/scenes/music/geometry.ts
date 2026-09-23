// Music symbols as geometry (design 2026-09-24-music-notation-and-staff §4.2):
// SMuFL glyph outlines, placed and scaled, and notes assembled from a head,
// a stem that starts EXACTLY at the font's stem anchor, and a flag hung from
// the stem's end. Pure: no drawables, no styles — the `music` element
// (layout/tier2.ts) and note_sheet (scenes/packs/music.yaml) turn these rings
// and segments into their own drawables. Everything here is y-up logical
// units; the glyph data (scenes/music/glyphs.json) is y-up staff spaces.

import { sampleSvgPath } from "../svgpath";

type Pt = [number, number];

export interface GlyphData {
  d: string;
  /** [x0, y0, x1, y1] in staff spaces, the glyph's own origin at 0,0. */
  bbox?: [number, number, number, number];
  /** SMuFL anchors in staff spaces (stemUpSE, stemDownNW, stemUpNW, …). */
  anchors?: Record<string, [number, number]>;
}

export interface GlyphSet {
  engravingDefaults: { stemThickness: number; staffLineThickness: number; legerLineThickness: number; legerLineExtension: number; thinBarlineThickness: number };
  glyphs: Record<string, GlyphData>;
}

/** One filled shape: the first ring is the outline, the rest are drawn
 *  even-odd with it — counters and separate pieces alike come out right. */
export interface GlyphShape {
  pts: Pt[];
  holes?: Pt[][];
}

/** A note as geometry: filled shapes (head, flag, dots) and the stem as a pen line. */
export interface NoteGeometry {
  head: GlyphShape;
  stem: { from: Pt; to: Pt; width: number } | null;
  flag: GlyphShape | null;
  dots: GlyphShape[];
  /** The head's centre — where the note "is" (its anchor). */
  center: Pt;
  box: { x: number; y: number; w: number; h: number };
}

export type NoteValue = "whole" | "half" | "quarter" | "eighth" | "sixteenth";

/** A stem's length from the head, in staff spaces — the engraver's octave. */
export const STEM_LENGTH = 3.5;

const HEAD: Record<NoteValue, string> = { whole: "noteheadWhole", half: "noteheadHalf", quarter: "noteheadBlack", eighth: "noteheadBlack", sixteenth: "noteheadBlack" };
const FLAG: Partial<Record<NoteValue, string>> = { eighth: "flag8th", sixteenth: "flag16th" };

export function musicGeometry(set: GlyphSet) {
  // Sampled once per glyph, in staff spaces; placing is then a scale and a shift.
  const cache = new Map<string, Pt[][]>();
  const ringsOf = (name: string): Pt[][] => {
    let r = cache.get(name);
    if (!r) {
      const g = set.glyphs[name];
      if (!g) throw new Error(`music: no glyph "${name}"`);
      r = sampleSvgPath(g.d, 6) as Pt[][];
      cache.set(name, r);
    }
    return r;
  };
  const has = (name: string): boolean => name in set.glyphs;
  const bboxOf = (name: string): [number, number, number, number] => {
    const g = set.glyphs[name];
    if (g?.bbox) return g.bbox;
    // No metadata box: measure the outline.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const ring of ringsOf(name)) for (const [x, y] of ring) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1];
  };
  const anchorOf = (name: string, key: string): Pt | null => set.glyphs[name]?.anchors?.[key] ?? null;

  /** A glyph with its ORIGIN at `origin`, one staff space = `sp` units. */
  const glyphAt = (name: string, origin: Pt, sp: number): GlyphShape => {
    const rings = ringsOf(name).map((ring) => ring.map(([x, y]): Pt => [origin[0] + x * sp, origin[1] + y * sp]));
    return rings.length > 1 ? { pts: rings[0], holes: rings.slice(1) } : { pts: rings[0] };
  };

  /** A glyph with the CENTRE of its box at `center`. */
  const glyphCentered = (name: string, center: Pt, sp: number): GlyphShape => {
    const [x0, y0, x1, y1] = bboxOf(name);
    return glyphAt(name, [center[0] - ((x0 + x1) / 2) * sp, center[1] - ((y0 + y1) / 2) * sp], sp);
  };

  /**
   * A note with its head centred on `center`. The stem starts at the head's
   * SMuFL stem anchor — the point the font says a stem meets THIS head — and
   * a flag hangs from its far end, the stem stopping at the flag's own anchor.
   * `stemLength` in staff spaces (default the engraver's 3.5); `dots` 0–2.
   */
  const note = (value: NoteValue, center: Pt, sp: number, o: { stem?: "up" | "down"; dots?: number; stemLength?: number } = {}): NoteGeometry => {
    const headName = HEAD[value];
    const [hx0, hy0, hx1, hy1] = bboxOf(headName);
    const origin: Pt = [center[0] - ((hx0 + hx1) / 2) * sp, center[1] - ((hy0 + hy1) / 2) * sp];
    const head = glyphAt(headName, origin, sp);
    const up = (o.stem ?? "up") === "up";
    const thick = set.engravingDefaults.stemThickness * sp;
    let stem: NoteGeometry["stem"] = null;
    let flag: GlyphShape | null = null;
    if (value !== "whole") {
      const a = anchorOf(headName, up ? "stemUpSE" : "stemDownNW") ?? (up ? [hx1, 0] : [hx0, 0]);
      // The anchor is the stem's outer corner (right edge going up, left
      // going down); a pen line is drawn on its centre line.
      const x = origin[0] + a[0] * sp + (up ? -thick / 2 : thick / 2);
      const y0 = origin[1] + a[1] * sp;
      let y1 = center[1] + (up ? 1 : -1) * (o.stemLength ?? STEM_LENGTH) * sp;
      const flagBase = FLAG[value];
      if (flagBase) {
        const flagName = `${flagBase}${up ? "Up" : "Down"}`;
        // The flag's origin sits at the stem's end, on the stem's left edge;
        // its own anchor says where the stem must reach to meet it.
        const fOrigin: Pt = [x - thick / 2, y1];
        flag = glyphAt(flagName, fOrigin, sp);
        const fa = anchorOf(flagName, up ? "stemUpNW" : "stemDownSW");
        if (fa) y1 = fOrigin[1] + fa[1] * sp;
      }
      stem = { from: [x, y0], to: [x, y1], width: thick };
    }
    const dots: GlyphShape[] = [];
    for (let k = 0; k < Math.min(2, o.dots ?? 0); k++) {
      dots.push(glyphCentered("augmentationDot", [origin[0] + hx1 * sp + (0.5 + k * 0.6) * sp, center[1]], sp));
    }
    // The note's box: head, stem and flag together.
    const pts: Pt[] = [...head.pts, ...(flag ? flag.pts : []), ...(stem ? [stem.from, stem.to] : []), ...dots.flatMap((d) => d.pts)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    return { head, stem, flag, dots, center, box };
  };

  /** The notehead glyph a note value uses. */
  const headOf = (value: NoteValue): string => HEAD[value];

  /** The note value a length in beats is written as, and its dots (1.5× = one dot). */
  const valueOf = (beats: number): { value: NoteValue; dots: number } => {
    const plain: [number, NoteValue][] = [[4, "whole"], [2, "half"], [1, "quarter"], [0.5, "eighth"], [0.25, "sixteenth"]];
    for (const [b, v] of plain) if (Math.abs(beats - b) < 1e-6) return { value: v, dots: 0 };
    for (const [b, v] of plain) if (Math.abs(beats - b * 1.5) < 1e-6) return { value: v, dots: 1 };
    for (const [b, v] of plain) if (Math.abs(beats - b * 1.75) < 1e-6) return { value: v, dots: 2 };
    // A length the letters cannot spell (a triplet): the nearest value below it.
    for (const [b, v] of plain) if (beats >= b) return { value: v, dots: 0 };
    return { value: "sixteenth", dots: 0 };
  };

  /** The rest glyph for a note value. */
  const restOf = (value: NoteValue): string =>
    ({ whole: "restWhole", half: "restHalf", quarter: "restQuarter", eighth: "rest8th", sixteenth: "rest16th" })[value];

  return { has, bboxOf, anchorOf, glyphAt, glyphCentered, note, headOf, valueOf, restOf, defaults: set.engravingDefaults };
}

export type MusicGeometry = ReturnType<typeof musicGeometry>;
