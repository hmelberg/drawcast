import { describe, expect, test } from "vitest";
import { notYetRecorded } from "../src/ui/voices-choice";

describe("Narration voices note", () => {
  test("counts the Gemini lines with no clip in the right voice", () => {
    const voices = { "@a": "gemini:Charon" };
    const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "a" as const }];
    const existing = { "|a||One.": { mp3: "x", ms: 1, voice: "gemini:Charon" } };
    expect(notYetRecorded(lines, existing, voices, "en")).toBe(1);
  });

  test("a clip recorded in another style counts as not yet recorded; Studio lines never count", () => {
    const voices = { "@a": "gemini:Charon | dry", "@b": "en-US-Studio-O" };
    const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "b" as const }];
    const existing = { "|a||One.": { mp3: "x", ms: 1, voice: "gemini:Charon" } };
    expect(notYetRecorded(lines, existing, voices, "en")).toBe(1);
  });
});
