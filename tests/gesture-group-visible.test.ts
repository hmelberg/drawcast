// A gesture at a set (a template's matrix_row_<s>, a group) while only some
// of it is drawn: it lands on the members on screen, without a warning an
// example could not carry; only a set with nothing on screen warns
// (2026-09-27, the transition-matrix tutorial: highlighting a row as it is
// written in).

import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const ids = ["a", "b", "c"];
const expandGroup = (id: string) => (id === "row" ? ["a", "b", "c"] : null);

describe("highlight and focus of a set", () => {
  for (const verb of ["highlight", "focus"] as const) {
    test(`${verb}: the members on screen, no warning`, () => {
      const p = planCommands([{ draw: ["a", "b"] }, { [verb]: { target: ["row"] } }], ids, { expandGroup });
      const step = p.steps.find((s): s is Extract<PlanStep, { kind: typeof verb }> => s.kind === verb)!;
      expect(step.ids).toEqual(["a", "b"]);
      expect(p.warnings).toEqual([]);
    });
    test(`${verb}: nothing of the set on screen warns, naming the set`, () => {
      const p = planCommands([{ [verb]: { target: ["row"] } }], ids, { expandGroup });
      expect(p.steps.some((s) => s.kind === verb)).toBe(false);
      expect(p.warnings.join(" ")).toMatch(new RegExp(`${verb} target "row" is not visible`));
    });
    test(`${verb}: a plain id not yet drawn still warns`, () => {
      const p = planCommands([{ draw: ["a"] }, { [verb]: { target: ["a", "c"] } }], ids, { expandGroup });
      expect(p.warnings.join(" ")).toMatch(new RegExp(`${verb} target "c" is not visible`));
    });
  }
});
