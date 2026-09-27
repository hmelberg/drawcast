import { expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { expandSpec } from "../src/spec/expand";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import type { Spec } from "../src/spec/types";

// The prompt offers {data: [x, y]} "in `at`"; validation used to refuse it on
// text and math (prompt lab 2026-09-27). It validates now, and lands where
// the page's domain puts that data point.
test("a text placed with at.data validates and lands on its data position", () => {
  const spec = {
    domain: { x: [0, 100], y: [0, 100] },
    elements: [
      { id: "ax", type: "axes" },
      { id: "t", type: "text", text: "here", at: { data: [50, 50] } },
    ],
    commands: [{ draw: ["ax", "t"] }],
  } as unknown as Spec;
  expect(validateSpec(spec).ok).toBe(true);
  const layout = layoutSpec(expandSpec(spec), heuristicMeasure);
  const box = elementBBoxes(layout).get("t")!;
  const [cx, cy] = domainMapping(spec.domain).toLogical([50, 50]);
  expect(Math.abs(box.x + box.w / 2 - cx)).toBeLessThan(box.w);
  expect(Math.abs(box.y + box.h / 2 - cy)).toBeLessThan(box.h * 2);
});
