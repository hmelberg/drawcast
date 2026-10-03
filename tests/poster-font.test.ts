// The poster's handwriting face (2026-10-04): every published poster was set
// in Comic Sans, because sketchFontStyle embedded the FIRST face of Google's
// css2 answer — the vietnamese subset, with no a–z. The face is now the
// app's own file (the one layout measured with), else Google's latin face;
// and a poster without it is no poster (snapshot.ts posterPng).
import { afterEach, describe, expect, test, vi } from "vitest";
import { latinFaceUrl } from "../src/export/video";
import { posterSvg, POSTER_W, POSTER_H } from "../src/export/snapshot";

const GOOGLE_CSS = `/* vietnamese */
@font-face {
  font-family: 'Patrick Hand';
  src: url(https://fonts.gstatic.com/s/patrickhand/v25/VIET.woff2) format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'Patrick Hand';
  src: url(https://fonts.gstatic.com/s/patrickhand/v25/EXT.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'Patrick Hand';
  src: url(https://fonts.gstatic.com/s/patrickhand/v25/LATIN.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+FFFD;
}
`;

describe("latinFaceUrl", () => {
  test("the face that covers basic Latin, not the first one listed", () => {
    expect(latinFaceUrl(GOOGLE_CSS)).toBe("https://fonts.gstatic.com/s/patrickhand/v25/LATIN.woff2");
  });
  test("one face without ranges is that face; subsets without Latin are none", () => {
    expect(latinFaceUrl("@font-face{src:url(https://x/a.woff2) format('woff2');}")).toBe("https://x/a.woff2");
    expect(latinFaceUrl(GOOGLE_CSS.split("/* latin */")[0])).toBeNull();
  });
});

describe("sketchFontStyle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  const bytes = (n: number) => new Response(new Uint8Array(n).fill(65), { headers: { "content-type": "font/ttf" } });
  const html = () => new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } });

  test("the app's own Patrick Hand file first, as truetype", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => (asked.push(u), u.includes("patrickhand") || u.includes("c64") ? bytes(2000) : html()));
    const { sketchFontStyle } = await import("../src/export/video");
    const css = await sketchFontStyle();
    expect(css).toMatch(/^<style>@font-face\{font-family:'Patrick Hand';src:url\(data:font\/ttf;base64,QUFB/);
    expect(css).toContain("format('truetype')");
    expect(css).toContain("font-family:'C64 Pro Mono'");
    expect(asked.some((u) => u.includes("googleapis"))).toBe(false);
  });

  test("a dev server's index.html is not a font: Google's LATIN face then", async () => {
    vi.stubGlobal("fetch", async (u: string) =>
      u.includes("googleapis") ? new Response(GOOGLE_CSS) : u.endsWith("LATIN.woff2") ? bytes(1500) : u.endsWith(".woff2") && u.includes("gstatic") ? bytes(10) : html());
    const { sketchFontStyle } = await import("../src/export/video");
    const css = await sketchFontStyle();
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain("format('woff2')");
    expect(css.length).toBeGreaterThan(1500); // the 1500-byte latin face, not the 10-byte others
    expect(css).not.toContain("C64 Pro Mono");
  });

  test("no face anywhere: \"\", and the next call asks again", async () => {
    let up = false;
    vi.stubGlobal("fetch", async (u: string) => (up && u.includes("patrickhand") ? bytes(2000) : html()));
    const { sketchFontStyle } = await import("../src/export/video");
    expect(await sketchFontStyle()).toBe("");
    await Promise.resolve();
    up = true;
    expect(await sketchFontStyle()).toContain("font-family:'Patrick Hand'");
  });
});

describe("posterSvg", () => {
  test("sized to the poster, the font first inside the svg", () => {
    const out = posterSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750"><g/></svg>', "<style>F</style>");
    expect(out).toBe(`<svg width="${POSTER_W}" height="${POSTER_H}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750"><style>F</style><g/></svg>`);
  });
});
