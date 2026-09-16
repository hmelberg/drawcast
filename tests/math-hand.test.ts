import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { HAND_MAX_SHIFT, handShape } from "../src/layout/math-hand";
import { MATH_DEFAULT_SIZE, setMathTextStyle } from "../src/layout/math";
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
// Four causes, one round: formulas typeset inline (fractions shrunk, authors
// compensating with sizes), equation_steps scaling every row to one box
// height, the global text scale skipping formulas, and exact Fira outlines
// beside a handwriting face. And the hand is optional — `text.math_hand:
// false` (or the viewer's Playback setting) gives exact print back.

type Pt = [number, number];
type Area = { id: string; kind: string; pts: Pt[]; holes?: Pt[][] };

const box = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
function pointInRing(p: Pt, ring: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const glyphsOf = (spec: Spec, id: string): Area[] =>
  flattenDrawables(layoutSpec(spec).drawables).filter((d) => d.id.startsWith(`${id}__g`) && d.kind === "area") as unknown as Area[];

describe("handShape — a pen's imperfections, deterministic and bounded", () => {
  // A square with a square counter, like a fat "0".
  const outer: Pt[] = [[0, 0], [20, 0], [20, 30], [0, 30]];
  const hole: Pt[] = [[6, 8], [14, 8], [14, 22], [6, 22]];
  const shape = { pts: outer, holes: [hole] };

  test("same seed, same size → identical points; another seed → different ones", () => {
    const a = handShape(shape, "eq:3", 28), b = handShape(shape, "eq:3", 28), c = handShape(shape, "eq:4", 28);
    expect(a).toEqual(b);
    expect(a.pts).not.toEqual(c.pts);
    expect(a.pts).not.toEqual(outer);
  });

  test("every point moves less than HAND_MAX_SHIFT × size, and the hand scales with the size", () => {
    for (const size of [20, 28, 40]) {
      const h = handShape(shape, "eq:0", size);
      const shift = Math.max(
        ...h.pts.map((p, i) => Math.hypot(p[0] - outer[i][0], p[1] - outer[i][1])),
        ...h.holes[0].map((p, i) => Math.hypot(p[0] - hole[i][0], p[1] - hole[i][1])),
      );
      expect(shift).toBeGreaterThan(0);
      expect(shift).toBeLessThan(HAND_MAX_SHIFT * size);
    }
  });

  test("a counter deforms with its outline: it stays inside, and keeps its point count", () => {
    for (let k = 0; k < 40; k++) {
      const h = handShape(shape, `seed:${k}`, 28);
      expect(h.holes).toHaveLength(1);
      expect(h.holes[0]).toHaveLength(4);
      for (const p of h.holes[0]) expect(pointInRing(p, h.pts)).toBe(true);
    }
  });
});

describe("math elements in the drawing's hand (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
  const spec = (text?: Spec["text"], tex = "E = mc^2", extra: Record<string, unknown> = {}): Spec => ({
    ...(text ? { text } : {}),
    elements: [{ id: "m", type: "math", tex, x: 500, y: 400, ...extra }],
    commands: [{ draw: ["m"] }],
  });

  test("on by default, off with text.math_hand: false — and deterministic across layouts", () => {
    const hand = glyphsOf(spec(), "m"), again = glyphsOf(spec(), "m"), print = glyphsOf(spec({ math_hand: false }), "m");
    expect(hand.length).toBe(print.length);
    expect(hand.map((g) => g.pts)).toEqual(again.map((g) => g.pts));
    expect(hand.map((g) => g.pts)).not.toEqual(print.map((g) => g.pts));
    // Precise, filled outlines either way: the hand is geometry, not a stroke.
    expect(hand.every((g) => (g as { precise?: boolean }).precise === true)).toBe(true);
  });

  test("the hand moves no glyph point further than the bound, so the box stays honest", () => {
    const hand = glyphsOf(spec(), "m"), print = glyphsOf(spec({ math_hand: false }), "m");
    for (let i = 0; i < hand.length; i++) {
      const a = box(hand[i].pts), b = box(print[i].pts);
      for (const d of [a.x0 - b.x0, a.x1 - b.x1, a.y0 - b.y0, a.y1 - b.y1]) expect(Math.abs(d)).toBeLessThan(HAND_MAX_SHIFT * MATH_DEFAULT_SIZE);
    }
    const hb = elementBBoxes(layoutSpec(spec())).get("m")!, pb = elementBBoxes(layoutSpec(spec({ math_hand: false }))).get("m")!;
    expect(Math.abs(hb.w - pb.w)).toBeLessThan(2 * HAND_MAX_SHIFT * MATH_DEFAULT_SIZE);
  });

  test("the viewer's Playback choice reaches layout through withTextStyle", () => {
    const s = spec();
    const viewerPrint = withTextStyle(s, effectiveTextStyle(s, { mathHand: false }));
    expect(glyphsOf(viewerPrint, "m").map((g) => g.pts)).toEqual(glyphsOf(spec({ math_hand: false }), "m").map((g) => g.pts));
  });
});

describe("one size model for formulas and text (real mathjax, node)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
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
    setMathTextStyle({ scale: 1, hand: false });
    try {
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
    } finally {
      setMathTextStyle({ scale: 1, hand: true });
    }
  });

  test("equation_steps still shrinks a row wider than the canvas allows, and never grows one", async () => {
    registerPack("mathlogic", mathlogicYaml);
    setMathTextStyle({ scale: 1, hand: false });
    try {
      const wide = "a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12} + a_{13} + a_{14} + a_{15} + a_{16} + a_{17} + a_{18} + a_{19} + a_{20} + a_{21} + a_{22}";
      const r = scenes.equation_steps.layout!({ steps: [{ tex: wide }, { tex: "a_1" }] });
      const areas = flattenDrawables(r.drawables).filter((d) => d.kind === "area") as unknown as Area[];
      const rowBox = (i: number) => box(areas.filter((a) => a.id.startsWith(`step_${i}__g`)).flatMap((a) => a.pts));
      const tallestGlyph = (i: number) => Math.max(...areas.filter((a) => a.id.startsWith(`step_${i}__g`)).map((a) => { const b = box(a.pts); return b.y1 - b.y0; }));
      expect(rowBox(0).x1 - rowBox(0).x0).toBeLessThanOrEqual(900);
      // Shrunk to fit: its "a" is smaller than the plain row's.
      expect(tallestGlyph(0)).toBeLessThan(tallestGlyph(1) * 0.9);
    } finally {
      setMathTextStyle({ scale: 1, hand: true });
    }
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
