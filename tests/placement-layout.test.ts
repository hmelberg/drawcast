import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";

describe("relative placement in layoutSpec", () => {
  test("text placed above a rect sits gap above it, centred, in any spec order", () => {
    const r = layoutSpec({
      elements: [
        { id: "t", type: "text", text: "Piston", font_size: 24, at: { ref: "a", side: "above", gap: 10 } },
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
      ],
      commands: [{ draw: ["a", "t"] }],
    });
    const b = elementBBoxes(r);
    const a = b.get("a")!, t = b.get("t")!;
    expect(t.y).toBeCloseTo(a.y + a.h + 10, 0);
    expect(t.x + t.w / 2).toBeCloseTo(a.x + a.w / 2, 0);
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
  });
  test("anchor placement: a circle's bottom lands on the rect's top", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "c", type: "shape", shape: "circle", radius: 20, at: { ref: "a", anchor: "top" }, anchor: "bottom" },
      ],
      commands: [{ draw: ["a", "c"] }],
    });
    const b = elementBBoxes(r);
    expect(b.get("c")!.y).toBeCloseTo(b.get("a")!.y + b.get("a")!.h, 0);
  });
  test("a path's own anchors follow the shift", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "p", type: "path", points: [[0, 0], [50, 30]], at: { ref: "a", side: "right", gap: 5 } },
      ],
      commands: [{ draw: ["a", "p"] }],
    });
    expect(r.namedAnchors.p.start[0]).toBeCloseTo(elementBBoxes(r).get("a")!.x + 100 + 5, 0);
  });
  test("a pieces element moves as a whole — its cells and their geometry come along", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "pie", type: "pieces", of: "sectors", n: 4, radius: 50, at: { ref: "a", side: "right", gap: 20 } },
      ],
      commands: [{ draw: ["a"] }, { draw: ["pie_1", "pie_2", "pie_3", "pie_4"] }],
    });
    const b = elementBBoxes(r);
    const a = b.get("a")!;
    const one = b.get("pie_1")!;
    // The whole pie (2·radius wide) starts one gap right of the rect.
    expect(Math.min(...["pie_1", "pie_2", "pie_3", "pie_4"].map((id) => b.get(id)!.x))).toBeCloseTo(a.x + a.w + 20, 0);
    // The piece geometry moved with the ink: the apex is the pie's centre.
    expect(r.pieces.pie_1.apex[0]).toBeCloseTo(a.x + a.w + 20 + 50, 0);
    expect(one.x).toBeGreaterThan(a.x + a.w);
  });
  test("at.ref may name a template id: the text lands on the template's own ink", () => {
    const r = layoutSpec({
      template: "supply_demand",
      params: {},
      elements: [{ id: "t", type: "text", text: "shift", font_size: 24, at: { ref: "axes", side: "above", gap: 6 } }],
      commands: [{ draw: ["axes", "t"] }],
    });
    const b = elementBBoxes(r);
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
    expect(b.get("t")!.y).toBeCloseTo(b.get("axes")!.y + b.get("axes")!.h + 6, 0);
  });
  test("unknown ref is an error-severity issue and the element still draws", () => {
    const r = layoutSpec({ elements: [{ id: "t", type: "text", text: "x", at: { ref: "ghost", side: "above" } }], commands: [{ draw: ["t"] }] });
    expect(r.issues.some((i) => i.rule === "placement" && i.severity === "error")).toBe(true);
    expect(r.order).toContain("t");
  });
});
