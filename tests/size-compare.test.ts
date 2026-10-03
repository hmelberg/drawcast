// size_compare (src/scenes/packs/compare.yaml): things drawn to the same
// scale. The scale math (diameter/length linear, area √, volume/mass ∛), the
// four arrangements, the gap and count_fit rows, tiny items, bleed — and the
// pack's own examples laid out with no lint issue at all.

import { beforeEach, describe, expect, test } from "vitest";
import compareYaml from "../src/scenes/packs/compare.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Drawable } from "../src/layout/model";
import { unionBBoxForId } from "../src/layout/boxes";
import { heuristicMeasure } from "../src/layout/measure";
import type { SceneLayout } from "../src/scenes/types";
import { iconSlots } from "../src/spec/icon-data";

beforeEach(() => {
  unregisterPack("compare");
  registerPack("compare", compareYaml);
});

const run = (params: Record<string, unknown>): SceneLayout => scenes.size_compare.layout!(params);
const box = (l: SceneLayout, id: string) => {
  const b = unionBBoxForId(l.drawables, id, heuristicMeasure);
  if (!b) throw new Error(`no ink for ${id}`);
  return b;
};
const leaves = (l: SceneLayout): Drawable[] => flattenDrawables(l.drawables).filter((d) => d.kind !== "group");

const SUN = { name: "Sun", value: 1391400, unit: "km" };
const EARTH = { name: "Earth", value: 12742, unit: "km" };

describe("size_compare: the scale math", () => {
  test("diameter is linear: the Sun is drawn 109 × as wide as the Earth", () => {
    const l = run({ measure: "diameter", layout: "overlay", items: [SUN, EARTH] });
    const ratio = box(l, "sun_shape").w / box(l, "earth_shape").w;
    expect(ratio).toBeGreaterThan(105);
    expect(ratio).toBeLessThan(113);
    expect(l.values?.ratio).toBeCloseTo(1391400 / 12742, 6);
  });

  test("area maps to the side by its square root", () => {
    const l = run({ measure: "area", items: [{ name: "Africa", value: 30.37 }, { name: "Greenland", value: 2.17 }] });
    const side = box(l, "africa_shape").w / box(l, "greenland_shape").w;
    expect(side).toBeCloseTo(Math.sqrt(30.37 / 2.17), 1);
  });

  test("volume and mass map by the cube root", () => {
    for (const measure of ["volume", "mass"]) {
      const l = run({ measure, layout: "overlay", items: [{ name: "Big", value: 1000 }, { name: "Small", value: 1 }] });
      expect(box(l, "big_shape").w / box(l, "small_shape").w, measure).toBeCloseTo(10, 1);
    }
  });

  test("the ratio is written once, in words for big numbers, and {ratio} reaches ratio_text", () => {
    // One line is the element itself; a long one is two lines in a group.
    const text = (l: SceneLayout) =>
      flattenDrawables(l.drawables)
        .filter((d) => (d.id === "ratio" || d.id.startsWith("ratio__")) && d.kind === "text")
        .map((d) => (d as { text: string }).text)
        .join(" ");
    expect(text(run({ measure: "diameter", items: [SUN, EARTH] }))).toBe("109 × as wide");
    expect(text(run({ measure: "area", items: [{ name: "A", value: 30.37 }, { name: "G", value: 2.17 }] }))).toBe("14 × the area");
    expect(text(run({ measure: "volume", items: [{ name: "Sun", value: 1.412e18 }, { name: "Earth", value: 1.083e12 }] }))).toBe("1.3 million × the volume");
    expect(text(run({ measure: "volume", ratio_text: "{ratio} Earths", items: [{ name: "Sun", value: 1.412e18 }, { name: "Earth", value: 1.083e12 }] }))).toBe("1.3 million Earths");
    expect(run({ ratio_text: "", items: [SUN, EARTH] }).order).not.toContain("ratio");
  });
});

