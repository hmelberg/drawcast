// The stage's click-to-toggle gesture (src/ui/controls.ts) must never fire
// for a click that BEGAN on a control — a slider drag released on the figure
// delivers its click to the stage, the two elements' common ancestor, and the
// click's own target cannot tell (Hans 2026-09-15: "as soon as we click on
// the screen it either pauses or continues to play"). No DOM harness in this
// repo: source-level pins, the idiom tests/tray-reveal.test.ts set.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/controls.ts", "utf8");

describe("stage click never toggles play from a control", () => {
  test("the control selector names every live control surface", () => {
    const m = /const CONTROL_SELECTOR = "([^"]+)"/.exec(src);
    expect(m, "CONTROL_SELECTOR must exist").not.toBeNull();
    for (const part of ["input", "button", "select", "textarea", "label", ".cs-paramtray", ".cs-codeedit", ".cs-ctlcard"]) {
      expect(m![1].split(",").map((s) => s.trim())).toContain(part);
    }
  });
  test("the press start is remembered on pointerdown (capture) and consulted before togglePlay", () => {
    expect(src).toMatch(/stage\.addEventListener\("pointerdown", \(e\) => \(pressOnControl = onControl\(e\.target\)\), true\)/);
    const handler = /stage\.addEventListener\("click", \(e\) => \{([\s\S]*?)togglePlay\(\);\s*\}\);/.exec(src);
    expect(handler, "the stage click handler must end in togglePlay()").not.toBeNull();
    const body = handler![1];
    expect(body).toMatch(/const began = pressOnControl;/);
    expect(body).toMatch(/if \(began \|\| onControl\(e\.target\)\) return;/);
    expect(body).toMatch(/if \(gateIsOpen\(stage\)\) return;/);
    expect(body.indexOf("began ||")).toBeLessThan(body.indexOf("isTextDrag"));
  });
});
