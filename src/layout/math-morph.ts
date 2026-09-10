// Formula morph (design 2026-09-10-formula-morph §2.3–2.4): which terms of
// one formula are the same terms in another, and what colour a term wears.
import type { MathOutline, MathToken } from "../scenes/engines";

export function normalizeTex(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The deepest entry of a token's latex chain (index 0 = its own) that equals a colour key. */
export function colorFor(chain: string[], colors: Record<string, string> | undefined): string | null {
  if (!colors) return null;
  const keys = new Map(Object.entries(colors).map(([k, v]) => [normalizeTex(k), v]));
  for (const entry of chain) {
    const hit = keys.get(normalizeTex(entry));
    if (hit !== undefined) return hit;
  }
  return null;
}

export interface TokenMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] }

const keyOf = (t: MathToken): string => `${t.node} ${normalizeTex(t.latex)}`;

/** Longest common subsequence over token keys, in reading order; each token matches at most once. */
export function matchTokens(from: MathToken[], to: MathToken[]): TokenMatch {
  const n = from.length, m = to.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = keyOf(from[i]) === keyOf(to[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (keyOf(from[i]) === keyOf(to[j])) { pairs.push([from[i].index, to[j].index]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const pf = new Set(pairs.map((p) => p[0])), pt = new Set(pairs.map((p) => p[1]));
  return { pairs, unmatchedFrom: from.map((t) => t.index).filter((k) => !pf.has(k)), unmatchedTo: to.map((t) => t.index).filter((k) => !pt.has(k)) };
}

export interface ShapeMatch { pairs: [number, number][]; unmatchedFrom: number[]; unmatchedTo: number[] }

/** Token pairs → glyph pairs (in order, the shorter run bounds it) → outline pairs (in order per glyph). */
export function matchShapes(from: { tokens: MathToken[]; outlines: MathOutline[] }, to: { tokens: MathToken[]; outlines: MathOutline[] }): ShapeMatch {
  const outlinesOfGlyph = (side: { outlines: MathOutline[] }, glyph: number): number[] => side.outlines.map((o, i) => (o.glyph === glyph ? i : -1)).filter((i) => i >= 0);
  const pairs: [number, number][] = [];
  for (const [fi, ti] of matchTokens(from.tokens, to.tokens).pairs) {
    const fg = from.tokens[fi].glyphs, tg = to.tokens[ti].glyphs;
    for (let k = 0; k < Math.min(fg.length, tg.length); k++) {
      const fo = outlinesOfGlyph(from, fg[k]), tob = outlinesOfGlyph(to, tg[k]);
      for (let q = 0; q < Math.min(fo.length, tob.length); q++) pairs.push([fo[q], tob[q]]);
    }
  }
  const pf = new Set(pairs.map((p) => p[0])), pt = new Set(pairs.map((p) => p[1]));
  return {
    pairs,
    unmatchedFrom: from.outlines.map((_, i) => i).filter((i) => !pf.has(i)),
    unmatchedTo: to.outlines.map((_, i) => i).filter((i) => !pt.has(i)),
  };
}
