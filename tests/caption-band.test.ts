import { describe, expect, it } from "vitest";
import { CAPTION_TEXT } from "../src/render/figure-style";
import { contrastRatio } from "./contrast";

// The subtitles over the drawing are written on it like its own labels
// (Hans, 2026-09-25): ink letters, each in a halo of the paper colour, no
// band. Under a letter the halo lays down paper, so the contrast that must
// hold is ink against paper — the same pair the figure's own labels use.
// (It replaced a 0.6-alpha dark band with white text, which this file used
// to pin at ≥ 4.5 : 1.)

describe("subtitles written on the drawing", () => {
  it("ink on its paper halo keeps AA contrast", () => {
    expect(contrastRatio(CAPTION_TEXT.ink, CAPTION_TEXT.halo)).toBeGreaterThanOrEqual(4.5);
  });

  it("the halo is the figure's own paper, so it never reads as a box", () => {
    expect(CAPTION_TEXT.halo.toLowerCase()).toBe("#faf6ec");
  });
});
