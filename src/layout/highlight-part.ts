// `highlight.part`: which PIECE of a target a highlight means — one symbol or
// one term of a formula, a phrase in a label or a line of code (Hans,
// 2026-09-24: "Sometimes, in an equation, it could be one character, or the
// whole equations, or a line, or part of a line").
//
// Pure and DOM-free, so the renderer (which paints the piece) and lint (which
// reports a part that matches nothing) answer the question the same way.
//
// A formula's glyphs carry their TeX token chain (AreaDrawable.tex, set by
// layout/math.ts), and a part names a glyph when ANY entry of its chain is
// that TeX — the same comparison `math.colors` uses (termTex: braces round
// the whole term do not count), so
// `"t_r"` lights both glyphs of tᵣ and `"\\dfrac{v^2}{2a}"` the whole
// fraction. Every occurrence, as with colours. Text is plain verbatim: the
// first occurrence on the DRAWN rows, as with a code element's `marks`.

import { termTex } from "./math-morph";
import type { Drawable } from "./model";

type Leaf = Exclude<Drawable, { kind: "group" }>;

export type PartHit =
  /** Formula glyphs whose chain names the part. */
  | { kind: "glyphs"; leafIds: string[] }
  /** A run of characters on one drawn row of a text leaf. */
  | { kind: "text"; leafId: string; row: number; col: number; len: number };

/** The drawn rows of a text leaf — its wrapped lines, or its one line. */
export function textRows(leaf: Extract<Drawable, { kind: "text" }>): string[] {
  return leaf.lines ?? [leaf.text];
}

/**
 * Where `part` lies among a target's leaves: the glyphs it names, and the
 * first occurrence in each text leaf. Empty when it names nothing — the
 * caller then emphasises the whole target (and lint says why).
 */
export function findPart(leaves: readonly Leaf[], part: string): PartHit[] {
  if (part.trim() === "") return [];
  const hits: PartHit[] = [];
  const want = termTex(part);
  const glyphs = leaves.filter((l) => l.kind === "area" && l.tex?.some((t) => termTex(t) === want)).map((l) => l.id);
  if (glyphs.length > 0) hits.push({ kind: "glyphs", leafIds: glyphs });
  for (const leaf of leaves) {
    if (leaf.kind !== "text") continue;
    const rows = textRows(leaf);
    for (let r = 0; r < rows.length; r++) {
      const col = rows[r].indexOf(part);
      if (col >= 0) {
        hits.push({ kind: "text", leafId: leaf.id, row: r, col, len: part.length });
        break;
      }
    }
  }
  return hits;
}

/** The character offset of (row, col) in the leaf's rows read end to end —
 *  the order the renderer's text holders spell them in. */
export function rowOffset(rows: readonly string[], row: number, col: number): number {
  let at = 0;
  for (let r = 0; r < row; r++) at += rows[r].length;
  return at + col;
}
