// Vertical settling (layout/settle.ts, page frame spec 2026-10-04 W18): the
// figure, heading aside, moved as one piece so the content area's gaps above
// and below it are even — and every reader of positions moved with it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { settleCardsGeometry, settleOffset, SETTLE_SLACK } from "../src/layout/settle";
import { contentBox } from "../src/layout/page";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { formulaHooksFor } from "../src/render/index";
import { planCommands } from "../src/render/plan";
import { authoredCards, cardsGeometryIn } from "../src/spec/cards";
import { parseScript, printScript } from "../src/spec/script";
import type { BBox } from "../src/layout/geometry";
import type { Spec } from "../src/spec/types";

const area = contentBox({ heading: true }); // y 160 … 655
const quiz = (name: string): Spec => (JSON.parse(readFileSync(new URL(`../library/quiz/${name}.json`, import.meta.url), "utf8")) as { spec: Spec }).spec;
const centre = (b: BBox): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

describe("the settle offset", () => {
  it("evens the gaps of a figure squeezed into the top half", () => {
    // 300 tall, top at 645: 10 above, 185 below.
    const dy = settleOffset({ x: 100, y: 345, w: 800, h: 300 }, area);
    expect(dy).toBe(-87); // −87.5, rounded
    const below = 345 + dy - area.y, above = area.y + area.h - (345 + dy + 300);
    expect(Math.abs(below - above)).toBeLessThanOrEqual(1);
  });

  it("lifts a figure sitting low", () => {
    expect(settleOffset({ x: 100, y: 170, w: 800, h: 200 }, area)).toBe(138);
  });

  it("leaves nearly even gaps, a full figure and one taller than the area alone", () => {
    // Uneven by exactly the slack: noise.
    expect(settleOffset({ x: 0, y: 160 + 100 + SETTLE_SLACK, w: 10, h: 200 }, area)).toBe(0);
    // 91 % of the height, all of the slack below: too little to be uneven.
    expect(settleOffset({ x: 0, y: area.y + area.h - 450, w: 10, h: 450 }, area)).toBe(0);
    // 86 %, cards touching the heading: moved.
    expect(settleOffset({ x: 0, y: area.y + area.h - 426, w: 10, h: 426 }, area)).toBe(-34);
    expect(settleOffset({ x: 0, y: 100, w: 10, h: 600 }, area)).toBe(0);
  });

  it("top: the figure's top at the area's top; none: as laid out", () => {
    expect(settleOffset({ x: 0, y: 300, w: 10, h: 100 }, area, { valign: "top" })).toBe(255);
    expect(settleOffset({ x: 0, y: 450, w: 10, h: 100 }, area, { valign: "none" })).toBe(0);
  });

  it("stops short of something pinned in its columns, and ignores one beside it", () => {
    const fig = { x: 300, y: 395, w: 400, h: 250 }; // wants to go down 117
    expect(settleOffset(fig, area, { pinned: [{ x: 320, y: 300, w: 100, h: 40 }] })).toBe(-45);
    expect(settleOffset(fig, area, { pinned: [{ x: 750, y: 300, w: 100, h: 40 }] })).toBe(-112);
    // Pinned right under it: no room, no move.
    expect(settleOffset(fig, area, { pinned: [{ x: 320, y: 360, w: 100, h: 40 }] })).toBe(0);
  });
});

/** A freehand page drawn in the top half: a box with a label, a text, a point command at canvas coordinates. */
const topHeavy = (extra: Partial<Spec> = {}): Spec =>
  expandSpec({
    title: "Top heavy",
    elements: [
      { id: "box", type: "shape", shape: "rect", x: 500, y: 560, width: 300, height: 120 },
      { id: "note", type: "text", text: "A note", x: 500, y: 460 },
      { id: "pin", type: "text", text: "Source: me", at: { place: "bottom_right" } },
    ],
    commands: [
      { draw: ["box"], speak: "A box." },
      { draw: ["note"], speak: "A note." },
      { point: { at: { x: 500, y: 560 } }, speak: "Here." },
      { draw: ["pin"], speak: "Pinned." },
    ],
    ...extra,
  } as Spec);

