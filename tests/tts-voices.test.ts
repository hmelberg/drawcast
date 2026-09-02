import { describe, expect, test } from "vitest";
import { preferredVoice, voiceLanguageCode } from "../src/export/tts";

// B12 pure helpers: the bake's reuse check and the synthesizer both call
// preferredVoice, so its rules ARE the contract.
describe("preferredVoice", () => {
  const prefs = { en: "en-GB-Neural2-A", nb: "nb-NO-Wavenet-C" };

  test("the primary speaker gets the per-language pick", () => {
    expect(preferredVoice(prefs, "en")).toBe("en-GB-Neural2-A");
    expect(preferredVoice(prefs, "en", "a")).toBe("en-GB-Neural2-A");
    expect(preferredVoice(prefs, "nb", "a")).toBe("nb-NO-Wavenet-C");
  });

  test("dialogue speaker b keeps the contrasting default — one pick must not collapse an a/b exchange into one voice", () => {
    expect(preferredVoice(prefs, "en", "b")).toBeUndefined();
  });

  test("no prefs, unknown language, or an empty stored name mean the default chain", () => {
    expect(preferredVoice(undefined, "en")).toBeUndefined();
    expect(preferredVoice(prefs, "fr")).toBeUndefined();
    expect(preferredVoice({ en: "" }, "en")).toBeUndefined();
  });
});

describe("voiceLanguageCode", () => {
  test("derives the languageCode the voice name implies — a mismatched pair 400s at the API", () => {
    expect(voiceLanguageCode("nb-NO-Wavenet-C")).toBe("nb-NO");
    expect(voiceLanguageCode("en-GB-Neural2-A")).toBe("en-GB");
    expect(voiceLanguageCode("cmn-CN-Wavenet-A")).toBe("cmn-CN");
  });
});

import { narrationVoice, stampedVoice, DEFAULT_VOICES } from "../src/export/tts";

// Hans 2026-09-02: the default English narrator is en-US-Studio-Q — for the
// UNDECLARED case only. Authored genders and dialogue keep the gendered
// table, and the bake stamp mirrors the same decision so a republish
// re-voices exactly the lines the change affects.
describe("narrationVoice — one decision for synthesis and stamp", () => {
  test("nothing declared → Studio-Q for English", () => {
    expect(narrationVoice(undefined, "en")).toEqual(DEFAULT_VOICES.en);
    expect(narrationVoice(undefined, "en", {})).toEqual(DEFAULT_VOICES.en);
    expect(narrationVoice(undefined, "en").name).toBe("en-US-Studio-Q");
  });

  test("a declared gender is never overridden by the default", () => {
    expect(narrationVoice(undefined, "en", { gender: "female" }).name).toBe("en-US-Neural2-F");
    expect(narrationVoice(undefined, "en", { gender: "male" }).name).toBe("en-US-Neural2-D");
  });

  test("dialogue keeps its a/b contrast — speakers go the gendered path", () => {
    expect(narrationVoice(undefined, "en", { speaker: "a" }).name).toBe("en-US-Neural2-F");
    expect(narrationVoice(undefined, "en", { speaker: "b" }).name).toBe("en-US-Neural2-D");
  });

  test("the author's per-language pick beats everything for the primary speaker", () => {
    expect(narrationVoice({ en: "en-GB-Neural2-A" }, "en").name).toBe("en-GB-Neural2-A");
    expect(narrationVoice({ en: "en-GB-Neural2-A" }, "en", { speaker: "b" }).name).toBe("en-US-Neural2-D");
  });

  test("a language without a default keeps the old chain", () => {
    expect(narrationVoice(undefined, "fr")).toEqual({ languageCode: "fr-FR" });
  });

  test("the stamp mirrors the decision: named choices stamp, gendered fallbacks do not", () => {
    expect(stampedVoice(undefined, "en")).toBe("en-US-Studio-Q");
    expect(stampedVoice({ en: "en-GB-Neural2-A" }, "en")).toBe("en-GB-Neural2-A");
    expect(stampedVoice(undefined, "en", { gender: "male" })).toBeUndefined();
    expect(stampedVoice(undefined, "fr")).toBeUndefined();
  });
});
