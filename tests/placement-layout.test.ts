import { afterEach, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { scenes } from "../src/scenes/registry";
import { defaultDrawOpts, defaultStyle } from "../src/layout/model";

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
  // C1: `at` used to fail silently in two ways — an anchor name the ref does
  // not have quietly became its centre, and `side` + `anchor` together
  // quietly let `side` win. Both are now said out loud, because a figure
  // assembled from a misspelt anchor looks assembled, just wrong.
  test("an at.anchor the ref does not have is a placement WARN, and the centre is used", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "c", type: "shape", shape: "circle", radius: 20, at: { ref: "a", anchor: "nozzle" } },
      ],
      commands: [{ draw: ["a", "c"] }],
    });
    const placement = r.issues.filter((i) => i.rule === "placement");
    expect(placement.map((i) => i.message)).toEqual(['element "c": at.anchor "nozzle" is not an anchor of "a" — using center']);
    expect(placement[0].severity).toBe("warn");
    expect(placement[0].ids).toEqual(["c"]);
    const b = elementBBoxes(r);
    // "using center" is not a figure of speech: the circle really is centred.
    expect(b.get("c")!.x + b.get("c")!.w / 2).toBeCloseTo(b.get("a")!.x + b.get("a")!.w / 2, 0);
    expect(b.get("c")!.y + b.get("c")!.h / 2).toBeCloseTo(b.get("a")!.y + b.get("a")!.h / 2, 0);
  });
  test("an anchor the ref DOES have (its own named anchor, or a universal one) says nothing", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "p", type: "path", points: [[0, 0], [50, 30]] },
        { id: "c", type: "shape", shape: "circle", radius: 20, at: { ref: "a", anchor: "top" } },
        { id: "d", type: "shape", shape: "circle", radius: 10, at: { ref: "p", anchor: "start" } },
      ],
      commands: [{ draw: ["a", "p", "c", "d"] }],
    });
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
  });
  test("side AND anchor together is a placement WARN naming the one that wins", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "c", type: "shape", shape: "circle", radius: 20, at: { ref: "a", side: "right", anchor: "top", gap: 5 } },
      ],
      commands: [{ draw: ["a", "c"] }],
    });
    const placement = r.issues.filter((i) => i.rule === "placement");
    expect(placement.map((i) => i.message)).toEqual(['element "c": at gives both side "right" and anchor "top" — side is used, anchor is ignored']);
    expect(placement[0].severity).toBe("warn");
    const b = elementBBoxes(r);
    expect(b.get("c")!.x).toBeCloseTo(b.get("a")!.x + b.get("a")!.w + 5, 0);
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

