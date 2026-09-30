// tests/picture-marks-frames.test.ts — the dev frames sheet holds a narrated mark beat mid-gesture, as it does a highlight.
import { expect, test } from "vitest";
import { gestureAt, gestureLabel } from "../src/dev/gesture-beats";
import { planCommands } from "../src/render/plan";
import { FULL_VIEW4 } from "../src/spec/places";

const rect = { x: 100, y: 300, w: 400, h: 200 };
const opts = {
  bboxOf: (id: string) => (id === "md" ? rect : null),
  pictureOf: (id: string) => (id === "md" ? { frame: { rect, view: FULL_VIEW4 }, regions: { left: [0, 0, 0.5, 1] } } : null),
};

test("a narrated mark beat is a gesture the sheet paints", () => {
  const plan = planCommands([{ draw: ["md"] }, { highlight: { target: "md:left" }, speak: "Look here." }] as never, ["md"], opts as never);
  const at = plan.steps.findIndex((s) => s.kind === "mark") + 1;
  expect(at).toBeGreaterThan(0);
  const g = gestureAt(plan, at);
  expect(g?.kind).toBe("mark");
  expect(gestureLabel(g!)).toBe("light mark");
});
