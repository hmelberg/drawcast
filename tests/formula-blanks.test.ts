import { beforeAll, describe, expect, test } from "vitest";
import { formulaBlanks, markBlanks, tileRight, typedRight, blankIsNumber, blankConvertible, hasBlanks } from "../src/formula/blanks";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { ensureEngines } from "../src/scenes/engines";
import { GUESS_COLOR } from "../src/guess/marks";
import { flattenDrawables } from "../src/layout/model";

describe("formula blanks", () => {
  test("found in order, nested braces kept", () => {
    const b = formulaBlanks("area", "A = \\pi \\blank{r^{2}} + \\blank{\\frac{1}{2}}");
    expect(b.map((x) => x.tex)).toEqual(["r^{2}", "\\frac{1}{2}"]);
    expect(b[0].part).toBe("area_blank_1");
    expect(b[1].fill).toBe("area_blank_2_fill");
    expect(b.map((x) => x.k)).toEqual([1, 2]);
  });
  test("hasBlanks", () => {
    expect(hasBlanks("A = \\blank{x}")).toBe(true);
    expect(hasBlanks("A = \\blanket")).toBe(false);
    expect(hasBlanks("A = x")).toBe(false);
  });
  test("marked TeX lays out like the answer", () => {
    const m = markBlanks("area", "A = \\pi \\blank{r^2}");
    expect(m.tex).not.toMatch(/\\blank/);
    expect(m.tex).toMatch(/r\^2/);
    expect([...m.marks.values()][0].id).toBe("area_blank_1_fill");
    expect([...m.marks.values()][0].name).toBe("blank_1");
    expect(m.filled).toEqual([false]);
  });
  test("a fill replaces the content; an empty fill keeps the truth's size", () => {
    const m = markBlanks("area", "A = \\pi \\blank{r^2}", ["2r"]);
    expect(m.tex).toMatch(/2r/);
    expect(m.tex).not.toMatch(/r\^2/);
    expect(m.filled).toEqual([true]);
    // An empty fill is no fill: the truth written in (kept back by the layout).
    const e = markBlanks("area", "A = \\pi \\blank{r^2}", [""]);
    expect(e.tex).not.toMatch(/phantom/);
    expect(e.tex).toMatch(/r\^2/);
    expect(e.filled).toEqual([false]);
    // For a morph: an unfilled blank is a phantom, a filled one its fill.
    const p = markBlanks("area", "\\blank{r^2} + \\blank{b}", [null, "c"], { phantom: true });
    expect(p.tex).toMatch(/\\phantom\{r\^2\}/);
    expect(p.tex).toMatch(/c/);
    expect(p.tex).not.toMatch(/\{b\}/);
    const n = markBlanks("area", "\\blank{a} + \\blank{b}", [null, "c"]);
    expect(n.filled).toEqual([false, true]);
  });
  test("no blanks: the same string, no marks", () => {
    const m = markBlanks("a", "x^2");
    expect(m.tex).toBe("x^2");
    expect(m.marks.size).toBe(0);
  });
  test("judging", () => {
    const [b] = formulaBlanks("a", "\\blank{r^2}");
    expect(tileRight(b, " r^{2} ")).toBe(true);
    expect(tileRight(b, "2r")).toBe(false);
    expect(typedRight(b, "r*r")).toBe(true);
    expect(typedRight(b, "r r")).toBe(true);
    expect(typedRight(b, "2r")).toBe(false);
    expect(typedRight(b, "r*r", "exact")).toBe(false);
    expect(typedRight(b, "r^2", "exact")).toBe(true);
    expect(typedRight(b, "((")).toBe(false);
    const [n] = formulaBlanks("a", "\\blank{12}");
    expect(blankIsNumber(n)).toBe(true);
    expect(blankIsNumber(b)).toBe(false);
    expect(typedRight(n, "12,1", undefined, 0.02)).toBe(true);
    expect(typedRight(n, "13")).toBe(false);
    expect(typedRight(n, "abc")).toBe(false);
    expect(blankConvertible(b)).toBe(true);
    const [odd] = formulaBlanks("a", "\\blank{\\int_0^1 x\\,dx}");
    expect(blankConvertible(odd)).toBe(false);
  });
});

