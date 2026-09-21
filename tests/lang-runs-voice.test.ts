// What a `[de:ich]` mark actually DOES once it leaves the parser: which voice
// the run is synthesized with, which clip key it gets, and — the property the
// whole design hangs on — that a line without a mark is untouched all the way
// down, so no clip ever baked stops matching the line it was baked for.
import { describe, expect, test } from "vitest";
import { speechKey } from "../src/render/delivery";
import { clipCacheKey, narrationVoice, runLang, synthesizeBase64, undeclaredNarratorGender, DEFAULT_VOICES } from "../src/export/tts";
import type { SpeakOpts } from "../src/render/delivery";
import { collectSpeakLines } from "../src/export/video";
import type { Spec } from "../src/spec/types";

describe("the clip key", () => {
  // The text is the LAST field and may itself contain "|", so a language
  // cannot be appended; it prefixes instead, and only when there is one.
  test("a line with no language keys exactly as it always did", () => {
    expect(speechKey({ text: "Hi" })).toBe("|a||Hi");
    expect(speechKey({ text: "Hi", gender: "male", speaker: "b", delivery: "grave" })).toBe("male|b|grave|Hi");
  });

  test("a run in another language is a different clip", () => {
    expect(speechKey({ text: "ich", lang: "de" })).toBe("@de|" + speechKey({ text: "ich" }));
    expect(speechKey({ text: "ich", lang: "de" })).not.toBe(speechKey({ text: "ich" }));
  });
});

describe("which voice says the run", () => {
  /** The request body synthesizeBase64 would send for one run. */
  const bodyOf = async (opts: SpeakOpts): Promise<{ voice: Record<string, unknown> }> => {
    const g = globalThis as unknown as { fetch: unknown };
    const original = g.fetch;
    let sent: { voice: Record<string, unknown> } | undefined;
    g.fetch = async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as { voice: Record<string, unknown> };
      return { ok: true, status: 200, json: async () => ({ audioContent: "AAA" }) };
    };
    try {
      await synthesizeBase64({ apiKey: "K", rate: 1, lang: "en" }, "ich", opts);
    } finally {
      g.fetch = original;
    }
    return sent!;
  };

  test("a run's own language beats the document's declared one", () => {
    expect(runLang({ text: "ich", lang: "de" }, "nb")).toBe("de");
    expect(runLang({ text: "Vi ser på tallene." }, "nb")).toBe("nb");
  });

  test("the run gets a voice of ITS language, at the narrator's sex", () => {
    const v = narrationVoice(undefined, "de", { gender: "female", speaker: "a", lang: "de" });
    expect(v.languageCode).toBe("de-DE");
  });

  // A male sentence with a female German word in the middle of it is a second
  // person, not a foreign word. With no declared sex the narrator is the
  // undeclared default (en-US-Studio-Q, MALE in Google's own voice table), so
  // the foreign run must match that rather than the gendered table's female.
  //
  // Asserted on the REQUEST and not on narrationVoice, which is where this
  // first got written and was wrong: VOICES names voices for en and nb only,
  // so voiceFor("de", …) returns a bare languageCode either way and the sex
  // travels as ssmlGender in the call itself. The body is the only place the
  // two halves meet.
  test("under an undeclared narrator the run matches the default narrator's sex", async () => {
    expect(undeclaredNarratorGender()).toBe("male");
    expect((await bodyOf({ lang: "de" })).voice).toMatchObject({ languageCode: "de-DE", ssmlGender: "MALE" });
    // …while the unmarked line around it is untouched: the undeclared
    // narrator is still asked for BY NAME, so it keeps Studio-Q and its clip.
    expect((await bodyOf({})).voice).toMatchObject({ languageCode: "en-US", name: "en-US-Studio-Q" });
  });

  test("a declared narrator sex is what the foreign run matches", async () => {
    expect((await bodyOf({ lang: "de", gender: "female", speaker: "a" })).voice).toMatchObject({ languageCode: "de-DE", ssmlGender: "FEMALE" });
  });

  // undeclaredNarratorGender() reads DEFAULT_VOICES.en because that table has
  // exactly one entry, so "the undeclared narrator" is unambiguous. A second
  // entry would need the DOCUMENT's language threaded in to choose between
  // them — this is the alarm for that day.
  test("the undeclared-narrator default is still a single entry", () => {
    expect(Object.keys(DEFAULT_VOICES)).toEqual(["en"]);
  });

  test("an author's own pick for that language wins over both", () => {
    const v = narrationVoice({ de: "de-DE-Wavenet-F" }, "de", { lang: "de" });
    expect(v.name).toBe("de-DE-Wavenet-F");
    expect(v.languageCode).toBe("de-DE");
  });

  test("the cache key follows the voice, so a foreign run cannot collide with the line", () => {
    const line = { text: "ich", lang: "de" };
    expect(clipCacheKey(1, undefined, line, "en")).not.toBe(clipCacheKey(1, undefined, { text: "ich" }, "en"));
  });
});

describe("what the bake is asked to synthesize", () => {
  const spec = (speak: string): Spec => ({ elements: [], commands: [{ speak }] }) as unknown as Spec;

  test("an unmarked line is one line, with no language on it", () => {
    const lines = collectSpeakLines(spec("Nothing foreign here."));
    expect(lines).toEqual([{ text: "Nothing foreign here.", speaker: undefined, delivery: undefined, gender: undefined }]);
  });

  test("a marked line is baked as its runs — each its own clip, in order", () => {
    const lines = collectSpeakLines(spec("The word is [de:ich]."));
    expect(lines.map((l) => [l.text, l.lang])).toEqual([
      ["The word is", undefined],
      ["ich.", "de"],
    ]);
  });

  test("the brackets never reach a clip", () => {
    for (const line of collectSpeakLines(spec("A [french:croissant] and a [german:Brötchen]."))) {
      expect(line.text).not.toMatch(/[[\]]/);
    }
  });
});
