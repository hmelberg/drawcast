// The panel's view state: what a press does, what the panel then SHOWS, and
// what stays hidden. The DOM half (hit-testing, the veil, the tray row) is
// the live smoke's.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { hiddenIds, pressSwitch, shownFor, veilOpacity, SWITCHES_ON, type SwitchState } from "../src/ui/panel-view";

const parts = { lines: ["c1_line_1", "c1_line_2"], out: ["c1_out", "c1_fig_1"] };

describe("pressSwitch", () => {
  test("power turns the picture off and on again", () => {
    const off = pressSwitch(SWITCHES_ON, "power");
    expect(off.on).toBe(false);
    expect(veilOpacity(off)).toBe(1); // off is OFF: nothing ghosts through
    expect(pressSwitch(off, "power")).toEqual(SWITCHES_ON);
  });

  test("the code and the output are switched independently, and each comes back", () => {
    const noCode = pressSwitch(SWITCHES_ON, "code");
    expect(noCode).toMatchObject({ code: false, output: true, on: true });
    const neither = pressSwitch(noCode, "output");
    expect(neither).toMatchObject({ code: false, output: false });
    expect(pressSwitch(pressSwitch(neither, "code"), "output")).toEqual(SWITCHES_ON);
  });
});

describe("what the panel shows", () => {
  const st = (over: Partial<SwitchState>): SwitchState => ({ ...SWITCHES_ON, ...over });

  test("turning one half off hands the whole screen to the other", () => {
    expect(shownFor(st({ code: false }), "left")).toBe("output");
    expect(shownFor(st({ output: false }), "left")).toBe("code");
    // …whatever the author asked for: a stacked panel expands the same way.
    expect(shownFor(st({ code: false }), "below")).toBe("output");
  });

  test("with both halves on, the authored layout is untouched", () => {
    expect(shownFor(SWITCHES_ON, "below")).toBe("below");
    expect(shownFor(SWITCHES_ON, undefined)).toBeUndefined();
  });

  test("with both off the panel keeps its size and simply holds nothing", () => {
    const none = st({ code: false, output: false });
    expect(shownFor(none, "left")).toBe("left"); // not re-laid out…
    expect(hiddenIds(none, parts)).toEqual([...parts.lines, ...parts.out]); // …just emptied
  });

  test("a half switched off on its own hides no ids — the layout did the work", () => {
    expect(hiddenIds(st({ code: false }), parts)).toEqual([]);
    expect(hiddenIds(SWITCHES_ON, parts)).toEqual([]);
  });
});

describe("the composer-less preview (source pin — the DOM half is the smoke's)", () => {
  test("previews from what is PAINTED, so a switch press does not undo a sweep", () => {
    const src = readFileSync("src/ui/panel-view.ts", "utf8");
    // Same rule as the tray's repaint(): a `run` has left its swept script and
    // fresh envelope on the player, and a preview rebuilt from the authored
    // `hd.spec.elements` would snap the figure back to the author's text.
    expect(src).toMatch(/patch\(hd\.timeline\.patchedElements\(\) \?\? hd\.spec\.elements \?\? \[\]\)/);
    expect(src).not.toMatch(/patch\(hd\.spec\.elements \?\? \[\]\)/);
  });
});
