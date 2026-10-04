// W25: a ring (or box) highlight goes round the element and its own label,
// not through the label.
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

function highlightBox(effect: string): { box: { x: number; y: number; w: number; h: number }; own: { y: number } } {
  const spec = {
    elements: [
      { id: "c", type: "shape", shape: "rect", x: 500, y: 400, width: 200, height: 80 },
      { id: "label_c", type: "text", text: "the cost", x: 500, y: 330, font_size: 26 },
    ],
    commands: [{ draw: ["c", "label_c"], speak: "x" }, { highlight: { target: ["c"], effect }, speak: "y" }],
  } as unknown as Spec;
  const layout = layoutSpec(spec);
  const bboxes = elementBBoxes(layout);
  const p = planCommands(spec.commands!, layout.order, {
    bboxOf: (id: string) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    ...domainMapping(spec.domain, layout.fit),
    ...planOptionsFor(spec, layout),
  } as never);
  const step = p.steps.find((s) => s.kind === "highlight") as unknown as { boxes: Record<string, { x: number; y: number; w: number; h: number }> };
  return { box: step.boxes.c, own: bboxes.get("c")! };
}

describe("ring highlight", () => {
  test("circle: the box takes in the label under the element", () => {
    const { box, own } = highlightBox("circle");
    expect(box.y).toBeLessThan(own.y);
    expect(box.y).toBeLessThanOrEqual(330 - 13);
  });
  test("glow: the element's own box only", () => {
    const { box, own } = highlightBox("glow");
    expect(box).toEqual(own);
  });
});
