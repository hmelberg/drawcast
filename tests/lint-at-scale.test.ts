// Lints judge text at the cast's text scale (spec 2026-10-04 §6, W5): the
// player measures and draws every text by text.font_size / 26, so check,
// frames, generation and the playlist check lay out through layoutAsSeen.
import { describe, expect, test } from "vitest";
import { layoutAsSeen } from "../src/lint/at-scale";
import { checkPlaylist } from "../src/lint/check-playlist";
import { layoutSpec } from "../src/layout/layout";
import { singlePlaylist } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const rules = (issues: { rule: string }[]) => issues.map((i) => i.rule);

const twoLabels = (fontSize?: number): Spec =>
  ({
    ...(fontSize ? { text: { font_size: fontSize } } : {}),
    elements: [
      { id: "a", type: "text", text: "left words", x: 380, y: 400, font_size: 26 },
      { id: "b", type: "text", text: "right words", x: 600, y: 400, font_size: 26 },
    ],
    commands: [{ draw: ["a", "b"], speak: "Two labels." }],
  }) as unknown as Spec;

describe("layoutAsSeen", () => {
  test("scale 1 is layoutSpec exactly", () => {
    expect(layoutAsSeen(twoLabels()).issues).toEqual(layoutSpec(twoLabels()).issues);
  });

  test("two labels clear at scale 1 collide at the cast's text scale", () => {
    expect(rules(layoutAsSeen(twoLabels()).issues)).not.toContain("overlap-label-label");
    expect(rules(layoutSpec(twoLabels(48)).issues)).not.toContain("overlap-label-label");
    expect(rules(layoutAsSeen(twoLabels(48)).issues)).toContain("overlap-label-label");
  });

  test("the drawables carry drawn sizes, and font-too-small judges them", () => {
    const small = (fontSize: number, size: number): Spec =>
      ({ text: { font_size: fontSize }, elements: [{ id: "t", type: "text", text: "note", x: 500, y: 400, font_size: size }], commands: [{ draw: ["t"], speak: "A note." }] }) as unknown as Spec;
    // 12 at scale 1 is too small; drawn at 12 × 48/26 ≈ 22 it reads.
    expect(rules(layoutSpec(small(48, 12)).issues)).toContain("font-too-small");
    expect(rules(layoutAsSeen(small(48, 12)).issues)).not.toContain("font-too-small");
    // 20 drawn at 20 × 16/26 ≈ 12 does not.
    expect(rules(layoutAsSeen(small(16, 20)).issues)).toContain("font-too-small");
    const t = layoutAsSeen(small(39, 20)).drawables.find((d) => d.id === "t");
    expect(t && t.kind === "text" ? t.fontSize : null).toBe(30);
  });

  test("the playlist check lints at scale too", () => {
    expect(rules(checkPlaylist(singlePlaylist(twoLabels(48))).lintIssues)).toContain("overlap-label-label");
  });
});
