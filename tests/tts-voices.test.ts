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
