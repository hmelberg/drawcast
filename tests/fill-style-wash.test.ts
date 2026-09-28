// style.fill_style "wash": a polygon / sector / ellipse / closed path fills
// as ONE flat translucent tint (an exact area, like a circle's fill), not
// rough hachure — "the sunlit half of the sky" (2026-09-28). Default unchanged.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type AreaDrawable } from "../src/layout/model";
import { isExactArea } from "../src/render/svg-backend";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const wash = (el: object) => {
  const spec = { elements: [el], commands: [] } as unknown as Spec;
  expect(validateSpec(spec).errors).toEqual([]);
  const id = (el as { id: string }).id;
  return flattenDrawables(layoutSpec(spec, heuristicMeasure).drawables).find((d) => d.id === `${id}_wash`) as AreaDrawable;
};

describe("fill_style: wash", () => {
  const kinds = [
    { id: "p", type: "polygon", points: [[300, 300], [600, 300], [450, 500]] },
    { id: "s", type: "sector", x: 500, y: 375, radius: 150, start: 0, end: 180 },
    { id: "e", type: "ellipse", x: 500, y: 375, rx: 200, ry: 100 },
    { id: "c", type: "path", points: [[300, 300], [600, 300], [600, 500]], closed: true },
  ];
  for (const el of kinds) {
    test(`${el.type}: hatch by default, a flat exact tint with fill_style wash`, () => {
      const hatch = wash({ ...el, style: { fill: "#f2c14e" } });
      expect(isExactArea(hatch)).toBe(false);
      const flat = wash({ ...el, style: { fill: "#f2c14e", fill_style: "wash" } });
      expect(isExactArea(flat)).toBe(true);
      expect(flat.style.opacity).toBe(0.35);
      expect(flat.pts).toEqual(hatch.pts);
    });
  }

  test("opacity sets the wash's strength", () => {
    const flat = wash({ id: "half", type: "sector", x: 500, y: 200, radius: 300, start: 0, end: 180, style: { fill: "#f2c14e", fill_style: "wash", opacity: 0.2 } });
    expect(flat.style.opacity).toBe(0.2);
  });

  test("an unknown fill_style is a schema error", () => {
    const spec = { elements: [{ id: "p", type: "polygon", points: [[0, 0], [1, 0], [0, 1]], style: { fill: "red", fill_style: "solid" } }], commands: [] } as unknown as Spec;
    expect(validateSpec(spec).ok).toBe(false);
  });
});
