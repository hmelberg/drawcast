import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const base = { elements: [{ id: "w", type: "curve", expr: "sin(f*x)" }], commands: [{ draw: ["w"] }] };

describe("vars, bind, at.on and trail validate", () => {
  test("a spec with vars, a bind, a point on a curve and a trailing animate is valid", () => {
    const r = validateSpec({
      ...base,
      vars: { f: 1, t: 2 },
      elements: [...base.elements, { id: "dot", type: "point", at: { x: 1, on: "w" }, bind: { "at.x": "t" } }],
      commands: [{ draw: ["w", "dot"] }, { animate: { f: 3 }, trail: { of: "dot" }, duration: 4 }],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  test("a reserved var name is an error", () => {
    const r = validateSpec({ ...base, vars: { x: 1 } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('"x" is reserved'))).toBe(true);
  });
  test("a non-numeric var and a non-string bind are structural errors", () => {
    expect(validateSpec({ ...base, vars: { f: "1" } }).ok).toBe(false);
    expect(validateSpec({ ...base, elements: [{ id: "w", type: "curve", expr: "x", bind: { x_to: 3 } }] }).ok).toBe(false);
  });
  test("at.on needs x; trail needs of", () => {
    const r = validateSpec({ ...base, elements: [...base.elements, { id: "p", type: "point", at: { on: "w" } }] });
    expect(r.errors.some((e) => e.includes("at.on needs x"))).toBe(true);
    expect(validateSpec({ ...base, commands: [{ animate: { f: 1 }, trail: {} }], vars: { f: 0 } }).ok).toBe(false);
  });
});
