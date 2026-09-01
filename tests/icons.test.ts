import { describe, expect, it } from "vitest";
import { ICON_PATHS, type IconName } from "../src/ui/icons";

// Part 2a (C8/D6.1, review R4): every control glyph is inline SVG taking
// currentColor — no emoji-class codepoints whose rendering is font-fallback
// luck. This drift test guards the inventory the control bar builds from.

const NAMES: IconName[] = ["play", "pause", "replay", "prev", "next", "volume", "muted", "theater", "fullscreen", "more"];

describe("control-bar icon inventory", () => {
  it("carries a non-empty path for every control the bar builds", () => {
    for (const name of NAMES) {
      expect(ICON_PATHS[name], name).toMatch(/^M/);
    }
    expect(Object.keys(ICON_PATHS).sort()).toEqual([...NAMES].sort());
  });

  it("keeps state pairs visually distinct", () => {
    expect(ICON_PATHS.play).not.toBe(ICON_PATHS.pause);
    expect(ICON_PATHS.play).not.toBe(ICON_PATHS.replay);
    expect(ICON_PATHS.volume).not.toBe(ICON_PATHS.muted);
    expect(ICON_PATHS.prev).not.toBe(ICON_PATHS.next);
  });
});
