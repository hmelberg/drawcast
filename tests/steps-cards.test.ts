// W15: PUT THE STEPS IN ORDER — rank cards with numbered slots and arrows (spec/steps.ts).
import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { cardsGeometryIn, cardsExtent, type CardsElementLike } from "../src/spec/cards";
import { cardsPlanFor } from "../src/render/index";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const items = ["Big Bang", "First stars", "Sun forms", "Earth forms", "First life"];
const specOf = (extra: Record<string, unknown> = {}): Spec =>
  ({
    title: "In what order did these happen?",
    elements: [{ id: "c", type: "cards", steps: true, items, ends: ["first", "last"], ...extra }],
    commands: [{ draw: ["c"] }, { ask: { question: "In what order?", on: "c", store: "k", right: "{k}.", wrong: "{k}." } }],
  }) as unknown as Spec;

describe("steps cards", () => {
  test("valid; a math derivation's steps still are", () => {
    expect(validateSpec(specOf()).errors).toEqual([]);
    const math = { elements: [{ id: "m", type: "math", tex: "a=b", x: 500, y: 400, steps: ["b=a"] }], commands: [{ draw: ["m"] }] } as unknown as Spec;
    expect(validateSpec(math).errors).toEqual([]);
  });

  test("a row of numbered slots with room for an arrow between each two", () => {
    const s = expandSpec(specOf());
    const g = cardsGeometryIn(s, "c")!;
    expect(g.mode).toBe("rank");
    expect(g.arrows).toEqual(["c_arrow_1", "c_arrow_2", "c_arrow_3", "c_arrow_4"]);
    for (let i = 1; i < g.slots.length; i++) {
      expect(g.slots[i][1]).toBeCloseTo(g.slots[0][1]);
      expect(g.slots[i][0] - g.slots[i - 1][0] - g.w).toBeGreaterThan(40);
    }
    const els = new Map((s.elements ?? []).map((e) => [e.id, e]));
    expect(els.get("c_slot_3_num")?.text).toBe("3");
    expect(els.get("c_arrow_1")?.type).toBe("arrow");
    // The arrows stand outside the cards' group: drawing the cards gives nothing away.
    const members = els.get("c")!.members ?? [];
    expect(members).toContain("c_slot_1");
    expect(members).toContain("c_end_1");
    expect(members.some((m) => m.startsWith("c_arrow_"))).toBe(false);
    // The group carries steps back for the gate and the player.
    expect(els.get("c")!.steps).toBe(true);
  });

  test("every card's text in two lines at most; the set inside the page", () => {
    const g = cardsGeometryIn(expandSpec(specOf()), "c")!;
    for (const ls of g.lines ?? []) expect(ls.length).toBeLessThanOrEqual(2);
    const e = cardsExtent(g, { ends: ["first", "last"] } as Pick<CardsElementLike, "ends">);
    expect(e.left).toBeGreaterThanOrEqual(59);
    expect(e.right).toBeLessThanOrEqual(941);
    expect(e.top).toBeLessThanOrEqual(655);
    expect(e.bottom).toBeGreaterThanOrEqual(160);
  });

  test("a column when asked; its arrows run down", () => {
    const s = expandSpec(specOf({ arrange: "column" }));
    const g = cardsGeometryIn(s, "c")!;
    expect(g.column).toBe(true);
    expect(g.slots[1][0]).toBeCloseTo(g.slots[0][0]);
    expect(g.slots[1][1]).toBeLessThan(g.slots[0][1]);
    const a = s.elements!.find((e) => e.id === "c_arrow_1")! as unknown as { from: { y: number }; to: { y: number } };
    expect(a.from.y).toBeGreaterThan(a.to.y);
  });

  test("the plan shows the arrows once the ask is answered", () => {
    const g = cardsGeometryIn(expandSpec(specOf()), "c")!;
    expect(cardsPlanFor(g)!.shows).toEqual(g.arrows);
  });
});
