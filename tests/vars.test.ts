import { describe, expect, test } from "vitest";
import { evalBindings, exprVariables, formatVar, interpolateVars, varNameErrors } from "../src/spec/vars";
import { sampleExpression } from "../src/layout/curves";
import type { SpecElement } from "../src/spec/types";

describe("var names", () => {
  test("plain names pass; reserved, malformed and non-finite fail", () => {
    expect(varNameErrors({ f: 1, a_2: 0.5 })).toEqual([]);
    expect(varNameErrors({ x: 1 })).toEqual(['vars: "x" is reserved (a curve variable, a function or a constant of expressions)']);
    expect(varNameErrors({ sin: 1 })[0]).toContain("reserved");
    expect(varNameErrors({ pi: 1 })[0]).toContain("reserved");
    expect(varNameErrors({ "2f": 1 })[0]).toContain("not a name");
    expect(varNameErrors({ f: Infinity })[0]).toContain("finite number");
    expect(varNameErrors(["f"])[0]).toContain("an object");
  });
  test("exprVariables is the six curve names plus the vars", () => {
    expect(exprVariables({ f: 1 })).toEqual(["x", "X", "q", "Q", "t", "T", "f"]);
    expect(exprVariables(undefined)).toEqual(["x", "X", "q", "Q", "t", "T"]);
  });
});

describe("text tokens", () => {
  test("{f} is formatted by the measure rule, {f:2} by explicit decimals, unknown names stay and are reported", () => {
    expect(formatVar(1.57)).toBe("1.6");
    expect(formatVar(60)).toBe("60");
    expect(formatVar(540.4)).toBe("540");
    expect(formatVar(1.57, 2)).toBe("1.57");
    expect(interpolateVars("f = {f}, twice {f:2}", { f: 1.57 })).toEqual({ text: "f = 1.6, twice 1.57", unknown: [] });
    expect(interpolateVars("k = {k}", { f: 1 })).toEqual({ text: "k = {k}", unknown: ["k"] });
    expect(interpolateVars("no tokens", { f: 1 })).toEqual({ text: "no tokens", unknown: [] });
  });
});

describe("bindings", () => {
  test("a bound field is replaced by the expression's value; dot paths reach nested numbers", () => {
    const el = { id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 30, bind: { end: "30 + 60*f", "at.x": "2*f" }, at: { x: 1, on: "w" } } as unknown as SpecElement;
    const r = evalBindings(el, { f: 2 });
    expect(r.errors).toEqual([]);
    expect(r.el.end).toBe(150);
    expect((r.el.at as { x: number }).x).toBe(4);
    expect(el.end).toBe(30); // the original is untouched
    expect((el.at as { x: number }).x).toBe(1);
  });
  test("a non-numeric path and an unknown var are errors and the binding is dropped", () => {
    const el = { id: "s", type: "sector", x: 1, radius: 5, bind: { text: "f", radius: "g*2" } } as unknown as SpecElement;
    const r = evalBindings(el, { f: 1 });
    expect(r.errors).toEqual([
      'element "s": bind "text" — not a numeric field of the element',
      'element "s": bind "radius" — unknown identifier "g"',
    ]);
    expect((r.el as { text?: unknown }).text).toBeUndefined();
  });
  test("a binding that evaluates to a non-finite number is an error", () => {
    const el = { id: "s", type: "sector", radius: 10, bind: { radius: "1/0" } } as unknown as SpecElement;
    expect(evalBindings(el, {}).errors[0]).toContain("not a finite number");
  });
  test("an element without bind is returned as is", () => {
    const el = { id: "s", type: "sector", radius: 10 } as unknown as SpecElement;
    expect(evalBindings(el, { f: 1 }).el).toBe(el);
  });
});

describe("sampleExpression with vars", () => {
  test("sin(f*x) at f = 2 matches Math.sin; without the var the expression is rejected", () => {
    const pts = sampleExpression("sin(f*x)", 0, 3, { f: 2 });
    expect(pts[pts.length - 1][1]).toBeCloseTo(Math.sin(6), 9);
    expect(() => sampleExpression("sin(f*x)", 0, 3)).toThrow(/unknown identifier "f"/);
  });
});
