import { describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine, setMathFont, ensureMathFont } from "../src/scenes/engines";
import { sampleSvgPath } from "../src/scenes/svgpath";

type Pt = [number, number];

const box = (pts: Pt[]) => ({
  x0: Math.min(...pts.map((p) => p[0])),
  x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  y1: Math.max(...pts.map((p) => p[1])),
});
const finite = (pts: Pt[]) => pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
const allPts = (outlines: { pts: Pt[] }[]) => outlines.flatMap((o) => o.pts);

async function mathjax(): Promise<MathJaxEngine> {
  await ensureEngines(["mathjax"]);
  return getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
}

describe("svg path sampler", () => {
  test("flattens a line + cubic subpath into one finite ring", () => {
    const subpaths = sampleSvgPath("M0 0 L10 0 C10 10 0 10 0 0 Z");
    expect(subpaths).toHaveLength(1);
    const pts = subpaths[0];
    expect(pts.length).toBeGreaterThan(6);
    expect(finite(pts)).toBe(true);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts).toContainEqual([10, 0]);
    // Rings carry no duplicated closing point (kit.polygon's convention) —
    // the cubic lands back on the start, which is dropped.
    expect(pts[pts.length - 1]).not.toEqual(pts[0]);
    // Cubic midpoint (t = 0.5) of (10,0)→(10,10)→(0,10)→(0,0) is exactly (5, 7.5).
    const mid = pts.find((p) => Math.abs(p[0] - 5) < 1e-9);
    expect(mid).toBeDefined();
    expect(mid![1]).toBeCloseTo(7.5, 9);
  });

  test("handles H/V/Q/T/S and relative commands, and starts a ring per M", () => {
    const subpaths = sampleSvgPath("M0 0 H10 V10 Z M20 0 q5 10 10 0 t10 0 Z");
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0]).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(box(subpaths[1]).x1).toBeCloseTo(40, 9);
    expect(box(subpaths[1]).y1).toBeCloseTo(5, 6);   // quadratic apex
    expect(finite(subpaths[1])).toBe(true);
    const smooth = sampleSvgPath("M0 0 C0 5 5 5 5 0 S10 -5 10 0");
    expect(smooth).toHaveLength(1);
    expect(box(smooth[0]).y0).toBeLessThan(0);       // the S mirrors the bulge downward
  });

  test("arcs are sampled (Task 12: Iconify SVGs use A/a)", () => {
    const [ring] = sampleSvgPath("M0 0 A5 5 0 0 1 10 0 Z", 8);
    expect(ring.length).toBeGreaterThan(2);
    expect(ring.every(([, y]) => y <= 0.001)).toBe(true); // sweep=1 arcs below the chord
  });

  test("malformed data is refused, never looped on", () => {
    expect(() => sampleSvgPath("M0 0 L10 0 Z 5 5")).toThrow(/malformed/i);
    expect(() => sampleSvgPath("5 5 L10 0")).toThrow(/malformed/i);
    expect(() => sampleSvgPath("M0 0 L10")).toThrow(/malformed/i);
    expect(sampleSvgPath("")).toEqual([]);
  });
});