describe("formula blanks in layout (real mathjax)", () => {
  beforeAll(async () => { await ensureEngines(["mathjax"]); });
  type Kid = { id: string; kind: string; style?: { opacity?: number; color?: string }; children?: Kid[] };

  test("a box part, and the fill glyphs hidden", () => {
    const spec = expandSpec({ elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}" }], commands: [] } as never);
    const l = layoutSpec(spec);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(l.order).toContain("area_blank_1");
    expect(l.order.indexOf("area_blank_1")).toBe(l.order.indexOf("area") + 1);
    const area = l.drawables.find((d) => d.id === "area") as unknown as Kid;
    const fill = area.children?.find((c) => c.id === "area_blank_1_fill");
    expect(fill?.style?.opacity).toBe(0);
    const box = l.drawables.find((d) => d.id === "area_blank_1") as unknown as { kind: string; closed?: boolean; style: { color?: string } };
    expect(box.kind).toBe("stroke");
    expect(box.closed).toBe(true);
    expect(box.style.color).toBe(GUESS_COLOR);
    const bb = elementBBoxes(l);
    const fb = bb.get("area_blank_1")!;
    const ab = bb.get("area")!;
    // The box sits around the blank, inside the formula's right side.
    expect(fb.w).toBeGreaterThan(0);
    expect(fb.x + fb.w).toBeGreaterThan(ab.x + ab.w * 0.5);
  });

  test("a viewer's fill shows in the guess colour; the truth in the ink", () => {
    const wrong = layoutSpec(expandSpec({ elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", fills: ["2r"] }], commands: [] } as never));
    const w = (wrong.drawables.find((d) => d.id === "area") as unknown as Kid).children!.find((c) => c.id === "area_blank_1_fill")!;
    expect(w.style?.opacity).toBe(1);
    expect(w.style?.color).toBe(GUESS_COLOR);
    const right = layoutSpec(expandSpec({ elements: [{ id: "area", type: "math", tex: "A = \\pi \\blank{r^2}", fills: ["r^{2}"] }], commands: [] } as never));
    const r = (right.drawables.find((d) => d.id === "area") as unknown as Kid).children!.find((c) => c.id === "area_blank_1_fill")!;
    expect(r.style?.opacity).toBe(1);
    expect(r.style?.color).not.toBe(GUESS_COLOR);
  });

  test("an empty fill keeps the box and the glyphs hidden", () => {
    const l = layoutSpec(expandSpec({ elements: [{ id: "f", type: "math", tex: "A = \\pi \\blank{r^2}", fills: [""] }], commands: [] } as never));
    expect(l.order).toEqual(["f", "f_blank_1"]);
    const fill = (l.drawables.find((d) => d.id === "f") as unknown as Kid).children!.find((c) => c.id === "f_blank_1_fill")!;
    expect(fill.style?.opacity).toBe(0);
  });

  test("a morph to a formula with a blank never shows the answer", () => {
    const spec = expandSpec({ elements: [{ id: "eq", type: "math", tex: "A = \\pi" }], commands: [] } as never);
    const leaves = (r: ReturnType<typeof layoutSpec>) => flattenDrawables(r.drawables).filter((d) => d.id.startsWith("eq") && d.kind === "area" && (d.style.opacity ?? 1) > 0).length;
    const blanked = layoutSpec(spec, undefined, { math: { eq: { tex: "A = \\pi \\blank{r^2}", from: "A = \\pi", t: 0.999 } } });
    const phantom = layoutSpec(spec, undefined, { math: { eq: { tex: "A = \\pi \\phantom{r^2}", from: "A = \\pi", t: 0.999 } } });
    const shown = layoutSpec(spec, undefined, { math: { eq: { tex: "A = \\pi r^2", from: "A = \\pi", t: 0.999 } } });
    expect(blanked.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(leaves(blanked)).toBe(leaves(phantom));
    expect(leaves(shown)).toBeGreaterThan(leaves(blanked));
  });

  test("blanks beside live math", () => {
    const l = layoutSpec(expandSpec({ vars: { r: { value: 2, min: 1, max: 5 } }, elements: [{ id: "f", type: "math", tex: "A = \\blank{\\pi} \\cdot {r}^2" }], commands: [] } as never));
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    const f = l.drawables.find((d) => d.id === "f") as unknown as Kid;
    const ids = f.children!.map((c) => c.id);
    expect(ids).toContain("f_blank_1_fill");
    expect(ids).toContain("f_var_r");
  });
});
