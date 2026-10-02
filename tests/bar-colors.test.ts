// A bar chart's colours from its labels (round 7 §7): different things,
// a colour each; one quantity over ordered levels, one colour.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { COLORS, flattenDrawables, type AreaDrawable } from "../src/layout/model";
import { barColorsFor } from "../src/scenes/bar-colors";
import { YOURS } from "../src/guess/reveal";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});
const fill = (l: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(l.drawables).find((d) => d.id === id) as AreaDrawable).style.fill;
const fills = (spec: Spec, n: number) => {
  const l = layoutSpec(spec);
  return Array.from({ length: n }, (_, i) => fill(l, `bar_${i + 1}__f0`));
};
const S = COLORS.series;

describe("the label rule", () => {
  test("names of things: each", () => expect(barColorsFor(["Shark", "Hippo", "Dog"])).toBe("each"));
  test("numbers and years: same", () => {
    expect(barColorsFor(["2015", "2016", "2017"])).toBe("same");
    expect(barColorsFor(["1", "2", "3"])).toBe("same");
    expect(barColorsFor(["1 200", "3.5", "1990s"])).toBe("same");
  });
  test("ranges and bins: same", () => {
    expect(barColorsFor(["0–9", "10-19", "20–29"])).toBe("same");
    expect(barColorsFor(["<5", "5-14", "65+"])).toBe("same");
  });
  test("months and weekdays, English and Norwegian, long and short: same", () => {
    expect(barColorsFor(["Jan", "Feb", "Mar"])).toBe("same");
    expect(barColorsFor(["januar", "februar", "mars"])).toBe("same");
    expect(barColorsFor(["mai", "jun.", "des"])).toBe("same");
    expect(barColorsFor(["Monday", "Tuesday"])).toBe("same");
    expect(barColorsFor(["man", "tir", "ons", "lørdag", "søndag"])).toBe("same");
  });
  test("mixed: each; no labels (a token): same", () => {
    expect(barColorsFor(["2019", "Norway"])).toBe("each");
    expect(barColorsFor([])).toBe("same");
  });
});

describe("the chart", () => {
  const chart = (params: object, commands: object[] = []) => ({ template: "bar_chart", params, commands }) as unknown as Spec;
  test("names: each bar its own colour", () => {
    expect(fills(chart({ labels: ["Shark", "Dog", "Snake"], values: [1, 2, 3] }), 3)).toEqual([S[0], S[1], S[2]]);
  });
  test("years: one colour", () => {
    expect(fills(chart({ labels: ["2015", "2016", "2017"], values: [1, 2, 3] }), 3)).toEqual([S[0], S[0], S[0]]);
  });
  test("bar_colors wins over the labels", () => {
    expect(fills(chart({ labels: ["Shark", "Dog"], values: [1, 2], bar_colors: "same" }), 2)).toEqual([S[0], S[0]]);
    expect(fills(chart({ labels: ["2015", "2016"], values: [1, 2], bar_colors: "each" }), 2)).toEqual([S[0], S[1]]);
  });
  test("grouped series keep one colour per series", () => {
    const l = layoutSpec(chart({ labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] }));
    expect(fill(l, "bar_2__f0")).toBe(S[0]);
    expect(fill(l, "bar_2__f1")).toBe(S[1]);
  });
  test("stacked series keep one colour per series", () => {
    const l = layoutSpec(chart({ labels: ["Shark", "Dog"], stacked: true, series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }] }));
    expect(fill(l, "bar_1__f0")).toBe(S[0]);
    expect(fill(l, "bar_2__f0")).toBe(S[0]);
    expect(fill(l, "bar_2__f1")).toBe(S[1]);
  });
  test("a guess on the chart skips the blue next to yours", () => {
    const spec = expandSpec(chart({ labels: ["Shark", "Dog", "Snake"], values: [1, 2, 3] }, [{ ask: { question: "How many people does the dog kill each year? Drag its bar.", on: "bar_2" } }]));
    expect(spec.params!.bar_guess).toBe(true);
    expect(fills(spec, 3)).toEqual([S[0], S[2], S[3]]);
  });
  test("the beside reveal's true half is drawn in the bar's own colour (spec §7)", () => {
    // besideParams (guess/reveal.ts) halves the guessed bar: beside_bars, 0-based.
    const spec = expandSpec(chart({ labels: ["Shark", "Dog", "Snake"], values: [1, 2, 3], beside_bars: [1] }, [{ ask: { question: "How many people does the dog kill each year? Drag its bar.", on: "bar_2" } }]));
    expect(fills(spec, 3)).toEqual([S[0], S[2], S[3]]);
  });
});

describe("blue yours beside a blue-ish bar (spec §7: check, and skip that colour while a guess is on)", () => {
  /** Hue in degrees of #rrggbb. */
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const gap = (a: string, b: string) => Math.min(Math.abs(hue(a) - hue(b)), 360 - Math.abs(hue(a) - hue(b)));
  test("series[1] is the only series colour within 30° of yours — the one the guess cycle skips", () => {
    // If the palette changes, this fails: re-decide which colour to skip in data.yaml.
    expect(S.map((c) => gap(c, YOURS) < 30)).toEqual(S.map((_, k) => k === 1));
  });
});
