import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, setMathHand, type MathJaxEngine } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { HAND_SCALE, handCharFor, handRingsFor } from "../src/scenes/math-hand";
import { MATH_DEFAULT_SIZE } from "../src/layout/math";
import { withTextStyle, effectiveTextStyle } from "../src/layout/text-style";
import { lintCommands } from "../src/lint/lint";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import mathlogicYaml from "../src/scenes/packs/mathlogic.yaml?raw";
import type { Spec } from "../src/spec/types";

// Hans 2026-09-16: "the math font/size is sometimes a bit strange and ugly.
// Sometimes the math equations are written very large and then smaller
// equations in the same page. Also it does not have the same handwritten
// font type or feeling that much of the other text and even charts have."
// Sizes: formulas typeset inline (fractions shrunk, authors compensating),
// equation_steps scaling every row to one box height, the global text scale
// skipping formulas. The hand: MathJax keeps the layout (Fira Math), and the
// glyphs a hand writes — letters, digits, everyday operators — are Patrick
// Hand's outlines in Fira's slots (scenes/math-hand.ts). A wobble on Fira's
// glyphs was tried first and judged ugly. Optional: `text.math_hand: false`
// (or the viewer's Playback setting) gives print back.

type Pt = [number, number];
type Area = { id: string; kind: string; pts: Pt[]; holes?: Pt[][] };

const box = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const glyphsOf = (spec: Spec, id: string): Area[] =>
  flattenDrawables(layoutSpec(spec).drawables).filter((d) => d.id.startsWith(`${id}__g`) && d.kind === "area") as unknown as Area[];

describe("handCharFor — which MathJax glyphs a hand writes", () => {
  test("ASCII, the math-alphanumeric variants and the everyday operators map to a character", () => {
    expect(handCharFor(0x78)).toBe("x");
    expect(handCharFor(0x31)).toBe("1");
    expect(handCharFor(0x1d465)).toBe("x");   // italic x, as MathJax writes a variable
    expect(handCharFor(0x1d434)).toBe("A");   // italic A
    expect(handCharFor(0x1d41a)).toBe("a");   // bold a
    expect(handCharFor(0x1d482)).toBe("a");   // bold italic a
    expect(handCharFor(0x210e)).toBe("h");    // italic h lives at the Planck codepoint
    expect(handCharFor(0x1d7d0)).toBe("2");   // bold 2
    expect(handCharFor(0x2212)).toBe("−");
    expect(handCharFor(0x2223)).toBe("|");
  });
  test("Greek and symbols the face lacks keep Fira", () => {
    expect(handCharFor(0x3b1)).toBeNull();    // α
    expect(handCharFor(0x1d6fc)).toBeNull();  // italic α
    expect(handCharFor(0x2264)).toBeNull();   // ≤
    expect(handCharFor(0x221a)).toBeNull();   // √
    expect(handCharFor(0x2211)).toBeNull();   // ∑
  });
});

describe("handRingsFor — Patrick Hand's outline in Fira's slot", () => {
  // A stand-in for Fira's "x": a 500-wide, x-height-tall block starting at x = 20.
  const fira: Pt[][] = [[[20, 0], [520, 0], [520, 527], [20, 527]]];
  test("scaled so the x-heights agree, baseline kept, ink centred on Fira's ink", () => {
    const rings = handRingsFor(0x1d465, fira)!;
    expect(rings.length).toBeGreaterThan(0);
    const b = box(rings.flat());
    expect(b.y1).toBeGreaterThan(527 * 0.9);
    expect(b.y1).toBeLessThan(527 * 1.15);
    expect(b.y0).toBeGreaterThan(-60); // on the baseline, bar a hand's undershoot
    expect((b.x0 + b.x1) / 2).toBeCloseTo(270, 0);
    expect(b.x1 - b.x0).toBeLessThanOrEqual(500 + 1e-6);
    expect(HAND_SCALE).toBeCloseTo(527 / 467, 3);
  });
  test("a capital taller than Fira's slot is squeezed to it about the baseline", () => {
    const short: Pt[][] = [[[0, 0], [500, 0], [500, 600], [0, 600]]];
    const b = box(handRingsFor(0x48, short)!.flat()); // "H", 661 tall in the face, 746 scaled
    expect(b.y1).toBeLessThanOrEqual(600 + 1e-6);
    expect(b.y1).toBeGreaterThan(590);
    expect(b.y0).toBeGreaterThan(-30);
  });
  test("a letter wider than Fira's slot is squeezed to it, never spilling into a neighbour", () => {
    const narrow: Pt[][] = [[[0, 0], [200, 0], [200, 527], [0, 527]]];
    const b = box(handRingsFor(0x6d, narrow)!.flat()); // "m"
    expect(b.x1 - b.x0).toBeLessThanOrEqual(200 + 1e-6);
    expect((b.x0 + b.x1) / 2).toBeCloseTo(100, 0);
  });
  test("null for a glyph the hand does not write, or an empty slot", () => {
    expect(handRingsFor(0x3b1, fira)).toBeNull();
    expect(handRingsFor(0x78, [])).toBeNull();
  });
});

