import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { elementBBoxes } from "../src/layout/layout";
import { leafDrawables } from "../src/layout/model";
import type { Pt } from "../src/layout/model";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import type { Spec } from "../src/spec/types";
import { guessParts, guessSetup, pieGeometry } from "../src/guess/handles";
import {
  EACH_MS,
  FADED,
  RIGHT,
  TRUTH,
  WRONG,
  YOURS,
  arrow,
  besideMarks,
  besideOffsets,
  besideParams,
  besideStyles,
  besideValues,
  fadeYours,
  partProgress,
  piePair,
  revealLength,
  tick,
} from "../src/guess/reveal";

beforeAll(() => {
  registerPack("data", dataYaml);
});

function setupFor(spec: Spec, on: string | string[], from?: number) {
  const s = expandSpec(spec);
  const layout = layoutSpec(s);
  return { s, layout, setup: guessSetup(s, s.params ?? {}, layout, guessParts(s, on), { from }) };
}

const bars: Spec = {
  template: "bar_chart",
  params: { labels: ["Norway", "Sweden", "Denmark"], values: [87, 52, 58], value_labels: true },
  commands: [],
} as Spec;

/** Each leaf's box from its points (areas and strokes). */
function leafBoxes(s: Spec): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const d of leafDrawables(layoutSpec(s).drawables)) {
    const pts = (d as { pts?: Pt[] }).pts;
    if (!pts || pts.length === 0) continue;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.set(d.id, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  return out;
}

describe("timing", () => {
  test("all at once, or each part EACH_MS after the one before", () => {
    expect(partProgress(0, 450, 900)).toBeCloseTo(0.5);
    expect(partProgress(2, 450, 900)).toBeCloseTo(0.5);
    expect(partProgress(0, 450, 900, "each")).toBeCloseTo(0.5);
    expect(partProgress(1, 450, 900, "each")).toBe(0);
    expect(partProgress(1, EACH_MS + 450, 900, "each")).toBeCloseTo(0.5);
    expect(revealLength(3, 900)).toBe(900);
    expect(revealLength(3, 900, "each")).toBe(900 + 2 * EACH_MS);
  });
});

describe("bars: halves", () => {
  test("the template draws a beside bar in the right half of its width; the slot and label stay", () => {
    const { s, setup } = setupFor(bars, "bar_2");
    const h = setup.handles[0];
    const p = besideParams(setup.handles, [1]);
    expect(p).toEqual({ beside_bars: [1] });
    const plain = leafBoxes(s);
    const halved = leafBoxes({ ...s, params: withOverrides(s.params ?? {}, p) });
    const fill = (b: Map<string, { x: number; w: number }>) => b.get("bar_2__f0")!;
    expect(fill(halved).w).toBeLessThan(fill(plain).w * 0.55);
    expect(fill(halved).x).toBeGreaterThan(h.cx! - 1);
    expect(fill(halved).x + fill(halved).w).toBeCloseTo(fill(plain).x + fill(plain).w, 0);
    // The other bars and the category label do not move.
    expect(halved.get("bar_1__f0")).toEqual(plain.get("bar_1__f0"));
    const labels = (x: Spec) => elementBBoxes(layoutSpec(x));
    expect(labels({ ...s, params: withOverrides(s.params ?? {}, p) }).get("bar_2__l") ?? null).toEqual(labels(s).get("bar_2__l") ?? null);
  });

  test("the true bar grows from zero; yours is a blue mark in the left half; the gap in ink", () => {
    const { setup } = setupFor(bars, "bar_2");
    const h = setup.handles[0];
    expect(besideValues(setup.handles, [[30]], [0])).toEqual([[0]]);
    expect(besideValues(setup.handles, [[30]], [1])[0][0]).toBeCloseTo(52);
    const m = besideMarks(setup.handles, [[30]], [1]);
    const filled = m.lines.find((l) => l.fill !== undefined)!;
    expect(filled.fill).toBe(YOURS);
    expect(Math.max(...filled.pts.map((p) => p[0]))).toBeLessThanOrEqual(h.cx!);
    expect(Math.min(...filled.pts.map((p) => p[0]))).toBeCloseTo(h.cx! - h.halfW!, 5);
    const gap = m.texts.find((t) => t.text === "+22")!;
    expect(gap.color).toBe(TRUTH);
    // Not yet at the end: no gap written.
    expect(besideMarks(setup.handles, [[30]], [0.5]).texts).toEqual([]);
  });

  test("fading takes the blue down to FADED and leaves the ink", () => {
    const { setup } = setupFor(bars, "bar_2");
    const m = fadeYours(besideMarks(setup.handles, [[30]], [1]), FADED);
    const filled = m.lines.find((l) => l.fill !== undefined)!;
    // Fill and outline each fade once: the fill through fill-opacity, the outline through opacity.
    expect(filled.fillOpacity).toBeCloseTo(0.6 * FADED);
    expect(filled.opacity ?? 1).toBe(1);
    expect(m.lines.filter((l) => l.color === YOURS && l.fill === undefined).every((l) => Math.abs((l.opacity ?? 1) - FADED) < 1e-9)).toBe(true);
    // besideMarks' own fade is the same.
    const own = besideMarks(setup.handles, [[30]], [1], FADED).lines.find((l) => l.fill !== undefined)!;
    expect((own.fillOpacity ?? 0) * (own.opacity ?? 1)).toBeCloseTo(0.6 * FADED);
    // The gap ("+22") is yours against the truth: it fades with yours (final fix wave E).
    expect(m.texts.find((t) => t.text === "+22")?.opacity).toBeCloseTo(FADED);
    expect(besideMarks(setup.handles, [[30]], [1], FADED).texts.find((t) => t.text === "+22")?.opacity).toBeCloseTo(FADED);
  });
});

describe("line: yours stays, the truth draws over it in ink", () => {
  const line: Spec = { template: "line_chart", params: { x: [1, 2, 3, 4, 5, 6], values: [1, 2, 3, 4, 5, 6] }, commands: [] } as Spec;
  test("the template stays at yours; the true line is cut at the reveal's progress; ±avg at the end", () => {
    const { setup } = setupFor(line, "line_1", 4);
    const h = setup.handles[0];
    const guess = [h.truth.map(() => 3)];
    expect(besideValues(setup.handles, guess, [0.5])).toEqual(guess);
    const half = besideMarks(setup.handles, guess, [0.5]);
    const ink = half.lines.find((l) => l.color === TRUTH)!;
    const blue = half.lines.find((l) => l.color === YOURS && l.fill === undefined)!;
    expect(Math.max(...ink.pts.map((p) => p[0]))).toBeLessThan(Math.max(...blue.pts.map((p) => p[0])));
    expect(half.lines.some((l) => l.fill === YOURS && l.fillOpacity === 0.15)).toBe(true);
    const end = besideMarks(setup.handles, guess, [1]);
    expect(end.texts.some((t) => /avg$/.test(t.text))).toBe(true);
  });
});

describe("pie: a true pie beside yours", () => {
  const pie: Spec = { template: "pie_chart", params: { labels: ["A", "B", "C"], values: [50, 30, 20] }, commands: [] } as Spec;
  test("the pair is the same size, centred where the one stood, the true pie's names on the canvas", () => {
    const { setup } = setupFor(pie, "slice_2");
    const h = setup.handles[0];
    const pair = piePair(h)!;
    expect(pair.yours.r).toBeCloseTo(pair.truth.r);
    expect(pair.yours.c[0]).toBeLessThan(h.centre![0]);
    expect(pair.truth.c[0]).toBeGreaterThan(h.centre![0]);
    expect(pair.truth.c[0] + pair.truth.r + 150).toBeLessThanOrEqual(1000);
    expect(pair.yours.c[0] - pair.yours.r).toBeGreaterThanOrEqual(0);
    expect(besideParams(setup.handles, [1])).toEqual({ beside_pie: pair.param });
    // The template draws its pie there; the title keeps its place.
    const s = expandSpec({ ...pie, params: { ...pie.params, title: "Shares" } } as Spec);
    const plain = leafBoxes(s);
    const moved = leafBoxes({ ...s, params: withOverrides(s.params ?? {}, { beside_pie: pair.param }) });
    const boxes = (x: Spec) => elementBBoxes(layoutSpec(x));
    expect(boxes({ ...s, params: withOverrides(s.params ?? {}, { beside_pie: pair.param }) }).get("title")).toEqual(boxes(s).get("title"));
    expect(moved.get("slice_1__f")!.x).toBeGreaterThan(plain.get("slice_1__f")!.x + 50);
    const g = pieGeometry(s.params ?? {});
    expect(g.radius).toBeGreaterThan(0);
  });

  test("yours is a blue pie with the asked slice tinted and its number; the truth arrives after the move", () => {
    const { setup } = setupFor(pie, "slice_2");
    const m = besideMarks(setup.handles, [[45]], [1]);
    expect(m.lines.some((l) => l.fill === YOURS)).toBe(true);
    expect(m.texts.some((t) => t.text === "45%" && t.color === YOURS)).toBe(true);
    // Half way through: moved, the shares still yours.
    expect(besideValues(setup.handles, [[45]], [0.5])[0][0]).toBeCloseTo(45);
    expect(besideValues(setup.handles, [[45]], [1])[0][0]).toBeCloseTo(30);
  });
});

describe("scale: your pin stays, the true pin drops", () => {
  const scale: Spec = { elements: [{ id: "year", type: "scale", min: 1700, max: 1800, value: 1756, label: "Born" }], commands: [] } as unknown as Spec;
  test("yours is a blue pin; the truth's own pin drops in; a bracket in ink", () => {
    const { setup } = setupFor(scale, "year");
    expect(setup.handles).toHaveLength(1);
    const off = besideOffsets(setup.handles, [0]);
    expect(Object.values(off)[0][1]).toBeGreaterThan(0);
    expect(besideOffsets(setup.handles, [1])).toEqual({});
    expect(besideValues(setup.handles, [[1720]], [0])).toEqual([[1756]]);
    const m = besideMarks(setup.handles, [[1720]], [1]);
    expect(m.lines.some((l) => l.fill === YOURS)).toBe(true);
    expect(m.lines.some((l) => l.color === TRUTH)).toBe(true);
    expect(m.texts.some((t) => t.text === "+36" && t.color === TRUTH)).toBe(true);
  });
});

describe("marks helpers", () => {
  test("✓ green, ✗ red; an arrow ends at its target", () => {
    expect(tick([0, 0], true)).toMatchObject({ text: "✓", color: RIGHT });
    expect(tick([0, 0], false)).toMatchObject({ text: "✗", color: WRONG });
    const a = arrow([0, 0], [100, 0]);
    expect(a[0].pts[1]).toEqual([100, 0]);
    expect(a[1].pts[1]).toEqual([100, 0]);
    expect(a.every((l) => l.color === WRONG)).toBe(true);
  });
});

describe("fix round 1", () => {
  test("negative bars: the gap is written under the lower end, clear of both halves", () => {
    const neg: Spec = { template: "bar_chart", params: { labels: ["A", "B", "C"], values: [5, -8, 3], value_labels: true }, commands: [] } as Spec;
    const { setup } = setupFor(neg, "bar_2");
    const h = setup.handles[0];
    const m = besideMarks(setup.handles, [[-4]], [1]);
    const fill = m.lines.find((l) => l.fill === YOURS)!;
    const gap = m.texts.find((t) => t.color === TRUTH)!;
    const truthEnd = h.toLogical!([0, -8])[1];
    expect(gap.at[1]).toBeLessThan(Math.min(...fill.pts.map((p) => p[1])));
    expect(gap.at[1]).toBeLessThan(truthEnd - 20);
  });

  test("a scale's true pin and number are drawn in ink", () => {
    const scale: Spec = { elements: [{ id: "year", type: "scale", min: 1700, max: 1800, value: 1756 }], commands: [] } as unknown as Spec;
    const { setup } = setupFor(scale, "year");
    const st = besideStyles(setup.handles);
    expect(st["year_answer_pin"]).toEqual({ style: { color: TRUTH, fill: TRUTH, fill_style: "wash" } });
    expect(st["year_answer_num"]).toEqual({ style: { color: TRUTH } });
    expect(besideStyles(setupFor(bars, "bar_2").setup.handles)).toEqual({});
  });

  test("a boxed pie keeps the pair inside its box; a named box uses the pie as drawn", () => {
    const boxed: Spec = { template: "pie_chart", params: { labels: ["A", "B", "C"], values: [5, 3, 2], box: { x: 500, y: 100, w: 450, h: 500 } }, commands: [] } as Spec;
    const pair = piePair(setupFor(boxed, "slice_1").setup.handles[0])!;
    expect(pair.yours.c[0] - pair.yours.r).toBeGreaterThanOrEqual(500);
    expect(pair.truth.c[0] + pair.truth.r + 150).toBeLessThanOrEqual(950 + 1e-6);
    const named: Spec = { template: "pie_chart", params: { labels: ["A", "B", "C"], values: [5, 3, 2], box: "right" }, commands: [] } as unknown as Spec;
    const h = setupFor(named, "slice_1").setup.handles[0];
    expect(h.centre![0]).toBeGreaterThan(600);
    const p2 = piePair(h)!;
    expect(p2.yours.c[0] - p2.yours.r).toBeGreaterThan(500);
  });
});
