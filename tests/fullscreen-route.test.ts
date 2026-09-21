// Fullscreen on a phone (Hans, 2026-09-21: "Full screen should work on a
// mobile phone (both wide and not-wide)"). Two things are worth pinning: the
// routing decision, and the CSS contract the faux route depends on.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { canGoNative } from "../src/ui/fullscreen";

describe("which fullscreen route a browser gets", () => {
  // The shapes are the real ones, not invented: Safari on iPhone defines
  // neither Element.requestFullscreen nor document.fullscreenEnabled for an
  // ordinary element — which is why the old `el.requestFullscreen?.()` was a
  // silent no-op there rather than an error anyone could have seen.
  test("an iPhone has no Fullscreen API for a <div>, so it takes the faux route", () => {
    expect(canGoNative({}, {})).toBe(false);
  });

  test("desktop Chrome/Firefox/Safari take the native route", () => {
    expect(canGoNative({ requestFullscreen: () => Promise.resolve() }, { fullscreenEnabled: true })).toBe(true);
  });

  // An iframe without allow="fullscreen" still HAS the method — the document
  // flag is the only thing that says so beforehand. Calling it there rejects,
  // which is the case toggleFullscreen's .catch() covers; this is the half we
  // can know without calling.
  test("an iframe that is not permitted fullscreen takes the faux route", () => {
    expect(canGoNative({ requestFullscreen: () => Promise.resolve() }, { fullscreenEnabled: false })).toBe(false);
  });

  test("a browser that reports the flag but not the method takes the faux route", () => {
    expect(canGoNative({}, { fullscreenEnabled: true })).toBe(false);
  });
});

// The faux route is nothing but CSS: if a later round adds a `:fullscreen`
// rule and forgets the class beside it, the native path keeps working and the
// phone quietly loses that rule — the exact failure this whole change is
// about, and one no unit test of TypeScript would ever see.
describe("every fullscreen CSS rule serves both routes", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  // Comments discuss `:fullscreen` freely; only selectors have to comply.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  test("no selector names :fullscreen without naming .cs-faux-fs too", () => {
    const offenders = withoutComments
      .split("\n")
      .filter((line) => line.includes(":fullscreen") && !line.includes("cs-faux-fs"));
    expect(offenders).toEqual([]);
  });

  test("the faux figure covers the DYNAMIC viewport, not the large one", () => {
    // 100vh on a phone is the viewport with the address bar retracted, so a
    // 100vh overlay is cropped by the bar that is on screen while you use it.
    const faux = withoutComments.slice(withoutComments.indexOf(".player-figure.cs-faux-fs"));
    const block = faux.slice(0, faux.indexOf("}"));
    expect(block).toContain("100dvh");
    expect(block).not.toMatch(/height:\s*100vh/);
  });
});
