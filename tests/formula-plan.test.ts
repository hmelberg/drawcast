import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = { x: 100, y: 100, w: 200, h: 40 };
const opts = { bboxOf: () => box, mathOf: (id: string) => (id === "eq" ? "2x + 3 = 11" : null), isElement: (id: string) => ["eq", "n"].includes(id), bboxesFor: () => () => box };

describe("morph.tex", () => {
  test("a math element morphs to new TeX: a relayout morph step with texItems and tex state; a second morph starts from the first's result", () => {
    const plan = planCommands([{ draw: ["eq"] }, { morph: { target: "eq", tex: "2x = 8" } }, { morph: { target: "eq", tex: "x = 4" } }], ["eq"], opts);
    expect(plan.warnings).toEqual([]);
    const s1 = plan.steps[1] as Extract<PlanStep, { kind: "morph" }>;
    expect(s1.relayout).toBe(true);
    expect(s1.items).toEqual([]);
    expect(s1.texItems).toEqual([{ id: "eq", from: "2x + 3 = 11", to: "2x = 8" }]);
    expect(plan.states[1].tex).toEqual({ eq: "2x = 8" });
    expect((plan.steps[2] as Extract<PlanStep, { kind: "morph" }>).texItems).toEqual([{ id: "eq", from: "2x = 8", to: "x = 4" }]);
  });
  test("tex on a non-math target warns and skips; tex with to is refused", () => {
    const plan = planCommands([{ draw: ["n"] }, { morph: { target: "n", tex: "x" } }, { morph: { target: "eq", tex: "x", to: { ref: "n" } } }], ["eq", "n"], opts);
    expect(plan.warnings).toContain('morph "n": not a math element — tex needs one');
    expect(plan.warnings.some((w) => w.includes("exactly one of"))).toBe(true);
    expect(plan.steps.filter((s) => s.kind === "morph")).toHaveLength(0);
  });
});

describe("copy", () => {
  test("copy mints a clone: copies state, default name, visible, a copy step; the clone can be moved and tex-morphed", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }, { move: { target: "eq_copy", by: [0, -80] } }, { morph: { target: "eq_copy", tex: "2x = 8" } }], ["eq"], opts);
    expect(plan.warnings).toEqual([]);
    expect(plan.steps[1]).toMatchObject({ kind: "copy", ids: ["eq_copy"] });
    expect(plan.states[1].copies).toEqual({ eq_copy: "eq" });
    expect(plan.states[1].visible).toContain("eq_copy");
    expect(plan.states[2].offsets.eq_copy).toEqual([0, -80]);
    expect((plan.steps[3] as Extract<PlanStep, { kind: "morph" }>).texItems).toEqual([{ id: "eq_copy", from: "2x + 3 = 11", to: "2x = 8" }]);
    expect(plan.states[3].tex).toEqual({ eq_copy: "2x = 8" });
    expect(plan.states[3].copies).toEqual({ eq_copy: "eq" });
  });
  test("as names the copy; a taken name, an unknown target and a template id are refused", () => {
    const plan = planCommands([{ draw: ["eq", "n"] }, { copy: { target: "eq", as: "line2" } }, { copy: { target: "eq", as: "n" } }, { copy: { target: "ghost" } }, { copy: { target: "tpl" } }], ["eq", "n", "tpl"], opts);
    expect(plan.states[1].copies).toEqual({ line2: "eq" });
    expect(plan.warnings).toEqual(expect.arrayContaining([expect.stringContaining('copy: "n" is already an element'), expect.stringContaining('copy target "ghost"'), expect.stringContaining('copy target "tpl"')]));
  });
  test("a second unnamed copy of the same element is _copy_2", () => {
    const plan = planCommands([{ draw: ["eq"] }, { copy: { target: "eq" } }, { copy: { target: "eq" } }], ["eq"], opts);
    expect(Object.keys(plan.states[2].copies)).toEqual(["eq_copy", "eq_copy_2"]);
  });
  test("a copy of a copy is copyable — the derivation chain (copy, morph its tex, copy the copy, morph again)", () => {
    const plan = planCommands(
      [
        { draw: ["eq"] },
        { copy: { target: "eq" } },
        { morph: { target: "eq_copy", tex: "2x = 8" } },
        { copy: { target: "eq_copy" } },
        { morph: { target: "eq_copy_copy", tex: "x = 4" } },
      ],
      ["eq"],
      opts,
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.states[3].copies).toEqual({ eq_copy: "eq", eq_copy_copy: "eq_copy" });
    const last = plan.steps[4] as Extract<PlanStep, { kind: "morph" }>;
    expect(last.texItems).toEqual([{ id: "eq_copy_copy", from: "2x = 8", to: "x = 4" }]);
  });
});
