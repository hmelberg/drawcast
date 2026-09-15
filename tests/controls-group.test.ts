// controls-group.ts builds real DOM (no jsdom in this repo — see
// tests/tray-controls.test.ts's header), so its shape is pinned the same
// source-level way: the builder must be dependency-injected (it reads and
// writes through `d`, never a module-level tray variable) so the SAME
// function produces the SAME rows whichever host (the tray, or a
// `pane: controls` panel's in-place card) calls it.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/ui/controls-group.ts", "utf8");

describe("controls-group builder (pins)", () => {
  test("exports buildControlsGroup(d: ControlsGroupDeps)", () => {
    expect(src).toMatch(/export interface ControlsGroupDeps/);
    expect(src).toMatch(/export function buildControlsGroup\(d: ControlsGroupDeps\): HTMLElement/);
  });
  test("knows nothing of the tray's own state — only d's", () => {
    // The tray's preview-state names must never leak in as free variables:
    // every read or write goes through the deps object the caller supplies.
    expect(src).not.toMatch(/\bcontrolValues\b/);
    expect(src).not.toMatch(/\brunControls\b/);
    expect(src).not.toMatch(/\btakenOver\b/);
  });
  test("every control kind still renders the exact classes the tray always used", () => {
    expect(src).toContain('class: "cs-tray-controls"');
    expect(src).toMatch(/class: `cs-tray-row cs-tray-ctl cs-tray-ctl-\$\{rowWidth\(c\.kind\)\}`/);
    for (const kind of ["slider", "choice", "toggle", "text", "number", "button"]) {
      expect(src).toMatch(new RegExp(`case "${kind}":`));
    }
    expect(src).toContain('class: "cs-tray-choicebtn"');
    expect(src).toContain('class: "cs-tray-pill cs-tray-ctlbtn"');
  });
  test("a control move commits through d.commit, never a local rewrite — and always names its own group (the two-hosts fix)", () => {
    expect(src).toMatch(/d\.commit\(c, range\.value, false, group\)/);
    expect(src).toMatch(/d\.commit\(c, v, true, group\)/);
    expect(src).toMatch(/d\.commit\(c, box\.checked, true, group\)/);
    expect(src).toMatch(/d\.commit\(c, input\.value, true, group\)/);
    expect(src).toMatch(/d\.commit\(c, "", true, group\)/);
  });
  test("every row is named for syncControlsGroup via data-control (Task 3 review)", () => {
    expect(src).toMatch(/"data-control": c\.name/);
    expect(src).toMatch(/export function syncControlsGroup\(group: HTMLElement, control: ControlSpec, value: ControlValue\): void/);
    expect(src).toMatch(/querySelector<HTMLElement>\(`\[data-control="\$\{control\.name\}"\]`\)/);
  });
  test("quiet is applied from d.quiet, not sniffed from a takeover set", () => {
    expect(src).toMatch(/if \(d\.quiet\) group\.classList\.add\("cs-tray-controls-quiet"\)/);
  });
  test("autorun: false adds a Run row that calls d.run(), not runControls directly", () => {
    expect(src).toMatch(/d\.el\.autorun === false/);
    expect(src).toMatch(/class: "cs-tray-run"/);
    expect(src).toMatch(/run\.addEventListener\("click", \(\) => d\.run\(\)\)/);
  });
});
