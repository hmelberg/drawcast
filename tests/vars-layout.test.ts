import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import type { Spec, SpecElement } from "../src/spec/types";
import type { StrokeDrawable, TextDrawable } from "../src/layout/model";

const stroke = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as StrokeDrawable;
const text = (l: ReturnType<typeof layoutSpec>, id: string) => l.drawables.find((d) => d.id === id) as TextDrawable;

describe("layout reads vars", () => {
  test("a curve expr reads a var; changing the var changes the curve", () => {
    const spec = (f: number): Spec => ({ vars: { f }, domain: { x: [0, 6], y: [-1, 1] }, elements: [{ id: "w", type: "curve", expr: "sin(f*x)" }], commands: [] });
    const a = stroke(layoutSpec(spec(1)), "w").pts;
    const b = stroke(layoutSpec(spec(2)), "w").pts;
    expect(a.length).toBe(b.length);
    expect(Math.abs(a[10][1] - b[10][1])).toBeGreaterThan(1);
  });
  test("bind replaces a sector's end from the var; the spec object is untouched", () => {
    const el = { id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "30 + 60*f" } } as SpecElement;
    const l = layoutSpec({ vars: { f: 1 }, elements: [el], commands: [] });
    expect(l.issues.filter((i) => i.rule === "bind")).toEqual([]);
    expect(l.namedAnchors.s.end[0]).toBeCloseTo(500, 6); // the end anchor at 90°: straight above the centre
    expect(l.namedAnchors.s.end[1]).toBeCloseTo(475, 6);
    expect(el.end).toBe(30);
  });
  test("an unknown var in a bind is an error-severity lint, and the written value is used", () => {
    const l = layoutSpec({ vars: { f: 1 }, elements: [{ id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "g" } }], commands: [] });
    expect(l.issues.some((i) => i.rule === "bind" && i.severity === "error" && i.ids[0] === "s" && i.message.includes('unknown identifier "g"'))).toBe(true);
    expect(l.namedAnchors.s.end[0]).toBeCloseTo(500 + 100 * Math.cos(Math.PI / 6), 6);
  });
  test("a bound curve range: x_to from a var moves the curve's last sample", () => {
    const l = layoutSpec({ vars: { k: 3 }, domain: { x: [0, 10], y: [0, 10] }, elements: [{ id: "w", type: "curve", expr: "x", x_from: 0, x_to: 10, bind: { x_to: "k" } }], commands: [] });
    const pts = stroke(l, "w").pts;
    const last = pts[pts.length - 1];
    const first = pts[0];
    // the plot spans the domain 0–10; a curve that stops at x = 3 covers 30% of the width
    expect((last[0] - first[0]) / (l.drawables.find((d) => d.id === "w") ? 1 : 1)).toBeLessThan(0.4 * 1000);
  });
  test("{f} in text, label and node text is written; an unknown token warns and stays", () => {
    const l = layoutSpec({
      vars: { f: 1.57 },
      elements: [
        { id: "t", type: "text", text: "f = {f}", x: 500, y: 700 },
        { id: "n", type: "node", text: "{f:2}", x: 200, y: 200 },
        { id: "w", type: "curve", expr: "x" },
        { id: "lb", type: "label", attach_to: "w", text: "k = {k}" },
      ],
      commands: [],
    });
    expect(text(l, "t").text).toBe("f = 1.6");
    expect(text(l, "n_text").text).toBe("1.57");
    expect(text(l, "lb").text).toBe("k = {k}");
    expect(l.warnings.some((w) => w.includes('label "lb"') && w.includes("{k}"))).toBe(true);
  });
  test("a point ON a curve at x reads its y off the curve", () => {
    const l = layoutSpec({ domain: { x: [0, 10], y: [0, 100] }, elements: [{ id: "w", type: "curve", expr: "x*x" }, { id: "p", type: "point", at: { x: 3, on: "w" } }], commands: [] });
    const w = stroke(l, "w").pts;
    const p = stroke(l, "p");
    const c = p.shapeHint && p.shapeHint.type === "circle" ? p.shapeHint.c : p.pts[0];
    const near = w.reduce((best, q) => (Math.abs(q[0] - c[0]) < Math.abs(best[0] - c[0]) ? q : best), w[0]);
    expect(Math.abs(near[1] - c[1])).toBeLessThan(4);
    expect(l.warnings).toEqual([]);
  });
  test("a point on an unknown curve or off its range warns and is skipped", () => {
    const l = layoutSpec({
      domain: { x: [0, 10], y: [0, 100] },
      elements: [
        { id: "w", type: "curve", expr: "x", x_from: 0, x_to: 5 },
        { id: "p", type: "point", at: { x: 8, on: "w" } },
        { id: "q", type: "point", at: { x: 1, on: "nope" } },
      ],
      commands: [],
    });
    expect(l.warnings.some((w) => w.includes('point "p"') && w.includes("outside"))).toBe(true);
    expect(l.warnings.some((w) => w.includes('point "q"') && w.includes("unknown curve"))).toBe(true);
  });
});
