// pieces of a rectangle (strips, grid), lint's co-visibility seeing through a
// pieces id, and nearest-slot assignment in ring and hex.
import { describe, expect, test } from "vitest";
import { elementRings, layoutSpec } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { coVisible } from "../src/lint/lint";
import { arrangeTargets } from "../src/render/arrange";
import type { Spec } from "../src/spec/types";

type P = [number, number];
const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;

describe("pieces of a rectangle", () => {
  test("strips: n equal columns spanning width × height, numbered left to right", () => {
    const out = layoutSpec(spec([{ id: "bar", type: "pieces", of: "strips", x: 500, y: 400, width: 400, height: 100, n: 4, style: { fill: "#fc4" } }]));
    expect(out.warnings).toEqual([]);
    expect(out.pieceGroups.bar).toEqual(["bar_1", "bar_2", "bar_3", "bar_4"]);
    expect(out.order).not.toContain("bar");
    const rings = elementRings(out);
    const ring1 = rings.get("bar_1")![0];
    const xs = ring1.map((p) => p[0]);
    const ys = ring1.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(300, 6);
    expect(Math.max(...xs)).toBeCloseTo(400, 6);
    expect(Math.min(...ys)).toBeCloseTo(350, 6);
    expect(Math.max(...ys)).toBeCloseTo(450, 6);
    expect(out.pieces.bar_1).toBeUndefined(); // no sector geometry
  });
  test("grid: n columns × rows rows, numbered row by row from the top left (y-up)", () => {
    const out = layoutSpec(spec([{ id: "g", type: "pieces", of: "grid", x: 500, y: 400, width: 400, height: 300, n: 4, rows: 3 }]));
    expect(out.pieceGroups.g).toHaveLength(12);
    const rings = elementRings(out);
    const centre = (id: string): P => {
      const r = rings.get(id)![0];
      return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
    };
    expect(centre("g_1")).toEqual([350, 500]); // top-left
    expect(centre("g_4")).toEqual([650, 500]); // top-right
    expect(centre("g_5")).toEqual([350, 400]); // second row starts at the left
    expect(centre("g_12")).toEqual([650, 300]); // bottom-right
  });
  test("the schema wants width, height and (for a grid) rows", () => {
    expect(validateSpec({ elements: [{ id: "b", type: "pieces", of: "strips", x: 1, y: 1, width: 10, height: 5, n: 2 }], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [{ id: "b", type: "pieces", of: "strips", x: 1, y: 1, n: 2 }], commands: [] }).ok).toBe(false);
    expect(validateSpec({ elements: [{ id: "b", type: "pieces", of: "grid", x: 1, y: 1, width: 10, height: 5, n: 2 }], commands: [] }).ok).toBe(false);
    expect(validateSpec({ elements: [{ id: "b", type: "pieces", of: "bricks", x: 1, y: 1, width: 10, height: 5, n: 2 }], commands: [] }).ok).toBe(false);
  });
});

describe("lint's co-visibility sees through a pieces id", () => {
  const expand = (id: string) => (id === "k" ? ["k_1", "k_2"] : null);
  test("draw of the parent reveals the pieces; hide of the parent conceals them", () => {
    const together = coVisible([{ draw: ["k"] }, { draw: ["t"] }, { hide: ["k"] }, { draw: ["u"] }], ["k_1", "k_2", "t", "u"], expand);
    expect(together("k_1", "t")).toBe(true);
    expect(together("k_2", "u")).toBe(false);
  });
  test("without the expansion the pieces are unmanaged and always co-visible", () => {
    const together = coVisible([{ draw: ["k"] }, { hide: ["k"] }, { draw: ["u"] }], ["k_1", "k_2", "u"]);
    expect(together("k_1", "u")).toBe(true);
  });
});

describe("nearest-slot assignment", () => {
  const item = (id: string, x: number, y: number) => ({ id, box: { x: x - 20, y: y - 10, w: 40, h: 20 }, centre: [x, y] as P, pose: { offset: [0, 0] as P, turn: undefined } });
  test("ring: each item takes the free slot nearest to where it already is", () => {
    // Four items already sitting near the top, right, bottom and left slots, listed in a scrambled order.
    const out = arrangeTargets([item("bottom", 500, 200), item("left", 300, 400), item("top", 500, 600), item("right", 700, 400)], "ring", { at: [500, 400], gap: 0 });
    const by = Object.fromEntries(out.map((o) => [o.id, o.centre!]));
    expect(by.top[1]).toBeGreaterThan(by.bottom[1]);
    expect(by.right[0]).toBeGreaterThan(by.left[0]);
    expect(Math.abs(by.top[0] - 500)).toBeLessThan(1e-6);
    expect(Math.abs(by.left[1] - 400)).toBeLessThan(1e-6);
  });
  test("hex: the first target takes the centre, the others the nearest ring slots", () => {
    const hexItem = (id: string, x: number, y: number) => ({ ...item(id, x, y), box: { x: x - 52, y: y - 60, w: 104, h: 120 } });
    // A full first ring (seven cells): the slots exist on every side, so east and west can each take theirs.
    const others = ["a", "b", "c2", "d"].map((id, k) => hexItem(id, 500 + 30 * k, 700));
    const out = arrangeTargets([hexItem("c", 900, 100), hexItem("east", 700, 400), hexItem("west", 300, 400), ...others], "hex", { at: [500, 400], gap: 0 });
    expect(out[0]).toEqual({ id: "c", centre: [500, 400] });
    const by = Object.fromEntries(out.map((o) => [o.id, o.centre!]));
    expect(by.east).toEqual([604, 400]);
    expect(by.west).toEqual([396, 400]);
  });
});
