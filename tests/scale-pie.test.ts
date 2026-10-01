import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { scaleGeometry, type ScaleElementLike } from "../src/spec/scale";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  registerPack("data", dataYaml);
});

const sc = (o: Partial<ScaleElementLike>): ScaleElementLike => ({ id: "s", type: "scale", min: 0, max: 100, value: 40, ...o });

describe("scale", () => {
  test("expands into the line group and the value marker", () => {
    const spec = expandSpec({ commands: [], elements: [sc({ label: "Share" }) as never] } as Spec);
    const ids = (spec.elements ?? []).map((e) => e.id);
    expect(ids).toContain("s");
    expect(ids).toContain("s_value");
    expect(ids).toContain("s_line");
    expect(ids).toContain("s_caption");
    expect((spec as { scales?: unknown[] }).scales).toHaveLength(1);
    const layout = layoutSpec(spec);
    expect(layout.order).toContain("s_value_mark");
    expect(layout.order).toContain("s_value_text");
    expect(layout.order).toContain("s_line");
  });

  test("linear geometry maps both ways", () => {
    const g = scaleGeometry(sc({ x: 100, width: 800 }));
    expect(g.xAt(50)).toBe(500);
    expect(g.valueAtX(500)).toBe(50);
    expect(g.ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  test("log geometry: decades evenly spaced, two significant figures", () => {
    const g = scaleGeometry(sc({ min: 100, max: 100000, log: true, value: 7000, x: 0, width: 300 }));
    expect(g.ticks).toEqual([100, 1000, 10000, 100000]);
    expect(g.xAt(1000)).toBeCloseTo(100);
    expect(g.valueAtX(150)).toBe(3200);
  });

  test("a year line is not grouped", () => {
    const g = scaleGeometry(sc({ min: 1700, max: 1800, value: 1756 }));
    expect(g.format(1756)).toBe("1756");
  });

  test("percent unit sticks to the number", () => {
    expect(scaleGeometry(sc({ unit: "%" })).format(12)).toBe("12%");
  });

  test("validation: min < max and a value", () => {
    const bad = validateSpec({ commands: [], elements: [{ id: "s", type: "scale", min: 5, max: 1 }] } as never);
    expect(JSON.stringify(bad)).toMatch(/min < max/);
  });
});

describe("pie_chart", () => {
  test("one slice per value, shares as percents", () => {
    const l = layoutSpec({ template: "pie_chart", params: { labels: ["A", "B", "C"], values: [1, 1, 2] }, commands: [] } as Spec);
    expect(l.order).toEqual(["slice_1", "slice_2", "slice_3"]);
    const texts = JSON.stringify(l.drawables);
    expect(texts).toContain("A  25%");
    expect(texts).toContain("C  50%");
  });

  test("a staged pie interpolates", () => {
    const l = layoutSpec({ template: "pie_chart", params: { labels: ["A", "B"], values: [[50, 50], [100, 0]], stage: 0.5 }, commands: [] } as Spec);
    expect(JSON.stringify(l.drawables)).toContain("A  75%");
  });
});
