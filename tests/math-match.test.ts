import { describe, expect, test } from "vitest";
import { colorFor, matchShapes, matchTokens, normalizeTex } from "../src/layout/math-morph";
import { ensureEngines, getLoadedEngines, type MathJaxEngine, type MathToken } from "../src/scenes/engines";

async function mathjax(): Promise<MathJaxEngine> {
  await ensureEngines(["mathjax"]);
  return getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
}
const tok = (node: string, latex: string, i: number): MathToken => ({ index: i, node, latex, chain: [latex], glyphs: [i] });

describe("matchTokens", () => {
  test("2x + 3 = 11 → 2x = 8 keeps 2, x, = and drops +, 3, 11; 8 is new", () => {
    const from = [tok("mn", "2", 0), tok("mi", "x", 1), tok("mo", "+", 2), tok("mn", "3", 3), tok("mo", "=", 4), tok("mn", "11", 5)];
    const to = [tok("mn", "2", 0), tok("mi", "x", 1), tok("mo", "=", 2), tok("mn", "8", 3)];
    const m = matchTokens(from, to);
    expect(m.pairs).toEqual([[0, 0], [1, 1], [4, 2]]);
    expect(m.unmatchedFrom).toEqual([2, 3, 5]);
    expect(m.unmatchedTo).toEqual([3]);
  });
  test("a repeated x matches in order; node kind matters (mn:2 never matches mi:2)", () => {
    const from = [tok("mi", "x", 0), tok("mo", "+", 1), tok("mi", "x", 2)];
    const to = [tok("mi", "x", 0), tok("mo", "-", 1), tok("mi", "x", 2)];
    expect(matchTokens(from, to).pairs).toEqual([[0, 0], [2, 2]]);
    expect(matchTokens([tok("mn", "2", 0)], [tok("mi", "2", 0)]).pairs).toEqual([]);
  });
  test("normalizeTex collapses whitespace; colorFor picks the deepest matching chain entry", () => {
    expect(normalizeTex(" \\Delta  C ")).toBe("\\Delta C");
    const colors = { "\\Delta C": "#b5482e", "\\frac{\\Delta C}{\\Delta E}": "#000" };
    expect(colorFor(["C", "\\Delta C", "\\frac{\\Delta C}{\\Delta E}", "ICER = \\frac{\\Delta C}{\\Delta E}"], colors)).toBe("#b5482e");
    expect(colorFor(["E", "\\Delta  E", "\\frac{\\Delta C}{\\Delta E}"], colors)).toBe("#000");
    expect(colorFor(["x"], colors)).toBeNull();
    expect(colorFor(["x"], undefined)).toBeNull();
  });
});

describe("matchShapes on real engine output", () => {
  test("2x + 3 = 11 → 2x = 8: the = glyph's two bars pair, 11's two glyphs are unmatched", async () => {
    const mj = await mathjax();
    const a = mj.layoutTeX("2x + 3 = 11", { display: false });
    const b = mj.layoutTeX("2x = 8", { display: false });
    const m = matchShapes(a, b);
    const eqA = a.outlines.map((o, i) => (o.token.latex === "=" ? i : -1)).filter((i) => i >= 0);
    const eqB = b.outlines.map((o, i) => (o.token.latex === "=" ? i : -1)).filter((i) => i >= 0);
    expect(eqA).toHaveLength(2);
    expect(m.pairs).toEqual(expect.arrayContaining([[eqA[0], eqB[0]], [eqA[1], eqB[1]]]));
    const eleven = a.outlines.map((o, i) => (o.token.latex === "11" ? i : -1)).filter((i) => i >= 0);
    expect(eleven).toHaveLength(2);
    for (const i of eleven) expect(m.unmatchedFrom).toContain(i);
    expect(m.pairs.length + m.unmatchedFrom.length).toBe(a.outlines.length);
    expect(m.pairs.length + m.unmatchedTo.length).toBe(b.outlines.length);
  });
});
