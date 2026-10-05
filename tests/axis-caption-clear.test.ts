// A chart's axis caption and its end tick labels keep clear of each other at
// the cast's text scale (2026-10-05, an 11-part book at font_size 32): the
// templates set the caption one row under the ticks for their own sizes, and
// the text scale grew both boxes into each other — "30" at the x axis end
// under "Years since start". The caption moves (as scale markers clear their
// caption, 953db9d7); a tick label goes only when the caption has no room.
import { beforeAll, expect, test } from "vitest";
import { layoutAsSeen } from "../src/lint/at-scale";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";

beforeAll(async () => {
  await ensureEnabledPacks(["data"]);
});

const captionClashes = (spec: object) =>
  layoutAsSeen(spec as never, heuristicMeasure).issues.filter((i) => i.rule === "overlap-label-label" && i.ids.some((id) => /axes__[xy]_label$/.test(id)));
const texts = (spec: object) => flattenDrawables(layoutAsSeen(spec as never, heuristicMeasure).drawables).filter((d): d is TextDrawable => d.kind === "text");

const line = {
  template: "line_chart",
  text: { font_size: 32 },
  params: { x: [0, 5, 10, 15, 20, 25, 30], series: [{ name: "A", values: [1, 2, 3, 4, 5, 6, 7] }], x_label: "Years since start", y_label: "Survival (%)" },
  commands: [],
};

test("a line chart at a larger text size: the x caption clears the end tick, which stays", () => {
  expect(captionClashes(line)).toEqual([]);
  const t = texts(line);
  expect(t.find((d) => d.id === "axes__x1")?.text).toBe("30");
  const cap = t.find((d) => d.id === "axes__x_label")!;
  expect(cap.pos[1]).toBeLessThan(t.find((d) => d.id === "axes__x1")!.pos[1]);
});

test("in a box beside other things, too", () => {
  expect(captionClashes({ ...line, params: { ...line.params, box: "right" } })).toEqual([]);
});

test("a bar chart's x caption clears the last category's name", () => {
  const bar = { template: "bar_chart", text: { font_size: 32 }, params: { labels: ["A", "B", "C"], values: [10, 30, 20], y_label: "Deaths per 1000", x_label: "Group of people" }, commands: [] };
  expect(captionClashes(bar)).toEqual([]);
});

test("no room below to move into: the caption goes to the edge and a number it still sits on goes", () => {
  const low = { ...line, text: { font_size: 40 }, params: { ...line.params, box: { x: 150, y: 80, w: 700, h: 400 } } };
  expect(captionClashes(low)).toEqual([]);
  const t = texts(low);
  expect(t.find((d) => d.id === "axes__x_label")).toBeDefined();
  expect(t.find((d) => d.id === "axes__x0")?.text).toBe("0"); // the numbers clear of it stay
});

test("a caption already off the canvas is left to the out-of-canvas lint: no number goes for it", () => {
  const off = { ...line, text: { font_size: 40 }, params: { ...line.params, box: { x: 150, y: 50, w: 700, h: 400 } } };
  expect(texts(off).find((d) => d.id === "axes__x1")?.text).toBe("30");
});

test("at the default text size nothing moves", () => {
  const plain = { ...line, text: undefined };
  const at = texts(plain).find((d) => d.id === "axes__x_label")!.pos;
  expect(at[1]).toBeCloseTo(43, 0);
});
