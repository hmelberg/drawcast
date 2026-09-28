// The `population` element (layout/population.ts): people as person
// pictograms, each in a state; stable slots, per-state orders, sets by id,
// values in drawn text, animation through a bound var, and its lint.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { lintCrowding } from "../src/lint/crowding";
import { assignStates, layoutPopulation, populationCounts, populationSlots, slotSequence, POPULATION_MIN_HEIGHT } from "../src/layout/population";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables, type Drawable, type GroupDrawable, type TextDrawable } from "../src/layout/model";
import type { Spec, SpecElement } from "../src/spec/types";

const pop = (extra: Partial<SpecElement> = {}): SpecElement => ({ id: "pop", type: "population", states: { healthy: 70, sick: 20, immune: 10 }, ...extra }) as SpecElement;
const lay = (spec: Spec) => layoutSpec(expandSpec(spec));
const top = (drawables: Drawable[], id: string) => drawables.find((d) => d.id === id) as GroupDrawable | undefined;
/** Person numbers (1-based slots) in a set, read off its children's ids. */
const people = (g: GroupDrawable | undefined): number[] =>
  [...new Set((g?.children ?? []).map((c) => Number(/__p(\d+)_/.exec(c.id)?.[1])).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);

describe("population counts", () => {
  test("the first state is the remainder; count defaults to the sum", () => {
    expect(populationCounts(pop())).toMatchObject({ count: 100, states: [{ name: "healthy", n: 70 }, { name: "sick", n: 20 }, { name: "immune", n: 10 }] });
    expect(populationCounts(pop({ count: 50, states: { healthy: 0, sick: 5 } })).states).toEqual([{ name: "healthy", n: 45 }, { name: "sick", n: 5 }]);
    expect(populationCounts({ id: "p", type: "population", count: 30 } as SpecElement).states).toEqual([{ name: "healthy", n: 30 }]);
  });
  test("states that add up to more than count are cut, and say so", () => {
    const c = populationCounts(pop({ count: 20, states: { healthy: 0, sick: 15, immune: 15 } }));
    expect(c.states.map((s) => s.n)).toEqual([0, 15, 5]);
    expect(c.issues[0]).toMatch(/add up to 30, more than count 20/);
  });
  test("a fractional count (mid-animation) rounds", () => {
    expect(populationCounts(pop({ states: { healthy: 0, sick: 12.4 }, count: 100 })).states[1].n).toBe(12);
  });
});

describe("slots and orders", () => {
  const box = { x: 100, y: 100, w: 400, h: 400 };
  test("100 people in a square box make a 10 × 10 grid, row-major from the top left", () => {
    const s = populationSlots(100, box, "grid", 1);
    expect([s.cols, s.rows]).toEqual([10, 10]);
    expect(s.centres[0][0]).toBeLessThan(s.centres[1][0]);
    expect(s.centres[0][1]).toBeGreaterThan(s.centres[10][1]);
    expect(s.h).toBeGreaterThan(30);
  });
  test("a crowd is jittered, but deterministic per seed", () => {
    const a = populationSlots(60, box, "crowd", 3), b = populationSlots(60, box, "crowd", 3), c = populationSlots(60, box, "crowd", 4);
    expect(a.centres).toEqual(b.centres);
    expect(a.centres).not.toEqual(c.centres);
    expect(a.centres).not.toEqual(populationSlots(60, box, "grid", 3).centres);
  });
  test("every order is a permutation of the slots, deterministic per seed", () => {
    const { centres } = populationSlots(100, box, "grid", 1);
    for (const o of ["spread", "cluster", "random", "rows"] as const) {
      const seq = slotSequence(centres, o, 7);
      expect([...seq].sort((a, b) => a - b)).toEqual(centres.map((_, i) => i));
      expect(slotSequence(centres, o, 7)).toEqual(seq);
    }
    expect(slotSequence(centres, "rows", 7)).toEqual(centres.map((_, i) => i));
    expect(slotSequence(centres, "random", 7)).not.toEqual(slotSequence(centres, "random", 8));
  });
  test("cluster grows outward from its seed person: the first ten are neighbours", () => {
    const { centres } = populationSlots(100, box, "grid", 1);
    const seq = slotSequence(centres, "cluster", 5);
    const first = centres[seq[0]];
    const far = Math.max(...seq.slice(0, 10).map((k) => Math.hypot(centres[k][0] - first[0], centres[k][1] - first[1])));
    expect(far).toBeLessThan(box.w * 0.25);
  });
  test("spread keeps every prefix even: no two of the first ten are neighbours", () => {
    const s = populationSlots(100, box, "grid", 1);
    const cell = box.w / s.cols;
    for (const n of [10, 20]) {
      const pts = slotSequence(s.centres, "spread", 5).slice(0, n).map((k) => s.centres[k]);
      const closest = Math.min(...pts.flatMap((p, i) => pts.slice(i + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
      expect(closest).toBeGreaterThan(cell * (n === 10 ? 2 : 1.4));
    }
  });
  test("growing the last state only adds people — nobody changes places", () => {
    const { centres } = populationSlots(100, box, "grid", 1);
    const el = pop({ order: { vaccinated: "spread", sick: "cluster" } });
    const at = (sick: number) => assignStates(centres, [{ name: "healthy", n: 0 }, { name: "vaccinated", n: 60 }, { name: "sick", n: sick }], el);
    const a = at(5), b = at(30);
    for (let k = 0; k < 100; k++) {
      if (a[k] === 1) expect(b[k]).toBe(1); // the vaccinated stay vaccinated
      if (a[k] === 2) expect(b[k]).toBe(2); // the sick stay sick
    }
    expect(b.filter((s) => s === 2)).toHaveLength(30);
    expect(b.filter((s) => s === 1)).toHaveLength(60);
  });
});

describe("population on a page", () => {
  test("each state is a set id, plus the legend; the parent id draws nothing itself", () => {
    const l = lay({ elements: [pop()] });
    expect(l.order).toEqual(expect.arrayContaining(["pop_healthy", "pop_sick", "pop_immune", "pop_legend"]));
    expect(l.order).not.toContain("pop");
    expect(l.pieceGroups.pop).toEqual(["pop_healthy", "pop_sick", "pop_immune", "pop_legend"]);
    expect(people(top(l.drawables, "pop_sick"))).toHaveLength(20);
    expect(people(top(l.drawables, "pop_immune"))).toHaveLength(10);
    expect(people(top(l.drawables, "pop_healthy"))).toHaveLength(70);
    expect(l.issues).toEqual([]);
  });
  test("an empty state is still a set (so a later animate has somewhere to put people)", () => {
    const l = lay({ elements: [pop({ states: { healthy: 100, vaccinated: 0 } })] });
    expect(l.order).toContain("pop_vaccinated");
    expect(top(l.drawables, "pop_vaccinated")?.children).toEqual([]);
  });
  test("the legend reads the counts, and labels rename a state", () => {
    const l = lay({ elements: [pop({ labels: { immune: "recovered" } })] });
    const texts = flattenDrawables([top(l.drawables, "pop_legend")!]).filter((d): d is TextDrawable => d.kind === "text").map((t) => t.text);
    expect(texts).toEqual(["70 healthy", "20 sick", "10 recovered"]);
    expect(lay({ elements: [pop({ legend: false })] }).order).not.toContain("pop_legend");
  });
  test("{pop.sick} and {pop.count} in drawn text", () => {
    const l = lay({ elements: [{ id: "t", type: "text", text: "{pop.sick} of {pop.count} sick", x: 500, y: 700 } as SpecElement, pop()] });
    expect((l.drawables.find((d) => d.id === "t") as TextDrawable).text).toBe("20 of 100 sick");
  });
  test("bound to a var: the count follows it, and the picture turns people over in order", () => {
    const spec = (i: number): Spec => ({ vars: { i }, elements: [pop({ states: { healthy: 0, sick: 1 }, count: 100, order: "cluster", bind: { "states.sick": "i" } })] });
    const s1 = people(top(lay(spec(1)).drawables, "pop_sick"));
    const s10 = people(top(lay(spec(10)).drawables, "pop_sick"));
    const s40 = people(top(lay(spec(40)).drawables, "pop_sick"));
    expect([s1.length, s10.length, s40.length]).toEqual([1, 10, 40]);
    for (const k of s1) expect(s10).toContain(k);
    for (const k of s10) expect(s40).toContain(k);
    // mid-sweep a fractional var rounds
    expect(people(top(lay(spec(12.6)).drawables, "pop_sick"))).toHaveLength(13);
  });
  test("slots stay put whatever the counts", () => {
    const heads = (sick: number) => {
      const l = lay({ elements: [pop({ states: { healthy: 0, sick }, count: 50 })] });
      const all = l.drawables.filter((d) => d.id.startsWith("pop_") && d.id !== "pop_legend") as GroupDrawable[];
      const out: Record<string, number[]> = {};
      for (const g of all) for (const c of g.children) if (c.kind === "stroke" && c.id.endsWith("_h")) out[c.id.split("__")[1]] = c.pts[0];
      return out;
    };
    expect(heads(5)).toEqual(heads(35));
  });
  test("fit places it in a region; two side by side do not overlap", () => {
    const l = lay({ elements: [pop({ id: "a", fit: "left" } as Partial<SpecElement>), pop({ id: "b", fit: "right" } as Partial<SpecElement>)] });
    const ax = l.namedAnchors.a, bx = l.namedAnchors.b;
    expect(ax.right[0]).toBeLessThan(bx.left[0]);
    expect(l.issues).toEqual([]);
  });
  test("at.place moves the whole population, sets and all", () => {
    const l = lay({ elements: [pop({ width: 300, height: 300, at: { place: "left" } })] });
    expect(l.namedAnchors.pop.left[0]).toBeLessThan(120);
    expect(l.namedAnchors.pop_sick.center[0]).toBeLessThan(400);
    expect(l.namedAnchors.pop_legend.bottom[1]).toBeGreaterThan(l.namedAnchors.pop.bottom[1] - 1);
  });
});

describe("population lint", () => {
  const issues = (el: Partial<SpecElement>) => layoutPopulation(pop(el), { x: 0, y: 0, w: 400, h: 400 }, heuristicMeasure).issues.map((i) => i.message);
  test("a clean one says nothing", () => {
    expect(issues({})).toEqual([]);
  });
  test("counts over count", () => {
    expect(issues({ count: 10, states: { healthy: 0, sick: 20 } })[0]).toMatch(/more than count 10/);
  });
  test("a state with no look and no colour; a colour makes it fine", () => {
    expect(issues({ states: { well: 50, zombie: 50 } })[0]).toMatch(/state "zombie" has no built-in look/);
    expect(issues({ states: { well: 50, zombie: 50 }, colors: { zombie: "accent" } })).toEqual([]);
  });
  test("labels, colors and order naming states that do not exist", () => {
    expect(issues({ labels: { vaxxed: "x" } })[0]).toMatch(/labels names "vaxxed"/);
    expect(issues({ order: { vaxxed: "spread" } as SpecElement["order"] })[0]).toMatch(/order names "vaxxed"/);
  });
  test("too many people for the area: warns with a count and a size that would read", () => {
    const m = layoutPopulation(pop({ count: 400, states: { healthy: 400 } }), { x: 0, y: 0, w: 200, h: 150 }, heuristicMeasure).issues[0].message;
    expect(m).toMatch(new RegExp(`under ${POPULATION_MIN_HEIGHT}, too small to read\\) — show at most \\d+, or give it about \\d+ × \\d+`));
  });
});

describe("schema", () => {
  test("a population validates; a bad one says why", () => {
    const ok = validateSpec({ elements: [pop({ layout: "crowd", order: { sick: "cluster" }, seed: 3, legend: false, labels: { sick: "ill" } })], commands: [{ draw: ["pop"] }] });
    expect(ok.errors).toEqual([]);
    expect(validateSpec({ elements: [{ id: "p", type: "population" }], commands: [] }).errors.join()).toMatch(/needs count or states/);
    expect(validateSpec({ elements: [pop({ layout: "row" })], commands: [] }).errors.join()).toMatch(/layout must be "grid" or "crowd"/);
    expect(validateSpec({ elements: [pop({ count: 0 })], commands: [] }).ok).toBe(false);
  });
});

describe("crowding", () => {
  test("a population's legend is one item on the page, however many states it has", () => {
    const states = Object.fromEntries(["healthy", "sick", "immune", "vaccinated", "dead"].map((s) => [s, 10]));
    const texts = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, type: "text", text: `w${i}`, x: 60 + (i % 5) * 180, y: 700 - Math.floor(i / 5) * 40 }) as SpecElement);
    const spec = expandSpec({ elements: [...texts, pop({ states, width: 400, height: 300, x: 500, y: 250 })], commands: [{ draw: ["pop"], speak: "a" }, { draw: texts.map((t) => t.id), speak: "b" }] });
    // 13 texts + one population = 14, the line: no warning (5 legend entries would make 18).
    expect(lintCrowding(layoutSpec(spec), spec)).toEqual([]);
  });
});
