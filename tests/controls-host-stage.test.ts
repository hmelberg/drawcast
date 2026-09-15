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
});