describe("a settled page", () => {
  it("moves the figure, its anchors and the canvas mapping by one dy — the heading and a pinned note stay", () => {
    const plain = layoutSpec(topHeavy({ page: { valign: "none" } }));
    const settled = layoutSpec(topHeavy());
    const dy = settled.fit?.settle ?? 0;
    expect(dy).toBeLessThan(-60);
    expect(plain.fit).toBeUndefined();
    const a = elementBBoxes(plain), b = elementBBoxes(settled);
    for (const id of ["box", "note"]) {
      expect(b.get(id)!.y - a.get(id)!.y).toBeCloseTo(dy, 6);
      expect(b.get(id)!.x).toBeCloseTo(a.get(id)!.x, 6);
    }
    for (const id of ["card_0_title", "card_0_line", "pin"]) expect(b.get(id)).toEqual(a.get(id));
    const anchorsA = plain.namedAnchors["box"], anchorsB = settled.namedAnchors["box"];
    for (const k of Object.keys(anchorsA ?? {})) expect(anchorsB[k][1] - anchorsA[k][1]).toBeCloseTo(dy, 6);
    // A command's canvas point lands where the ink now is.
    const { toLogical, deltaToLogical } = domainMapping(undefined, settled.fit);
    expect(toLogical([500, 560])).toEqual([500, 560 + dy]);
    expect(deltaToLogical([0, 10])).toEqual([0, 10]);
    const plan = planCommands(topHeavy().commands, settled.order, { bboxOf: (id) => b.get(id) ?? null, ...domainMapping(undefined, settled.fit) });
    const point = plan.steps.find((s) => s.kind === "point") as { x: number; y: number } | undefined;
    expect(point?.y).toBeCloseTo(560 + dy, 6);
    expect(centre(b.get("box")!)[1]).toBeCloseTo(560 + dy, 0);
  });

  it("the gaps above and below the figure come out even", () => {
    const l = layoutSpec(topHeavy({ elements: [{ id: "box", type: "shape", shape: "rect", x: 500, y: 560, width: 300, height: 120 }] } as Partial<Spec>));
    const box = elementBBoxes(l).get("box")!;
    const below = box.y - area.y, above = area.y + area.h - (box.y + box.h);
    expect(Math.abs(below - above)).toBeLessThanOrEqual(1);
  });

  it("page.valign none, a page with no heading, no commands and a moving cast stay as laid out", () => {
    expect(layoutSpec(topHeavy({ page: { valign: "none" } })).fit).toBeUndefined();
    expect(layoutSpec(topHeavy({ heading: false })).fit).toBeUndefined();
    expect(layoutSpec({ ...topHeavy(), commands: [] }).fit).toBeUndefined();
    const moving = topHeavy();
    moving.commands = [...(moving.commands ?? []), { move: { target: "note", by: [10, 0] } }];
    expect(layoutSpec(moving).fit).toBeUndefined();
  });

  it("a cards element's slots, a card's drawn box and its geometry move together", () => {
    const spec = expandSpec(quiz("baby-animal-names"));
    const settled = layoutSpec(spec);
    const dy = settled.fit?.settle ?? 0;
    expect(dy).toBeLessThan(-60);
    const plain = layoutSpec({ ...spec, page: { valign: "none" } });
    const boxes = elementBBoxes(settled), before = elementBBoxes(plain);
    const g = formulaHooksFor(spec, boxes, (l) => elementBBoxes(l), dy).cardsOn("babies")!;
    const raw = cardsGeometryIn(spec, "babies")!;
    g.cards.forEach((id, i) => {
      // The drawn card and the geometry's home agree on the settled page …
      expect(centre(boxes.get(id)!)[1]).toBeCloseTo(g.home[i][1], 0);
      // … and both moved by dy.
      expect(boxes.get(id)!.y - before.get(id)!.y).toBeCloseTo(dy, 6);
      expect(g.home[i][1] - raw.home[i][1]).toBeCloseTo(dy, 6);
      expect(g.truth[i][1] - raw.truth[i][1]).toBeCloseTo(dy, 6);
    });
    g.slots.forEach((p, i) => expect(p[1] - raw.slots[i][1]).toBeCloseTo(dy, 6));
    expect(settleCardsGeometry(raw, 0)).toBe(raw);
  });

  it("on-canvas answer buttons move with the figure", () => {
    const quizzed = (extra: Partial<Spec> = {}): Spec =>
      expandSpec({
        title: "Top heavy",
        elements: [{ id: "box", type: "shape", shape: "rect", x: 500, y: 590, width: 300, height: 90 }],
        commands: [
          { draw: ["box"], speak: "A box." },
          { quiz: { question: "Is it a box?", choices: ["Yes", "No"], correct: 1, on_canvas: true } },
        ],
        ...extra,
      } as Spec);
    const settled = layoutSpec(quizzed());
    const dy = settled.fit?.settle ?? 0;
    expect(dy).toBeLessThan(-30);
    const plain = layoutSpec(quizzed({ page: { valign: "none" } }));
    const a = elementBBoxes(plain), b = elementBBoxes(settled);
    for (const id of ["box", "quiz_1_btn_1", "quiz_1_btn_2"]) expect(b.get(id)!.y - a.get(id)!.y).toBeCloseTo(dy, 6);
  });
});

