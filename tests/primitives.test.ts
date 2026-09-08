import { describe, expect, test } from "vitest";
import { layoutSpec, elementRings } from "../src/layout/layout";
import type { Spec } from "../src/spec/types";
import { validateSpec } from "../src/spec/schema";
import { defaultDrawOpts, defaultStyle, drawablesForId, type Drawable } from "../src/layout/model";

const spec = (elements: unknown[]): Spec => ({ elements, commands: [] }) as unknown as Spec;

describe("wash suffix — a primitive's own sub-id, not the shipped packs' public `_fill`", () => {
  const body: Drawable = { id: "body", kind: "stroke", pts: [[0, 0]], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts() };
  const bodyFill: Drawable = {
    id: "body_fill",
    kind: "area",
    pts: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    z: 0,
    style: defaultStyle(),
    drawOpts: defaultDrawOpts(),
  };
  test("a pack's own <id>_fill is a SEPARATE public id — drawablesForId(\"body\") does not sweep it up", () => {
    expect(drawablesForId([body, bodyFill], "body")).toEqual([body]);
  });
  test("but <id>_wash IS a sub-drawable of its parent", () => {
    const wash: Drawable = { ...bodyFill, id: "body_wash" };
    expect(drawablesForId([body, wash], "body")).toEqual([body, wash]);
  });
});

describe("sector / arc / polygon", () => {
  test("a sector is a closed outline with a wash, anchored at its centroid", () => {
    const out = layoutSpec(spec([{ id: "s", type: "sector", x: 500, y: 375, radius: 100, start: 0, end: 90, style: { fill: "#f2c14e" } }]));
    expect(out.warnings).toEqual([]);
    expect(out.order).toContain("s");
    const rings = elementRings(out);
    expect(rings.get("s")?.length).toBeGreaterThan(0);
    const box = out.drawables.flatMap((d) => (d.id === "s" || d.id.startsWith("s_") ? [d] : []));
    expect(box.length).toBeGreaterThan(0);
  });
  test("an arc is a stroke only — no closed outline", () => {
    const out = layoutSpec(spec([{ id: "a", type: "arc", x: 500, y: 375, radius: 100, start: 0, end: 180 }]));
    expect(out.warnings).toEqual([]);
    expect(elementRings(out).has("a")).toBe(false);
  });
  test("a regular polygon from sides + radius, and an explicit polygon from points", () => {
    const out = layoutSpec(spec([
      { id: "hex", type: "polygon", x: 300, y: 300, radius: 80, sides: 6 },
      { id: "tri", type: "polygon", points: [[600, 300], [700, 300], [650, 380]] },
    ]));
    expect(out.warnings).toEqual([]);
    const rings = elementRings(out);
    expect(rings.get("hex")?.[0]).toHaveLength(6);
    expect(rings.get("tri")?.[0]).toHaveLength(3);
  });
  test("the schema accepts them and rejects a sector without a radius", () => {
    expect(validateSpec({ elements: [{ id: "s", type: "sector", x: 1, y: 1, radius: 5, start: 0, end: 30 }], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [{ id: "s", type: "sector", x: 1, y: 1, start: 0, end: 30 }], commands: [] }).ok).toBe(false);
  });
});

describe("pieces", () => {
  const out = layoutSpec(spec([{ id: "kake", type: "pieces", of: "sectors", x: 300, y: 375, radius: 120, n: 12 }]));
  test("emits n addressable sector groups, not the parent id", () => {
    expect(out.warnings).toEqual([]);
    for (let k = 1; k <= 12; k++) expect(out.order).toContain(`kake_${k}`);
    expect(out.order).not.toContain("kake");
    expect(out.pieceGroups.kake).toEqual(Array.from({ length: 12 }, (_, i) => `kake_${i + 1}`));
  });
  test("records each piece's geometry: apex at the centre, mid-angle stepping by 360/n, half-angle 15°", () => {
    const p1 = out.pieces.kake_1;
    expect(p1.apex).toEqual([300, 375]);
    expect(p1.radius).toBe(120);
    expect(p1.halfAngle).toBeCloseTo(15, 6);
    expect(p1.midAngle).toBeCloseTo(15, 6);
    expect(out.pieces.kake_2.midAngle).toBeCloseTo(45, 6);
    expect(p1.centroid[0]).toBeGreaterThan(300);
  });
  test("every piece has a closed outline for hit-testing and the identify drill", () => {
    const rings = elementRings(out);
    for (let k = 1; k <= 12; k++) expect(rings.get(`kake_${k}`)?.length).toBeGreaterThan(0);
  });
  test("pieces are valid in the schema, and n is required", () => {
    expect(validateSpec({ elements: [{ id: "p", type: "pieces", of: "sectors", x: 1, y: 1, radius: 5, n: 4 }], commands: [] }).ok).toBe(true);
    expect(validateSpec({ elements: [{ id: "p", type: "pieces", of: "sectors", x: 1, y: 1, radius: 5 }], commands: [] }).ok).toBe(false);
  });
});
