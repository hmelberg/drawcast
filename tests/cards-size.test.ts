// Cards and the page frame (spec 2026-10-04-page-frame, W2): a size factor on
// every size, two-line text, growth when the cards are alone on the page, the
// caption band as the floor, icons and an optional title on compare cards,
// and what follows a card when the cards slide.

import { describe, expect, test } from "vitest";
import { authoredCards, cardsExtent, cardsGeometry, cardsGeometryIn, fitCardTexts, resolveCardsSize, type CardsElementLike } from "../src/spec/cards";
import { CAPTION_TOP, CONTENT_TOP, CONTENT_TOP_BARE, MARGIN, PAGE_W } from "../src/layout/page";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { planCommands } from "../src/render/plan";
import { cardsPlanFor, planOptionsFor } from "../src/render/index";
import type { Spec, SpecElement } from "../src/spec/types";

const STROKES = "M0 0";
const rank: CardsElementLike = { id: "r", type: "cards", items: ["Rome", "Paris", "Oslo", "Lima", "Kyiv"], ends: ["least", "most"], arrange: "row" };
const page = (els: unknown[], commands: unknown[] = [{ card: { title: "Q" } }, { draw: ["r"] }]): Spec => ({ title: "Q", elements: els, commands }) as unknown as Spec;
const group = (s: Spec, id = "r") => s.elements!.find((e) => e.id === id) as SpecElement & { size?: number; x?: number; y?: number };

describe("size 1 with company: as it was", () => {
  test("a rank row keeps its old numbers (slots at y 380, cards 146 × 56, x 180 … 820)", () => {
    const g = cardsGeometry(rank);
    expect(g.k).toBeUndefined();
    expect([g.w, g.h]).toEqual([146, 56]);
    expect(g.slots.map((p) => p[0])).toEqual([180, 340, 500, 660, 820]);
    expect(g.slots.every((p) => p[1] === 380)).toBe(true);
    expect(JSON.stringify(cardsGeometry({ ...rank, size: 1 }))).toBe(JSON.stringify(g));
    expect(JSON.stringify(cardsGeometry({ ...rank, size: "auto" }))).toBe(JSON.stringify(g));
  });
  test("next to another element the expansion leaves the cards at size 1, where they were", () => {
    const s = expandSpec(page([rank, { id: "dot", type: "point", at: [1, 1] }]));
    expect(group(s).size).toBeUndefined();
    expect(group(s).x).toBeUndefined();
    expect(s.elements!.find((e) => e.id === "r_1")).toMatchObject({ width: 146, height: 56, font_size: 20 });
  });
});