describe("size_compare: arrangements", () => {
  const two = [{ name: "Big", value: 10 }, { name: "Small", value: 4 }];

  test("beside: one baseline, side by side, inside the content area", () => {
    const l = run({ layout: "beside", items: two });
    const a = box(l, "big_shape"), b = box(l, "small_shape");
    expect(a.y).toBeCloseTo(b.y, 0);
    expect(a.x + a.w).toBeLessThan(b.x);
    for (const id of l.order) {
      const bb = box(l, id);
      expect(bb.x, id).toBeGreaterThanOrEqual(58);
      expect(bb.x + bb.w, id).toBeLessThanOrEqual(942);
      expect(bb.y, id).toBeGreaterThanOrEqual(158);
      expect(bb.y + bb.h, id).toBeLessThanOrEqual(662);
    }
  });

  test("row: one centre line", () => {
    const l = run({ layout: "row", items: two });
    const a = box(l, "big_shape"), b = box(l, "small_shape");
    expect(a.y + a.h / 2).toBeCloseTo(b.y + b.h / 2, 0);
  });

  test("inside: the small one lies within the big one; labels in a column to the right", () => {
    for (const shape of ["circle", "square"]) {
      const l = run({ layout: "inside", items: two.map((t) => ({ ...t, shape })) });
      const a = box(l, "big_shape"), b = box(l, "small_shape");
      expect(b.x, shape).toBeGreaterThanOrEqual(a.x);
      expect(b.y, shape).toBeGreaterThanOrEqual(a.y);
      expect(b.x + b.w, shape).toBeLessThanOrEqual(a.x + a.w);
      expect(b.y + b.h, shape).toBeLessThanOrEqual(a.y + a.h);
      expect(box(l, "small_label").x + box(l, "small_label").w, shape).toBeGreaterThan(a.x + a.w);
    }
  });

  test("overlay: every item centred on one point", () => {
    const l = run({ layout: "overlay", items: two });
    const a = box(l, "big_shape"), b = box(l, "small_shape");
    expect(a.x + a.w / 2).toBeCloseTo(b.x + b.w / 2, 0);
    expect(a.y + a.h / 2).toBeCloseTo(b.y + b.h / 2, 0);
  });

  test("ids: <item>_shape and <item>_label for each item, the groups `shapes` and `labels`", () => {
    const l = run({ items: [SUN, EARTH, { name: "DR Congo", value: 5000 }] });
    for (const id of ["sun_shape", "sun_label", "earth_shape", "earth_label", "dr_congo_shape", "dr_congo_label", "ratio"]) expect(l.order).toContain(id);
    expect(l.groups?.shapes).toEqual(["sun_shape", "earth_shape", "dr_congo_shape"].sort((x, y) => (x === "sun_shape" ? -1 : y === "sun_shape" ? 1 : 0)));
    expect(l.groups?.labels?.length).toBe(3);
  });
});

