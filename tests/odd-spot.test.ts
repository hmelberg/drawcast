// W13: ODD ONE OUT (spec/odd-one-out.ts) and SPOT IT ON THE PICTURE
// (spec/spot.ts, layout/spot-geometry.ts) — expansion, validation, plan.

import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { expandOddOneOut, oddErrors, oddIndex, rulePlace } from "../src/spec/odd-one-out";
import { expandSpot, spotErrors, spotPlace } from "../src/spec/spot";
import { validateSpec } from "../src/spec/schema";
import { judgeSpot, nearestEdge, spotPoint } from "../src/layout/spot-geometry";
import { planCommands } from "../src/render/plan";
import { FULL_VIEW4 } from "../src/spec/places";
import type { Command, Spec } from "../src/spec/types";

const ZOO: Spec = {
  title: "Zoo",
  elements: [
    {
      id: "zoo",
      type: "cards",
      items: [{ text: "Whale" }, { text: "Bat" }, { text: "Dolphin" }, { text: "Platypus" }, { text: "Shark", odd: true }],
      rule: "All four are mammals; the shark is a fish.",
    },
  ],
  commands: [
    { draw: ["zoo"] },
    { ask: { question: "Which one is not a mammal? Tap it.", on: "zoo", right: "The shark is a fish.", wrong: "Look again." } },
  ],
} as unknown as Spec;

