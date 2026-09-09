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
});
