import { describe, expect, test } from "vitest";
import { notYetRecorded, notYetRecordedIn } from "../src/ui/voices-choice";
import { clipCacheKey } from "../src/export/tts";

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

  test("a line the clip store has (the `has` predicate) counts as recorded", () => {
    const voices = { "@a": "gemini:Charon" };
    const lines = [{ text: "One.", speaker: "a" as const }, { text: "Two.", speaker: "a" as const }];
    expect(notYetRecorded(lines, {}, voices, "en", (l) => l.text === "Two.")).toBe(1);
  });
});

describe("Narration voices note against the editor's clip store", () => {
  test("a line is recorded if the document has it in the right voice OR the store has it under the preview's key", async () => {
    const voices = { "@a": "gemini:Charon", "@b": "gemini:Kore" };
    const lines = [
      { text: "One.", speaker: "a" as const },
      { text: "Two.", speaker: "a" as const },
      { text: "Three.", speaker: "b" as const },
    ];
    const mem = new Map<string, string>([[clipCacheKey(1.1, voices, lines[1], "en"), "mp3"]]);
    const store = { get: async (k: string) => mem.get(k) ?? null, put: async () => {} };
    const existing = { "|a||One.": { mp3: "x", ms: 1, voice: "gemini:Charon" } };
    expect(await notYetRecordedIn(store, 1.1, lines, existing, voices, "en")).toBe(1);
    // Another rate (or voice) is another key: not what the preview would play.
    expect(await notYetRecordedIn(store, 1, lines, existing, voices, "en")).toBe(2);
  });

  test("a store that cannot read counts nothing as recorded there", async () => {
    const store = { get: async () => Promise.reject(new Error("idb gone")), put: async () => {} };
    expect(await notYetRecordedIn(store, 1, [{ text: "One.", speaker: "a" }], {}, { "@a": "gemini:Charon" }, "en")).toBe(1);
  });
});