describe("odd one out", () => {
  test("oddIndex: exactly one odd item", () => {
    expect(oddIndex([{ text: "a" }, { text: "b", odd: true }])).toBe(1);
    expect(oddIndex([{ text: "a", odd: true }, { text: "b", odd: true }])).toBe(-1);
    expect(oddIndex(["a", "b"])).toBe(-1);
  });

  test("validates; the cards ask becomes a choose over the cards, left to right, with the ring and the rule", () => {
    expect(validateSpec(ZOO).errors ?? []).toEqual([]);
    const out = expandSpec(ZOO);
    const ask = out.commands!.find((c) => c.ask)!.ask!;
    expect(ask.on).toBeUndefined();
    expect(ask.answer).toBe("zoo_5");
    expect([...(ask.choose as string[])].sort()).toEqual(["zoo_1", "zoo_2", "zoo_3", "zoo_4", "zoo_5"]);
    const xs = (ask.choose as string[]).map((id) => (out.elements!.find((e) => e.id === id) as { x: number }).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(ask.reveal_draw).toEqual(["zoo_odd", "zoo_rule"]);
    const ring = out.elements!.find((e) => e.id === "zoo_odd")!;
    expect(ring).toMatchObject({ type: "annotation", kind: "circle", target: ["zoo_5"] });
    const rule = out.elements!.find((e) => e.id === "zoo_rule") as { text: string; y: number };
    expect(rule.text).toBe("All four are mammals; the shark is a fish.");
    // Under the cards, above the caption band.
    const card = out.elements!.find((e) => e.id === "zoo_1") as { y: number; height: number };
    expect(rule.y).toBeLessThan(card.y - card.height / 2);
    expect(rule.y).toBeGreaterThan(160);
    // Idempotent: a second pass adds nothing.
    expect(expandOddOneOut(out)).toBe(out);
  });

  test("choose over drawn things with a rule", () => {
    const spec = {
      title: "t",
      elements: [
        { id: "a", type: "icon", of: "dog", x: 200, y: 400, size: 80 },
        { id: "b", type: "icon", of: "cat", x: 400, y: 400, size: 80 },
        { id: "c", type: "icon", of: "car", x: 600, y: 400, size: 80 },
      ],
      commands: [{ draw: ["a", "b", "c"] }, { ask: { question: "Which is not an animal?", choose: ["a", "b", "c"], answer: "c", rule: "Two are animals." } }],
    } as unknown as Spec;
    expect(oddErrors(spec)).toEqual([]);
    const out = expandOddOneOut(spec);
    expect(out.commands![1].ask!.reveal_draw).toEqual(["odd_1_odd", "odd_1_rule"]);
    const rule = out.elements!.find((e) => e.id === "odd_1_rule") as { x: number; y: number };
    expect(rule.x).toBe(400);
    expect(rule.y).toBe(360 - 62);
  });

  test("rulePlace: over the options when below would reach the caption band", () => {
    expect(rulePlace({ x: 100, y: 170, w: 200, h: 100 }).y).toBe(170 + 100 + 62);
  });

  test("errors: two odd items, a rule with nothing odd, a rule with no answer", () => {
    const two = { elements: [{ id: "z", type: "cards", items: [{ text: "a", odd: true }, { text: "b", odd: true }, "c"] }], commands: [] } as unknown as Spec;
    expect(oddErrors(two).join(" ")).toMatch(/exactly one/);
    const rule = { elements: [{ id: "z", type: "cards", items: ["a", "b", "c"], ends: ["x", "y"], rule: "r" }], commands: [] } as unknown as Spec;
    expect(oddErrors(rule).join(" ")).toMatch(/odd: true/);
    const ask = { elements: [], commands: [{ ask: { question: "q", choose: ["a", "b"], rule: "r" } }] } as unknown as Spec;
    expect(oddErrors(ask).join(" ")).toMatch(/choose with answer/);
  });

  test("plan: the ring and the rule are visible after the ask, and the step carries them", () => {
    const out = expandSpec(ZOO);
    const ids = out.elements!.map((e) => e.id);
    const plan = planCommands(out.commands!, ids, { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
    const i = plan.steps.findIndex((s) => s.kind === "ask");
    const step = plan.steps[i] as { revealDraw?: string[]; choose?: unknown[] };
    expect(step.revealDraw).toEqual(["zoo_odd", "zoo_rule"]);
    expect(step.choose).toHaveLength(5);
    expect(plan.states[i].visible).toContain("zoo_rule");
    expect(plan.states[i - 1].visible).not.toContain("zoo_rule");
  });
});

describe("spot it", () => {
  const square = { box: { x: 0, y: 0, w: 100, h: 100 }, rings: [[[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][]] };
  test("judge: inside, a near miss within reach, a far miss with its nearest edge", () => {
    expect(judgeSpot(square, [50, 50]).ok).toBe(true);
    expect(judgeSpot(square, [110, 50]).ok).toBe(true); // reach = max(14, 0.1 × 141)
    const far = judgeSpot(square, [200, 50]);
    expect(far.ok).toBe(false);
    expect(far.nearest).toEqual([100, 50]);
    expect(far.off).toBeCloseTo(100);
    expect(judgeSpot(square, [130, 50], 0.25).ok).toBe(true);
  });
  test("an L-shaped place: its point is inside, never the box centre outside it", () => {
    const L = { box: { x: 0, y: 0, w: 100, h: 100 }, rings: [[[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]] as [number, number][]] };
    const p = spotPoint(L);
    expect(judgeSpot(L, p).inside).toBe(true);
    // A part's fill and its closed stroke are the same ring twice: still inside.
    expect(judgeSpot({ ...L, rings: [L.rings[0], L.rings[0]] }, [10, 10]).inside).toBe(true);
    expect(nearestEdge({ box: { x: 0, y: 0, w: 10, h: 10 } }, [5, 20])).toEqual([5, 10]);
  });

  const BODY: Spec = {
    title: "Body",
    elements: [{ id: "body", type: "image", url: "https://example.org/body.png", x: 500, y: 400, width: 400, regions: { liver: [0.3, 0.4, 0.2, 0.1] } }],
    commands: [{ draw: ["body"] }, { ask: { question: "Where is the liver? Tap it.", spot: "liver", on: "body", right: "Here, under the ribs." } }],
  } as unknown as Spec;

  test("a region of the on image: validates, expands to a click on the place", () => {
    expect(spotErrors(BODY)).toEqual([]);
    expect(validateSpec(BODY).errors ?? []).toEqual([]);
    expect(spotPlace(BODY, BODY.commands![1].ask!)).toBe("body:liver");
    const ask = expandSpot(BODY).commands![1].ask!;
    expect(ask).toMatchObject({ widget: "click", answer: "body:liver", spot: "body:liver" });
    expect(ask.on).toBeUndefined();
  });
  test("a part or element id stays itself; a wrong region is named", () => {
    const anat = { template: "anatomy", commands: [{ ask: { question: "Where is the liver?", spot: "liver", on: "anatomy" } }] } as unknown as Spec;
    expect(expandSpot(anat).commands![0].ask).toMatchObject({ answer: "liver", widget: "click" });
    const bad = { ...BODY, commands: [{ ask: { question: "q", spot: "heart", on: "body" } }] } as unknown as Spec;
    expect(spotErrors(bad).join(" ")).toMatch(/not a region of body — it has: liver/);
    const clash = { ...BODY, commands: [{ ask: { question: "q", spot: "liver", on: "body", answer: "x" } }] } as unknown as Spec;
    expect(spotErrors(clash).join(" ")).toMatch(/leave out answer/);
  });
  test("plan: a region's box and point; an element's point is inside its outline", () => {
    const rect = { x: 300, y: 300, w: 400, h: 200 };
    const cmds = expandSpot(BODY).commands as Command[];
    const plan = planCommands(cmds, ["body"], {
      bboxOf: (id) => (id === "body" ? rect : null),
      pictureOf: (id) => (id === "body" ? { frame: { rect, view: FULL_VIEW4 }, regions: { liver: [0.3, 0.4, 0.2, 0.1] } } : null),
    });
    const s = plan.steps.find((x) => x.kind === "ask") as { spot?: { box: { x: number; w: number } }; answerPoint?: number[]; widget?: string };
    expect(s.widget).toBe("click");
    expect(s.spot!.box.x).toBeCloseTo(420);
    expect(s.spot!.box.w).toBeCloseTo(80);
    expect(s.answerPoint![0]).toBeCloseTo(460);

    const L: [number, number][] = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]];
    const p2 = planCommands([{ draw: ["liver"] }, { ask: { question: "q", widget: "click", answer: "liver", spot: "liver" } }] as Command[], ["liver"], {
      bboxOf: () => ({ x: 0, y: 0, w: 100, h: 100 }),
      ringsOf: () => [L],
    });
    const s2 = p2.steps.find((x) => x.kind === "ask") as { answerPoint: [number, number] };
    expect(judgeSpot({ box: { x: 0, y: 0, w: 100, h: 100 }, rings: [L] }, s2.answerPoint).inside).toBe(true);
  });
});
