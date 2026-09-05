import { describe, expect, it } from "vitest";
import { CAPTION_BAND } from "../src/render/figure-style";
import { contrastRatio } from "./contrast";

// Part 2a (A6/D1): the subtitle band lost visual weight (0.82 → lighter)
// without losing legibility. The worst case for the white caption text is
// the band over bare paper — nothing drawn beneath it — so that blend is
// what must keep WCAG AA. Measured, not eyeballed: at 0.55 the blend reads
// 3.86:1 (fails AA for this text size); 0.6 is the lightest alpha that
// passes. Drift-tested in both directions so the band neither fades into
// illegibility nor creeps back toward the wall of ink D1 complained about.

const PAPER = [250, 246, 236]; // .cs-stage background = FIGURE_GROUND #faf6ec
const TEXT = "#fbf8f1"; // .cs-caption color

const hex = (c: number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

describe("subtitle band", () => {
  it("keeps AA contrast for caption text over bare paper", () => {
    const { ink, alpha } = CAPTION_BAND;
    const blend = PAPER.map((p, i) => alpha * ink[i] + (1 - alpha) * p);
    expect(contrastRatio(TEXT, hex(blend))).toBeGreaterThanOrEqual(4.5);
  });

  it("stays translucent — never back to the 0.82 wall of ink", () => {
    expect(CAPTION_BAND.alpha).toBeLessThanOrEqual(0.65);
  });
});
