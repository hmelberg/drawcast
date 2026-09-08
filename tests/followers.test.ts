import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
// A 100×50 box with its label centred at (120, 25), just right of it.
const boxes: Record<string, ReturnType<typeof box>> = { sq: box(0, 0, 100, 50), label_sq: box(110, 20, 20, 10), label_sq_leader: box(100, 25, 10, 1) };
const opts = {
  bboxOf: (id: string) => boxes[id] ?? null,
  attachedTo: (id: string) => (id === "sq" ? ["label_sq", "label_sq_leader"] : []),
};
const items = (plan: ReturnType<typeof planCommands>, i = 0) => (plan.steps[i] as Extract<PlanStep, { kind: "transform" }>).items;

describe("followers ride the pose change (design §2.2)", () => {
  test("a rotation of 90° about the box's bottom_left swings the label round: its centre (120,25) → (−25,120)", () => {
    const plan = planCommands([{ move: { target: ["sq"], rotate: 90, pivot: { anchor: "bottom_left" } } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset[0]).toBeCloseTo(-25 - 120, 6);
    expect(lab.to.offset[1]).toBeCloseTo(120 - 25, 6);
    expect(lab.to.turn.deg).toBe(0); // the text never turns
  });
  test("a scale ×2 about bottom_left pushes the label out with the far side: (120,25) → (240,50)", () => {
    const plan = planCommands([{ move: { target: ["sq"], scale: 2, pivot: { anchor: "bottom_left" } } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset).toEqual([120, 25]);
    expect(lab.to.turn.scale ?? 1).toBe(1);
  });
  test("a pure translation is today's delta exactly", () => {
    const plan = planCommands([{ move: { target: ["sq"], to: [500, 500] } }], ["sq", "label_sq", "label_sq_leader"], opts);
    const lab = items(plan).find((it) => it.id === "label_sq")!;
    expect(lab.to.offset).toEqual([450, 475]);
  });
  test("arrange zipper carries a slice's label (it used to leave it behind)", () => {
    const pieces = { p_1: { apex: [300, 375] as [number, number], centroid: [330, 390] as [number, number], midAngle: 45, halfAngle: 45, radius: 120 }, p_2: { apex: [300, 375] as [number, number], centroid: [270, 390] as [number, number], midAngle: 135, halfAngle: 45, radius: 120 } };
    const b: Record<string, ReturnType<typeof box>> = { p_1: box(300, 375, 120, 120), p_2: box(180, 375, 120, 120), label_p_1: box(340, 400, 20, 10) };
    const plan = planCommands([{ arrange: { target: ["p_1", "p_2"], layout: "zipper", at: [600, 375] } }], ["p_1", "p_2", "label_p_1"], {
      bboxOf: (id) => b[id] ?? null,
      pieceOf: (id) => pieces[id as keyof typeof pieces] ?? null,
      attachedTo: (id) => (id === "p_1" ? ["label_p_1"] : []),
    });
    const lab = items(plan).find((it) => it.id === "label_p_1");
    expect(lab).toBeDefined();
    expect(Math.hypot(lab!.to.offset[0], lab!.to.offset[1])).toBeGreaterThan(100);
  });
});