describe("size_compare: gap, count_fit, tiny and bleed", () => {
  test("gap: the centres lie gap × scale apart, with a dimension line, and 29 Earths fill the free gap", () => {
    const l = run({ layout: "row", count_fit: true, gap: { value: 384400 }, items: [EARTH, { name: "Moon", value: 3474, unit: "km" }] });
    const e = box(l, "earth_shape"), m = box(l, "moon_shape");
    const s = l.values!.scale;
    expect(m.x + m.w / 2 - (e.x + e.w / 2)).toBeCloseTo(384400 * s, 0);
    expect(l.order).toEqual(expect.arrayContaining(["gap_line", "gap_label", "fit_row", "fit_label"]));
    expect(l.values!.fit).toBe(29);
    const row = flattenDrawables(l.drawables).find((d) => d.id === "fit_row") as { children: unknown[] };
    expect(row.children.length).toBe(29);
    // the copies stay between the two surfaces
    const fr = box(l, "fit_row");
    expect(fr.x).toBeGreaterThanOrEqual(e.x + e.w - 1);
    expect(fr.x + fr.w).toBeLessThanOrEqual(m.x + 1);
  });

  test("count_fit without a gap: copies across the biggest (109 Earths across the Sun)", () => {
    const l = run({ layout: "inside", count_fit: true, items: [SUN, EARTH] });
    expect(l.values!.fit).toBe(109);
    const sun = box(l, "sun_shape"), row = box(l, "fit_row");
    expect(row.x).toBeGreaterThanOrEqual(sun.x - 1);
    expect(row.x + row.w).toBeLessThanOrEqual(sun.x + sun.w + 1);
  });

  test("a thing too small to see is a dot with a ring, never enlarged", () => {
    const l = run({ layout: "beside", items: [SUN, EARTH] });
    expect(box(l, "earth_shape").w).toBeLessThan(5);
    expect(leaves(l).some((d) => d.id === "earth_label__ring")).toBe(true);
    const big = run({ layout: "beside", items: [SUN, { name: "Jupiter", value: 139820 }] });
    expect(leaves(big).some((d) => d.id.endsWith("__ring"))).toBe(false);
  });

  test("bleed: the big one runs off the left edge but stays on the canvas, and the small one grows", () => {
    const plain = run({ layout: "row", items: [SUN, EARTH] });
    const l = run({ layout: "row", bleed: 3, items: [SUN, EARTH] });
    expect(box(l, "earth_shape").w).toBeGreaterThan(box(plain, "earth_shape").w * 2);
    for (const d of leaves(l)) {
      const pts = d.kind === "stroke" || d.kind === "area" ? d.pts : d.kind === "text" ? [d.pos] : [];
      for (const [x, y] of pts) {
        expect(x >= 0 && x <= 1000 && y >= 0 && y <= 750, `${d.id} at ${x},${y}`).toBe(true);
      }
    }
    expect(box(l, "sun_shape").x).toBeLessThan(10);
  });

  test("every pack example lays out with no warning and no lint issue, deterministically", () => {
    for (const ex of scenes.size_compare.manifest.examples) {
      const spec = { template: "size_compare", params: ex.params, elements: [] } as never;
      const res = layoutSpec(spec);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues.map((i) => `[${i.severity}] ${i.message}`), ex.request).toEqual([]);
      expect(JSON.stringify(layoutSpec(spec).drawables)).toBe(JSON.stringify(res.drawables));
    }
  });

  test("the lint names what the params cannot do", () => {
    const lint = scenes.size_compare.lint!;
    expect(lint({ items: [{ name: "a", value: 1 }] }).map((i) => i.severity)).toEqual(["error"]);
    expect(lint({ measure: "area", gap: { value: 3 }, items: [{ name: "a", value: 1 }, { name: "b", value: 2 }] })).toHaveLength(1);
    expect(lint({ items: [{ name: "a", value: 1 }, { name: "b", value: 2 }] })).toEqual([]);
  });
});

describe("size_compare: icons", () => {
  test("an icon item asks for its keyword, and its data lands on the item", () => {
    const spec = { elements: [], template: "size_compare", params: { items: [{ name: "Whale heart", value: 180, shape: "icon", icon: "heart" }, { name: "Car", value: 1400, shape: "icon", icon: { of: "car", set: "twemoji" } }, { name: "Dot", value: 1 }] } };
    const slots = iconSlots(spec as never);
    expect(slots.map((s) => s.ask.of)).toEqual(["heart", "car"]);
    expect(slots[0].host).toBe(spec.params.items[0]);
  });

  test("an icon item with no artwork yet draws a dashed square of its size", () => {
    const l = run({ measure: "mass", items: [{ name: "Car", value: 1400, shape: "icon", icon: "car" }, { name: "Heart", value: 180, shape: "icon", icon: "heart" }] });
    expect(leaves(l).some((d) => d.id === "car_shape__box")).toBe(true);
    expect(box(l, "car_shape").w / box(l, "heart_shape").w).toBeCloseTo(Math.cbrt(1400 / 180), 1);
  });
});
