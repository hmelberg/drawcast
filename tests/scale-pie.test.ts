import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { authoredScales, scaleGeometry, type ScaleElementLike } from "../src/spec/scale";
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
    expect(ids).toContain("s_answer");
    expect(ids).toContain("s_line");
    expect(ids).toContain("s_caption");
    expect(authoredScales(spec)).toEqual([expect.objectContaining({ id: "s", min: 0, max: 100, value: 40 })]);
    expect(validateSpec(spec).ok).toBe(true);
    const layout = layoutSpec(spec);
    expect(layout.order).toContain("s_answer_pin");
    expect(layout.order).toContain("s_answer_num");
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

  test("a whole number on a fine scale is written whole: 28 ¢, ticks 0 10 20, not 28.0 / 0.0 (fix wave 2026-10-03)", () => {
    const g = scaleGeometry(sc({ min: 0, max: 40, value: 28, unit: "¢" }));
    expect(g.format(28)).toBe("28 ¢");
    expect(g.format(27.5)).toBe("27.5 ¢");
    expect(g.ticks.map((t) => g.format(t))).toEqual(["0 ¢", "10 ¢", "20 ¢", "30 ¢", "40 ¢"]);
  });

  test("percent unit sticks to the number", () => {
    expect(scaleGeometry(sc({ unit: "%" })).format(12)).toBe("12%");
  });

  test("big numbers in words: numerals below a million, then million … sextillion, then 10ⁿ (page frame W3)", () => {
    const g = scaleGeometry(sc({ min: 1, max: 1e27, log: true, value: 2e16 }));
    const t = g.tickText!;
    expect([1, 10, 1000, 10000, 100000].map(t)).toEqual(["1", "10", "1000", "10 000", "100 000"]);
    expect([1e6, 1e7, 1e9, 1e12, 1e15, 1e18, 1e21, 1e23].map(t)).toEqual(["1 million", "10 million", "1 billion", "1 trillion", "1 quadrillion", "1 quintillion", "1 sextillion", "100 sextillion"]);
    expect([1e24, 1e26].map(t)).toEqual(["10²⁴", "10²⁶"]);
    expect(g.format(2e16)).toBe("20 quadrillion");
    expect(g.format(4.3e19)).toBe("43 quintillion");
    expect(g.format(3.2e25)).toBe("3.2 × 10²⁵");
    expect(g.format(1.3e6)).toBe("1.3 million");
    expect(g.format(999.9e6)).toBe("1 billion");
  });

  test("tick_format: numerals keeps every digit; power writes 10ⁿ", () => {
    expect(scaleGeometry(sc({ min: 1, max: 1e9, log: true, tick_format: "numerals" })).format(2e7)).toBe("20 000 000");
    const p = scaleGeometry(sc({ min: 1, max: 1e9, log: true, tick_format: "power" }));
    expect(p.tickText!(1e6)).toBe("10⁶");
    expect(p.format(4.3e7)).toBe("4.3 × 10⁷");
  });

  test("a linear line of big numbers: the step's decimals", () => {
    const g = scaleGeometry(sc({ min: 0, max: 8e9, value: 7.9e9 }));
    expect(g.format(7.9e9)).toBe("7.9 billion");
    expect(g.ticks.map(g.tickText!)).toContain("2 billion");
  });

  test("years before year 1 are BC; the AD side stays plain from 1000 (era hatch)", () => {
    const g = scaleGeometry(sc({ min: -3000, max: 2000, value: -30 }));
    expect(g.format(-30)).toBe("30 BC");
    expect(g.format(-2560)).toBe("2560 BC");
    expect(g.format(500)).toBe("AD 500");
    expect(g.format(1969)).toBe("1969");
    expect(g.ticks.map(g.tickText!)).toEqual(["3000 BC", "2000 BC", "1000 BC", "0", "1000", "2000"]);
    expect(scaleGeometry(sc({ min: -3000, max: 2000, era: "BCE" })).format(500)).toBe("500 CE");
    expect(scaleGeometry(sc({ min: -3000, max: 2000, era: "none" })).format(-30)).toBe("-30");
    // A temperature is not a year.
    expect(scaleGeometry(sc({ min: -40, max: 40, unit: "°C" })).format(-10)).toBe("-10 °C");
  });

  test("a crowded log line labels every 3rd decade (1000, 1 million, 1 billion …); the others keep a short tick", () => {
    const spec = expandSpec({ commands: [], elements: [sc({ min: 1000, max: 1e21, log: true, value: 4.3e19, x: 100, y: 240, width: 800 }) as never] } as Spec);
    const all = (spec.elements ?? []).filter((e) => /^s_tick_\d+_num$/.test(e.id));
    expect(all).toHaveLength(19); // every tick keeps its number's id; the thinned ones are empty
    const nums = all.map((e) => e.text).filter((t) => t !== "");
    // Thinned as far as the lint's heuristic measure needs (W25): the names
    // alone, as a ruler — "1 quadrillion" in full crowds at 22.
    expect(nums).toEqual(["1000", "million", "billion", "trillion", "quadrillion", "quintillion", "sextillion"]);
  });

  test("a unit is written once, at the line's right end", () => {
    const spec = expandSpec({ commands: [], elements: [sc({ min: 0, max: 120, unit: "km/h", x: 100, y: 300, width: 700 }) as never] } as Spec);
    const els = spec.elements ?? [];
    const unit = els.find((e) => e.id === "s_unit")!;
    expect(unit.text).toBe("km/h");
    expect(unit.x).toBeGreaterThan(800); // past the line's end (x 100 + 700)
    expect(unit.y).toBeGreaterThan(300); // raised a little off the line, clear of the numbers under it
    expect(els.filter((e) => /_tick_\d+_num$/.test(e.id)).every((e) => !String(e.text).includes("km/h"))).toBe(true);
    // "%" rides on every number: no unit at the end.
    const pct = expandSpec({ commands: [], elements: [sc({ unit: "%" }) as never] } as Spec);
    expect((pct.elements ?? []).some((e) => e.id === "s_unit")).toBe(false);
  });

  test("placed by the page: centred in the content box; alone it is larger and in the middle; explicit x/y/width win", () => {
    const alone = authoredScales(expandSpec({ commands: [], elements: [sc({}) as never] } as Spec))[0];
    const g = scaleGeometry(alone);
    expect(g.x1 - g.x0).toBeGreaterThanOrEqual(780);
    expect(Math.abs((g.x0 + g.x1) / 2 - 500)).toBeLessThan(30);
    expect(g.sizes!.tick).toBeGreaterThan(22);
    const company = authoredScales(expandSpec({ commands: [], elements: [sc({}) as never, { id: "c", type: "shape", shape: "circle", x: 500, y: 550, radius: 60 } as never] } as Spec))[0];
    expect(scaleGeometry(company).sizes!.tick).toBe(22);
    expect(scaleGeometry(company).y).toBeLessThan(g.y);
    const fixed = authoredScales(expandSpec({ commands: [], elements: [sc({ x: 150, y: 300, width: 700 }) as never] } as Spec))[0];
    expect([fixed.x, fixed.y, fixed.width]).toEqual([150, 300, 700]);
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