describe("math elements in the drawing's hand (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
  afterEach(() => setMathHand(true));
  const spec = (text?: Spec["text"], tex = "E = mc^2", extra: Record<string, unknown> = {}): Spec => ({
    ...(text ? { text } : {}),
    elements: [{ id: "m", type: "math", tex, x: 500, y: 400, ...extra }],
    commands: [{ draw: ["m"] }],
  });

  test("on by default, off with text.math_hand: false — same glyph count, same tokens, different outlines", () => {
    const hand = glyphsOf(spec(), "m"), print = glyphsOf(spec({ math_hand: false }), "m");
    expect(hand.length).toBe(print.length);
    expect(hand.map((g) => g.pts)).not.toEqual(print.map((g) => g.pts));
    expect(hand.every((g) => (g as { precise?: boolean }).precise === true)).toBe(true);
    // Deterministic: the same spec lays out to the same points.
    expect(glyphsOf(spec(), "m").map((g) => g.pts)).toEqual(hand.map((g) => g.pts));
  });

  test("the swapped glyphs sit in Fira's slots: every glyph's ink centre and baseline row stay put", () => {
    const hand = glyphsOf(spec(), "m"), print = glyphsOf(spec({ math_hand: false }), "m");
    for (let i = 0; i < hand.length; i++) {
      const a = box(hand[i].pts), b = box(print[i].pts);
      expect(Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2)).toBeLessThan(0.08 * MATH_DEFAULT_SIZE);
      expect(a.x1 - a.x0).toBeLessThanOrEqual(b.x1 - b.x0 + 0.5);
    }
    const hb = elementBBoxes(layoutSpec(spec())).get("m")!, pb = elementBBoxes(layoutSpec(spec({ math_hand: false }))).get("m")!;
    expect(hb.w / pb.w).toBeGreaterThan(0.85);
    expect(hb.w / pb.w).toBeLessThanOrEqual(1.01);
  });

  test("Greek keeps Fira, so a mixed formula is the hand where it can be and print where it must", () => {
    const eng = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
    const on = eng.layoutTeX("\\alpha x", { display: true });
    setMathHand(false);
    const off = eng.layoutTeX("\\alpha x", { display: true });
    expect(on.outlines[0].token.c).toBe(off.outlines[0].token.c);
    expect(on.outlines[0].pts).toEqual(off.outlines[0].pts);       // α: Fira both ways
    expect(on.outlines[1].pts).not.toEqual(off.outlines[1].pts);   // x: the hand
    expect(on.outlines[1].token.c).toBe("1D465");                  // the token still names Fira's codepoint (colours, morph matching)
  });

  test("colours by term still find the swapped glyph", () => {
    const r = layoutSpec(spec(undefined, "x + y", { colors: { x: "#b5482e" } }));
    const glyphs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("m__g")) as unknown as { style: { fill?: string } }[];
    expect(glyphs.filter((g) => g.style.fill === "#b5482e")).toHaveLength(1);
    expect(r.warnings.filter((w) => w.includes("colors"))).toEqual([]);
  });

  test("the viewer's Playback choice reaches layout through withTextStyle", () => {
    const s = spec();
    const viewerPrint = withTextStyle(s, effectiveTextStyle(s, { mathHand: false }));
    expect(glyphsOf(viewerPrint, "m").map((g) => g.pts)).toEqual(glyphsOf(spec({ math_hand: false }), "m").map((g) => g.pts));
  });
});

