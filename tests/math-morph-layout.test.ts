import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";
import { mathDrawables, mathMorphDrawables } from "../src/layout/math";
import type { AreaDrawable, GroupDrawable } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

let mj: MathJaxEngine;
beforeAll(async () => { await ensureEngines(["mathjax"]); mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine; });
const el = (extra: Partial<SpecElement> = {}): SpecElement => ({ id: "eq", type: "math", tex: "2x + 3 = 11", size: 40, ...extra } as SpecElement);
const kids = (r: { drawables: { kind: string }[] }) => ((r.drawables[0] as GroupDrawable).children as AreaDrawable[]);
const centroid = (pts: [number, number][]) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);

describe("mathMorphDrawables", () => {
  test("t = 0: matched shapes sit on the old formula, new-only shapes have opacity 0; t = 1: the reverse", () => {
    const a = kids(mathDrawables(el(), mj, 500, 375));
    const b = kids(mathDrawables(el({ tex: "2x = 8" }), mj, 500, 375));
    const at0 = kids(mathMorphDrawables(el(), mj, 500, 375, "2x + 3 = 11", "2x = 8", 0));
    const at1 = kids(mathMorphDrawables(el(), mj, 500, 375, "2x + 3 = 11", "2x = 8", 1));
    expect(at0.length).toBe(at1.length); // the node list never depends on t
    expect(at0.filter((k) => k.style.opacity === 0).length).toBeGreaterThanOrEqual(1); // 8, unmatched new
    // Observed: "2x + 3 = 11" lays out 8 shapes (2, x, +, 3, two "=" bars, and
    // the two "1" glyphs of "11"); matchShapes pairs 4 of them with "2x = 8"
    // (2, x, and both "=" bars), leaving 4 unmatched-from-A: "+", "3", and the
    // two glyphs of "11" — those are the ones at opacity 1 − t = 0 at t = 1.
    expect(a.length).toBe(8);
    expect(at1.filter((k) => k.style.opacity === 0).length).toBe(4);
    // A matched shape at t=1 lies on the new formula's shape (the "2") — not
    // EXACTLY, because morphPair resamples both sides to a common point count
    // (k = max(len(A), len(B), 24)) before lerping, and "2" alone simplifies
    // to 21 points on each side: the endpoint at t=1 is a 24-point resample
    // of the 21-point "2x = 8" glyph, not that glyph's own raw points, so its
    // naive (unweighted) vertex-average centroid drifts a fraction of a unit
    // from the un-resampled one (observed: ~0.54 units on a ~500-unit canvas,
    // for glyphs ~15-20 units wide) — a real property of reusing morphPair
    // as specified, not a matching bug (a wrong shape or a stale translation
    // would miss by glyph-widths, not fractions of a unit).
    const two1 = at1.find((k) => k.style.opacity === 1)!;
    const twoB = b[0];
    expect(Math.abs(centroid(two1.pts)[0] - centroid(twoB.pts)[0])).toBeLessThan(1);
  });
  // Renamed (review finding 8, 2026-09-10): "an unpaired counter appears only
  // from t ≥ 0.5" overstated what this proves — the unmatched "8" fades in
  // continuously (opacity == t) rather than appearing only past the midpoint;
  // the name now says what the test actually exercises.
  test("t = 0.5: a matched glyph's centroid is the midpoint of its old and new place; an unmatched shape keeps its own counters and fades in", () => {
    const a = kids(mathDrawables(el({ tex: "x = 1" }), mj, 500, 375));
    const b = kids(mathDrawables(el({ tex: "x = 8" }), mj, 500, 375));
    const mid = kids(mathMorphDrawables(el({ tex: "x = 1" }), mj, 500, 375, "x = 1", "x = 8", 0.5));
    const xa = a[0], xb = b[0], xm = mid[0];
    expect(centroid(xm.pts)[0]).toBeCloseTo((centroid(xa.pts)[0] + centroid(xb.pts)[0]) / 2, 0);
    const eightMid = mid.find((k) => k.style.opacity === 0.5 && (k.holes?.length ?? 0) === 2);
    expect(eightMid).toBeDefined();
    const before = kids(mathMorphDrawables(el({ tex: "x = 1" }), mj, 500, 375, "x = 1", "x = 8", 0.25));
    expect(before.every((k) => k.style.opacity !== 0.25 || (k.holes?.length ?? 0) === 2)).toBe(true); // the 8 keeps its own holes: it is unmatched, not lerped
  });
});

describe("colors", () => {
  test("colors: {x: …} colours both x in x^2 + x and nothing else; an unknown key is reported", () => {
    const r = mathDrawables(el({ tex: "x^2 + x", colors: { x: "#2f6b8f", q: "#000" } }), mj, 500, 375);
    const blue = kids(r).filter((k) => k.style.fill === "#2f6b8f");
    expect(blue).toHaveLength(2);
    expect(kids(r).filter((k) => k.style.fill !== "#2f6b8f").length).toBe(kids(r).length - 2);
    expect(r.unusedColors).toEqual(["q"]);
  });
  test("a multi-token key colours the whole numerator; the colour survives a morph on matched shapes", () => {
    const r = mathDrawables(el({ tex: "\\frac{\\Delta C}{\\Delta E}", colors: { "\\Delta C": "#b5482e" } }), mj, 500, 375);
    expect(kids(r).filter((k) => k.style.fill === "#b5482e").length).toBeGreaterThanOrEqual(2); // Δ and C
    const m = kids(mathMorphDrawables(el({ tex: "\\frac{C_1 - C_0}{E}", colors: { "\\Delta C": "#b5482e", "C_1 - C_0": "#b5482e" } }), mj, 500, 375, "\\frac{C_1 - C_0}{E}", "\\frac{\\Delta C}{E}", 0.5));
    expect(m.some((k) => k.style.fill === "#b5482e")).toBe(true);
  });
});
