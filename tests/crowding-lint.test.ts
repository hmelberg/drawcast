// The crowding lint (src/lint/crowding.ts): per page state, how many of the
// cast's own texts are visible at once and how much of it is small print.
import { beforeAll, describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import { CROWDING_MAX_TEXTS, crowdingStates, castOwnIds, lintCrowding } from "../src/lint/crowding";
import type { Command, Spec } from "../src/spec/types";

function labels(n: number, size?: number): NonNullable<Spec["elements"]> {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    type: "text",
    text: `L${i}`,
    x: 60 + (i % 5) * 180,
    y: 80 + Math.floor(i / 5) * 120,
    ...(size ? { font_size: size } : {}),
  })) as NonNullable<Spec["elements"]>;
}
const lint = (spec: Spec) => {
  const s = expandSpec(spec);
  return lintCrowding(layoutSpec(s), s);
};

describe("crowding lint", () => {
  test("too many texts at once warns once, naming the worst page state", () => {
    const ids = labels(16).map((e) => e.id);
    const issues = lint({ elements: labels(16), commands: [{ draw: ids.slice(0, 8), speak: "a" }, { draw: ids.slice(8), speak: "b" }] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: "crowding", severity: "warn" });
    expect(issues[0].message).toMatch(/16 text items are on the page at once after commands\[1\]/);
  });

  test("erasing what has served keeps each page state under the line", () => {
    const ids = labels(16).map((e) => e.id);
    const commands: Command[] = [{ draw: ids.slice(0, 8), speak: "a" }, { erase: ids.slice(0, 8), speak: "gone" }, { draw: ids.slice(8), speak: "b" }];
    expect(lint({ elements: labels(16), commands })).toEqual([]);
    const s = expandSpec({ elements: labels(16), commands });
    const states = crowdingStates(layoutSpec(s).drawables, s.commands, { counts: castOwnIds(s) });
    expect(Math.max(...states.map((x) => x.texts))).toBe(8);
  });

  test("several pieces of small print on one page warn", () => {
    const issues = lint({ elements: labels(6, 14), commands: [{ draw: labels(6).map((e) => e.id), speak: "a" }] });
    expect(issues.map((i) => i.message).join("\n")).toMatch(/6 texts smaller than 16 units/);
  });

  test("a template's own texts do not count — only what the cast adds", () => {
    const s = expandSpec({ template: "decision_tree", params: {}, elements: [], commands: [{ speak: "x" }] } as Spec);
    expect(lintCrowding(layoutSpec(s), s)).toEqual([]);
  });
});

// Tuning: the thresholds were set so that almost no bundled example trips.
// Measured 2026-09-28 over 358 specs: the cast's own texts peak above 10 in
// 8, above 12 in 5, above 14 in ONE (a freehand Markov cohort, 15 at once);
// small print (more than two texts under 16 units at once) in none. Counting
// template texts too, 70 would trip at 14 — a template's page is designed.
const ex = (bundledExamples as { request: string; spec?: Spec; playlist?: string; specimen?: boolean }[]).filter((e) => !e.specimen);
const cases: [string, Spec][] = ex.flatMap((e) =>
  e.spec
    ? [[e.request, expandSpec(e.spec)] as [string, Spec]]
    : e.playlist
      ? itemsOf(parsePlaylistText(e.playlist)).map((it, i) => [`${e.request} [${i + 1}]`, expandSpec(it.spec)] as [string, Spec])
      : [],
);
beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  await ensureEnginesForSpecs(cases.map(([, s]) => s));
});

test(`bundled examples: at most one trips the crowding lint (more than ${CROWDING_MAX_TEXTS} texts)`, () => {
  const trips = cases.filter(([, spec]) => lintCrowding(layoutSpec(spec), spec).length > 0).map(([req]) => req);
  expect(trips.length, trips.join("\n")).toBeLessThanOrEqual(1);
});

test("a deck's cards and boxes are one figure, however many cards", () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ text: `C${i}`, bin: i % 2 ? "A" : "B" }));
  const s = expandSpec({
    elements: [{ id: "deck", type: "cards", bins: ["A", "B"], deck: true, items }],
    commands: [{ draw: ["deck"], speak: "a" }, { ask: { question: "Which?", on: "deck" } }],
  } as unknown as Spec);
  expect(lintCrowding(layoutSpec(s), s)).toEqual([]);
});
