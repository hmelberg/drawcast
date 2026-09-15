// The controls host's stage half is DOM (no harness here): source pins,
// the idiom tests/stage-click.test.ts set.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const host = readFileSync("src/ui/controls-host.ts", "utf8");
const input = readFileSync("src/ui/controls-input.ts", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("controls host on the stage (pins)", () => {
  test("the host registers its panels as a control region, so a press there never toggles play", () => {
    expect(host).toMatch(/registerControlRegion\(stage, \(e\) => \{[\s\S]{0,300}host\.panelAt\(p\) !== null/);
  });
  test("a press while playing pauses and snaps FIRST, then the same press is the gesture (one click)", () => {
    const down = /stage\.addEventListener\(\s*"pointerdown",\s*\(e: PointerEvent\) => \{([\s\S]*?)\n    \},\n    \{ capture: true, signal \},\n  \);/.exec(host);
    expect(down).not.toBeNull();
    const body = down![1];
    expect(body).toContain("opts.pauseAndSnap()");
    expect(body.indexOf("opts.pauseAndSnap()")).toBeLessThan(body.indexOf("host.press("));
  });
  test("a slider drag takes pointer capture and releases it", () => {
    expect(host).toMatch(/stage\.setPointerCapture\(e\.pointerId\)/);
    expect(host).toMatch(/stage\.releasePointerCapture\(/);
    expect(host).toMatch(/host\.drag\(/);
    expect(host).toMatch(/host\.release\(/);
  });
  test("the cursor rule: a live row shows a pointer only while paused or gated", () => {
    expect(host).toMatch(/stage\.classList\.toggle\("cs-ctl-hover", /);
    expect(css).toMatch(/\.cs-stage\.cs-ctl-hover \{ cursor: pointer; \}/);
  });
  test("teardown uses an AbortController so every listener can be removed at once", () => {
    expect(host).toMatch(/new AbortController\(\)/);
    expect(host).toMatch(/controller\.abort\(\)/);
  });
  test("the transient input: sketch font, no border of its own, Enter/blur commit, Escape cancels, stops propagation", () => {
    expect(input).toMatch(/class: "cs-ctlinput"/);
    expect(css).toMatch(/\.cs-ctlinput \{[^}]*font-family: var\(--sketch-font\)/);
    expect(css).toMatch(/\.cs-ctlinput \{[^}]*border: none/);
    expect(input).toMatch(/e\.key === "Enter"/);
    expect(input).toMatch(/e\.key === "Escape"/);
    expect(input).toMatch(/addEventListener\("blur"/);
    expect(input).toMatch(/stopPropagation\(\)/);
    expect(input).toMatch(/clientPointFor\(stage, \[/);
  });
  test("the stage wears cs-ctl-live while a panel is hosted, and touch-action pan-y is what actually stops the touch drag from scrolling the page", () => {
    // preventDefault() on pointerdown does NOT stop touch panning — by then
    // the browser owns the gesture. Only touch-action does, so the class must
    // go on at attach (before any finger lands) and come off at teardown.
    expect(host).toMatch(/stage\.classList\.add\("cs-ctl-live"\)/);
    const teardown = /return \(\) => \{([\s\S]*?)\n  \};/.exec(host);
    expect(teardown).not.toBeNull();
    expect(teardown![1]).toMatch(/stage\.classList\.remove\("cs-ctl-live"\)/);
    expect(css).toMatch(/\.cs-stage\.cs-ctl-live \{ touch-action: pan-y; \}/);
  });
  test("HTML chrome lying over a panel wins the press — the centred ▶, the tray, a code card, the transient input, the caption band", () => {
    const down = /stage\.addEventListener\(\s*"pointerdown",\s*\(e: PointerEvent\) => \{([\s\S]*?)\n    \},\n    \{ capture: true, signal \},\n  \);/.exec(host);
    expect(down).not.toBeNull();
    const body = down![1];
    // .cs-caption is the one that is not a button: an absolute overlay across
    // the whole stage bottom with pointer events on, so selecting the beat's
    // text over a bottom row would otherwise drag that row's slider.
    expect(body).toMatch(
      /e\.target instanceof Element && e\.target\.closest\("button, input, select, textarea, \.cs-paramtray, \.cs-codeedit, \.cs-ctlinput, \.cs-caption"\)/,
    );
    // …and it must bow out BEFORE the press becomes a gesture, or the knob
    // moves anyway while the button's own click also fires.
    expect(body.indexOf("e.target.closest(")).toBeLessThan(body.indexOf("host.press("));
    expect(body.indexOf("e.target.closest(")).toBeLessThan(body.indexOf("opts.pauseAndSnap()"));
  });
});
