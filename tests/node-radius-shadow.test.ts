// Round 5 §3.1: a rect node's `radius` (rounded corners) and `shadow` (a soft
// shadow drawn as an ordinary exact area — no SVG filter — so it looks the
// same in sketchy, clean, movies and exports). The vitest environment is
// node, so these tests stop at the drawables and the path data the renderer
// draws.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { COLORS, drawablesForId, leafDrawables, Z_STROKE, type Drawable } from "../src/layout/model";
import { dashedOutlineD, shapeFillD } from "../src/render/svg-backend";
import type { Spec } from "../src/spec/types";

const nodeSpec = (extra: Record<string, unknown>): Spec =>
  ({ elements: [{ id: "b", type: "node", shape: "rect", text: "Hi", x: 300, y: 300, ...extra }], commands: [] }) as unknown as Spec;

const leavesOf = (spec: Spec) => leafDrawables(layoutSpec(spec).drawables);
type Leaf = Exclude<Drawable, { kind: "group" }>;

describe("a rect node with radius and shadow", () => {
  const leaves = leavesOf(nodeSpec({ radius: 10, shadow: true, style: { fill: "#fffdf8" }, }));
  const box = leaves.find((d) => d.id === "b") as Extract<Leaf, { kind: "stroke" }>;

  test("the box carries r on its rect hint and a rounded ring", () => {
    expect(box.kind).toBe("stroke");
    expect(box.shapeHint?.type).toBe("rect");
    const h = box.shapeHint as { type: "rect"; x: number; y: number; w: number; h: number; r?: number };
    expect(h.r).toBe(10);
    const distinct = new Set(box.pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`));
    expect(distinct.size).toBeGreaterThan(4);
    const corner = [h.x, h.y];
    expect(box.pts.some((p) => Math.abs(p[0] - corner[0]) < 1e-6 && Math.abs(p[1] - corner[1]) < 1e-6)).toBe(false);
    // Still within the same box (unchanged size).
    for (const [x, y] of box.pts) {
      expect(x).toBeGreaterThanOrEqual(h.x - 1e-6);
      expect(x).toBeLessThanOrEqual(h.x + h.w + 1e-6);
      expect(y).toBeGreaterThanOrEqual(h.y - 1e-6);
      expect(y).toBeLessThanOrEqual(h.y + h.h + 1e-6);
    }
  });

  test("a shadow drawable: same rounded shape offset (3, 4) down-right, ink at 12 %, no stroke, below the box", () => {
    const sh = leaves.find((d) => d.id === "b__shadow") as Extract<Leaf, { kind: "area" }>;
    expect(sh).toBeDefined();
    expect(sh.kind).toBe("area");
    expect(sh.precise).toBe(true);
    expect(sh.style.fill).toBe(COLORS.ink);
    expect(sh.style.opacity).toBeCloseTo(0.12);
    expect(sh.z).toBe(Z_STROKE - 1);
    expect(sh.z).toBeLessThan(box.z);
    // y-up logical units: down is −y.
    expect(sh.pts.length).toBe(box.pts.length);
    sh.pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(box.pts[i][0] + 3);
      expect(p[1]).toBeCloseTo(box.pts[i][1] - 4);
    });
  });

  test("the shadow travels with the box (drawablesForId)", () => {
    const ids = drawablesForId(layoutSpec(nodeSpec({ radius: 10, shadow: true })).drawables, "b").map((d) => d.id);
    expect(ids).toContain("b__shadow");
    expect(ids.indexOf("b__shadow")).toBeLessThan(ids.indexOf("b"));
  });

  test("the backend's fill and dashed outline follow the corners", () => {
    expect(shapeFillD(box)).toMatch(/a10 10 /i);
    const dashed = leavesOf(nodeSpec({ radius: 10, style: { dash: true } })).find((d) => d.id === "b") as Leaf;
    const square = leavesOf(nodeSpec({ style: { dash: true } })).find((d) => d.id === "b") as Leaf;
    expect(dashedOutlineD(dashed as never)).not.toEqual(dashedOutlineD(square as never));
  });

  test("radius is clamped to half the shorter side", () => {
    const b = leavesOf(nodeSpec({ radius: 500, width: 100, height: 40 })).find((d) => d.id === "b") as Extract<Leaf, { kind: "stroke" }>;
    expect((b.shapeHint as { r?: number }).r).toBe(20);
  });

  test("shadow without radius: a square shadow", () => {
    const ls = leavesOf(nodeSpec({ shadow: true }));
    const sh = ls.find((d) => d.id === "b__shadow") as Extract<Leaf, { kind: "area" }>;
    expect(sh.pts.length).toBe(4);
  });
});

describe("without radius/shadow nothing changes", () => {
  test("a plain rect node's drawables are as before", () => {
    expect(layoutSpec(nodeSpec({})).drawables).toMatchSnapshot();
  });
  test("radius 0 is the plain rect", () => {
    expect(JSON.stringify(layoutSpec(nodeSpec({ radius: 0 })).drawables)).toEqual(JSON.stringify(layoutSpec(nodeSpec({})).drawables));
  });
});
