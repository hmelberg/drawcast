// `style.fill` on every closed shape (an author, 2026-09-27: a filled
// `shape: rect` drew empty in both render styles; only circles filled, so the
// compiler prompt's own piston never showed its fill). The layout carried the
// fill on the rect's stroke; the renderer painted a hint's fill only for a
// circle. shapeFillD is the fill every render branch now paints for a circle
// or rect hint, dashed or solid; polygon, ellipse, sector and closed path
// carry theirs as a `_wash` area. The vitest environment is node, so these
// tests stop at the drawables and the path data the renderer draws.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables, type Drawable } from "../src/layout/model";
import { dashedOutlineD, shapeFillD } from "../src/render/svg-backend";
import { toSvgY } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";

const FILL = "#c9dcef";

const spec: Spec = {
  elements: [
    { id: "box", type: "shape", shape: "rect", x: 300, y: 300, width: 200, height: 100, style: { fill: FILL } },
    { id: "dbox", type: "shape", shape: "rect", x: 300, y: 500, width: 200, height: 100, style: { fill: FILL, dash: true } },
    { id: "ring", type: "shape", shape: "circle", x: 700, y: 300, radius: 60, style: { fill: FILL } },
    { id: "empty", type: "shape", shape: "rect", x: 700, y: 500 },
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 250]], style: { fill: FILL } },
    { id: "ell", type: "ellipse", x: 1000, y: 400, rx: 120, ry: 60, style: { fill: FILL } },
    { id: "sec", type: "sector", x: 900, y: 150, radius: 80, start: 0, end: 90, style: { fill: FILL } },
    { id: "loop", type: "path", points: [[600, 700], [700, 750], [800, 700]], closed: true, style: { fill: FILL } },
  ],
  commands: [],
} as unknown as Spec;

const leaves = leafDrawables(layoutSpec(spec).drawables);
const leaf = (id: string) => leaves.find((d) => d.id === id) as Exclude<Drawable, { kind: "group" | "text" | "image" }>;

/** The x/y extremes of path data's absolute and relative moves, in layout coordinates. */
function rectExtent(d: string) {
  const m = /^M(-?[\d.]+) (-?[\d.]+) h(-?[\d.]+) v(-?[\d.]+) h(-?[\d.]+) Z$/.exec(d);
  expect(m, d).not.toBeNull();
  const [x, ySvg, w, h] = [1, 2, 3, 4].map((i) => Number(m![i]));
  return { x0: x, x1: x + w, yTop: toSvgY(ySvg), yBottom: toSvgY(ySvg + h) };
}

describe("a filled shape rect paints its fill", () => {
  test("the rect's stroke carries the fill, and shapeFillD covers the whole rect", () => {
    const d = leaf("box");
    expect(d.kind === "stroke" && d.shapeHint?.type).toBe("rect");
    expect(d.style.fill).toBe(FILL);
    const e = rectExtent(shapeFillD(d)!);
    expect(e).toEqual({ x0: 200, x1: 400, yTop: 350, yBottom: 250 });
  });

  test("dashed: the fill stays under the cut outline", () => {
    const d = leaf("dbox");
    expect(dashedOutlineD(d)).not.toBeNull();
    expect(rectExtent(shapeFillD(d)!)).toEqual({ x0: 200, x1: 400, yTop: 550, yBottom: 450 });
  });

  test("a circle still fills", () => {
    expect(shapeFillD(leaf("ring"))).toMatch(/^M640\.0 .* A60 60 /);
  });

  test("without a fill there is none", () => {
    expect(leaf("empty").style.fill).toBeUndefined();
    expect(shapeFillD(leaf("empty"))).toBeNull();
  });
});

describe("the other closed shapes fill through their wash", () => {
  test.each(["tri", "ell", "sec", "loop"])("%s: a filled `_wash` area, and no second fill on its outline", (id) => {
    const wash = leaf(`${id}_wash`);
    expect(wash?.kind, id).toBe("area");
    expect(wash.style.fill).toBe(FILL);
    expect(wash.pts.length).toBeGreaterThanOrEqual(3);
    // The outline also holds style.fill, but has no hint: painting it would
    // double the wash at full strength.
    expect(shapeFillD(leaf(id))).toBeNull();
  });
});
