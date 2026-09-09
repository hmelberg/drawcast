import { describe, expect, test } from "vitest";
import { placementOrder, relativeDelta, shiftDrawables } from "../src/layout/place";
import { defaultDrawOpts, defaultStyle, type Drawable } from "../src/layout/model";
import type { SpecElement } from "../src/spec/types";

const el = (o: Partial<SpecElement> & { id: string }): SpecElement => ({ type: "shape", ...o }) as SpecElement;

describe("placementOrder", () => {
  test("puts a referenced element before the one that refers to it", () => {
    const r = placementOrder([el({ id: "t", type: "text", at: { ref: "a", side: "above" } }), el({ id: "a", x: 1, y: 1 })]);
    expect(r.order.map((e) => e.id)).toEqual(["a", "t"]);
    expect(r.issues).toEqual([]);
  });
  test("unknown ref and cycle are placement errors; the elements still come out", () => {
    const r = placementOrder([el({ id: "p", at: { ref: "q" } }), el({ id: "q", at: { ref: "p" } }), el({ id: "z", at: { ref: "nope" } })]);
    expect(r.order.map((e) => e.id).sort()).toEqual(["p", "q", "z"]);
    expect(r.issues.map((i) => [i.rule, i.severity])).toEqual([["placement", "error"], ["placement", "error"]]);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/unknown ref "nope"/);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/cycle/);
  });
});

describe("relativeDelta", () => {
  const ref = { x: 100, y: 100, w: 50, h: 20 };
  const own = { x: 0, y: 0, w: 10, h: 10 };
  test("side above with gap: own bottom edge sits gap above ref top, centred", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", side: "above", gap: 12 }, undefined);
    expect(dx).toBeCloseTo(120); // own centre x 5 → 125
    expect(dy).toBeCloseTo(132); // own y 0 → 100+20+12
  });
  test("anchor on ref lands own anchor", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", anchor: "top_right" }, "bottom_left");
    expect([dx, dy]).toEqual([150, 120]);
  });
  test("geometric anchor from the ref's named points wins over the box", () => {
    const [dx, dy] = relativeDelta(own, ref, { tip: [999, 999] }, { ref: "r", anchor: "tip" }, "center");
    expect([dx, dy]).toEqual([994, 994]);
  });
  test("offset is added last", () => {
    const [dx, dy] = relativeDelta(own, ref, {}, { ref: "r", side: "right", gap: 0, offset: [3, -4] }, undefined);
    expect([dx, dy]).toEqual([153, 101]);
  });
});

describe("shiftDrawables", () => {
  test("moves pts, pos, shapeHint and children", () => {
    const ds: Drawable[] = [
      { id: "s", kind: "stroke", pts: [[0, 0], [1, 1]], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch"), shapeHint: { type: "circle", c: [0, 0], r: 5 } },
      { id: "g", kind: "group", z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch"), box: { x: 0, y: 0, w: 20, h: 20 }, children: [{ id: "t", kind: "text", pos: [2, 2], text: "x", fontSize: 20, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") }] },
    ];
    shiftDrawables(ds, 10, -5);
    expect((ds[0] as { pts: number[][] }).pts).toEqual([[10, -5], [11, -4]]);
    expect((ds[0] as { shapeHint: { c: number[] } }).shapeHint.c).toEqual([10, -5]);
    expect(((ds[1] as { children: { pos: number[] }[] }).children[0]).pos).toEqual([12, -3]);
    expect((ds[1] as { box: { x: number; y: number; w: number; h: number } }).box).toEqual({ x: 10, y: -5, w: 20, h: 20 });
  });
});
