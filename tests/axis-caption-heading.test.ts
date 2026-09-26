// A y-axis caption keeps out of the card heading (2026-09-25): above the
// arrow tip is the heading's strip, so a caption that would reach into the
// heading itself goes beside the tip instead — right of the arrow, under the
// underline. One that clears the heading stays where it always was.
import { expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { expandSpec } from "../src/spec/expand";

const chart = (title: string, yLabel: string) =>
  expandSpec({
    domain: { x: [0, 10], y: [0, 10] },
    elements: [{ id: "ax", type: "axes", x_label: "Time", y_label: yLabel }, { id: "c", type: "curve", expr: "10 - x" }],
    commands: [{ card: { title } }, { draw: ["ax", "c"] }],
  } as never);

const caption = (spec: object) => {
  const l = layoutSpec(spec as never, heuristicMeasure);
  const t = flattenDrawables(l.drawables).find((d) => d.id === "ax_y_label") as { pos: [number, number]; anchor: string };
  return { l, t };
};

test("a wide title and a long caption: beside the tip, and no heading intrusion", () => {
  const { l, t } = caption(chart("Why the acceptability curve slopes", "Probability cost-effective"));
  expect(t.anchor).toBe("start");
  expect(l.issues.filter((i) => i.rule === "heading-intrusion")).toEqual([]);
});

test("a short title leaves the caption above the arrow, as before", () => {
  const { t } = caption(chart("Decay", "Price"));
  expect(t.anchor).toBe("middle");
});
