// The bar race. What is pinned: rank is interpolated (never recomputed from
// interpolated values), a racer's id follows the RACER and not its rank —
// the rough.js seed is hashSeed(id), so a rank-keyed id would re-roll a
// bar's sketchy stroke mid-overtake — and the top_n airlock lets a racer
// slide in and out instead of popping.

import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type AreaDrawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});

const race = (params: object) => layoutSpec({ template: "bar_race", params } as Spec);
const bar = (l: ReturnType<typeof layoutSpec>, i: number) =>
  flattenDrawables(l.drawables).find((d) => d.id === `race_${i}` && d.kind === "area") as AreaDrawable | undefined;
const rowY = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const pts = bar(l, i)!.pts;
  return (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
};
const barLen = (l: ReturnType<typeof layoutSpec>, i: number) => {
  const xs = bar(l, i)!.pts.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
};
// A racer's name: the sub-drawable welded to its bar. "race_1_" is not a
// prefix of "race_10_text", so this stays exact past nine racers.
const racerName = (l: ReturnType<typeof layoutSpec>, i: number) =>
  (flattenDrawables(l.drawables).find((d) => d.kind === "text" && d.id.startsWith(`race_${i}_`)) as { text: string } | undefined)?.text;

// Two racers that swap between stage 0 and stage 1.
const SWAP = { labels: ["A", "B"], values: [[10, 6], [6, 10]] };

describe("bar_race", () => {
  test("is a ready template with one id per racer, in input order", () => {
    expect(scenes.bar_race?.manifest.status).toBe("ready");
    const l = race({ ...SWAP, stage: 0 });
    expect(l.order.filter((id) => id.startsWith("race_"))).toEqual(["race_1", "race_2"]);
  });

  test("the row position glides across the crossing instead of jumping", () => {
    const at = (s: number) => rowY(race({ ...SWAP, stage: s }), 1);
    const [y0, quarter, half, threeQ, y1] = [0, 0.25, 0.5, 0.75, 1].map(at);
    // Monotone, and the quarter step is a real fraction of the whole move —
    // a rank-snap would leave y unchanged until it jumped.
    expect(Math.abs(quarter - y0)).toBeGreaterThan(Math.abs(y1 - y0) * 0.15);
    expect(half).toBeCloseTo((y0 + y1) / 2, 0);
    expect(Math.abs(threeQ - y0)).toBeGreaterThan(Math.abs(quarter - y0));
  });

  test("bar length interpolates with the value", () => {
    expect(barLen(race({ ...SWAP, stage: 0.5 }), 1)).toBeCloseTo(barLen(race({ ...SWAP, stage: 0.5 }), 2), 0);
  });

  test("an id belongs to a racer, not to a rank", () => {
    // A is ahead at stage 0 and behind at stage 1; race_1 is A at both.
    const first = race({ ...SWAP, stage: 0 });
    const last = race({ ...SWAP, stage: 1 });
    expect(rowY(first, 1)).not.toBeCloseTo(rowY(last, 1), 0);
    // The racer's element and its name cannot BOTH be the bare id "race_1":
    // a layout with two drawables sharing an id is rejected outright
    // (src/scenes/compile.ts). "race_1" is the bar's fill — the drawable the
    // rough seed is keyed to — and the name rides the sub-drawable id
    // "race_1_text", so match the element or anything welded to it.
    const label = (l: ReturnType<typeof layoutSpec>) =>
      flattenDrawables(l.drawables)
        .filter((d) => d.kind === "text" && (d.id === "race_1" || d.id.startsWith("race_1_")))
        .map((d) => (d as { text: string }).text);
    expect(label(first).join(" ")).toContain("A");
    expect(label(last).join(" ")).toContain("A");
  });

  test("top_n keeps the field to n rows, and the n+1th is the airlock", () => {
    const l = race({
      labels: ["A", "B", "C", "D"],
      values: [[10, 8, 6, 4]],
      top_n: 2,
      stage: 0,
    });
    expect(bar(l, 1)).toBeDefined();
    expect(bar(l, 2)).toBeDefined();
    // Third place sits in the fading airlock row; fourth is not drawn at all.
    expect(bar(l, 4)).toBeUndefined();
    // …but it is still DECLARED. The player's plan-time `visible` set is
    // fixed before the tween (src/render/index.ts), so a racer that re-enters
    // the field mid-cast can only do so under an id that was in `order` all
    // along — dropping the off-field beat would leave every other assertion
    // here green and break re-entry.
    expect(l.order).toContain("race_4");
  });

  test("a racer climbing into the field fades in rather than popping", () => {
    const climbing = { labels: ["A", "B", "C"], values: [[10, 8, 1], [10, 1, 8]], top_n: 2 };
    const mid = race({ ...climbing, stage: 0.5 });
    const end = race({ ...climbing, stage: 1 });
    const op = (l: ReturnType<typeof layoutSpec>) => bar(l, 3)?.style.opacity ?? 0;
    expect(op(mid)).toBeGreaterThan(0);
    expect(op(mid)).toBeLessThan(op(end));
  });

  test("order: fixed keeps input order and animates lengths only", () => {
    const fixed = { ...SWAP, order: "fixed" };
    expect(rowY(race({ ...fixed, stage: 0 }), 1)).toBeCloseTo(rowY(race({ ...fixed, stage: 1 }), 1), 3);
    // "lengths only" is the other half: the row holds still, the bar does not.
    // A falls 10 → 6 while the leader is 10 at both stages, so it keeps 60 %.
    const [len0, len1] = [0, 1].map((s) => barLen(race({ ...fixed, stage: s }), 1));
    expect(len1).toBeCloseTo(len0 * 0.6, 6);
  });

  test("a race still waiting on its script draws named, zero-length bars", () => {
    // The placeholder promise: the editor lints BEFORE any script has run, so
    // a still-unresolved "{id.var}" token must lay out as a quiet placeholder
    // — the beats and the typed names present, the data merely absent — and
    // never as an error state.
    const l = race({ labels: ["Oslo", "Bergen", "Tromsø"], values: "{sim.v}", stage: 0 });
    expect(l.warnings).toEqual([]);
    expect(l.issues).toEqual([]);
    expect(l.order.filter((id) => id.startsWith("race_"))).toEqual(["race_1", "race_2", "race_3"]);
    expect([1, 2, 3].map((i) => barLen(l, i))).toEqual([0, 0, 0]);
    expect([1, 2, 3].map((i) => racerName(l, i))).toEqual(["Oslo", "Bergen", "Tromsø"]);
    // Not data yet is not wrong data: no refusal note is drawn.
    expect(flattenDrawables(l.drawables).some((d) => d.id === "note")).toBe(false);
  });

  test("a name too long for its margin is truncated, not run off the canvas", () => {
    // The left margin stops widening at 40 % of the plot, so a long enough
    // name would otherwise be drawn past x = 0 — out-of-canvas, which is an
    // ERROR, not a cosmetic overflow.
    const long = "United Kingdom of Great Britain and Northern Ireland"; // 52 chars
    const l = race({ labels: [long, "France"], values: [[10, 6]] });
    expect(l.warnings).toEqual([]);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    const drawn = racerName(l, 1)!;
    expect(drawn.endsWith("…")).toBe(true);
    expect(drawn.length).toBeLessThan(long.length);
    // A name that fits is left exactly alone.
    expect(racerName(l, 2)).toBe("France");
  });
});
