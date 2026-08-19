import { describe, expect, test } from "vitest";
import { collectSpeakTexts, wrapCaption } from "../src/export/video";

describe("collectSpeakTexts", () => {
  test("collects distinct narration lines in storyboard order", () => {
    const texts = collectSpeakTexts({
      commands: [
        { speak: "First line." },
        { draw: ["a"] },
        { speak: "Second line.", blocking: false },
        { speak: "First line." }, // duplicate synthesized once
        { pause: 1 },
      ],
    });
    expect(texts).toEqual(["First line.", "Second line."]);
  });

  test("ignores empty narration and specs without commands", () => {
    expect(collectSpeakTexts({ commands: [{ speak: "  " }, { draw: ["a"] }] })).toEqual([]);
    expect(collectSpeakTexts({})).toEqual([]);
  });
});

describe("wrapCaption", () => {
  const measure = (s: string) => s.length * 10; // 10px per character

  test("keeps short captions on one line", () => {
    expect(wrapCaption(measure, "short and sweet", 400)).toEqual(["short and sweet"]);
  });

  test("wraps greedily at the measured width", () => {
    expect(wrapCaption(measure, "aaaa bbbb cccc dddd", 100)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  test("a single overlong word still lands on its own line", () => {
    expect(wrapCaption(measure, "supercalifragilistic yes", 100)).toEqual(["supercalifragilistic", "yes"]);
  });
});
