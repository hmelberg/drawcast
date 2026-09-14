import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (el: object, commands: object[] = [{ draw: ["sim"] }]): Spec =>
  ({ elements: [{ id: "sim", type: "code", language: "python", code: "n = (1, 50)\nprint(n)", controls: ["n"], ...el }], commands }) as unknown as Spec;
const rules = (s: Spec) => lintCommands(s).filter((i) => i.rule === "pane");

describe("pane — schema", () => {
  test("code | controls accepted; junk rejected", () => {
    expect(validateSpec(spec({ show: "left", pane: "controls" })).ok).toBe(true);
    expect(validateSpec(spec({ show: "left", pane: "code" })).ok).toBe(true);
    expect(validateSpec(spec({ show: "left", pane: "knobs" })).ok).toBe(false);
  });
});

describe("pane — lint", () => {
  test("controls pane on a side is clean", () => {
    expect(rules(spec({ show: "left", pane: "controls" }))).toEqual([]);
  });
  test("pane with show output or none warns", () => {
    expect(rules(spec({ show: "output", pane: "controls" }))[0]).toMatchObject({ severity: "warn", ids: ["sim"] });
    expect(rules(spec({ show: "none", pane: "controls" }))[0]).toMatchObject({ severity: "warn" });
  });
  test("pane: controls without controls is an error", () => {
    expect(rules(spec({ show: "left", pane: "controls", controls: [] }))[0]).toMatchObject({ severity: "error" });
    expect(rules(spec({ show: "left", pane: "controls", controls: undefined }))[0]).toMatchObject({ severity: "error" });
  });
  test("lines or marks with pane: controls warn", () => {
    expect(rules(spec({ show: "left", pane: "controls", lines: 4 }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("lines") });
    expect(rules(spec({ show: "left", pane: "controls", marks: ["n"] }))[0]).toMatchObject({ severity: "warn", message: expect.stringContaining("marks") });
  });
});
