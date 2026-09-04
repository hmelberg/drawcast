import { describe, expect, test } from "vitest";
import { clipCacheKey, isUsableVoice, listCloudVoices, preferredVoice, voiceLang, voiceLanguageCode } from "../src/export/tts";

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

// Hans, 2026-09-04, from a real publish failure on drawcast.app:
//   the voice "Charon" was rejected by the API — pick a different en voice
// "Charon" is a Gemini-TTS voice. The voices.list endpoint offers those
// alongside the ordinary ones, but their names are BARE WORDS, and two
// things then break: voiceLanguageCode splits the name on "-" and would send
// languageCode "Charon", and Gemini-TTS additionally requires a
// voice.model_name this client never sends. So such a voice can only ever
// 400 — it must not be offered, and one already stored must not be obeyed.
describe("isUsableVoice — a voice this client can actually synthesize with", () => {
  test("an ordinary voice carries its locale in the name", () => {
    expect(isUsableVoice("en-US-Neural2-F")).toBe(true);
    expect(isUsableVoice("nb-NO-Wavenet-E")).toBe(true);
    expect(isUsableVoice("en-US-Studio-Q")).toBe(true);
    expect(isUsableVoice("cmn-CN-Wavenet-A")).toBe(true);
    expect(isUsableVoice("en-US-Chirp3-HD-Charon")).toBe(true);
    // The filter must not quietly drop real voices: three-letter language
    // subtags and non-country regions are ordinary in Google's catalogue.
    expect(isUsableVoice("yue-HK-Standard-A")).toBe(true);
    expect(isUsableVoice("fil-PH-Neural2-A")).toBe(true);
    expect(isUsableVoice("ar-XA-Wavenet-B")).toBe(true);
    expect(isUsableVoice("es-US-Journey-D")).toBe(true);
  });

  test("a bare Gemini-TTS name does not", () => {
    expect(isUsableVoice("Charon")).toBe(false);
    expect(isUsableVoice("Puck")).toBe(false);
    expect(isUsableVoice("Kore")).toBe(false);
    expect(isUsableVoice("")).toBe(false);
  });
});

describe("listCloudVoices — the picker offers only what publish can use", () => {
  const withFetch = async (voices: { name: string; ssmlGender?: string }[], run: () => Promise<void>) => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    g.fetch = async () => ({ ok: true, json: async () => ({ voices }) });
    try {
      await run();
    } finally {
      g.fetch = original;
    }
  };

  test("a Gemini voice in the API's answer never reaches the dropdown", async () => {
    await withFetch(
      [
        { name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
        { name: "Charon", ssmlGender: "MALE" },
        { name: "en-US-Studio-Q", ssmlGender: "FEMALE" },
      ],
      async () => {
        const list = await listCloudVoices("KEY", "en-US");
        expect(list.map((v) => v.name)).toEqual(["en-US-Neural2-F", "en-US-Studio-Q"]);
      },
    );
  });
});

describe("preferredVoice — a stored voice that cannot work is not a preference", () => {
  // Recovery: Hans already has "Charon" in settings.cloudVoices.en. Filtering
  // the dropdown does not clear it, so without this every publish would keep
  // failing. Falling back is safe here precisely BECAUSE stampedVoice reads
  // the same function: the clip is stamped with the voice that actually sang
  // it, so the reuse check cannot mislabel a recording (the rule that made
  // an API-side silent substitution unacceptable).
  test("a bare Gemini name stored by an older build falls back to the default chain", () => {
    expect(preferredVoice({ en: "Charon" }, "en")).toBeUndefined();
    expect(narrationVoice({ en: "Charon" }, "en").name).toBe("en-US-Studio-Q");
    expect(stampedVoice({ en: "Charon" }, "en")).toBe("en-US-Studio-Q");
  });

  test("an ordinary stored voice is still obeyed", () => {
    expect(preferredVoice({ en: "en-GB-Neural2-A" }, "en")).toBe("en-GB-Neural2-A");
  });
});

// Hans, 2026-09-04: "when I select a different language in playback, is this
// not used when I publish?" It was not. A drawcast declares its language
// (spec.lang), but the cloud voice was chosen by SNIFFING each line — and
// detectLang only knows Norwegian by its letters and a short stopword list,
// so an ordinary Norwegian sentence with no æøå ("Microdata har 10 000
// enheter") reads as English and gets the English voice.
describe("voiceLang — the declared language governs, sniffing is the fallback", () => {
  test("a declared language wins over what the line looks like", () => {
    expect(voiceLang("nb", "Microdata has 10 000 units")).toBe("nb");
    expect(voiceLang("en", "Vi ser at det er slik")).toBe("en");
  });

  test("a regional tag is reduced to the primary subtag the voice map is keyed by", () => {
    // settings.cloudVoices and VOICES are keyed "nb"/"en"; a spec that says
    // "nb-NO" must still find the author's Norwegian pick.
    expect(voiceLang("nb-NO", "hva som helst")).toBe("nb");
    expect(voiceLang("en-GB", "anything")).toBe("en");
  });

  test("nothing declared falls back to sniffing the line, as before", () => {
    expect(voiceLang(undefined, "Vi ser at det er slik")).toBe("nb");
    expect(voiceLang(undefined, "We see that it is so")).toBe("en");
    expect(voiceLang("", "Vi ser at det er slik")).toBe("nb");
    expect(voiceLang("   ", "We see that it is so")).toBe("en");
  });
});

describe("clipCacheKey — the declared language reaches the key", () => {
  const line = { text: "Microdata har 10 000 enheter" };
  const voices = { en: "en-US-Studio-Q", nb: "nb-NO-Wavenet-E" };

  test("a Norwegian drawcast keys on the Norwegian voice even when the line reads as English", () => {
    expect(clipCacheKey(1, voices, line, "nb")).toContain("nb-NO-Wavenet-E");
  });

  test("without a declared language the old sniffing key is unchanged", () => {
    // The bake and live playback share this key; changing it for undeclared
    // documents would silently re-charge every existing drawcast.
    expect(clipCacheKey(1, voices, line)).toBe(clipCacheKey(1, voices, line, undefined));
  });
});
