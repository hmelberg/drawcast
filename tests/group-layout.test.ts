import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";

const thing = {
  elements: [
    { id: "body", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 200 },
    { id: "cap", type: "shape", shape: "circle", radius: 20, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
    { id: "pump", type: "group", members: ["body", "cap"] },
    { id: "name", type: "label", text: "Pump", attach_to: "pump", side: "right" },
    { id: "f", type: "text", text: "F", font_size: 24, at: { ref: "pump", side: "above", gap: 10 } },
  ],
  commands: [{ draw: ["pump", "name", "f"] }],
} as const;

describe("group", () => {
  test("has the union box of its members, is not in order, and expands", () => {
    const r = layoutSpec(thing as never);
    expect(r.order).not.toContain("pump");
    expect(r.groups.pump).toEqual(["body", "cap"]);
    const b = elementBBoxes(r);
    const body = b.get("body")!, cap = b.get("cap")!, f = b.get("f")!;
    expect(f.y).toBeCloseTo(cap.y + cap.h + 10, 0);
    expect(r.namedAnchors.pump.bottom[1]).toBeCloseTo(body.y, 0);
    expect(r.issues.filter((i) => i.rule === "placement" || i.rule === "group-empty")).toEqual([]);
  });
  test("nested groups flatten; missing member and empty group are errors", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 100, y: 100 }, { id: "b", type: "shape", shape: "rect", x: 400, y: 100 },
        { id: "inner", type: "group", members: ["a"] }, { id: "outer", type: "group", members: ["inner", "b"] },
        { id: "bad", type: "group", members: ["ghost"] },
      ],
      commands: [{ draw: ["outer"] }],
    } as never);
    expect(r.groups.outer.sort()).toEqual(["a", "b"]);
    const bad = r.issues.filter((i) => i.rule === "group-empty");
    expect(bad.map((i) => i.severity)).toEqual(["error"]);
    expect(bad[0].message).toMatch(/"bad".*"ghost"/);
  });
  test("a label is a legal member: it joins the leaves but not the box", () => {
    const r = layoutSpec({
      elements: [
        { id: "box", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 40 },
        { id: "tag", type: "label", text: "Tag", attach_to: "box", side: "right" },
        { id: "g", type: "group", members: ["box", "tag"] },
      ],
      commands: [{ draw: ["g"] }],
    } as never);
    expect(r.issues.filter((i) => i.rule === "group-empty")).toEqual([]);
    expect(r.groups.g).toEqual(["box", "tag"]);
    const b = elementBBoxes(r);
    // The label is placed after tier-2, so the group's box is the rect's alone.
    expect(r.namedAnchors.g.center).toEqual([b.get("box")!.x + b.get("box")!.w / 2, b.get("box")!.y + b.get("box")!.h / 2]);
    // …and the label is a real, drawable id, so the group reaches it.
    expect(r.order).toContain("tag");
    expect(b.get("tag")).toBeDefined();
  });
  test("a pieces parent as a member gives the group its cells' box", () => {
    const r = layoutSpec({
      elements: [
        { id: "kake", type: "pieces", of: "sectors", x: 300, y: 400, radius: 120, n: 4, style: { fill: "#2f6b8f" } },
        { id: "g", type: "group", members: ["kake"] },
        { id: "t", type: "text", text: "T", font_size: 24, at: { ref: "g", side: "above", gap: 10 } },
      ],
      commands: [{ draw: ["g", "t"] }],
    } as never);
    expect(r.issues.filter((i) => i.rule === "group-empty" || i.rule === "placement")).toEqual([]);
    expect(r.warnings).toEqual([]);
    const b = elementBBoxes(r);
    const cells = r.pieceGroups.kake.map((id) => b.get(id)!);
    const x0 = Math.min(...cells.map((c) => c.x)), y0 = Math.min(...cells.map((c) => c.y));
    const x1 = Math.max(...cells.map((c) => c.x + c.w)), y1 = Math.max(...cells.map((c) => c.y + c.h));
    expect(r.namedAnchors.g.bottom_left[0]).toBeCloseTo(x0, 6);
    expect(r.namedAnchors.g.bottom_left[1]).toBeCloseTo(y0, 6);
    expect(r.namedAnchors.g.top_right[0]).toBeCloseTo(x1, 6);
    expect(r.namedAnchors.g.top_right[1]).toBeCloseTo(y1, 6);
    // …and text placed above the group clears the cut cake, gap and all.
    expect(b.get("t")!.y).toBeCloseTo(y1 + 10, 0);
  });
  test("an annotation is a legal member too", () => {
    const r = layoutSpec({
      elements: [
        { id: "box", type: "shape", shape: "rect", x: 300, y: 300, width: 60, height: 40 },
        { id: "mark", type: "annotation", target: "box" },
        { id: "g", type: "group", members: ["box", "mark"] },
      ],
      commands: [{ draw: ["g"] }],
    } as never);
    expect(r.issues.filter((i) => i.rule === "group-empty")).toEqual([]);
    expect(r.groups.g).toEqual(["box", "mark"]);
  });
});
