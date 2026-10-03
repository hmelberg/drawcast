// The big play/replay button on a hands-on figure: the decision is pure
// (ui/bigplay.ts); the stage half is DOM with no harness here, so it is
// pinned by source, the idiom tests/controls-host-stage.test.ts uses.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { HANDS_ON_CLASS, figureIsHandsOn } from "../src/ui/bigplay";

const controls = readFileSync("src/ui/controls.ts", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("figureIsHandsOn", () => {
  test("an ordinary cast keeps the centred button", () => {
    expect(figureIsHandsOn({ widget: false, interactions: [] })).toBe(false);
  });
  test("a widget body (live or not) is hands-on", () => {
    expect(figureIsHandsOn({ widget: true, interactions: [] })).toBe(true);
  });
  test("free play on the figure is hands-on; tray-launched explores are not (they hide the button themselves)", () => {
    for (const k of ["piano", "chess", "staff"] as const) expect(figureIsHandsOn({ widget: false, interactions: [k] })).toBe(true);
    for (const k of ["periodic", "space", "sky"] as const) expect(figureIsHandsOn({ widget: false, interactions: [k] })).toBe(false);
  });
});

describe("the stage wiring (pins)", () => {
  test("controls.ts toggles the class from the widget host and the template's interactions", () => {
    expect(HANDS_ON_CLASS).toBe("cs-handson");
    expect(controls).toMatch(/stage\.classList\.toggle\(HANDS_ON_CLASS, figureIsHandsOn\(\{ widget: widgetHost !== null, interactions \}\)\)/);
    // After the host is attached, so `widgetHost` is known.
    expect(controls.indexOf("figureIsHandsOn({")).toBeGreaterThan(controls.indexOf("const widgetHost = attachWidgetHost("));
  });
  test("the button keeps an accessible name that follows play/replay", () => {
    expect(controls).toMatch(/class: "cs-bigplay", title: "Play with narration", "aria-label": "Play with narration"/);
    expect(controls).toMatch(/nameBigPlay\(s === "done" \? "Replay with narration" : "Play with narration"\)/);
    expect(controls).toMatch(/bigPlay\.setAttribute\("aria-label", label\)/);
  });
  test("hands-on and drawn-panel stages dock it in the corner, off centre, and bring it up on hover and focus", () => {
    const dock = /\.cs-stage\.cs-handson \.cs-bigplay,\s*\.cs-stage\.cs-ctl-live \.cs-bigplay \{([^}]*)\}/.exec(css);
    expect(dock).not.toBeNull();
    expect(dock![1]).toMatch(/left: 0\.6rem/);
    expect(dock![1]).toMatch(/top: 0\.6rem/);
    expect(dock![1]).toMatch(/transform: none/);
    expect(css).toMatch(/\.cs-stage\.cs-handson \.cs-bigplay:focus-visible/);
  });
  test("mid-drag the button never catches the pointer", () => {
    expect(css).toMatch(/\.cs-stage\.cs-grabbing \.cs-bigplay \{ display: none; \}/);
  });
  test("an ordinary cast's centred button is unchanged", () => {
    expect(css).toMatch(/\.cs-bigplay \{\s*position: absolute;\s*left: 50%;\s*top: 50%;\s*transform: translate\(-50%, -50%\);/);
  });
});

describe("a pause after the start is not the poster", () => {
  test("docks the ▶ small in the lower-left corner on a mid-cast pause", () => {
    const rule = css.slice(css.indexOf(".cs-stage.is-paused .cs-bigplay {"));
    expect(rule).toMatch(/^\.cs-stage\.is-paused \.cs-bigplay \{[^}]*left: 0\.6rem;[^}]*bottom: 0\.6rem;[^}]*width: 40px;/);
  });
  test("shows none at all while a question is up on the paused figure", () => {
    expect(css).toContain(".cs-stage.is-paused:has(> .cs-figgate, > .cs-cardgate, > .cs-waitgate, > .cs-gatedock) .cs-bigplay { display: none; }");
  });
  test("lets the figure worked by hand keep its top-left dock (declared after)", () => {
    expect(css.indexOf(".cs-stage.cs-handson .cs-bigplay,")).toBeGreaterThan(css.indexOf(".cs-stage.is-paused .cs-bigplay {"));
  });
});
