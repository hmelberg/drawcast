// spec 2026-09-17-inset §9 test 12: the planner treats an inset's slot like
// any other element's box — camera can centre on it, move can scale it in
// place. Pattern for building a host spec with a resolved picture borrowed
// from tests/inset-tier2.test.ts.
import { describe, expect, test } from "vitest";
import { CANVAS } from "../src/layout/canvas";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { INSET_H, INSET_RIGHT, INSET_TOP, INSET_W, type InsetPicture } from "../src/layout/inset";
import { pictureOf } from "../src/render/inset";
import { planOptionsFor } from "../src/render/index";
import { planCommands, type PlanStep } from "../src/render/plan";
import type { Spec, SpecElement } from "../src/spec/types";

const SOURCE: Spec = {
  title: "The model",
  elements: [
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
    { id: "cap", type: "text", text: "A triangle", x: 200, y: 340 },
  ],
  commands: [{ draw: ["tri", "cap"] }],
};
const picture = (): InsetPicture => ({ ...pictureOf(SOURCE, heuristicMeasure, planOptionsFor, "pic"), spec: SOURCE, index: 0 });
const inset: SpecElement = { id: "pic", type: "inset", of: "The model", picture: picture() };
const HOST: Spec = {
  elements: [inset],
  commands: [{ draw: ["pic"] }, { camera: { center: { ref: "pic" }, zoom: 2 } }, { move: { target: "pic", scale: 4, to: { x: 500, y: 375 } } }],
};

describe("planning through an inset (spec §9 test 12)", () => {
  test("camera centres on the inset's slot (within the canvas clamp); move scale+to on it plans as a transform", () => {
    const layout = layoutSpec(HOST, heuristicMeasure);
    const bboxes = elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(HOST.commands, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(HOST, layout) });
    expect(plan.warnings).toEqual([]);

    // The default-column slot (spec §4.4/§5): x = INSET_RIGHT - INSET_W, y = INSET_TOP - INSET_H.
    const slot = bboxes.get("pic")!;
    expect(slot).toEqual({ x: INSET_RIGHT - INSET_W, y: INSET_TOP - INSET_H, w: INSET_W, h: INSET_H });
    const slotCentre = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };

    const cam = plan.steps.find((s): s is Extract<PlanStep, { kind: "camera" }> => s.kind === "camera");
    expect(cam).toBeDefined();
    expect(cam!.box).not.toBeNull();
    // zoom: 2 wants a 500x375 window centred on the slot, but the slot sits
    // in the top-right corner, so the window is clamped to stay inside the
    // canvas (plan.ts's own camera clamp) rather than truly centred on it.
    const w = CANVAS.w / 2;
    const h = CANVAS.h / 2;
    const expected = {
      x: Math.min(Math.max(slotCentre.x - w / 2, 0), CANVAS.w - w),
      y: Math.min(Math.max(slotCentre.y - h / 2, 0), CANVAS.h - h),
      w,
      h,
    };
    expect(cam!.box).toEqual(expected);

    // move {target, scale, to} is a pose change (scale/to present), not a
    // plain translation, so it plans as a "transform" step, not "move"
    // (src/render/plan.ts: the hasScale/hasTo branch pushes kind: "transform").
    const moveStep = plan.steps.find((s) => s.kind === "transform" || s.kind === "move");
    expect(moveStep).toBeDefined();
    expect(moveStep!.kind).toBe("transform");
    const items = (moveStep as Extract<PlanStep, { kind: "transform" }>).items;
    expect(items.map((it) => it.id)).toContain("pic");
  });
});
