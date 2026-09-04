// The CRT's switches: what a press does, and what it hides. The DOM half
// (hit-testing, the veil, the tooltip) is the live smoke's.

import { describe, expect, test } from "vitest";
import { hiddenIds, pressSwitch, veilOpacity, SWITCHES_ON, type SwitchState } from "../src/ui/screen-switches";

const parts = { lines: ["c1_line_1", "c1_line_2"], out: ["c1_out", "c1_fig_1"] };

describe("pressSwitch", () => {
  test("power turns the picture off and on again", () => {
    const off = pressSwitch(SWITCHES_ON, "power");
    expect(off.on).toBe(false);
    expect(veilOpacity(off)).toBeGreaterThan(0.9);
    expect(pressSwitch(off, "power")).toEqual(SWITCHES_ON);
  });

  test("brightness cycles and comes back to bright", () => {
    let s: SwitchState = SWITCHES_ON;
    const seen = [veilOpacity(s)];
    for (let i = 0; i < 3; i++) {
      s = pressSwitch(s, "dim");
      seen.push(veilOpacity(s));
    }
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(seen[2]).toBeGreaterThan(seen[1]);
    expect(seen[3]).toBe(seen[0]); // back to bright
  });

  test("a dark screen has no brightness to set", () => {
    const off = pressSwitch(SWITCHES_ON, "power");
    expect(pressSwitch(off, "dim")).toEqual(off);
  });

  test("the code and the output are hidden independently, and each comes back", () => {
    const noCode = pressSwitch(SWITCHES_ON, "code");
    expect(hiddenIds(noCode, parts)).toEqual(parts.lines);
    const neither = pressSwitch(noCode, "output");
    expect(hiddenIds(neither, parts)).toEqual([...parts.lines, ...parts.out]);
    expect(hiddenIds(pressSwitch(pressSwitch(neither, "code"), "output"), parts)).toEqual([]);
  });

  test("switching the code off leaves the picture on — they are different switches", () => {
    const noCode = pressSwitch(SWITCHES_ON, "code");
    expect(noCode.on).toBe(true);
    expect(veilOpacity(noCode)).toBe(0);
  });
});