describe("relative placement: every failure path says what happened", () => {
  afterEach(() => {
    delete scenes.temp_placement_scene;
  });

  const rect = { id: "a", type: "shape" as const, shape: "rect" as const, x: 300, y: 300, width: 100, height: 40 };

  test("a label draws nothing of its own, so at is a warning — and it lands where it would have anyway", () => {
    const spec = (at: object | undefined) => ({
      elements: [rect, { id: "n", type: "label" as const, text: "note", attach_to: "a", ...(at ? { at } : {}) }],
      commands: [{ draw: ["a", "n"] }],
    });
    const withAt = layoutSpec(spec({ ref: "a", side: "below" }));
    const without = layoutSpec(spec(undefined));
    const issue = withAt.issues.find((i) => i.rule === "placement");
    expect(issue?.severity).toBe("warn");
    expect(issue?.message).toMatch(/at is ignored/);
    expect(issue?.message).toMatch(/attach_to/);
    expect(elementBBoxes(withAt).get("n")).toEqual(elementBBoxes(without).get("n"));
  });

  test("a pieces parent is a usable at.ref: its cells are its box", () => {
    const r = layoutSpec({
      elements: [
        { id: "pie", type: "pieces", of: "sectors", n: 4, radius: 50, x: 500, y: 400 },
        { id: "t", type: "text", text: "Shares", font_size: 24, at: { ref: "pie", side: "above", gap: 10 } },
      ],
      commands: [{ draw: ["pie_1", "pie_2", "pie_3", "pie_4"] }, { draw: ["t"] }],
    });
    const b = elementBBoxes(r);
    expect(r.warnings.join(" ")).not.toMatch(/no box/);
    expect(b.get("t")!.y).toBeCloseTo(400 + 50 + 10, 0);
    expect(b.get("t")!.x + b.get("t")!.w / 2).toBeCloseTo(500, 0);
  });

  test("a template id that exports an anchor but no ink is a point to place against", () => {
    scenes.temp_placement_scene = {
      manifest: { name: "temp_placement_scene", status: "ready", description: "test-only", params_schema: {}, element_ids: {}, examples: [] },
      layout: () => ({
        drawables: [{ id: "ink", kind: "stroke" as const, pts: [[10, 10], [20, 20]] as [number, number][], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") }],
        labels: [],
        anchors: { ghost_anchor: [700, 500] as [number, number] },
        order: ["ink"],
      }),
    };
    const r = layoutSpec({
      template: "temp_placement_scene",
      elements: [{ id: "t", type: "text", text: "here", font_size: 24, at: { ref: "ghost_anchor", side: "above", gap: 4 } }],
      commands: [{ draw: ["ink", "t"] }],
    });
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
    expect(r.warnings.join(" ")).not.toMatch(/no box/);
    const t = elementBBoxes(r).get("t")!;
    expect(t.y).toBeCloseTo(504, 0);
    expect(t.x + t.w / 2).toBeCloseTo(700, 0);
  });

  test("a ref with no box at all does not dump the element in the corner", () => {
    // `group` is a known element type with no tier-2 case yet (Task 4), so it
    // draws nothing and exports no anchor: the ref resolves to no box at all.
    const spec = (at: object | undefined) => ({
      elements: [
        { id: "g", type: "group" as const, members: ["t"] },
        { id: "t", type: "text" as const, text: "floating", font_size: 24, ...(at ? { at } : {}) },
      ],
      commands: [{ draw: ["t"] }],
    });
    const r = layoutSpec(spec({ ref: "g", side: "above" }));
    expect(r.warnings.join(" ")).toMatch(/at\.ref "g" has no box — placed at its default position/);
    // Exactly where it would have gone with no `at` at all — not the origin.
    expect(elementBBoxes(r).get("t")).toEqual(elementBBoxes(layoutSpec(spec(undefined))).get("t"));
    expect(elementBBoxes(r).get("t")!.x).toBeGreaterThan(100);
  });

  test("an arrow waits for an endpoint that is placed relatively", () => {
    const r = layoutSpec({
      elements: [
        { id: "arr", type: "arrow", from: { x: 100, y: 100 }, to: { ref: "n" } },
        rect,
        { id: "n", type: "node", shape: "circle", text: "N", at: { ref: "a", side: "right", gap: 30 } },
      ],
      commands: [{ draw: ["a", "n", "arr"] }],
    });
    expect(r.warnings.join(" ")).not.toMatch(/no box/);
    const n = elementBBoxes(r).get("n")!;
    expect(n.x).toBeCloseTo(430, 0); // rect right edge 400 + gap 30
    // The arrow stops just short of the node's edge, on the line to the
    // node's SHIFTED centre — emitted before the shift it would still point
    // at where pass 1 parked the free node.
    const tip = r.namedAnchors.arr.tip;
    const c = [n.x + n.w / 2, n.y + n.h / 2];
    expect(Math.hypot(tip[0] - c[0], tip[1] - c[1])).toBeLessThan(n.w / 2 + 8);
  });
});

describe("relative placement: every side, and the default gap", () => {
  const ref = { id: "a", type: "shape" as const, shape: "rect" as const, x: 300, y: 300, width: 100, height: 40 };
  // The reference box is x 300..400, y 300..340.
  const place = (at: object) => {
    const r = layoutSpec({
      elements: [ref, { id: "c", type: "shape" as const, shape: "circle" as const, radius: 20, at }],
      commands: [{ draw: ["a", "c"] }],
    });
    expect(r.issues.filter((i) => i.rule === "placement")).toEqual([]);
    const b = elementBBoxes(r).get("c")!;
    return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
  };

  test("below: own top edge sits gap under the ref bottom, centred", () => {
    const c = place({ ref: "a", side: "below", gap: 10 });
    expect(c.y1).toBeCloseTo(290, 0);
    expect(c.cx).toBeCloseTo(350, 0);
  });
  test("left: own right edge sits gap left of the ref, middle-aligned", () => {
    const c = place({ ref: "a", side: "left", gap: 10 });
    expect(c.x1).toBeCloseTo(290, 0);
    expect(c.cy).toBeCloseTo(320, 0);
  });
  test("the default gap is 8", () => {
    const c = place({ ref: "a", side: "right" });
    expect(c.x0).toBeCloseTo(408, 0);
  });
  test("above-left: own bottom-right corner meets the ref's top-left, gap away", () => {
    const c = place({ ref: "a", side: "above-left", gap: 10 });
    expect([c.x1, c.y0]).toEqual([290, 350]);
  });
  test("above-right: own bottom-left corner meets the ref's top-right, gap away", () => {
    const c = place({ ref: "a", side: "above-right", gap: 10 });
    expect([c.x0, c.y0]).toEqual([410, 350]);
  });
  test("below-left: own top-right corner meets the ref's bottom-left, gap away", () => {
    const c = place({ ref: "a", side: "below-left", gap: 10 });
    expect([c.x1, c.y1]).toEqual([290, 290]);
  });
  test("below-right: own top-left corner meets the ref's bottom-right, gap away", () => {
    const c = place({ ref: "a", side: "below-right", gap: 10 });
    expect([c.x0, c.y1]).toEqual([410, 290]);
  });
});
