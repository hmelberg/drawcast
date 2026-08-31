import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { markSvg } from "../src/brand/mark";

describe("markSvg", () => {
  it("draws the same mark every time — roughjs randomises, a logo must not", () => {
    expect(markSvg()).toBe(markSvg());
  });
  it("produces real path data, not an empty shell", () => {
    const svg = markSvg();
    expect(svg).toMatch(/<svg[^>]*viewBox=/);
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(svg).toMatch(/d="M/);
  });
  it("has retired the squiggle and the emoji favicon", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.squiggle/);
    expect(html).not.toMatch(/%E2%9C%8F/);
    expect(html).toMatch(/mark\.svg/);
  });

  // Round-2 fix: public/mark.svg is a fixed-ink favicon file (it cannot read
  // a CSS custom property) — fine for the tab icon, but main.ts's topbar used
  // an <img src="./mark.svg"> copy of that SAME fixed ink, so the mark went
  // near-invisible (1.50:1) against dark's --paper. The fix takes a colour
  // argument so the topbar's copy can render inline with currentColor instead
  // and follow --ink like every other chrome element.
  it("takes a colour argument, defaulting to the fixed ink the favicon file needs", () => {
    expect(markSvg()).toContain("#3d3833");
    const inline = markSvg(64, "currentColor");
    expect(inline).toContain("currentColor");
    expect(inline).not.toContain("#3d3833");
  });

  it("draws the same shape regardless of colour — only stroke/fill change", () => {
    const a = markSvg(64, "currentColor").replace(/currentColor/g, "#3d3833");
    const b = markSvg();
    expect(a).toBe(b);
  });

  it("the topbar renders the mark inline with currentColor — not the fixed-ink <img> file, which would stay invisible in dark mode", async () => {
    const src = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/h\(\s*"img"\s*,\s*\{\s*class:\s*"mark"/);
    expect(src).toMatch(/markSvg\([^)]*currentColor/);
  });

  // The standalone viewer (published pages) carried its own leftovers: a
  // "squiggle" class whose CSS rule is already gone (dead, harmless, but
  // pointless), and a footer crediting "drawcast ✏️" — the exact emoji this
  // round's mark was introduced to replace.
  it("the standalone viewer has no dead squiggle class and no pencil emoji", async () => {
    const src = await readFile(new URL("../src/viewer.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/squiggle/);
    expect(src).not.toMatch(/✏/);
  });
});