describe("page.valign", () => {
  it("validates center, top and none — nothing else", () => {
    const base = { title: "t", elements: [{ id: "a", type: "text", text: "A", x: 500, y: 400 }], commands: [{ draw: ["a"], speak: "A." }] } as Spec;
    expect(validateSpec(base).ok).toBe(true);
    for (const v of ["center", "top", "none"]) expect(validateSpec({ ...base, page: { valign: v } } as Spec).ok).toBe(true);
    expect(validateSpec({ ...base, page: { valign: "middle" } } as unknown as Spec).ok).toBe(false);
    expect(validateSpec({ ...base, page: { align: "top" } } as unknown as Spec).ok).toBe(false);
  });

  it("a script carries it as a setting, both ways", () => {
    const spec = parseScript('# A page\npage: {"valign": "top"}\n\nHello.\n');
    expect(spec.page).toEqual({ valign: "top" });
    expect(printScript(spec)).toContain("page:");
    expect(parseScript(printScript(spec)).page).toEqual({ valign: "top" });
  });
});

describe("what counts as the figure's run", () => {
  const example = (title: string): Spec => {
    const all = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { spec?: Spec }[];
    return expandSpec(all.find((e) => e.spec?.title === title)!.spec!);
  };

  it("cards count where they will go, not only where they start", () => {
    // Inventions on a timeline: the cards start under the line and are
    // answered above it, in rising rows.
    const spec = example("Inventions on a timeline");
    const l = layoutSpec(spec);
    const dy = l.fit?.settle ?? 0;
    const g = formulaHooksFor(spec, elementBBoxes(l), (x) => elementBBoxes(x), dy).cardsOn(authoredCards(spec)[0].id)!;
    const ys = [...[...g.home, ...g.truth].flatMap((p) => [p[1] - g.h / 2, p[1] + g.h / 2]), ...[...elementBBoxes(l)].filter(([id]) => !id.startsWith("card_")).flatMap(([, b]) => [b.y, b.y + b.h])];
    const below = Math.min(...ys) - area.y, above = area.y + area.h - Math.max(...ys);
    expect(Math.abs(below - above)).toBeLessThanOrEqual(SETTLE_SLACK);
  });

  it("a guess on a scale leaves the page as laid out", () => {
    expect(layoutSpec(example("Neurons in a brain")).fit).toBeUndefined();
  });
});
