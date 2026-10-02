// tests/formula-expr.test.ts
import { describe, expect, test } from "vitest";
import { equivalent, evaluate, exactEqual, exprToTeX, normTeX, parseAscii, texToExpr, type Expr } from "../src/formula/expr";

const p = (s: string): Expr => {
  const e = parseAscii(s);
  if ("error" in e) throw new Error(e.error);
  return e;
};
const t = (s: string): Expr => {
  const e = texToExpr(s);
  if (!e) throw new Error(`no expr for ${s}`);
  return e;
};

describe("parseAscii", () => {
  test("implied multiplication and unicode", () => {
    expect(evaluate(p("2r"), { r: 3 })).toBe(6);
    expect(evaluate(p("pi r^2"), { r: 2 })).toBeCloseTo(4 * Math.PI);
    expect(evaluate(p("π·r²"), { r: 2 })).toBeCloseTo(4 * Math.PI);
    expect(evaluate(p("2(a+b)"), { a: 1, b: 2 })).toBe(6);
    expect(evaluate(p("(a+b)/2"), { a: 1, b: 3 })).toBe(2);
    expect(evaluate(p("sqrt(x)"), { x: 9 })).toBe(3);
    expect(evaluate(p("√x"), { x: 16 })).toBe(4);
    expect(evaluate(p("x^-1"), { x: 4 })).toBe(0.25);
    expect(evaluate(p("3 × 4"), {})).toBe(12);
    expect(evaluate(p("2,5"), {})).toBe(2.5); // comma decimal
  });
  test("power binds tighter than unary minus; right-associative", () => {
    expect(evaluate(p("-x^2"), { x: 3 })).toBe(-9);
    expect(evaluate(p("2^3^2"), {})).toBe(512);
  });
  test("errors are values, not throws", () => {
    expect("error" in (parseAscii("2+") as object)).toBe(true);
    expect("error" in (parseAscii("(a+b") as object)).toBe(true);
    expect("error" in (parseAscii("") as object)).toBe(true);
  });
});

describe("texToExpr", () => {
  test("the supported subset", () => {
    expect(evaluate(t("r^2"), { r: 3 })).toBe(9);
    expect(evaluate(t("\\frac{v^2}{2a}"), { v: 4, a: 2 })).toBe(4);
    expect(evaluate(t("\\sqrt{x}"), { x: 4 })).toBe(2);
    expect(evaluate(t("2\\pi r"), { r: 1 })).toBeCloseTo(2 * Math.PI);
    expect(evaluate(t("a \\cdot b"), { a: 2, b: 5 })).toBe(10);
    expect(evaluate(t("\\left(a+b\\right)^{2}"), { a: 1, b: 1 })).toBe(4);
    expect(evaluate(t("x_1 + x_2"), { x_1: 1, x_2: 2 })).toBe(3);
  });
  test("outside the subset → null", () => {
    expect(texToExpr("\\sum_{i=1}^n i")).toBeNull();
    expect(texToExpr("\\int x dx")).toBeNull();
  });
  test("TeX function words are outside the subset, not misread (`\\sin 2x` is not sin(2)·x)", () => {
    for (const w of ["sin", "cos", "tan", "ln", "log", "exp"]) {
      expect(texToExpr(`\\${w} 2x`)).toBeNull();
    }
    expect(texToExpr("\\sin x^2")).toBeNull();
  });
});

describe("equivalent", () => {
  test("same value, different form", () => {
    expect(equivalent(p("r*r"), t("r^2"))).toBe(true);
    expect(equivalent(p("r r"), t("r^2"))).toBe(true);
    expect(equivalent(p("(a+b)/2"), t("\\frac{a}{2}+\\frac{b}{2}"))).toBe(true);
  });
  test("different value", () => {
    expect(equivalent(p("2r"), t("r^2"))).toBe(false);
  });
  test("a letter the truth does not have is wrong (review focus 1)", () => {
    expect(equivalent(p("pi d^2/4"), t("\\pi r^2"))).toBe(false);
  });
  test("points outside the domain are skipped (review focus 2)", () => {
    expect(equivalent(p("sqrt(x-2)"), t("\\sqrt{x-2}"))).toBe(true);
    expect(equivalent(p("sqrt(x-2)"), t("\\sqrt{x-3}"))).toBe(false);
  });
});

describe("exact form", () => {
  test("printed back and compared", () => {
    expect(exprToTeX(p("pi r^2"))).toBe("\\pi r^{2}");
    expect(exactEqual(p("pi r^2"), "\\pi r^2")).toBe(true);
    expect(exactEqual(p("pi r r"), "\\pi r^2")).toBe(false);
    expect(normTeX(" { r^{2} } ")).toBe("r^2");
  });
});
