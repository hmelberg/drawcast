// `style.dash` on every stroked element type (an LLM run, 2026-09-27: a
// dashed rect drew solid). The layout always carried the flag; the renderer
// dropped it for rect and circle shapes (drawn by rc.rectangle / rc.circle,
// which have no dash), left out the closing side of every closed outline
// (polygon, ellipse, closed path: the dash walk stopped at the last vertex),
// and ignored it on region outlines. dashedOutlineD is the one path
// every render branch now takes; the vitest environment is node, so these
// tests stop at the path data the renderer draws.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { leafDrawables, type Drawable, type Pt } from "../src/layout/model";
import { dashedOutlineD } from "../src/render/svg-backend";
import { toSvgY } from "../src/layout/canvas";
import { normalizeSpec, validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const DASH = { dash: true };

const spec: Spec = {
  domain: { x: [0, 100], y: [0, 100] },
  elements: [
    { id: "d", type: "curve", expr: "80 - x", style: DASH },
    { id: "s", type: "curve", expr: "20 + x" },
    { id: "cs", type: "region", between: ["d", "s"], x_from: 0, x_to: 30, style: DASH },
    { id: "box", type: "shape", shape: "rect", x: 300, y: 300, width: 200, height: 100, style: DASH },
    { id: "ring", type: "shape", shape: "circle", x: 700, y: 300, radius: 60, style: DASH },
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 250]], style: DASH },
    { id: "pth", type: "path", points: [[600, 600], [700, 650], [800, 600]], style: DASH },
    { id: "loop", type: "path", points: [[600, 700], [700, 750], [800, 700]], closed: true, style: DASH },
    { id: "arr", type: "arrow", from: { x: 100, y: 600 }, to: { x: 300, y: 600 }, style: DASH },
    { id: "ln", type: "line", through: [[10, 10], [90, 90]], style: DASH },
    { id: "ell", type: "ellipse", x: 1000, y: 400, rx: 120, ry: 60, style: DASH },
  ],
  commands: [],
} as unknown as Spec;

const out = layoutSpec(spec);
const leaf = (id: string) => leafDrawables(out.drawables).find((d) => d.id === id) as Exclude<Drawable, { kind: "group" | "text" | "image" }>;

/** The dash subpaths' endpoints, back in layout coordinates. */
function dashPts(d: string): Pt[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), toSvgY(Number(m[2]))]);
}
const onSegment = (p: Pt, a: Pt, b: Pt) => {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
  return Math.abs(cross) / len < 0.5 && t > 0.05 && t < 0.95;
};

describe("style.dash reaches the drawable every renderer reads", () => {
  test.each(["box", "ring", "tri", "pth", "loop", "arr", "ln", "ell", "d", "cs"])("%s carries style.dash and a dashed outline", (id) => {
    const d = leaf(id);
    expect(d, id).toBeDefined();
    expect(d.style.dash).toBe(true);
    const path = dashedOutlineD(d, d.kind === "area" ? true : undefined);
    expect(path).not.toBeNull();
    expect(path!.split("M").length - 1).toBeGreaterThan(3);
  });

  test("a dashed rect is dashed on all four sides — not left to rc.rectangle's solid outline", () => {
    const d = leaf("box");
    expect(d.kind === "stroke" && d.shapeHint?.type).toBe("rect");
    const pts = dashPts(dashedOutlineD(d)!);
    const [x0, y0, x1, y1] = [200, 250, 400, 350];
    const corners: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      expect(pts.some((p) => onSegment(p, a, b)), `side ${i + 1}`).toBe(true);
    }
  });

  test("a dashed circle is cut from its ring", () => {
    const d = leaf("ring");
    const pts = dashPts(dashedOutlineD(d)!);
    for (const p of pts) expect(Math.hypot(p[0] - 700, p[1] - 300)).toBeCloseTo(60, 0);
    // round the whole ring, not one arc of it
    expect(pts.some((p) => p[1] > 340) && pts.some((p) => p[1] < 260)).toBe(true);
  });

  test("a closed outline's last side (back to the first vertex) is dashed too", () => {
    const pts = dashPts(dashedOutlineD(leaf("tri"))!);
    expect(pts.some((p) => onSegment(p, [200, 250], [100, 100]))).toBe(true);
  });

  test("an open path does not close itself", () => {
    const pts = dashPts(dashedOutlineD(leaf("pth"))!);
    expect(pts.some((p) => onSegment(p, [800, 600], [600, 600]))).toBe(false);
  });

  test("without dash there is no dashed outline", () => {
    const plain = layoutSpec({ elements: [{ id: "b", type: "shape", shape: "rect", x: 300, y: 300 }], commands: [] } as unknown as Spec);
    const d = leafDrawables(plain.drawables).find((x) => x.id === "b") as Parameters<typeof dashedOutlineD>[0];
    expect(d.style.dash).toBeFalsy();
    expect(dashedOutlineD(d)).toBeNull();
  });
});

describe("a bare `dash: true` on the element means style.dash", () => {
  const bare = { elements: [{ id: "box", type: "shape", shape: "rect", x: 300, y: 300, dash: true }], commands: [] };

  test("it validates, and normalizes into style", () => {
    expect(validateSpec(bare).ok).toBe(true);
    const n = normalizeSpec(bare) as Spec;
    expect(n.elements[0].style?.dash).toBe(true);
    expect((n.elements[0] as unknown as { dash?: boolean }).dash).toBeUndefined();
  });

  test("an explicit style.dash wins", () => {
    const n = normalizeSpec({ elements: [{ id: "b", type: "path", points: [[0, 0], [1, 1]], dash: true, style: { dash: false } }], commands: [] }) as Spec;
    expect(n.elements[0].style?.dash).toBe(false);
  });

  test("the laid-out rect is dashed", () => {
    const l = layoutSpec(bare as unknown as Spec);
    const d = leafDrawables(l.drawables).find((x) => x.id === "box")!;
    expect(d.style.dash).toBe(true);
  });
});
