// The "mixed" look (2026-10-01, the book's default): clean lines, hand-hatched
// fills. No jsdom in this repo, so the drawing itself is checked by eye (the
// book mock, dev-casts/book-mock.html); what is pinned here is the choice of
// renderer and the wiring whose absence would fail silently — a mixed mount
// that drew rough strokes after all, or a share link that dropped the style.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { parseFigureAttrs } from "../src/engine-element";

describe("mixed render style", () => {
  test("rendererFor picks a renderer per style", () => {
    expect(rendererFor("mixed").name).toBe("mixed");
    expect(rendererFor("clean").name).toBe("clean");
    expect(rendererFor("sketchy").name).toBe("sketchy");
  });

  test("a mixed mount marks its rough canvas, and drawLeaf draws its strokes clean", () => {
    const src = readFileSync(new URL("../src/render/svg-backend.ts", import.meta.url), "utf8");
    expect(src).toMatch(/if \(rc && opts\.cleanStrokes\) CLEAN_STROKE_CANVASES\.add\(rc\)/);
    expect(src).toMatch(/d\.kind === "stroke" && \(d\.precise \|\| d\.style\.roughness === 0 \|\| CLEAN_STROKE_CANVASES\.has\(rc\)\)/);
    // Areas are NOT in that test: their hatching stays hand-drawn.
    expect(src).toMatch(/makeSvgBackend\(\{ name: "mixed", label: "Clean lines, hand fills", sketchy: true, cleanStrokes: true \}\)/);
  });

  test("the embed and share links accept it", () => {
    expect(parseFigureAttrs((n) => (n === "look" ? "mixed" : null)).look).toBe("mixed");
    const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
    expect(viewer).toMatch(/styleParam === "mixed" \? "mixed"/);
  });
});
