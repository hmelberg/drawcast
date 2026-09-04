import { describe, expect, test } from "vitest";
import { audioLimits, clipCacheKey, isUsableVoice, listCloudVoices, preferredVoice, synthesizeBase64, voiceLang, voiceLanguageCode } from "../src/export/tts";

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

// Hans, 2026-09-04, the decisive clue: baking a course with a Chirp 3: HD
// Norwegian voice succeeded for the first three lectures and failed on the
// fourth or fifth. So the voice itself is fine — one LINE is not. The only
// per-line difference in the request is `delivery`, which is the sole reason
// `pitch` and `volumeGainDb` are ever sent, and Chirp 3: HD rejects pitch.
// A publish therefore died at the first soft/grave/brisk line in the series.
describe("audioLimits — what prosody a voice family accepts", () => {
  test("Chirp 3: HD takes no pitch and no gain, and caps the rate at 2", () => {
    const c = audioLimits("nb-NO-Chirp3-HD-Charon");
    expect(c.pitch).toBe(false);
    expect(c.gain).toBe(false);
    expect(c.maxRate).toBe(2);
  });

  test("Studio takes no pitch — the limitation this code already knew about", () => {
    expect(audioLimits("en-US-Studio-Q").pitch).toBe(false);
    expect(audioLimits("en-US-Studio-Q").gain).toBe(true);
  });

  test("the ordinary families take everything", () => {
    for (const n of ["nb-NO-Wavenet-E", "en-US-Neural2-F", "en-GB-Standard-A"]) {
      expect(audioLimits(n)).toEqual({ pitch: true, gain: true, maxRate: 4 });
    }
  });

  test("an unnamed voice (the API picks) is treated as ordinary", () => {
    expect(audioLimits(undefined).pitch).toBe(true);
  });
});

describe("synthesizeBase64 — the request a delivery line actually sends", () => {
  const bodyOf = async (voiceName: string, delivery: "soft" | "grave") => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    let sent: Record<string, never> | undefined;
    g.fetch = async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, never>;
      return { ok: true, status: 200, json: async () => ({ audioContent: "AAA" }) };
    };
    try {
      await synthesizeBase64({ apiKey: "K", rate: 1, voices: { nb: voiceName }, lang: "nb" }, "Vi ser på tallene.", { delivery });
    } finally {
      g.fetch = original;
    }
    return sent as unknown as { audioConfig: Record<string, unknown>; voice: Record<string, unknown> };
  };

  test("a Chirp voice gets no pitch and no volumeGainDb — the fields it 400s on", async () => {
    const body = await bodyOf("nb-NO-Chirp3-HD-Charon", "soft");
    expect(body.voice.name).toBe("nb-NO-Chirp3-HD-Charon");
    expect(body.audioConfig).not.toHaveProperty("pitch");
    expect(body.audioConfig).not.toHaveProperty("volumeGainDb");
    expect(body.audioConfig.speakingRate).toBeLessThanOrEqual(2);
  });

  test("an ordinary voice keeps the whole prosody nudge", async () => {
    const body = await bodyOf("nb-NO-Wavenet-E", "soft");
    expect(body.audioConfig.pitch).toBe(-1.5);
    expect(body.audioConfig.volumeGainDb).toBe(-3);
  });
});

describe("a rejected voice reports why", () => {
  // The old message named the voice and stopped there, discarding the API's
  // own sentence — which is exactly the sentence that says WHICH field it
  // objected to. Two rounds of guessing came out of that.
  test("the API's own reason survives into the error", async () => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    g.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "This voice does not support pitch parameters." } }),
    });
    try {
      await expect(
        synthesizeBase64({ apiKey: "K", rate: 1, voices: { nb: "nb-NO-Chirp3-HD-Charon" }, lang: "nb" }, "Hei.", {}),
      ).rejects.toThrow(/does not support pitch parameters/);
    } finally {
      g.fetch = original;
    }
  });

  test("and so does the guidance about picking another voice", async () => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    g.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "boom" } }) });
    try {
      await expect(
        synthesizeBase64({ apiKey: "K", rate: 1, voices: { nb: "nb-NO-Chirp3-HD-Charon" }, lang: "nb" }, "Hei.", {}),
      ).rejects.toThrow(/nb-NO-Chirp3-HD-Charon/);
    } finally {
      g.fetch = original;
    }
  });
});

// Hans, 2026-09-04: "don't send fields that are null".
//
// The measurement behind the rule: of 42 delivery uses in the bundled
// examples, 40 are `grave` — and grave's pitchSt and gainDb are BOTH 0. So
// on 95 % of them drawcast announced a pitch and a gain it was not applying,
// and that announcement is exactly what a Chirp voice 400s on. A field that
// carries the API's own default is not a setting; it is noise with a failure
// mode.
describe("the request carries only fields that do something", () => {
  const bodyOf = async (voiceName: string, opts: { delivery?: "soft" | "grave" | "brisk"; rate?: number }) => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    let sent: { audioConfig: Record<string, unknown> } | undefined;
    g.fetch = async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as { audioConfig: Record<string, unknown> };
      return { ok: true, status: 200, json: async () => ({ audioContent: "AAA" }) };
    };
    try {
      await synthesizeBase64(
        { apiKey: "K", rate: opts.rate ?? 1, voices: { nb: voiceName }, lang: "nb" },
        "Vi ser på tallene.",
        opts.delivery ? { delivery: opts.delivery } : {},
      );
    } finally {
      g.fetch = original;
    }
    return sent!.audioConfig;
  };

  test("grave nudges only the pace, so only the pace is sent — on ANY voice family", async () => {
    for (const voice of ["nb-NO-Wavenet-E", "nb-NO-Chirp3-HD-Charon"]) {
      const cfg = await bodyOf(voice, { delivery: "grave" });
      expect(cfg).not.toHaveProperty("pitch");
      expect(cfg).not.toHaveProperty("volumeGainDb");
      expect(cfg.speakingRate).toBeCloseTo(0.88);
    }
  });

  test("brisk likewise", async () => {
    const cfg = await bodyOf("nb-NO-Wavenet-E", { delivery: "brisk" });
    expect(cfg).not.toHaveProperty("pitch");
    expect(cfg).not.toHaveProperty("volumeGainDb");
  });

  test("soft really does colour the voice, so it really does send those fields", async () => {
    const cfg = await bodyOf("nb-NO-Wavenet-E", { delivery: "soft" });
    expect(cfg.pitch).toBe(-1.5);
    expect(cfg.volumeGainDb).toBe(-3);
  });

  test("the neutral speaking rate is the API's own default and is not sent either", async () => {
    const cfg = await bodyOf("nb-NO-Wavenet-E", { rate: 1 });
    expect(cfg).not.toHaveProperty("speakingRate");
    expect(cfg.audioEncoding).toBe("MP3");
  });

  test("a rate the author actually changed is sent", async () => {
    expect((await bodyOf("nb-NO-Wavenet-E", { rate: 1.2 })).speakingRate).toBeCloseTo(1.2);
    expect((await bodyOf("nb-NO-Wavenet-E", { rate: 0.9 })).speakingRate).toBeCloseTo(0.9);
  });
});
