// Source-level pins for the tray's controls group (no DOM in this repo):
// the rows must rewrite the AUTHORED script (tuples intact) and run through
// runEdited, values must die with the preview, and the group must be built
// from the tray plan's `controls`.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/tray.ts", "utf8");
const player = readFileSync("src/render/player.ts", "utf8");

describe("tray controls (pins)", () => {
  test("controls parse the authored element, not the resolved clone", () => {
    expect(src).toMatch(/parseControls\(\s*[^)]*authoredEl\.code/);
  });
  test("a control change runs the rewritten script through runEdited", () => {
    expect(src).toMatch(/const code = applyControls\([^)]*authoredCode[\s\S]{0,200}?runEdited\(el, code, "controls"\)/);
  });
  test("control values are cleared with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]*?controlValues\.clear\(\)/);
  });
  test("a held glow is released with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]*?heldGlows/);
  });
  test("the group is built from plan.controls", () => {
    expect(src).toContain("plan.controls");
    expect(src).toContain("controlIds:");
  });
  test("the player can hold a glow for the tray", () => {
    expect(player).toMatch(/holdGlow\(ids: string\[\]\): \(\) => void/);
  });
});
