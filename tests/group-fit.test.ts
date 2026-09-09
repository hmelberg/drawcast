import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { fitRegion } from "../src/layout/regions";
import { flattenDrawables } from "../src/layout/model";

const pump = (fit: unknown) => ({
  elements: [
    { id: "body", type: "shape", shape: "rect", x: 0, y: 0, width: 60, height: 200 },
    { id: "cap", type: "shape", shape: "circle", radius: 20, at: { ref: "body", anchor: "top" }, anchor: "bottom" },
    { id: "t", type: "text", text: "cap", font_size: 24, at: { ref: "cap", side: "above", gap: 4 } },
    { id: "pump", type: "group", members: ["body", "cap", "t"], fit },
  ],
  commands: [{ draw: ["pump"] }],
});

describe("group.fit", () => {
  test("members are scaled uniformly and centred in the left region", () => {
    const r = layoutSpec(pump("left") as never);
    const b = elementBBoxes(r);
    const L = fitRegion("left");
    const g = [b.get("body")!, b.get("cap")!, b.get("t")!];
    const x0 = Math.min(...g.map((q) => q.x)), x1 = Math.max(...g.map((q) => q.x + q.w));
    const y0 = Math.min(...g.map((q) => q.y)), y1 = Math.max(...g.map((q) => q.y + q.h));
    expect(y1 - y0).toBeCloseTo(L.h, 0);                 // height-limited
    expect((x0 + x1) / 2).toBeCloseTo(L.x + L.w / 2, 0);   // centred
    expect(b.get("body")!.w / b.get("body")!.h).toBeCloseTo(60 / 200, 2); // aspect kept
    const t = flattenDrawables(r.drawables).find((d) => d.id === "t") as { fontSize: number };
    expect(t.fontSize).toBeGreaterThan(24); // scaled up with the figure
  });
  test("a box fit that shrinks text below 18 warns naming the group", () => {
    const r = layoutSpec(pump({ x: 100, y: 100, w: 40, h: 60 }) as never);
    expect(r.issues.some((i) => i.rule === "font-too-small" && /fit box too small.*"pump"/.test(i.message))).toBe(true);
  });
  test("overlap between two members of a fitted group is not reported", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 100, height: 100 },
        { id: "b", type: "shape", shape: "rect", x: 20, y: 20, width: 100, height: 100 },
        { id: "g", type: "group", members: ["a", "b"], fit: "right" },
      ],
      commands: [{ draw: ["g"] }],
    } as never);
    expect(r.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });
  test("at.ref across a fit boundary is a placement error", () => {
    const r = layoutSpec({
      elements: [
        { id: "o", type: "shape", shape: "rect", x: 600, y: 600 },
        { id: "a", type: "shape", shape: "rect", x: 0, y: 0 },
        { id: "b", type: "text", text: "x", at: { ref: "o", side: "above" } },
        { id: "g", type: "group", members: ["a", "b"], fit: "left" },
      ],
      commands: [{ draw: ["o", "g"] }],
    } as never);
    expect(r.issues.some((i) => i.rule === "placement" && /"b".*outside its fit group "g"/.test(i.message))).toBe(true);
  });

  test("a fit box with no area is refused, and the figure is left where it was", () => {
    const flat = layoutSpec(pump({ x: 100, y: 100, w: 0, h: 60 }) as never);
    expect(flat.issues.some((i) => i.rule === "placement" && /group "pump": fit needs a region name or a box/.test(i.message))).toBe(true);
    const b = elementBBoxes(flat).get("body")!;
    expect([b.x, b.y, b.w, b.h]).toEqual([0, 0, 60, 200]);
  });

  // The brief's overlap case has no text in it, so nothing could have been
  // reported either way: this is the pair the exemption is actually for — a
  // member's word sitting on a member's line — with the un-fitted spec as the
  // control that proves the lint still sees it.
  const wordOnLine = (fit: unknown) => ({
    elements: [
      { id: "s", type: "shape", shape: "rect", x: 100, y: 100, width: 200, height: 200 },
      { id: "w", type: "text", text: "hello", x: 200, y: 100, font_size: 28 },
      { id: "g", type: "group", members: ["s", "w"], ...(fit ? { fit } : {}) },
    ],
    commands: [{ draw: ["g"] }],
  });
  test("a member's label on a member's stroke is excused only inside a fit group", () => {
    const loose = layoutSpec(wordOnLine(undefined) as never);
    expect(loose.issues.some((i) => i.rule === "overlap-label-stroke" && i.ids.includes("w"))).toBe(true);
    const fitted = layoutSpec(wordOnLine("right") as never);
    expect(fitted.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });
});
