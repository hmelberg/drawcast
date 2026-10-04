// W27: a number line's extra labelled markers (`markers` on a scale) —
// "old limit" at 7 and "2011" at 13, placed by the engine.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { planOptionsFor } from "../src/render/index";
import { planCommands } from "../src/render/plan";
import { expandSpec } from "../src/spec/expand";
import { scaleGeometry, scaleMarkerElements, type ScaleElementLike } from "../src/spec/scale";
import { validateSpec } from "../src/spec/schema";
import { parseScript, printScript } from "../src/spec/script";
import type { Spec, SpecElement } from "../src/spec/types";

const folds: ScaleElementLike = {
  id: "folds",
  type: "scale",
  min: 0,
  max: 20,
  ticks: 4,
  value: 12,
  unit: "folds",
  x: 150,
  y: 470,
  width: 700,
  markers: [
    { value: 7, label: "old limit" },
    { value: 13, label: "2011" },
    { value: 14 },
  ],
};

const textOf = (els: SpecElement[], id: string) => els.find((e) => e.id === id) as SpecElement & { x: number; y: number; text: string; font_size: number };

describe("scale markers", () => {
  test("each marker is a group: a tick on the line, its words above the answer's number", () => {
    const els = scaleMarkerElements(folds);
    const g = scaleGeometry(folds);
    for (const n of [1, 2, 3]) {
      expect(els.find((e) => e.id === `folds_marker_${n}`)?.type).toBe("group");
      const tick = els.find((e) => e.id === `folds_marker_${n}_tick`) as SpecElement & { points: number[][] };
      expect(tick.points[0][0]).toBeCloseTo(g.xAt(folds.markers![n - 1].value));
    }
    expect(textOf(els, "folds_marker_1_words").text).toBe("old limit");
    // No label: the value as the line writes it.
    expect(textOf(els, "folds_marker_3_words").text).toBe("14 folds");
    // Above the band the guess's number takes — and the tick numbers are under the line.
    const size = g.sizes!.answer;
    const bandTop = g.y + 36 + Math.round(size * 0.6) + size * 0.6;
    for (const n of [1, 2, 3]) {
      const t = textOf(els, `folds_marker_${n}_words`);
      expect(t.y - t.font_size / 2).toBeGreaterThan(bandTop);
    }
  });

  test("neighbours that would touch are put on different rows", () => {
    const els = scaleMarkerElements(folds);
    const a = textOf(els, "folds_marker_2_words");
    const b = textOf(els, "folds_marker_3_words");
    // 13 and 14 are 35 apart; "2011" and "14 folds" cannot share a row.
    expect(a.y).not.toBe(b.y);
    // 7 stands alone: the first row.
    expect(textOf(els, "folds_marker_1_words").y).toBe(Math.min(a.y, b.y));
  });

  test("a leader never crosses the answer's number", () => {
    const els = scaleMarkerElements(folds);
    // 13 is under "12 folds" (the answer's number): no leader; 7 is clear: a leader.
    expect(els.some((e) => e.id === "folds_marker_2_lead")).toBe(false);
    expect(els.some((e) => e.id === "folds_marker_1_lead")).toBe(true);
  });

  test("the markers come with the line when the cast does not draw them, and go with it", () => {
    const spec = expandSpec({
      title: "Folds",
      heading: false,
      elements: [folds as never],
      commands: [{ draw: "folds" }, { speak: "Seven was the old limit." }, { erase: "folds" }],
    } as Spec);
    expect(validateSpec(spec).errors ?? []).toEqual([]);
    const layout = layoutSpec(spec);
    expect(layout.order).toContain("folds_marker_1_words");
    const opts = planOptionsFor(spec, layout);
    expect(opts.drawnAfter!("folds_line")).toContain("folds_marker_1_words");
    const plan = planCommands(spec.commands, layout.order, { bboxOf: () => null, ...opts });
    const draw = plan.steps.find((s) => s.kind === "draw") as { ids: string[] };
    expect(draw.ids).toContain("folds_marker_1_words");
    expect(opts.ownedBy!("folds_line")).toContain("folds_marker_2_words");
  });

  test("a marker the cast draws itself is drawn where the cast says", () => {
    const spec = expandSpec({
      title: "Folds",
      heading: false,
      elements: [folds as never],
      commands: [{ draw: "folds" }, { speak: "In 2011 a class folded it thirteen times.", draw: "folds_marker_2" }],
    } as Spec);
    const layout = layoutSpec(spec);
    const plan = planCommands(spec.commands, layout.order, { bboxOf: () => null, ...planOptionsFor(spec, layout) });
    const draws = plan.steps.filter((s) => s.kind === "draw") as { ids: string[] }[];
    expect(draws[0].ids).toContain("folds_marker_1_words");
    expect(draws[0].ids).not.toContain("folds_marker_2_words");
    expect(draws.some((d) => d.ids.includes("folds_marker_2_words"))).toBe(true);
  });

  test("markers survive the .cast round trip", () => {
    const spec = { title: "Folds", elements: [folds as never], commands: [{ draw: "folds" }] } as Spec;
    const back = parseScript(printScript(spec));
    expect((back.elements![0] as unknown as ScaleElementLike).markers).toEqual(folds.markers);
  });
});