describe("alone on the page: larger, up to ×1.6, inside the content area", () => {
  test("a rank alone grows, spreads across the content width and stands in the middle", () => {
    const s = expandSpec(page([rank, { id: "note", type: "text", text: "a note", x: 500, y: 700 }]));
    const k = group(s).size!;
    expect(k).toBeGreaterThan(1);
    expect(k).toBeLessThanOrEqual(1.6);
    expect(group(s).x).toBe(MARGIN);
    const el = authoredCards(s)[0];
    const g = cardsGeometry(el);
    const e = cardsExtent(g, el);
    expect(e.bottom).toBeGreaterThanOrEqual(CAPTION_TOP);
    expect(e.top).toBeLessThanOrEqual(CONTENT_TOP);
    expect(Math.abs((e.top + e.bottom) / 2 - (CONTENT_TOP + CAPTION_TOP) / 2)).toBeLessThan(1);
    expect(g.h).toBeCloseTo(56 * k);
    expect(s.elements!.find((x) => x.id === "r_1")!.font_size).toBe(Math.round(20 * k));
  });
  test("every mode alone stays inside the content area (heading on top)", () => {
    const items8 = Array.from({ length: 8 }, (_, i) => ({ text: `Thing ${i}`, in: i % 2 === 0, icon: "x", icon_strokes: STROKES }));
    const cases: CardsElementLike[] = [
      rank,
      { id: "r", type: "cards", arrange: "column", items: ["A", "B", "C", "D", "E", "F"] },
      { id: "r", type: "cards", bins: ["Yes", "No"], items: Array.from({ length: 6 }, (_, i) => ({ text: `Item ${i}`, bin: i % 2 ? "No" : "Yes" })) },
      { id: "r", type: "cards", select: "Mammals", items: items8 },
      { id: "r", type: "cards", items: ["Kangaroo", "Swan", "Hare", "Eel"].map((t, i) => ({ text: t, match: `M${i}` })) },
      { id: "r", type: "cards", compare: "Which is older?", items: ["Fax", "Phone", "Oxford", "Aztecs"].map((t, i) => ({ text: t, value: i })) },
      { id: "r", type: "cards", options: [{ text: "Treat now", goto: "a" }, { text: "Test again", goto: "b" }] },
    ];
    for (const el of cases) {
      const s = expandSpec(page([el]));
      const back = authoredCards(s)[0];
      const g = cardsGeometry(back);
      const e = cardsExtent(g, back);
      expect(e.bottom, `${JSON.stringify(el).slice(0, 60)}`).toBeGreaterThanOrEqual(CAPTION_TOP - 0.5);
      expect(e.top).toBeLessThanOrEqual(CONTENT_TOP + 0.5);
      expect(e.left).toBeGreaterThanOrEqual(MARGIN - 0.5);
      expect(e.right).toBeLessThanOrEqual(PAGE_W - MARGIN + 0.5);
      // Grown only as far as it fits whole (a set that does not fit at size 1 is made smaller, as with company).
      if (Number(back.size ?? 1) > 1) expect(g.squeezed).toBeUndefined();
    }
  });
  test("no heading (no card, no title): the strip is the cards' too", () => {
    const el: CardsElementLike = { id: "r", type: "cards", arrange: "column", items: ["A", "B", "C", "D", "E", "F"] };
    const withHead = resolveCardsSize(el, page([el]));
    const bare = resolveCardsSize(el, { elements: [el], commands: [{ draw: ["r"] }] } as unknown as Spec);
    expect(bare.size as number).toBeGreaterThan(withHead.size as number);
    expect(cardsExtent(cardsGeometry(bare), bare).top).toBeLessThanOrEqual(CONTENT_TOP_BARE + 0.5);
  });
  test("words the author put under the cards stay clear of them", () => {
    const el: CardsElementLike = { id: "r", type: "cards", select: "Norse", items: ["window", "beef", "sky", "egg"].map((t, i) => ({ text: t, in: i % 2 === 0 })) };
    const r = resolveCardsSize(el, page([el, { id: "gloss", type: "text", text: "vindauga", x: 500, y: 265, font_size: 44 }]));
    expect(cardsExtent(cardsGeometry(r), r).bottom).toBeGreaterThanOrEqual(265 + 44 * 0.65);
  });
  test("an authored size wins; validation takes 0.6–2 or auto, on cards only", () => {
    const s = expandSpec(page([{ ...rank, size: 0.8 }]));
    expect(group(s).size).toBe(0.8);
    expect(cardsGeometry(authoredCards(s)[0]).w).toBeCloseTo(160 - 14 * 0.8);
    expect(cardsGeometry(authoredCards(s)[0]).h).toBeCloseTo(56 * 0.8);
    const ok = (el: unknown): boolean => validateSpec(page([el])).ok;
    expect(ok({ ...rank, size: "auto" })).toBe(true);
    expect(ok({ ...rank, size: 2 })).toBe(true);
    expect(ok({ ...rank, size: 2.5 })).toBe(false);
    expect(ok({ ...rank, size: "big" })).toBe(false);
    expect(ok({ id: "m", type: "math", tex: "x", size: "auto" })).toBe(false);
  });
});

describe("two lines, then smaller", () => {
  test("a text too long for one line wraps to two; the card grows a line, the font stays", () => {
    const el: CardsElementLike = { ...rank, items: ["The Lord of the Rings", "Dune", "Emma", "Ulysses", "Ivanhoe"] };
    const g = cardsGeometry(el);
    expect(g.lines?.[0]).toHaveLength(2);
    expect(g.h).toBeCloseTo(56 + 20 * 1.25);
    expect(g.font).toBeUndefined();
    const s = expandSpec(page([el, { id: "dot", type: "point", at: [0, 0] }]));
    expect(s.elements!.find((e) => e.id === "r_1")!.text).toContain("\n");
    const text = layoutSpec(s).drawables.find((d) => d.id === "r_1_text") as { lines?: string[]; text: string };
    expect(text.lines).toHaveLength(2);
    expect(text.text).toBe("The Lord of the Rings");
  });
  test("three lines' worth is drawn smaller in two, and the lint asks for fewer words", () => {
    const fit = fitCardTexts(["one two three four five six seven eight"], 146, 20);
    expect(fit.tooLong).toEqual([0]);
    expect(fit.font).toBeLessThan(20);
    expect(fit.lines[0].length).toBeLessThanOrEqual(2);
    const el: CardsElementLike = { ...rank, items: ["Brazil", "one two three four five six seven eight", "Peru", "Chile", "Cuba"] };
    const issues = lintCommands(page([el], [{ card: { title: "Q" } }, { draw: ["r"] }])).filter((i) => i.rule === "cards-text");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/card 2/);
  });
});

