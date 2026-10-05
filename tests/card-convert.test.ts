// The card lab's converter, pure half (src/card/convert.ts, 2026-10-05): one
// engine drawable as card items, simplification, the size cap and the
// corners left for the marks. The browser half (render to the poster frame)
// is exercised by `npm run cardlab`.
import { describe, expect, test } from "vitest";
import { boxOf, capItems, cardItem, cornersByInk, seedOf, shortText, simplify } from "../src/card/convert";
import { decodePts, encodePts } from "../src/card/points";
import type { CardItem } from "../src/card/types";

const style = { color: "#222", strokeWidth: 2, roughness: 1.2, opacity: 1 };
const drawOpts = { mode: "sketch" as const, duration: 300 };
const stroke = (over: object = {}) => ({ id: "s1", kind: "stroke" as const, z: 1, style, drawOpts, pts: [[0, 0], [50, 1], [100, 0], [200, 100]] as [number, number][], ...over });

describe("simplify and shorten", () => {
  test("a nearly straight run keeps its ends; a corner stays", () => {
    expect(simplify([[0, 0], [50, 0.5], [100, 0]])).toEqual([[0, 0], [100, 0]]);
    expect(simplify([[0, 0], [100, 0], [100, 100]])).toEqual([[0, 0], [100, 0], [100, 100]]);
  });
  test("long words keep their first words", () => {
    expect(shortText("Short label")).toBe("Short label");
    expect(shortText("How many must be immune to stop a disease?")).toBe("How many must be immune to…");
    expect(shortText("How many must be immune to stop a disease?", 60)).toBe("How many must be immune to stop a disease?");
  });
});

describe("one drawable as a card item", () => {
  test("a stroke: simplified integer points, the engine's seed, arrowhead and dash", () => {
    const it = cardItem(stroke({ arrowhead: "end", style: { ...style, dash: true } })) as Extract<CardItem, { k: "s" }>;
    expect(it.k).toBe("s");
    expect(it.p).toBe("0 0 100 0 100 100");
    expect(it.sd).toBe(seedOf("s1"));
    expect(it.a).toBe("e");
    expect(it.d).toBe(1);
  });
  test("a circle and a box keep their true shapes, moved by the poster's offset", () => {
    expect((cardItem(stroke({ shapeHint: { type: "circle", c: [10, 20], r: 5 } }), 3, 4) as { ci: number[] }).ci).toEqual([13, 24, 5]);
    expect((cardItem(stroke({ shapeHint: { type: "rect", x: 1, y: 2, w: 30, h: 40 } })) as { rc: number[] }).rc).toEqual([1, 2, 30, 40]);
  });
  test("text: anchored, sized, shortened; code is left out", () => {
    const t = { id: "t1", kind: "text" as const, z: 1, style, drawOpts, pos: [100, 200] as [number, number], text: "Hours a day", fontSize: 18.4, anchor: "start" as const };
    expect(cardItem(t)).toMatchObject({ k: "t", x: 100, y: 200, t: "Hours a day", s: 18, an: "s" });
    expect(cardItem({ ...t, font: "mono" as const })).toBe("code");
  });
  test("an icon (SVG) is kept, a photo is not; a formula's letter is kept exact, holes and all", () => {
    const img = { id: "i", kind: "image" as const, z: 1, style, drawOpts, pos: [50, 50] as [number, number], w: 40, h: 40 };
    expect(cardItem({ ...img, href: "data:image/svg+xml;utf8,<svg/>" })).toMatchObject({ k: "i", x: 50, w: 40 });
    expect(cardItem({ ...img, href: "data:image/png;base64,AAAA" })).toBe("picture");
    const o = [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][];
    const hole = [[3, 3], [6, 3], [6, 6]] as [number, number][];
    expect(cardItem({ id: "g", kind: "area" as const, z: 1, style, drawOpts, pts: o, holes: [hole], tex: ["o"] })).toMatchObject({ k: "a", x: 1, p: "0 0 10 0 0 10 -10 0", hl: ["3 3 3 0 0 3"] });
  });
});

describe("the cap and the corners", () => {
  const text = (x: number, y: number, t = "label"): CardItem => ({ k: "t", x, y, t, s: 20, an: "m", c: "#222" });
  test("over the cap, the smallest items go first", () => {
    const big: CardItem = { k: "s", p: "0 0 900 700", c: "#222", w: 2, r: 1, sd: 1 };
    const smalls = Array.from({ length: 200 }, (_, i): CardItem => ({ k: "s", p: `${i} ${i} 2 2`, c: "#222", w: 2, r: 1, sd: i }));
    const { items, dropped } = capItems([big, ...smalls], 100, 2000);
    expect(items[0]).toBe(big);
    expect(dropped).toBeGreaterThan(0);
    expect(JSON.stringify(items).length + 140).toBeLessThanOrEqual(2000);
  });
  test("an icon's drawing does not count against the cap", () => {
    const icon: CardItem = { k: "i", x: 500, y: 300, w: 80, h: 80, href: `data:image/svg+xml;utf8,${"x".repeat(5000)}` };
    expect(capItems([icon], 100, 2000).dropped).toBe(0);
  });
  test("the corners: the inkiest last", () => {
    // Logical y-up: y 700 is the top of the card, so these sit in the top-left slot.
    const corners = cornersByInk([text(120, 700, "a long heading here"), text(150, 650, "another label")]);
    expect(corners[3]).toBe("tl");
    expect(boxOf(text(100, 100))[0]).toBeLessThan(100);
  });
});

describe("compact points", () => {
  test("the first point whole, then differences; rounded; round trip", () => {
    expect(encodePts([[120.4, 40], [123, 38], [128, 38]])).toBe("120 40 3 -2 5 0");
    expect(decodePts("120 40 3 -2 5 0")).toEqual([[120, 40], [123, 38], [128, 38]]);
    expect(decodePts("")).toEqual([]);
  });
});
