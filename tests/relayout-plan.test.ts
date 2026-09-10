import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const boxes: Record<string, ReturnType<typeof box>> = { d: box(100, 100, 300, 200), eq: box(240, 190, 20, 20), n: box(600, 600, 40, 40) };
const dependentsOf = (id: string) => (id === "d" ? ["eq", "a"] : []);

describe("relayout steps", () => {
  test("a move whose target has dependents is marked relayout and switches the bbox source with the poses", () => {
    const calls: unknown[] = [];
    const plan = planCommands([{ draw: ["d", "eq", "n"] }, { move: { target: "d", by: [50, 0] } }, { point: { at: { ref: "eq" } } }], ["d", "eq", "a", "n"], {
      bboxOf: (id) => boxes[id] ?? null,
      dependentsOf,
      sourceIds: ["d"],
      bboxesFor: (params, overrides) => {
        calls.push({ params, overrides });
        return (id) => (id === "eq" ? box(290, 220, 20, 20) : boxes[id] ?? null);
      },
    });
    const mv = plan.steps[1] as Extract<PlanStep, { kind: "move" }>;
    expect(mv.relayout).toBe(true);
    expect(calls).toEqual([{ params: {}, overrides: { poses: { d: { offset: [50, 0], turn: undefined } }, shapes: {} } }]);
    const pt = plan.steps[2] as Extract<PlanStep, { kind: "point" }>;
    expect(pt.x).toBeCloseTo(300, 6); // the post-move intersection box
    expect(plan.sources).toEqual(["d"]);
  });
  test("a move of an element nothing depends on is a plain move and never calls bboxesFor", () => {
    let calls = 0;
    const plan = planCommands([{ draw: ["n"] }, { move: { target: "n", by: [5, 5] } }], ["n"], {
      bboxOf: (id) => boxes[id] ?? null,
      dependentsOf,
      sourceIds: ["d"],
      bboxesFor: () => {
        calls++;
        return () => null;
      },
    });
    expect((plan.steps[1] as Extract<PlanStep, { kind: "move" }>).relayout).toBeUndefined();
    expect(calls).toBe(0);
  });
  test("a rotate (transform) and a morph of a source are relayout steps; the overrides carry only source ids", () => {
    const seen: unknown[] = [];
    const plan = planCommands([{ draw: ["d", "n"] }, { move: { target: ["d", "n"], rotate: 30 } }, { morph: { target: "d", stretch: [2, 1] } }], ["d", "n"], {
      bboxOf: (id) => boxes[id] ?? null,
      dependentsOf,
      sourceIds: ["d"],
      leafPointsOf: (id) => (id === "d" ? [{ leafId: "d", pts: [[100, 100], [400, 300]], closed: false }] : null),
      bboxesFor: (_p, overrides) => {
        seen.push(overrides);
        return (id) => boxes[id] ?? null;
      },
    });
    expect((plan.steps[1] as Extract<PlanStep, { kind: "transform" }>).relayout).toBe(true);
    expect((plan.steps[2] as Extract<PlanStep, { kind: "morph" }>).relayout).toBe(true);
    expect(Object.keys((seen[0] as { poses: object }).poses)).toEqual(["d"]);
    expect(Object.keys((seen[1] as { shapes: object }).shapes)).toEqual(["d"]);
  });
  test("without dependentsOf nothing changes: no relayout flags, no sources", () => {
    const plan = planCommands([{ draw: ["d"] }, { move: { target: "d", by: [5, 5] } }], ["d"], { bboxOf: (id) => boxes[id] ?? null });
    expect((plan.steps[1] as Extract<PlanStep, { kind: "move" }>).relayout).toBeUndefined();
    expect(plan.sources).toEqual([]);
  });
});
