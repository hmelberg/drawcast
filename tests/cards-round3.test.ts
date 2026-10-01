import { describe, expect, test } from "vitest";
import { cardsGeometry, cardsMode, type CardsElementLike } from "../src/spec/cards";
import { scaleGeometry, type ScaleElementLike } from "../src/spec/scale";
import { cardsMarks, cardsTruth, decodeArrangement, drop, encodeArrangement, initialArrangement, placeOff, positions, rightPick, scoreCards } from "../src/cards/model";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";

const years: ScaleElementLike = { id: "years", type: "scale", min: 1400, max: 2000 };
const place: CardsElementLike = { id: "inv", type: "cards", along: "years", items: [{ text: "Press", value: 1440 }, { text: "Telescope", value: 1608 }, { text: "Phone", value: 1876 }] };
const match: CardsElementLike = { id: "d", type: "cards", items: [{ text: "Aspirin", match: "Thins blood" }, { text: "Insulin", match: "Lowers sugar" }, { text: "Penicillin", match: "Kills bacteria" }] };
const compare: CardsElementLike = { id: "r", type: "cards", compare: "Which kills more?", items: [{ text: "Sharks", value: 6 }, { text: "Cows", value: 20 }, { text: "Snakes", value: 100000 }, { text: "Lightning", value: 24000 }] };
const decide: CardsElementLike = { id: "p", type: "cards", options: [{ text: "Treat", goto: "t" }, { text: "Wait", goto: "w", best: true }], then: "after" };

describe("modes come from structure", () => {
  test("each structure its mode", () => {
    expect(cardsMode(place)).toBe("place");
    expect(cardsMode(match)).toBe("match");
    expect(cardsMode(compare)).toBe("compare");
    expect(cardsMode(decide)).toBe("decide");
    expect(cardsMode({ id: "x", type: "cards", items: ["a", "b"] })).toBe("rank");
  });
});

describe("place", () => {
  const g = cardsGeometry(place, () => years);
  const sg = scaleGeometry(years);
  test("cards start in the row; dropped on the line they take the value under them", () => {
    let a = initialArrangement(g);
    expect(a.values).toEqual([null, null, null]);
    a = drop(g, a, 0, [sg.xAt(1450), sg.y + 60]);
    expect(a.values![0]).toBe(1450);
    expect(positions(g, a)[0][0]).toBeCloseTo(sg.xAt(1450));
    a = drop(g, a, 0, [sg.xAt(1450), sg.y - 200]);
    expect(a.values![0]).toBeNull();
  });
  test("scoring within 5 % of the line, the mean distance", () => {
    const a = { order: [], boxes: [], values: [1450, 1700, null] };
    expect(scoreCards(g, a)).toEqual({ within: 1, count: 3, ok: false });
    expect(placeOff(g, a)).toBeCloseTo((10 + 92) / 2);
    expect(decodeArrangement(g, encodeArrangement(g, a))).toEqual(a);
  });
  test("cards close together stand in levels", () => {
    const p = g.placeAt!([1500, 1505, null]);
    expect(p[0][1]).not.toBe(p[1][1]);
  });
});

describe("match", () => {
  const g = cardsGeometry(match);
  test("a drag from a left card to a right one links them; a later link takes the partner", () => {
    let a = initialArrangement(g);
    const pos = positions(g, a);
    a = drop(g, a, 0, pos[3 + 2]); // Aspirin → Kills bacteria
    expect(a.links).toEqual([2, -1, -1]);
    a = drop(g, a, 2, pos[3 + 2]); // Penicillin → Kills bacteria takes it from Aspirin
    expect(a.links).toEqual([-1, -1, 2]);
    expect(scoreCards(g, a)).toEqual({ within: 1, count: 3, ok: false });
  });
  test("truth: each partner opposite its card; marks draw true lines and the wrong links", () => {
    expect(g.truth[3][1]).toBe(g.truth[0][1]);
    const m = cardsMarks(g, { order: [], boxes: [], links: [1, 0, 2] });
    expect(m.lines.filter((l) => !l.dashed)).toHaveLength(3);
    expect(m.lines.filter((l) => l.dashed)).toHaveLength(2);
  });
});

describe("compare", () => {
  const g = cardsGeometry(compare);
  test("consecutive pairs; the bigger is right", () => {
    expect(g.rows).toEqual([[0, 1], [2, 3]]);
    expect(rightPick(g, 0)).toBe(1);
    expect(rightPick(g, 1)).toBe(0);
    expect(scoreCards(g, { order: [], boxes: [], picks: [1, 1] })).toEqual({ within: 1, count: 2, ok: false });
    expect(cardsTruth(g).picks).toEqual([1, 0]);
  });
  test("the values are outside the group, so drawing the cards gives nothing away", () => {
    const spec = expandSpec({ commands: [], elements: [compare as never] } as Spec);
    const group = spec.elements!.find((e) => e.id === "r")!;
    expect(group.members).not.toContain("r_v_1");
    expect(spec.elements!.some((e) => e.id === "r_v_1")).toBe(true);
  });
});

describe("decide", () => {
  const g = cardsGeometry(decide);
  test("options as cards; the best one scores", () => {
    expect(g.texts).toEqual(["Treat", "Wait"]);
    expect(scoreCards(g, { order: [], boxes: [], choice: 1 }).ok).toBe(true);
    expect(scoreCards(g, { order: [], boxes: [], choice: 0 }).ok).toBe(false);
  });
  test("lint: option labels and then must lie ahead", () => {
    const lint = (commands: Spec["commands"]) => lintCommands(expandSpec({ elements: [decide as never], commands } as Spec)).filter((i) => i.rule === "guess");
    expect(lint([{ draw: ["p"] }, { ask: { question: "?", on: "p" } }, { label: "t" }, { label: "w" }, { label: "after" }])).toEqual([]);
    expect(lint([{ draw: ["p"] }, { ask: { question: "?", on: "p" } }, { label: "t" }])).toHaveLength(2);
  });
});

describe("validation", () => {
  test("all four validate expanded, with a bare scale", () => {
    const spec = expandSpec({ commands: [], elements: [years as never, place as never, match as never, compare as never, decide as never] } as Spec);
    expect(validateSpec(spec).errors).toEqual([]);
  });
  test("place needs values", () => {
    const bad = validateSpec({ commands: [], elements: [years, { id: "c", type: "cards", along: "years", items: ["a", "b"] }] } as never);
    expect(JSON.stringify(bad)).toMatch(/value/);
  });
});