describe("the caption band is the floor", () => {
  test("a compare set of 5 rows moves up under the heading rather than into the captions", () => {
    const el: CardsElementLike = { id: "c", type: "cards", compare: "More?", items: Array.from({ length: 10 }, (_, i) => ({ text: `T${i}`, value: i })) };
    const e = cardsExtent(cardsGeometry(el), el);
    expect(e.top).toBeLessThanOrEqual(CONTENT_TOP + 0.5);
    expect(e.bottom).toBeGreaterThanOrEqual(CAPTION_TOP - 0.5);
  });
});

describe("compare cards", () => {
  const items = ["Fax", "Phone", "Oxford", "Aztecs"].map((t, i) => ({ text: t, value: i, icon: "x", icon_strokes: STROKES }));
  const cmp = { id: "c", type: "cards", compare: "Which came first?", items };
  test("icons: the taller icon card, the icon on every card node", () => {
    const g = cardsGeometry(cmp as CardsElementLike);
    expect(g.h).toBe(96);
    const s = expandSpec(page([cmp, { id: "dot", type: "point", at: [0, 0] }], [{ card: { title: "Q" } }, { draw: ["c"] }]));
    expect(s.elements!.find((e) => e.id === "c_1")).toMatchObject({ icon: "x", icon_strokes: STROKES, height: 96 });
  });
  test("the title: none under a heading, the question without one, and title: true / words / false", () => {
    const ids = (s: Spec) => s.elements!.map((e) => e.id);
    expect(ids(expandSpec(page([cmp])))).not.toContain("c_title");
    const bare = expandSpec({ elements: [cmp], commands: [{ draw: ["c"] }] } as unknown as Spec);
    expect(bare.elements!.find((e) => e.id === "c_title")!.text).toBe("Which came first?");
    expect(expandSpec(page([{ ...cmp, title: true }])).elements!.find((e) => e.id === "c_title")!.text).toBe("Which came first?");
    expect(expandSpec(page([{ ...cmp, title: "Older?" }])).elements!.find((e) => e.id === "c_title")!.text).toBe("Older?");
    expect(ids(expandSpec({ elements: [{ ...cmp, title: false }], commands: [] } as unknown as Spec))).not.toContain("c_title");
    // A cast that names the title keeps it (written before the heading).
    expect(ids(expandSpec(page([cmp], [{ card: { title: "Q" } }, { draw: ["c_title", "c"] }])))).toContain("c_title");
    expect(validateSpec(page([{ ...rank, title: true }])).ok).toBe(false);
  });
});

describe("what follows a card when the cards slide", () => {
  const spec = expandSpec(
    page(
      [rank, { id: "lab", type: "label", text: "the capital", attach_to: "r_2" }, { id: "dot", type: "point", at: [0, 0] }],
      [{ card: { title: "Q" } }, { draw: ["r", "lab"] }, { ask: { question: "Which of these cities is the largest? Drag them in order.", on: "r" } }],
    ),
  );
  test("a label attached to a card is offset with it after the ask (the plan)", () => {
    const g = cardsGeometryIn(spec, "r")!;
    expect(g.followers?.r_2).toEqual(["lab", "lab_leader"]);
    const cs = cardsPlanFor(g)!;
    expect(cs.offsets.lab).toEqual(cs.offsets.r_2);
    const layout = layoutSpec(spec);
    const plan = planCommands(spec.commands!, layout.order, { ...planOptionsFor(spec, layout), cardsFor: (id) => (id === "r" ? cs : null) });
    const after = plan.states[plan.states.length - 1];
    expect(after.offsets.lab).toEqual(after.offsets.r_2);
    expect(Math.hypot(...after.offsets.r_2)).toBeGreaterThan(1);
  });
  test("a compare value follows its card, and erasing the cards erases the values", () => {
    const cmp = { id: "c", type: "cards", compare: "More?", items: [0, 1, 2, 3].map((i) => ({ text: `T${i}`, value: i })) };
    const s = expandSpec(page([cmp], [{ card: { title: "Q" } }, { draw: ["c"] }, { ask: { question: "Which of each pair is the larger one? Tap it.", on: "c" } }, { erase: ["c"] }]));
    const g = cardsGeometryIn(s, "c")!;
    expect(g.followers?.c_1).toEqual(["c_v_1"]);
    const layout = layoutSpec(s);
    const plan = planCommands(s.commands!, layout.order, { ...planOptionsFor(s, layout), cardsFor: (id) => (id === "c" ? cardsPlanFor(g) : null) });
    expect(plan.states.some((st) => st.visible.includes("c_v_1"))).toBe(true);
    expect(plan.states[plan.states.length - 1].visible).not.toContain("c_v_1");
  });
});