describe("one size model for formulas and text (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
  afterEach(() => setMathHand(true));
  const print = { math_hand: false as const };
  const tallest = (spec: Spec, id: string) => Math.max(...glyphsOf(spec, id).map((g) => { const b = box(g.pts); return b.y1 - b.y0; }));

  test("display style: a fraction's parts are full size, not script size", () => {
    const alone: Spec = { text: print, elements: [{ id: "one", type: "math", tex: "1", x: 200, y: 400 }], commands: [{ draw: ["one"] }] };
    const frac: Spec = { text: print, elements: [{ id: "f", type: "math", tex: "\\frac{1}{2}", x: 500, y: 400 }], commands: [{ draw: ["f"] }] };
    // The tallest glyph of \frac{1}{2} is a digit at text size; inline
    // style would have shrunk it to 70 %.
    expect(tallest(frac, "f") / tallest(alone, "one")).toBeGreaterThan(0.97);
    expect(tallest(frac, "f") / tallest(alone, "one")).toBeLessThan(1.03);
  });

  test("the global text scale (text.font_size) scales formulas like every text", () => {
    const at = (font_size: number) => elementBBoxes(layoutSpec({ text: { ...print, font_size }, elements: [{ id: "m", type: "math", tex: "a + b", x: 500, y: 400 }], commands: [{ draw: ["m"] }] })).get("m")!;
    expect(at(39).w / at(26).w).toBeCloseTo(1.5, 1);
    expect(at(39).h / at(26).h).toBeCloseTo(1.5, 1);
    // …and the viewer's size override, folded in by withTextStyle, does the same.
    const s: Spec = { text: print, elements: [{ id: "m", type: "math", tex: "a + b", x: 500, y: 400 }], commands: [{ draw: ["m"] }] };
    const viewer = withTextStyle(s, effectiveTextStyle(s, { fontSize: 39 }));
    expect(elementBBoxes(layoutSpec(viewer)).get("m")!.w).toBeCloseTo(at(39).w, 5);
  });

  test("equation_steps: every step at one letter height — a plain step no longer dwarfs one with a fraction", async () => {
    registerPack("mathlogic", mathlogicYaml);
    setMathHand(false);
    const r = scenes.equation_steps.layout!({ steps: [{ tex: "x = 1" }, { tex: "\\frac{x}{2} = 1" }, { tex: "2x + 1 = 3" }] });
    const areas = flattenDrawables(r.drawables).filter((d) => d.kind === "area") as unknown as Area[];
    const stepTallest = (i: number) => Math.max(...areas.filter((a) => a.id.startsWith(`step_${i}__g`)).map((a) => { const b = box(a.pts); return b.y1 - b.y0; }));
    // Each step has a "1" or a "2": the digit height is the same in all three.
    expect(stepTallest(1) / stepTallest(0)).toBeCloseTo(1, 1);
    expect(stepTallest(2) / stepTallest(0)).toBeCloseTo(1, 1);
    // The fraction step is taller than the plain one (it stacks), so rows
    // are pitched by their own height, not a fixed box.
    const rowH = (i: number) => { const b = box(areas.filter((a) => a.id.startsWith(`step_${i}__g`)).flatMap((a) => a.pts)); return b.y1 - b.y0; };
    expect(rowH(1)).toBeGreaterThan(rowH(0) * 1.8);
    // Top to bottom, and centred on the canvas's middle.
    expect(r.anchors["step_0"][1]).toBeGreaterThan(r.anchors["step_1"][1]);
    expect(r.anchors["step_1"][1]).toBeGreaterThan(r.anchors["step_2"][1]);
  });

  test("equation_steps still shrinks a row wider than the canvas allows, and never grows one", async () => {
    registerPack("mathlogic", mathlogicYaml);
    setMathHand(false);
    const wide = "a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} + a_{14} + a_{15} + a_{16} + a_{17} + a_{18} + a_{19} + a_{20} + a_{21} + a_{22}";
    const r = scenes.equation_steps.layout!({ steps: [{ tex: wide }, { tex: "a_1" }] });
    const areas = flattenDrawables(r.drawables).filter((d) => d.kind === "area") as unknown as Area[];
    const rowBox = (i: number) => box(areas.filter((a) => a.id.startsWith(`step_${i}__g`)).flatMap((a) => a.pts));
    const tallestGlyph = (i: number) => Math.max(...areas.filter((a) => a.id.startsWith(`step_${i}__g`)).map((a) => { const b = box(a.pts); return b.y1 - b.y0; }));
    expect(rowBox(0).x1 - rowBox(0).x0).toBeLessThanOrEqual(900);
    // Shrunk to fit: its "a" is smaller than the plain row's.
    expect(tallestGlyph(0)).toBeLessThan(tallestGlyph(1) * 0.9);
  });

  test("the engine is asked for display style by the math element (the layout unit is the same either way)", async () => {
    const eng = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
    const inline = eng.layoutTeX("\\frac{1}{2}", { display: false }), display = eng.layoutTeX("\\frac{1}{2}", { display: true });
    expect(display.h).toBeGreaterThan(inline.h * 1.15);
  });
});

describe("lint: formulas of different sizes on one page", () => {
  const page = (sizes: (number | undefined)[]): Spec => ({
    elements: sizes.map((size, i) => ({ id: `m${i}`, type: "math", tex: "x", x: 100 + i * 100, y: 400, ...(size !== undefined ? { size } : {}) })),
    commands: [{ draw: sizes.map((_, i) => `m${i}`) }],
  });
  const mathSize = (spec: Spec) => lintCommands(spec).filter((i) => i.rule === "math-size");

  test("warns once, naming every formula, when the spread passes 1.3×", () => {
    const issues = mathSize(page([undefined, 48, 28]));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].ids).toEqual(["m0", "m1", "m2"]);
    expect(issues[0].message).toContain("m1 at 48");
    expect(issues[0].message).toContain("m0 at 28");
  });

  test("a headline formula at 34 beside 28s is fine; one formula alone is always fine", () => {
    expect(mathSize(page([undefined, 34, 28]))).toEqual([]);
    expect(mathSize(page([80]))).toEqual([]);
    expect(mathSize(page([]))).toEqual([]);
  });
});
