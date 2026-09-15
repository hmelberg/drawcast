import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";

const doc = (cmd: object) => ({ elements: [{ id: "sim", type: "code", language: "python", show: "left", controls: ["beta"], code: "beta = (0.1, 1.0)" }], commands: [cmd] });

describe("schema: run and explore.play", () => {
  test("run with values in every series shape validates", () => {
    expect(validateSpec(doc({ run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 5 }, k: [1, 2], s: "a", t: true, n: 3 }, every: 0.3, loop: 2 } })).ok).toBe(true);
  });
  test("run needs code and values; loop is an integer ≥ 1; unknown keys fail", () => {
    expect(validateSpec(doc({ run: { values: { beta: 1 } } })).ok).toBe(false);
    expect(validateSpec(doc({ run: { code: "sim" } })).ok).toBe(false);
    expect(validateSpec(doc({ run: { code: "sim", values: { beta: 1 }, loop: 0 } })).ok).toBe(false);
    expect(validateSpec(doc({ run: { code: "sim", values: { beta: 1 }, bogus: 1 } })).ok).toBe(false);
  });
  test("smooth: false validates on both run and explore.play", () => {
    expect(validateSpec(doc({ run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 5 } }, smooth: false } })).ok).toBe(true);
    expect(validateSpec(doc({ explore: { code: "sim", play: { values: { beta: { from: 0.1, to: 0.9, steps: 5 } }, smooth: false } } })).ok).toBe(true);
  });
  test("explore.play accepts false or the run shape without code", () => {
    expect(validateSpec(doc({ explore: { code: "sim", play: false } })).ok).toBe(true);
    expect(validateSpec(doc({ explore: { code: "sim", play: { values: { beta: [0.2, 0.4] }, every: 0.4 } } })).ok).toBe(true);
    expect(validateSpec(doc({ explore: { code: "sim", play: { code: "sim", values: { beta: 1 } } } })).ok).toBe(false);
  });
});
