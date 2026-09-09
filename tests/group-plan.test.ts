import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const bbox = { body: { x: 300, y: 300, w: 60, h: 200 }, cap: { x: 310, y: 500, w: 40, h: 40 } };

describe("group as a command target", () => {
  test("draw, highlight and move expand to the members", () => {
    const plan = planCommands(
      [{ draw: ["pump"] }, { highlight: { target: ["pump"], effect: "pulse" } }, { move: { target: ["pump"], by: [10, 0] } }],
      ["body", "cap"],
      { expandGroup: (id) => (id === "pump" ? ["body", "cap"] : null), bboxOf: (id) => bbox[id as keyof typeof bbox] },
    );
    expect(plan.warnings).toEqual([]);
    expect(plan.steps[0]).toMatchObject({ kind: "draw", ids: ["body", "cap"] });
    expect(plan.steps[1]).toMatchObject({ kind: "highlight", ids: ["body", "cap"] });
    expect(plan.states[2].visible).toEqual(expect.arrayContaining(["body", "cap"]));
  });
  test("rotate on a group turns about the union centre, not each member's own", () => {
    const plan = planCommands([{ draw: ["body", "cap"] }, { move: { target: ["pump"], rotate: 90 } }], ["body", "cap"], {
      expandGroup: (id) => (id === "pump" ? ["body", "cap"] : null), bboxOf: (id) => bbox[id as keyof typeof bbox],
    });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.kind).toBe("transform");
    // union box: x 300..360, y 300..540 → centre (330, 420); at rest the pose
    // is the identity, so the recorded (original-frame) pivot IS that point.
    expect(step.items.find((it) => it.id === "body")!.to.turn.pivot).toEqual([330, 420]);
    expect(step.items.find((it) => it.id === "cap")!.to.turn.pivot).toEqual([330, 420]);
    // …and each member really turns about it: 90° about (330, 420) sends
    // body's centre (330, 400) to (350, 420) and cap's (330, 520) to (230, 420).
    const centreNow = (id: keyof typeof bbox) => {
      const it = step.items.find((x) => x.id === id)!;
      const b = bbox[id];
      const [px, py] = it.to.turn.pivot;
      const [cx, cy] = [b.x + b.w / 2 - px, b.y + b.h / 2 - py];
      const rad = (it.to.turn.deg * Math.PI) / 180;
      return [px + cx * Math.cos(rad) - cy * Math.sin(rad) + it.to.offset[0], py + cx * Math.sin(rad) + cy * Math.cos(rad) + it.to.offset[1]];
    };
    expect(centreNow("body")[0]).toBeCloseTo(350, 6);
    expect(centreNow("body")[1]).toBeCloseTo(420, 6);
    expect(centreNow("cap")[0]).toBeCloseTo(230, 6);
    expect(centreNow("cap")[1]).toBeCloseTo(420, 6);
  });
  test("point aims at the group's union box, as it does at a pieces parent", () => {
    const plan = planCommands([{ draw: ["body", "cap"] }, { point: { at: { ref: "pump" } } }], ["body", "cap"], {
      expandGroup: (id) => (id === "pump" ? ["body", "cap"] : null), bboxOf: (id) => bbox[id as keyof typeof bbox],
    });
    expect(plan.warnings).toEqual([]);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "point" }>;
    expect([step.x, step.y]).toEqual([330, 420]);
    expect(step.box).toEqual({ x: 300, y: 300, w: 60, h: 240 });
  });
});
