// tests/code-controls-lint.test.ts
// The `controls` lint (spec 2026-09-14 §2.7): every error the repair round
// must see, every warning, each with a spec that trips it and one that does not.
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = [{ draw: ["sim"] }], params?: object): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", show: "left", ...el }], commands, ...(params ? { template: "bar_chart", params } : {}) }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "controls");

describe("controls lint — errors", () => {
  test("a clean script has no issues", () => {
    expect(rules(spec({ controls: ["n"], code: "n = (1, 50)\nprint(n)" }))).toEqual([]);
  });
  test("no birthplace", () => {
    const [i] = rules(spec({ controls: ["n"], code: "print(1)" }));
    expect(i).toMatchObject({ severity: "error", ids: ["sim"] });
    expect(i.message).toContain("no birthplace");
  });
  test("born twice", () => {
    expect(rules(spec({ controls: ["n"], code: "n = (1, 5)\nn = (2, 6)" }))[0]).toMatchObject({ severity: "error" });
  });
  test("not a control literal", () => {
    expect(rules(spec({ controls: ["n"], code: "n = {'a': 1}" }))[0]).toMatchObject({ severity: "error" });
  });
  test("bad longhand argument", () => {
    expect(rules(spec({ controls: ["n"], code: "n = Slider(1, 50, default=99)" }))[0]).toMatchObject({ severity: "error" });
  });
  test("controls on a basic script", () => {
    expect(rules(spec({ language: "basic", controls: ["N"], code: "10 N = 5" }))[0]).toMatchObject({ severity: "error" });
  });
  test("controls on a non-code element", () => {
    const s = { elements: [{ id: "t", type: "text", text: "hi", controls: ["x"] }], commands: [{ draw: ["t"] }] } as unknown as Spec;
    expect(rules(s)[0]).toMatchObject({ severity: "error", ids: ["t"] });
  });
});

describe("controls lint — warnings", () => {
  test("an explicit keyword at a call site defeats the control", () => {
    const [i] = rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nsim(n=5)" }));
    expect(i).toMatchObject({ severity: "warn" });
    expect(i.message).toContain("sim(n=");
    expect(rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nsim()" }))).toEqual([]);
  });
  test("a comparison is not a call-site override", () => {
    expect(rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nprint(check(n == 5))" }))).toEqual([]);
    const [i] = rules(spec({ controls: ["n"], code: "def sim(n=(1, 50)):\n    return n\nsim(n=5)" }));
    expect(i).toMatchObject({ severity: "warn" });
    expect(i.message).toContain("sim(n=");
  });
  test("a later plain-literal reassignment", () => {
    expect(rules(spec({ controls: ["x"], code: "x = (1, 50)\nx = 5" }))[0]).toMatchObject({ severity: "warn" });
  });
  test("a step that does not divide the range; two controls with one label", () => {
    expect(rules(spec({ controls: ["x"], code: "x = (0, 10, 3)" }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("divide") });
    expect(rules(spec({ controls: ["a", "b"], code: 'a = Slider(1, 5, label="Same")\nb = Slider(1, 5, label="Same")' }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("label") });
  });
  test("a hidden pane that feeds nothing", () => {
    expect(rules(spec({ controls: ["n"], show: "none", code: "n = (1, 50)" }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("nothing visible") });
    // Fed through a token: fine.
    expect(rules(spec({ controls: ["n"], show: "none", code: "n = (1, 50)\ny = [n]" }, [{ draw: ["sim"] }], { values: "{sim.y}" }))).toEqual([]);
  });
});
