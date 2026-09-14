// Source-level pins for the tray's controls group (no DOM in this repo):
// the rows must rewrite the AUTHORED script (tuples intact) and run through
// runEdited, values must die with the preview, and the group must be built
// from the tray plan's `controls`.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/tray.ts", "utf8");

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
  test("a control move never overwrites a script the viewer took over", () => {
    expect(src).toMatch(/takenOver\.add\(el\.id\)[\s\S]{0,200}?cs-tray-controls-quiet/);
  });
  test("the group is built from plan.controls", () => {
    expect(src).toContain("plan.controls");
    expect(src).toContain("controlIds:");
  });
  test("a click during playback on a control-bearing panel pauses first, then opens that script (spec §2.6)", () => {
    const i = src.indexOf("hd.timeline.state === \"playing\"", src.indexOf("const screenAt"));
    const region = src.slice(i, i + 1200);
    expect(region).toContain("hd.timeline.pause()");
    expect(region).toMatch(/open\(\{ onCode: /);
    expect(region.indexOf("hd.timeline.pause()")).toBeLessThan(region.indexOf("open({ onCode:"));
  });
  test("one controls-group builder, two hosts (tray and in-place card)", () => {
    const group = readFileSync("src/ui/controls-group.ts", "utf8");
    expect(group).toMatch(/export function buildControlsGroup\(/);
    expect(src).toMatch(/buildControlsGroup\(/);              // the tray uses it
    expect(src).toMatch(/mountControlsCard\(/);               // and mounts it in place
    expect(src).not.toMatch(/class: "cs-tray-ctl cs-tray-ctl-/); // the inline builder is gone from tray.ts
  });
  test("a pane: controls panel opens its card, not the editor, on a paused click", () => {
    expect(src).toMatch(/el\.pane === "controls"[\s\S]{0,400}?mountControlsCard\(/);
  });
  test("the card is torn down with the preview", () => {
    expect(src).toMatch(/const clearPreview[\s\S]{0,800}?controlsCards/);
  });
});
