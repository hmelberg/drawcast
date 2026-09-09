import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const spec = (elements: unknown[], domain?: unknown): Spec => ({ elements, commands: [], ...(domain ? { domain } : {}) }) as unknown as Spec;
const pts = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { pts: [number, number][] }).pts;

describe("ellipse (design §2.5)", () => {
  test("a closed outline with a wash, 48 points on the ellipse, foci on the major axis", () => {
    const out = layoutSpec(spec([{ id: "e", type: "ellipse", x: 500, y: 375, rx: 300, ry: 180, style: { fill: "#87a878" } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    const ring = pts(out, "e");
    expect(ring).toHaveLength(48);
    for (const [x, y] of ring) expect(((x - 500) / 300) ** 2 + ((y - 375) / 180) ** 2).toBeCloseTo(1, 6);
    expect(flattenDrawables(out.drawables).some((d) => d.id === "e_wash")).toBe(true);
    expect(out.namedAnchors.e.focus_1).toEqual([260, 375]);
    expect(out.namedAnchors.e.focus_2).toEqual([740, 375]);
  });
  test("a tall ellipse has its foci on the vertical axis; rotation turns everything", () => {
    const out = layoutSpec(spec([{ id: "e", type: "ellipse", x: 500, y: 375, rx: 100, ry: 200, rotation: 90 }]), heuristicMeasure);
    const f1 = out.namedAnchors.e.focus_1, f2 = out.namedAnchors.e.focus_2;
    // rotation 90 turns the vertical major axis onto the horizontal: foci at 500 ± sqrt(200² − 100²) in x
    expect(Math.abs(f1[0] - f2[0])).toBeCloseTo(2 * Math.sqrt(30000), 4);
    expect(f1[1]).toBeCloseTo(375, 4);
  });
});

describe("line (design §2.5)", () => {
  test("through two anchors, clipped to the canvas, with start/end/mid/point anchors", () => {
    const out = layoutSpec(spec([{ id: "tri", type: "polygon", points: [[200, 250], [600, 250], [450, 500]] }, { id: "l", type: "line", through: [{ ref: "tri", anchor: "vertex_1" }, { ref: "tri", anchor: "vertex_2" }], style: { dash: true } }]), heuristicMeasure);
    expect(out.warnings).toEqual([]);
    const [a, b] = pts(out, "l");
    expect(a).toEqual([0, 250]);
    expect(b).toEqual([1000, 250]);
    expect(out.namedAnchors.l.point_2).toEqual([600, 250]);
    expect(out.namedAnchors.l.mid).toEqual([500, 250]);
  });
  test("through one point with an angle; with a slope in domain units, clipped to the plot box", () => {
    const out = layoutSpec(spec([{ id: "d", type: "line", through: [[500, 375]], angle: 45 }]), heuristicMeasure);
    const [a, b] = pts(out, "d");
    expect(a[1] - a[0]).toBeCloseTo(375 - 500, 6); // y − x is constant along a 45° line
    expect(b[1] - b[0]).toBeCloseTo(375 - 500, 6);
    const dom = layoutSpec(spec([{ id: "ax", type: "axes", x_label: "x", y_label: "y" }, { id: "s", type: "line", through: [[0, 0]], slope: 1 }], { x: [0, 100], y: [0, 100] }), heuristicMeasure);
    expect(dom.warnings).toEqual([]);
    const [p, q] = pts(dom, "s");
    expect(q[0] - p[0]).toBeGreaterThan(0);
    expect(q[1] - p[1]).toBeGreaterThan(0);
  });
  test("schema: ellipse needs rx and ry; line needs through, and with one point a slope or an angle", () => {
    expect(validateSpec(spec([{ id: "e", type: "ellipse", x: 1, y: 1, rx: 10 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "l", type: "line", through: [[0, 0]] }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "l", type: "line", through: [[0, 0]], angle: 30 }])).ok).toBe(true);
  });
});
