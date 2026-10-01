import { describe, expect, test } from "vitest";
import { cardsGeometry, expandCards, authoredCards, shuffleOrder, type CardsElementLike } from "../src/spec/cards";
import { cardAt, cardsMarks, decodeArrangement, drop, encodeArrangement, initialArrangement, positions, rightCards, scoreCards } from "../src/cards/model";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const rank: CardsElementLike = { id: "spend", type: "cards", items: ["USA", "Germany", "Norway", "UK", "Spain"], ends: ["most", "least"] };
const sort: CardsElementLike = {
  id: "costs",
  type: "cards",
  bins: ["Fixed", "Variable"],
  items: [
    { text: "Rent", bin: "Fixed" },
    { text: "Flour", bin: "Variable" },
    { text: "Insurance", bin: "Fixed" },
    { text: "Packaging", bin: "Variable" },
  ],
};

describe("shuffle", () => {
  test("never the true order, and a permutation", () => {
    for (let n = 2; n <= 8; n++) {
      const p = shuffleOrder(n);
      expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(p.every((v, i) => v === i)).toBe(false);
    }
  });
});

describe("rank", () => {
  const g = cardsGeometry(rank);
  test("cards are drawn shuffled; the truth is the slots in order", () => {
    expect(g.mode).toBe("rank");
    expect(g.cards).toEqual(["spend_1", "spend_2", "spend_3", "spend_4", "spend_5"]);
    expect(g.truth).toEqual(g.slots);
    expect(rightCards(g, initialArrangement(g)).every(Boolean)).toBe(false);
  });

  test("a drop takes the slot; the others make room", () => {
    let a = initialArrangement(g);
    const usa = 0;
    a = drop(g, a, usa, g.slots[0]);
    expect(a.order[0]).toBe(usa);
    expect(new Set(a.order).size).toBe(5);
    expect(positions(g, a)[usa]).toEqual(g.slots[0]);
  });

  test("scoring, encoding and the cards under the pointer", () => {
    const truth = { order: [0, 1, 2, 3, 4], boxes: [] };
    expect(scoreCards(g, truth)).toEqual({ within: 5, count: 5, ok: true });
    const a = { order: [0, 2, 1, 3, 4], boxes: [] };
    expect(scoreCards(g, a)).toEqual({ within: 3, count: 5, ok: false });
    expect(scoreCards(g, a, 0.5).ok).toBe(true);
    expect(decodeArrangement(g, encodeArrangement(g, a))).toEqual(a);
    expect(decodeArrangement(g, "0,0,1,2,3")).toBeNull();
    expect(cardAt(g, positions(g, a), positions(g, a)[2])).toBe(2);
  });

  test("marks: the place the viewer gave each wrong card", () => {
    const m = cardsMarks(g, { order: [0, 2, 1, 3, 4], boxes: [] });
    expect(m.texts.map((t) => t.text).sort()).toEqual(["you: 2nd", "you: 3rd"]);
  });
});

describe("sort", () => {
  const g = cardsGeometry(sort);
  test("boxes, a row of cards, the truth in the right box", () => {
    expect(g.mode).toBe("sort");
    expect(g.truthBin).toEqual([0, 1, 0, 1]);
    expect(g.binBoxes).toHaveLength(2);
    const fixed = g.binBoxes[0];
    expect(Math.abs(g.truth[0][0] - fixed.c[0])).toBeLessThan(1);
  });

  test("a drop in a box stacks it; elsewhere sends it back", () => {
    let a = initialArrangement(g);
    a = drop(g, a, 0, g.binBoxes[0].c);
    a = drop(g, a, 2, g.binBoxes[0].c);
    expect(a.boxes[0]).toEqual([0, 2]);
    expect(positions(g, a)[2]).toEqual(g.binSlot(0, 1));
    a = drop(g, a, 0, [5, 5]);
    expect(a.boxes[0]).toEqual([2]);
    expect(positions(g, a)[0]).toEqual(g.home[0]);
  });

  test("scoring: unplaced cards are wrong", () => {
    const a = { order: [], boxes: [[0, 1], [3]] };
    expect(scoreCards(g, a)).toEqual({ within: 2, count: 4, ok: false });
    expect(decodeArrangement(g, encodeArrangement(g, a))).toEqual(a);
    expect(cardsMarks(g, a).lines).toHaveLength(2); // Flour (wrong box) and Insurance (never placed)
  });
});

describe("the element", () => {
  test("expands, validates, lays out, and its group carries the fields back", () => {
    const spec = expandSpec({ commands: [], elements: [rank as never, sort as never] } as Spec);
    expect(validateSpec(spec).ok).toBe(true);
    expect(authoredCards(spec).map((c) => c.id)).toEqual(["spend", "costs"]);
    const layout = layoutSpec(spec);
    expect(layout.order).toEqual(expect.arrayContaining(["spend_1", "spend_end_1", "costs_bin_1_box", "costs_4"]));
    expect(expandCards({ commands: [] } as Spec)).toEqual({ commands: [] });
  });

  test("validation: a sort item needs a bin among bins", () => {
    const bad = validateSpec({ commands: [], elements: [{ id: "c", type: "cards", bins: ["A", "B"], items: [{ text: "x", bin: "C" }, { text: "y", bin: "A" }] }] } as never);
    expect(JSON.stringify(bad)).toMatch(/every item needs/);
  });

  test("lint: cards must be drawn before the question", () => {
    const issues = (commands: Spec["commands"]) =>
      lintCommands(expandSpec({ elements: [rank as never], commands } as Spec)).filter((i) => i.rule === "guess");
    expect(issues([{ draw: ["spend"] }, { ask: { question: "Order?", on: "spend" } }])).toEqual([]);
    expect(issues([{ ask: { question: "Order?", on: "spend" } }])).toHaveLength(1);
  });

  test("plan: after the question every card stands at its true place", () => {
    const g = cardsGeometry(rank);
    const offsets: Record<string, [number, number]> = {};
    g.cards.forEach((c, i) => (offsets[c] = [g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]]));
    const plan = planCommands([{ draw: ["spend_1", "spend_2", "spend_3", "spend_4", "spend_5"] }, { ask: { question: "Order?", on: "spend" } }], g.cards, {
      cardsFor: (id) => (id === "spend" ? { cards: g.cards, offsets } : null),
    });
    const step = plan.steps[1] as { kind: string; cards?: string };
    expect(step.cards).toBe("spend");
    expect(plan.states[1].offsets["spend_1"]).toEqual(offsets["spend_1"]);
  });
});
