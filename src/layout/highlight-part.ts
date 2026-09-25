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
  let glyphs = leaves.filter((l) => l.kind === "area" && l.tex?.some((t) => termTex(t) === want)).map((l) => l.id);
  // No single node spells it: try a run of SIBLING nodes — `bx` in `y = bx - 1`,
  // `P(A)` in `P(B\mid A)\,P(A)`, `9\times10^{13}` — which is how a person
  // (or an LLM) names a term, and which MathJax never groups (2026-09-25).
  if (glyphs.length === 0) glyphs = siblingRuns(leaves, part);
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

/** A term's TeX as a run is compared: termTex, less the spacing commands
 *  (`\,` `\;` `\!` `\quad`), which draw no glyph and so never appear
 *  between the siblings a run is built from. */
function runTex(tex: string): string {
  return termTex(tex).replace(/\\(?:qquad|quad|[,;:! ])/g, "").replace(/\s+/g, "");
}

/**
 * Every run of consecutive glyphs whose nodes, children of one parent, spell
 * `part` end to end. A glyph's chain runs from its own token up to the root,
 * so at depth d its node is chain[d] and its parent is everything above; a
 * run grows while the next glyph shares that parent, adding a node each time
 * the child changes (the two glyphs of `=` or of `10` are one node). Runs of
 * one node are the ordinary match and are not repeated here.
 */
function siblingRuns(leaves: readonly Leaf[], part: string): string[] {
  const want = runTex(part);
  if (want === "") return [];
  const glyphs = leaves.filter((l): l is Extract<Leaf, { kind: "area" }> => l.kind === "area" && Array.isArray(l.tex) && l.tex.length > 0);
  const found = new Set<string>();
  const nodeAt = (chain: string[], parentLen: number): string | null => (chain.length > parentLen ? chain[chain.length - parentLen - 1] : null);
  const sameParent = (chain: string[], parent: string[]): boolean => chain.length > parent.length && parent.every((t, k) => chain[chain.length - parent.length + k] === t);
  for (let i = 0; i < glyphs.length; i++) {
    const chain = glyphs[i].tex!;
    for (let d = 0; d < chain.length - 1; d++) {
      const parent = chain.slice(d + 1);
      let spelled = "";
      let prev: string | null = null;
      let nodes = 0;
      const run: string[] = [];
      for (let j = i; j < glyphs.length; j++) {
        const cj = glyphs[j].tex!;
        if (!sameParent(cj, parent)) break;
        const node = nodeAt(cj, parent.length)!;
        if (node !== prev) {
          spelled += runTex(node);
          nodes++;
          prev = node;
          if (!want.startsWith(spelled)) break;
        }
        run.push(glyphs[j].id);
        if (spelled === want && nodes >= 2) {
          // Take the rest of this node's glyphs too (`10` is two).
          for (let k = j + 1; k < glyphs.length && sameParent(glyphs[k].tex!, parent) && nodeAt(glyphs[k].tex!, parent.length) === node; k++) run.push(glyphs[k].id);
          for (const id of run) found.add(id);
          break;
        }
      }
    }
  }
  return glyphs.map((g) => g.id).filter((id) => found.has(id));
}

/** The character offset of (row, col) in the leaf's rows read end to end —
 *  the order the renderer's text holders spell them in. */
export function rowOffset(rows: readonly string[], row: number, col: number): number {
  let at = 0;
  for (let r = 0; r < row; r++) at += rows[r].length;
  return at + col;
}
