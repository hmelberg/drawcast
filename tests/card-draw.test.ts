// The small card renderer (src/card/draw.ts, card lab 2026-10-05).
import { describe, expect, test } from "vitest";
import { planThumb } from "../netlify/lib/thumb.mts";
import { drawCard, drawingMarkup } from "../src/card/draw";
import type { CompiledCard } from "../src/card/types";

const card: CompiledCard = {
  v: 1,
  items: [
    { k: "s", p: [100, 100, 900, 100], c: "#222", w: 2, r: 1.2, sd: 7, a: "e" },
    { k: "s", p: [], c: "#222", w: 2, r: 1, sd: 8, rc: [100, 200, 200, 100], f: "#fffdf7" },
    { k: "a", p: [200, 200, 400, 200, 400, 400], f: "#e07a5f", o: 0.35, r: 1, sd: 9 },
    { k: "t", x: 500, y: 700, t: "Why prices rose & fell", s: 24, an: "m", c: "#222" },
    { k: "i", x: 700, y: 400, w: 80, h: 80, href: "data:image/svg+xml;utf8,<svg/>" },
  ],
  marks: planThumb('band "Not what you think" stamp "MYTH?"', { title: "Prices" }),
  corners: ["tr", "br", "tl", "bl"],
};

describe("drawCard", () => {
  test("a well-formed SVG with the drawing, escaped text, the icon and the marks", () => {
    const svg = drawCard(card);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Why prices rose &amp; fell");
    expect(svg).toContain('<image href="data:image/svg+xml');
    expect(svg).toContain("MYTH?");
    expect(svg.toUpperCase()).toContain("NOT WHAT YOU THINK");
    expect(new DOMParserLike(svg).ok).toBe(true);
  });
  test("the same card draws the same every time (the engine's seeds)", () => {
    expect(drawCard(card)).toBe(drawCard(card));
  });
  test("over the poster: the poster instead of the drawing, the marks unchanged", () => {
    const over = drawCard(card, { posterHref: "/x.png" });
    expect(over).toContain('href="/x.png"');
    expect(over).not.toContain("Why prices rose");
    expect(over).toContain("MYTH?");
  });
  test("a width scales the outer size only", () => {
    expect(drawCard(card, { width: 280 })).toMatch(/^<svg [^>]*width="280" height="210"/);
    expect(drawingMarkup(card)).toContain('<rect width="1000" height="750"');
  });
});

/** Tags balance (the node suite has no DOMParser). */
class DOMParserLike {
  ok: boolean;
  constructor(svg: string) {
    const stack: string[] = [];
    let ok = true;
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (m[3] === "/") continue;
      if (m[1] === "/") ok = ok && stack.pop() === m[2];
      else stack.push(m[2]);
    }
    this.ok = ok && stack.length === 0;
  }
}
