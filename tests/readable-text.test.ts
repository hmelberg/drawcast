// W30 — minimum text size (spec 2026-10-04-page-frame): templates draw the
// words a viewer reads at TEXT_MIN (18) or more at scale 1; a template box
// that shrinks the figure holds them there; a body that packs its own words
// asks kit.textFit() and is laid out again at the size it will be drawn; and
// `check`/frames print an advisory for what is still under the minimum.

import { beforeAll, describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { kit, withTextFit } from "../src/scenes/kit";
import { readable, TEXT_LABEL, TEXT_MIN } from "../src/layout/readable";
import { smallTemplateText } from "../src/lint/template-text";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

/** Dense data sheets whose page-fitting trades against the floor (spec W30, "not done"). */
const EXCEPTIONS = new Set(["decision_tree", "markov_model", "des_hta", "periodic_table"]);

const templated = (bundledExamples as { request: string; spec?: Spec; specimen?: boolean }[])
  .filter((e) => !e.specimen && e.spec && typeof e.spec.template === "string")
  .map((e) => [e.request, e.spec!] as const);

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs(templated.map(([, s]) => s));
});

describe("the readable sizes", () => {
  test("TEXT_MIN 18 and TEXT_LABEL 22, on the kit too; readable() floors", () => {
    expect(TEXT_MIN).toBe(18);
    expect(TEXT_LABEL).toBe(22);
    expect(kit.TEXT_MIN).toBe(TEXT_MIN);
    expect(kit.TEXT_LABEL).toBe(TEXT_LABEL);
    expect(readable(14)).toBe(18);
    expect(readable(20)).toBe(20);
    expect(readable(16, 20)).toBe(20);
  });

  test("withTextFit: kit.textFit() answers the scale inside, 1 outside, and says whether it was asked", () => {
    expect(kit.textFit()).toBe(1);
    const asked = withTextFit(1.3, () => kit.textFit());
    expect(asked).toEqual({ value: 1.3, asked: true });
    expect(withTextFit(1.3, () => 7)).toEqual({ value: 7, asked: false });
    expect(kit.textFit()).toBe(1);
  });
});

describe("bundled examples: template text at scale 1", () => {
  test.each(templated.filter(([, s]) => !EXCEPTIONS.has(s.template!)))("%s — no template text under TEXT_MIN", (_, spec) => {
    const ex = expandSpec({ ...spec, text: spec.text ? { ...spec.text, font_size: undefined } : undefined });
    const issue = smallTemplateText(layoutSpec(ex).drawables, ex);
    expect(issue?.message ?? null).toBeNull();
  });
});

describe("a template box holds the words at TEXT_MIN", () => {
  test("sky_map in a box at s ≈ 0.73: its names land at TEXT_MIN or more, and lint clean (kit.textFit)", () => {
    const spec = expandSpec({ template: "sky_map", params: { time: "2026-12-20T21:00:00Z", place: "Oslo", focus: "Cassiopeia", names: "la", box: { x: 0, y: 140, w: 690, h: 540 } }, commands: [] } as unknown as Spec);
    const l = layoutSpec(spec);
    const names = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text" && d.id.startsWith("label_"));
    expect(names.length).toBeGreaterThan(3);
    for (const t of names) expect(t.fontSize).toBeGreaterThanOrEqual(TEXT_MIN - 1e-6);
    expect(l.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });
});

describe("crowded charts thin their labels rather than shrink them", () => {
  test("bar_chart with 30 year labels: every k-th at TEXT_MIN, none smaller", () => {
    const labels = Array.from({ length: 30 }, (_, i) => String(1991 + i));
    const l = layoutSpec(expandSpec({ template: "bar_chart", params: { labels, values: labels.map((_, i) => i + 1) }, commands: [] } as unknown as Spec));
    const cats = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text" && /^bar_\d+__l$/.test(d.id));
    expect(cats.length).toBeGreaterThan(5);
    expect(cats.length).toBeLessThan(30);
    for (const t of cats) expect(t.fontSize).toBe(TEXT_MIN);
    expect(l.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });

  test("bar_race lying down: a deep field shows fewer racers, names at TEXT_MIN or more", () => {
    const labels = Array.from({ length: 25 }, (_, i) => "Racer " + (i + 1));
    const l = layoutSpec(expandSpec({ template: "bar_race", params: { labels, values: [labels.map((_, i) => 100 - i)], top_n: 20, title: "A deep field" }, commands: [] } as unknown as Spec));
    const names = flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text" && /_text$/.test(d.id));
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names.length).toBeLessThanOrEqual(21);
    for (const t of names) expect(t.fontSize).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(l.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
  });
});

describe("the small-text advisory", () => {
  test("flags a template's own small text, never the spec's elements", () => {
    const spec = { template: "t", elements: [{ id: "note" }] };
    const text = (id: string, fontSize: number) => ({ id, kind: "text", text: "x", fontSize, pos: [0, 0], anchor: "middle", z: 2 }) as unknown as TextDrawable;
    expect(smallTemplateText([text("note", 12), text("note_ctl", 12)], spec)).toBeNull();
    const issue = smallTemplateText([text("axis__t1", 15), text("axis__t2", 16), text("name", 22)], spec);
    expect(issue?.rule).toBe("small-text");
    expect(issue?.message).toMatch(/2 texts drawn under 18 units \(smallest 15, "axis__t1"\)/);
    expect(smallTemplateText([text("axis__t1", 15)], { elements: [] })).toBeNull();
  });
});