describe("mathjax engine (real load — node, no DOM)", () => {
  test("layoutTeX('x^2 + 1') returns finite outlines in a positive box", async () => {
    const eng = await mathjax();
    const { outlines, w, h } = eng.layoutTeX("x^2 + 1");
    expect(outlines.length).toBeGreaterThanOrEqual(4);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    for (const o of outlines) {
      expect(o.pts.length).toBeGreaterThanOrEqual(3);
      expect(finite(o.pts)).toBe(true);
    }
    // Everything sits inside the reported box, origin at the left baseline.
    const b = box(allPts(outlines));
    expect(b.x0).toBeGreaterThanOrEqual(-1e-6);
    expect(b.x1).toBeLessThanOrEqual(w + 1e-6);
    expect(b.y1 - b.y0).toBeLessThanOrEqual(h + 1e-6);
  });

  test("the engine loads once — a second ensure is cached and free", async () => {
    const first = await mathjax();
    const t0 = performance.now();
    const second = await mathjax();
    expect(performance.now() - t0).toBeLessThan(100);
    expect(second).toBe(first);
  });

  test("an inline expression is ONE piece: MathJax 4's inline line-breaking is off (a+b would lose +b)", async () => {
    const eng = await mathjax();
    // With linebreaks.inline on, 4.x emits "a" in one <svg> and "+b" in a
    // second; layoutTeX reads the first and silently drops the rest.
    expect(eng.layoutTeX("a+b").outlines.length).toBe(3);
    expect(eng.layoutTeX("x^2 + 1").outlines.length).toBe(4);
  });

  test("fonts: Fira is the default, TeX loads on demand, and the two really are different glyphs", async () => {
    const eng = await mathjax();
    expect(eng.fontFor("fira")).toBe("fira");
    await eng.ensureFont("tex");
    expect(eng.fontFor("tex")).toBe("tex");
    const fira = eng.layoutTeX("x^2 + 1", { font: "fira" });
    const tex = eng.layoutTeX("x^2 + 1", { font: "tex" });
    expect(fira.outlines.length).toBe(4);
    expect(tex.outlines.length).toBe(4);
    // Same x-height by construction (h ≈ 1 for an x row), different widths: two fonts, not one twice.
    expect(Math.abs(fira.w - tex.w)).toBeGreaterThan(0.05);
    // No font named: the module-level current font (what layoutSpec sets) decides.
    setMathFont("tex");
    expect(JSON.stringify(eng.layoutTeX("x^2 + 1"))).toBe(JSON.stringify(tex));
    setMathFont("fira");
    expect(JSON.stringify(eng.layoutTeX("x^2 + 1"))).toBe(JSON.stringify(fira));
    // ensureMathFont from outside the engine is the same thing, and idempotent.
    await ensureMathFont("tex");
    expect(eng.fontFor("tex")).toBe("tex");
  });

  test("layoutTeX('E = mc^2') covers every glyph", async () => {
    const eng = await mathjax();
    const { outlines } = eng.layoutTeX("E = mc^2");
    expect(outlines.length).toBeGreaterThanOrEqual(5);
    expect(finite(allPts(outlines))).toBe(true);
  });

  test("y is up: the superscript of x^2 sits above the baseline glyph", async () => {
    const eng = await mathjax();
    const { outlines, w } = eng.layoutTeX("x^2");
    expect(outlines).toHaveLength(2);
    const [base, sup] = [...outlines].sort((a, b) => box(a.pts).x0 - box(b.pts).x0).map((o) => box(o.pts));
    expect(sup.x0).toBeGreaterThan(base.x1);         // the "2" trails the "x"
    expect(sup.y1).toBeGreaterThan(base.y1);         // ... and rides above it: y is up
    expect(sup.y0).toBeGreaterThan(0);               // the superscript never dips to the baseline
    expect(base.y0).toBeCloseTo(0, 1);               // the "x" sits on it
    expect(sup.x1).toBeLessThanOrEqual(w);
  });

  test("height is on an x-height unit scale", async () => {
    const eng = await mathjax();
    const { outlines, h } = eng.layoutTeX("x");
    expect(h).toBeGreaterThan(0.9);
    expect(h).toBeLessThan(1.15);
    expect(box(allPts(outlines)).y1).toBeCloseTo(1, 1);
  });

  test("a fraction bar comes back as a 4-point rectangle above the baseline", async () => {
    const eng = await mathjax();
    const { outlines, w } = eng.layoutTeX("\\frac{a}{b}");
    const rects = outlines.filter((o) => o.pts.length === 4 && box(o.pts).x1 - box(o.pts).x0 > w / 2);
    expect(rects).toHaveLength(1);
    const b = box(rects[0].pts);
    expect(b.y0).toBeGreaterThan(0);                 // the bar rides above the baseline
    expect(b.y1 - b.y0).toBeGreaterThan(0);
    expect(b.y1 - b.y0).toBeLessThan(0.3);           // and is a thin rule
    // 4 corners, axis-aligned: two distinct x values and two distinct y values.
    expect(new Set(rects[0].pts.map((p) => p[0])).size).toBe(2);
    expect(new Set(rects[0].pts.map((p) => p[1])).size).toBe(2);
    // The numerator sits above the bar, the denominator below it.
    const glyphs = outlines.filter((o) => o !== rects[0]);
    expect(glyphs.some((o) => box(o.pts).y0 > b.y1)).toBe(true);
    expect(glyphs.some((o) => box(o.pts).y1 < b.y0)).toBe(true);
  });

  test("display mode stacks the limits of a sum", async () => {
    const eng = await mathjax();
    const inline = eng.layoutTeX("\\sum_{i=1}^{n} i");
    const display = eng.layoutTeX("\\sum_{i=1}^{n} i", { display: true });
    expect(display.h).toBeGreaterThan(inline.h);
    expect(display.w).toBeLessThan(inline.w);
  });

  test("the ams package is really registered, not just named", async () => {
    const eng = await mathjax();
    // Naming a package TeX never registered is silently ignored, so these two
    // would come back as "unknown environment" if AmsConfiguration went missing.
    const m = eng.layoutTeX("\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}", { display: true });
    expect(m.outlines.length).toBeGreaterThanOrEqual(6);   // 4 digits (two with counters) + 2 stretchy parens
    const aligned = eng.layoutTeX("\\begin{align} a &= b \\\\ c &= d \\end{align}", { display: true });
    expect(aligned.h).toBeGreaterThan(3);                  // two stacked rows, not one line
  });

  test("bad TeX throws instead of drawing MathJax's error box", async () => {
    const eng = await mathjax();
    expect(() => eng.layoutTeX("\\notaunit{")).toThrow(/TeX/i);
  });

  test("layout is deterministic", async () => {
    const eng = await mathjax();
    expect(JSON.stringify(eng.layoutTeX("\\sqrt{x+1}"))).toBe(JSON.stringify(eng.layoutTeX("\\sqrt{x+1}")));
  });
});

