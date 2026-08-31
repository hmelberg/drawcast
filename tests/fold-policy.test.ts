import { describe, expect, it } from "vitest";
import { foldedControls } from "../src/ui/controls";

// The decision behind the player bar's "⋯" overflow, extracted as a pure
// function so it can be covered without a browser. The bug this fix round
// found was never in this decision — it was that attachPlayerControls took
// it once from matchMedia() and never asked again, so a phone rotation left
// a stale answer in place. These tests cover the decision; the re-asking is
// wired in controls.ts (a MediaQueryList "change" listener, torn down per
// render via the foldTeardown WeakMap) and is not itself DOM-testable here.
describe("foldedControls", () => {
  it("keeps everything inline on a wide screen", () => {
    expect(foldedControls(false, true, true)).toEqual({
      inline: ["mode", "speed", "mute", "captions"],
      folded: [],
    });
  });

  it("folds everything behind ⋯ on a narrow screen", () => {
    expect(foldedControls(true, true, true)).toEqual({
      inline: [],
      folded: ["mode", "speed", "mute", "captions"],
    });
  });

  it("always carries mode and speed — the bar has no mode without them", () => {
    expect(foldedControls(false, false, false).inline).toEqual(["mode", "speed"]);
    expect(foldedControls(true, false, false).folded).toEqual(["mode", "speed"]);
  });

  it("only lists mute/captions when the caller actually wired them up", () => {
    expect(foldedControls(false, true, false).inline).toEqual(["mode", "speed", "mute"]);
    expect(foldedControls(false, false, true).inline).toEqual(["mode", "speed", "captions"]);
    expect(foldedControls(true, true, false).folded).toEqual(["mode", "speed", "mute"]);
    expect(foldedControls(true, false, true).folded).toEqual(["mode", "speed", "captions"]);
  });

  it("never splits a control between inline and folded", () => {
    for (const narrow of [true, false]) {
      for (const hasMute of [true, false]) {
        for (const hasCC of [true, false]) {
          const { inline, folded } = foldedControls(narrow, hasMute, hasCC);
          expect(inline.some((s) => folded.includes(s))).toBe(false);
        }
      }
    }
  });
});
