import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import type { LayoutOverrides } from "../src/layout/posed";
import type { Spec } from "../src/spec/types";

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
    expect(calls).toEqual([{ params: {}, overrides: { poses: { d: { offset: [50, 0], turn: undefined } }, shapes: {}, math: {}, copies: {} } }]);
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
  test("a dependent moved together with its source leaves the moving set, so it is never displaced twice (review finding 1)", () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: ["d", "eq"], by: [50, 0] } }], ["d", "eq"], {
      bboxOf: (id) => boxes[id] ?? null,
      dependentsOf,
      sourceIds: ["d"],
      bboxesFor: () => (id) => boxes[id] ?? null,
    });
    const mv = plan.steps[1] as Extract<PlanStep, { kind: "move" }>;
    expect(mv.ids).toEqual(["d"]);
    expect(mv.relayout).toBe(true);
    expect(plan.states[1].offsets.d).toEqual([50, 0]);
    expect(plan.states[1].offsets.eq).toBeUndefined();
    expect(plan.warnings).toEqual(['move target "eq" is defined by another target and follows it — its own move is dropped']);
  });
  test("a group as a source: the move of its members carries the poses the group's dependents follow (review finding 2)", () => {
    const spec: Spec = {
      elements: [
        { id: "p1", type: "shape", shape: "rect", x: 100, y: 100, width: 100, height: 50 },
        { id: "p2", type: "shape", shape: "rect", x: 300, y: 100, width: 100, height: 50 },
        { id: "g", type: "group", members: ["p1", "p2"] },
        { id: "a", type: "arrow", from: { ref: "g" }, to: { x: 500, y: 600 } },
      ],
      commands: [{ draw: ["p1", "p2", "a"] }, { move: { target: "g", by: [0, 200] } }],
    };
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const seen: LayoutOverrides[] = [];
    const plan = planCommands(spec.commands, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      bboxesFor: (_p, overrides) => {
        seen.push(overrides!);
        const b = elementBBoxes(layoutSpec(spec, undefined, overrides));
        return (id) => b.get(id) ?? null;
      },
      ...planOptionsFor(spec, layout),
    });
    expect(plan.warnings).toEqual([]);
    expect(plan.sources).toEqual(["g", "p1", "p2"]);
    const mv = plan.steps[1] as Extract<PlanStep, { kind: "move" }>;
    expect(mv.relayout).toBe(true);
    expect(Object.keys(seen[0].poses!).sort()).toEqual(["p1", "p2"]);
    const moved = layoutSpec(spec, undefined, seen[0]);
    const tail = (l: ReturnType<typeof layoutSpec>) => (l.drawables.find((d) => d.id === "a") as { pts: [number, number][] }).pts[0];
    expect(tail(moved)[1]).toBeGreaterThan(tail(layout)[1] + 150);
  });
  test("a ghost minted after a source moved carries that boundary's poses, and params instead of null (review finding 5)", () => {
    const plan = planCommands([{ draw: ["d", "eq"] }, { move: { target: "d", by: [50, 0] } }, { keep: { target: "eq" } }], ["d", "eq"], {
      bboxOf: (id) => boxes[id] ?? null,
      dependentsOf,
      sourceIds: ["d"],
      bboxesFor: () => (id) => boxes[id] ?? null,
    });
    const ghost = plan.minted.find((m) => m.kind === "ghost") as { params: unknown; overrides?: LayoutOverrides };
    expect(ghost.params).toEqual({});
    expect(ghost.overrides?.poses?.d.offset).toEqual([50, 0]);
    const plain = planCommands([{ draw: ["n"] }, { keep: { target: "n" } }], ["n"], { bboxOf: (id) => boxes[id] ?? null });
    expect((plain.minted[0] as { params: unknown }).params).toBeNull();
  });
  test("without dependentsOf nothing changes: no relayout flags, no sources", () => {
    const plan = planCommands([{ draw: ["d"] }, { move: { target: "d", by: [5, 5] } }], ["d"], { bboxOf: (id) => boxes[id] ?? null });
    expect((plan.steps[1] as Extract<PlanStep, { kind: "move" }>).relayout).toBeUndefined();
    expect(plan.sources).toEqual([]);
  });
});