// A glyph's SVG path is several subpaths: the outer boundary plus the counters
// (the enclosed holes of "b", "8", "0"). Returned flat they are indistinguishable
// from separate shapes, and a consumer that fills every ring paints the counters
// shut. The engine groups them per source <path> so `holes` says which is which.
describe("mathjax counters (holes)", () => {
  const inside = (p: Pt, ring: Pt[]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  test("'8' is ONE outline carrying its TWO counters as holes", async () => {
    const eng = await mathjax();
    const { outlines } = eng.layoutTeX("8");
    expect(outlines).toHaveLength(1);
    expect(outlines[0].holes).toHaveLength(2);
    const outer = outlines[0].pts;
    const ob = box(outer);
    for (const hole of outlines[0].holes!) {
      expect(hole.length).toBeGreaterThanOrEqual(3);
      expect(finite(hole)).toBe(true);
      const hb = box(hole);
      expect(hb.x0).toBeGreaterThan(ob.x0);
      expect(hb.x1).toBeLessThan(ob.x1);
      expect(hb.y0).toBeGreaterThan(ob.y0);
      expect(hb.y1).toBeLessThan(ob.y1);
      // ... and it really is enclosed, not merely bbox-nested.
      expect(inside(hole[0], outer)).toBe(true);
    }
    // The two counters are stacked, not the same ring twice.
    const [a, b] = outlines[0].holes!.map(box);
    expect(Math.min(a.y0, b.y0)).toBeLessThan(Math.max(a.y0, b.y0) - 1e-6);
  });

  test("'b' and '0' each keep exactly one counter", async () => {
    const eng = await mathjax();
    for (const ch of ["b", "0"]) {
      const { outlines } = eng.layoutTeX(ch);
      expect(outlines, ch).toHaveLength(1);
      expect(outlines[0].holes, ch).toHaveLength(1);
      expect(inside(outlines[0].holes![0][0], outlines[0].pts), ch).toBe(true);
    }
  });

  test("a glyph with no counter reports no holes", async () => {
    const eng = await mathjax();
    const { outlines } = eng.layoutTeX("x");
    expect(outlines).toHaveLength(1);
    expect(outlines[0].holes ?? []).toEqual([]);
  });

  test("disjoint parts of one glyph stay separate outlines, not holes of each other", async () => {
    const eng = await mathjax();
    // "=" is two bars; neither encloses the other, so neither may become a hole.
    const { outlines } = eng.layoutTeX("=");
    expect(outlines).toHaveLength(2);
    for (const o of outlines) expect(o.holes ?? []).toEqual([]);
  });

  test("no ring is lost or duplicated by the grouping", async () => {
    const eng = await mathjax();
    const { outlines } = eng.layoutTeX("ax^2+bx+c=0", { display: true });
    const rings = outlines.reduce((n, o) => n + 1 + (o.holes?.length ?? 0), 0);
    // a(+counter), x, 2, +, b(+counter), x, +, c, = (two bars), 0(+counter)
    expect(rings).toBe(14);
    expect(outlines).toHaveLength(11);
    expect(outlines.filter((o) => (o.holes?.length ?? 0) > 0)).toHaveLength(3);
  });

  test("a fraction rule is a plain 4-point rectangle — never a hole of anything", async () => {
    const eng = await mathjax();
    const { outlines, w } = eng.layoutTeX("\\frac{a}{b}");
    const rects = outlines.filter((o) => o.pts.length === 4 && box(o.pts).x1 - box(o.pts).x0 > w / 2);
    expect(rects).toHaveLength(1);
    expect(rects[0].holes ?? []).toEqual([]);
    // "a" and "b" both have counters, so exactly two outlines carry holes.
    expect(outlines.filter((o) => (o.holes?.length ?? 0) > 0)).toHaveLength(2);
  });
});

describe("token identity (formula morph design §2.2)", () => {
  test("x = \\frac{a+1}{2b}: tokens in reading order, the rule keyed to its fraction, chains up to the root", async () => {
    const mj = await mathjax();
    const laid = mj.layoutTeX("x = \\frac{a+1}{2b}", { display: false });
    const keys = laid.tokens.map((t) => `${t.node}:${t.latex}`);
    // reading order observed from MathJax's own SVG emission: numerator, then
    // denominator, then the mfrac's own <rect> rule last.
    expect(keys).toEqual(["mi:x", "mo:=", "mi:a", "mo:+", "mn:1", "mn:2", "mi:b", "rule:\\frac{a+1}{2b}"]);
    expect(keys.slice(0, 5)).toEqual(["mi:x", "mo:=", "mi:a", "mo:+", "mn:1"]);
    expect(keys).toContain("rule:\\frac{a+1}{2b}");
    expect(keys.filter((k) => k.startsWith("mn:")).sort()).toEqual(["mn:1", "mn:2"]);
    for (const t of laid.tokens) expect(t.glyphs.length).toBeGreaterThan(0);
    // every outline names its glyph and token; the rule has no codepoint
    for (const o of laid.outlines) {
      expect(typeof o.glyph).toBe("number");
      expect(laid.tokens[o.token.index].glyphs).toContain(o.glyph);
      expect(o.token.chain[o.token.chain.length - 1]).toBe("x = \\frac{a+1}{2b}");
    }
    const rule = laid.outlines.find((o) => o.token.node === "rule")!;
    expect(rule.token.c).toBeUndefined();
    expect(rule.pts).toHaveLength(4);
    const x = laid.outlines.find((o) => o.token.latex === "x")!;
    expect(x.token.c).toMatch(/^1D465$/i);
    expect(x.token.chain[0]).toBe("x");
  });
  test("= is one token of one glyph that yields two hole-free outlines; 11 is one token of two glyphs", async () => {
    const mj = await mathjax();
    const eq = mj.layoutTeX("=", { display: false });
    expect(eq.tokens).toHaveLength(1);
    expect(eq.tokens[0].glyphs).toHaveLength(1);
    expect(eq.outlines.filter((o) => o.token.index === 0)).toHaveLength(2);
    const eleven = mj.layoutTeX("11", { display: false });
    expect(eleven.tokens).toHaveLength(1);
    expect(eleven.tokens[0].node).toBe("mn");
    expect(eleven.tokens[0].glyphs).toHaveLength(2);
  });
});
