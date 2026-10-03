// W4 of the page-frame design (docs/specs/2026-10-04-page-frame.md): data
// charts read on a full page — round y ticks on bar and line charts, round x
// ticks on a long line chart, category labels that wrap before they shrink,
// and a pie whose radius grows with its box.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type AreaDrawable, type TextDrawable } from "../src/layout/model";
import { pieGeometry } from "../src/guess/handles";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});

type L = ReturnType<typeof layoutSpec>;
const lay = (template: string, params: object): L => layoutSpec({ template, params } as Spec);
const texts = (l: L, re: RegExp) => flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text" && re.test(d.id));
const clean = (l: L) => expect(l.issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);

describe("bar_chart", () => {
  test("round y ticks, four to six of them, at the readable size", () => {
    const l = lay("bar_chart", { labels: ["Bat", "Cat", "Human", "Giraffe"], values: [19.9, 12.5, 8, 4.6], ylim: [0, 24] });
    const ticks = texts(l, /^axes__yt\d+$/);
    expect(ticks.map((t) => t.text)).toEqual(["0", "5", "10", "15", "20"]);
    expect(ticks.every((t) => t.fontSize === 20)).toBe(true);
    clean(l);
    expect(texts(lay("bar_chart", { labels: ["A", "B"], values: [1, 2], y_ticks: false }), /^axes__yt/)).toEqual([]);
  });

  test("category and value labels are 21 and 20 when they fit", () => {
    const l = lay("bar_chart", { labels: ["Norway", "Sweden", "Denmark"], values: [87, 52, 58], value_labels: true });
    expect(texts(l, /^bar_\d+__l$/).map((t) => t.fontSize)).toEqual([21, 21, 21]);
    expect(texts(l, /^bar_\d+__v0$/).map((t) => t.fontSize)).toEqual([20, 20, 20]);
    clean(l);
  });

  test("long category names wrap onto two lines before they shrink, and the caption clears them", () => {
    const labels = ["Hospital care", "Primary health care", "Prescription drugs", "Long-term nursing", "Administration"];
    const l = lay("bar_chart", { labels, values: [40, 15, 12, 18, 3], x_label: "Where the money goes" });
    const cats = texts(l, /^bar_\d+__l$/);
    expect(cats.some((t) => t.lines?.length === 2)).toBe(true);
    expect(cats.every((t) => t.fontSize >= 18)).toBe(true);
    clean(l);
  });
});

describe("line_chart", () => {
  test("round y ticks replace the two ends; y_ticks: false keeps the ends", () => {
    const l = lay("line_chart", { x: [1, 2, 3, 4], values: [1, 3, 6, 8] });
    expect(texts(l, /^axes__yt\d+$/).map((t) => t.text)).toEqual(["0", "2", "4", "6", "8"]);
    expect(texts(l, /^axes__y[01]$/)).toEqual([]);
    const ends = lay("line_chart", { x: [1, 2, 3, 4], values: [1, 3, 6, 8], y_ticks: false });
    expect(texts(ends, /^axes__y[01]$/).map((t) => t.text)).toEqual(["0", "8.6"]);
  });

  test("more than twelve numeric x values get round x ticks between the ends", () => {
    const x = Array.from({ length: 31 }, (_, i) => 1800 + i * 10);
    const l = lay("line_chart", { x, values: x.map((_, i) => i * i), x_label: "Year" });
    const mid = texts(l, /^axes__xt\d+$/).map((t) => Number(t.text));
    expect(mid.length).toBeGreaterThanOrEqual(3);
    const steps = mid.slice(1).map((v, i) => v - mid[i]);
    expect(new Set(steps).size).toBe(1);
    expect([10, 20, 50, 100]).toContain(steps[0]);
    clean(l);
  });
});

describe("pie_chart", () => {
  const pie = (box?: object) => lay("pie_chart", { labels: ["Fossil", "Nuclear", "Renewable"], values: [65, 17, 18], ...(box ? { box } : {}) });
  const radiusOf = (l: L) => {
    const w = flattenDrawables(l.drawables).find((d) => d.id === "slice_1__f") as AreaDrawable;
    return Math.hypot(w.pts[1][0] - w.pts[0][0], w.pts[1][1] - w.pts[0][1]);
  };

  test("the radius grows with the box and the guess geometry agrees", () => {
    const small = pie({ x: 520, y: 160, w: 420, h: 400 });
    const big = pie({ x: 60, y: 160, w: 880, h: 500 });
    expect(radiusOf(big)).toBeGreaterThan(radiusOf(small) * 1.2);
    expect(radiusOf(big)).toBeGreaterThan(205); // the old cap in this box
    expect(pieGeometry({ labels: ["Fossil", "Nuclear", "Renewable"], values: [65, 17, 18], box: { x: 60, y: 160, w: 880, h: 500 } }).radius).toBeCloseTo(radiusOf(big), 6);
    for (const l of [small, big, pie()]) clean(l);
  });

  test("names are 24 and stay inside the box", () => {
    const l = pie({ x: 60, y: 160, w: 880, h: 500 });
    const names = texts(l, /^slice_\d+__l$/);
    expect(names.every((t) => t.fontSize === 24)).toBe(true);
    for (const t of names) {
      expect(t.pos[1]).toBeGreaterThan(160);
      expect(t.pos[1]).toBeLessThan(660);
    }
  });
});
