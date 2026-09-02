import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { markSvg } from "../src/brand/mark";

// Hans 2026-09-02, picking from the three candidates: "1" — a clean play
// triangle in a rounded rust square. No sketch texture at all: the
// hand-drawn quality lives in the drawings, and a mark has to read at 16px,
// where the old roughjs strokes vanished. Two fixed colours in both themes —
// the square is the app's rust accent, the triangle its paper — so the mark
// needs no ink, no currentColor, and no theme awareness.

describe("markSvg — the clean play mark", () => {
  it("is a rounded rust square with a paper play triangle, and nothing else", () => {
    const svg = markSvg();
    expect(svg).toMatch(/<svg[^>]*viewBox="0 0 24 24"/);
    expect(svg).toMatch(/<rect[^>]*rx="[^"]+"[^>]*fill="#b5482e"/);
    expect(svg).toMatch(/<path[^>]*d="M[^"]*Z"[^>]*fill="#fffefb"/);
    expect((svg.match(/<(rect|path|circle|polygon|line)\b/g) ?? []).length).toBe(2);
  });

  it("has no ink and no strokes — identical on paper and in dark chrome", () => {
    const svg = markSvg();
    expect(svg).not.toContain("#3d3833");
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toMatch(/stroke/);
  });

  it("sizes to the caller without redrawing", () => {
    expect(markSvg(16)).toMatch(/width="16" height="16"/);
    expect(markSvg(16).replace('width="16" height="16"', 'width="64" height="64"')).toBe(markSvg(64));
  });

  it("public/mark.svg — the favicon — is byte-identical to markSvg(64); regenerate with scripts/build-mark.ts", async () => {
    const file = await readFile(new URL("../public/mark.svg", import.meta.url), "utf8");
    expect(file).toBe(markSvg(64));
  });

  // Hans, minutes after picking it (2026-09-02): "I regret my choice. I
  // think no logo might be better (just use the drawcast word in
  // handwritten fonts like now)." So the topbar carries the wordmark alone,
  // and the mark exists only where a page needs an icon: the browser tab.
  it("the topbar carries only the wordmark — no mark, and no dead .mark rule", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(src).not.toMatch(/markSvg|class:\s*"mark"/);
    expect(src).toMatch(/class: "wordmark" \}, "drawcast"/);
    expect(css).not.toMatch(/^\.mark\s*\{/m);
  });

  it("has retired the squiggle and the emoji favicon", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.squiggle/);
    expect(html).not.toMatch(/%E2%9C%8F/);
    expect(html).toMatch(/mark\.svg/);
  });

  // The standalone viewer (published pages) once carried a dead "squiggle"
  // class and a footer crediting "drawcast ✏️" — the emoji the first mark
  // replaced. Neither may come back.
  it("the standalone viewer has no dead squiggle class and no pencil emoji", async () => {
    const src = await readFile(new URL("../src/viewer.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/squiggle/);
    expect(src).not.toMatch(/✏/);
  });
});
