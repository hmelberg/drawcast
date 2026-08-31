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
});
