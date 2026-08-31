// What the Voice menu offers.
//
// One control expresses both the language spoken and the voice speaking it,
// because a voice belongs to a language: SpeechManager.speak uses an explicit
// voice in preference to the language-matched one, so offering them separately
// makes "English words in a Norwegian voice" reachable in two clicks. Here it
// is unreachable by construction.
import { describe, expect, test } from "vitest";
import { parseVoiceId, voiceOptions, DEFAULT_VOICE } from "../src/render/voices";

const voice = (name: string, lang: string) => ({ name, lang, voiceURI: `uri:${name}` });

const VOICES = [
  voice("Samantha", "en-US"),
  voice("Daniel", "en-GB"),
  voice("Nora", "nb-NO"),
  voice("Amelie", "fr-FR"),
];

const LANGS = [
  { code: "en", label: "English" },
  { code: "nb", label: "Norwegian" },
];

describe("voiceOptions", () => {
  test("Default comes first and always exists", () => {
    const opts = voiceOptions({ languages: LANGS, voices: VOICES });
    expect(opts[0].id).toBe(DEFAULT_VOICE);
    expect(opts[0].lang).toBeUndefined();
  });

  test("Default names the chain it follows when narration is baked in", () => {
    expect(voiceOptions({ languages: LANGS, voices: VOICES, hasBaked: true })[0].label).toMatch(/published/i);
    expect(voiceOptions({ languages: LANGS, voices: VOICES })[0].label).toMatch(/default/i);
  });

  test("voices are grouped under the language they can speak", () => {
    const opts = voiceOptions({ languages: LANGS, voices: VOICES });
    const byLang = (code: string) => opts.filter((o) => o.lang === code).map((o) => o.label);
    expect(byLang("en")).toEqual(["Samantha", "Daniel"]);
    expect(byLang("nb")).toEqual(["Nora"]);
  });

  test("a voice for a language the drawcast cannot say is not offered", () => {
    // French is installed on the machine, but there is no French text to read.
    const opts = voiceOptions({ languages: LANGS, voices: VOICES });
    expect(opts.some((o) => o.label === "Amelie")).toBe(false);
  });

  test("region variants all count — en-GB and en-AU are both English", () => {
    const opts = voiceOptions({ languages: [{ code: "en", label: "English" }], voices: [voice("Karen", "en-AU"), voice("Daniel", "en-GB")] });
    expect(opts.filter((o) => o.lang === "en")).toHaveLength(2);
  });

  test("a language with no installed voice is reported, not silently missing", () => {
    // The machine simply has no Norwegian voice. Saying so beats an empty
    // group the viewer reads as a bug in the drawcast.
    const opts = voiceOptions({ languages: LANGS, voices: [voice("Samantha", "en-US")] });
    const nb = opts.filter((o) => o.lang === "nb");
    expect(nb).toHaveLength(1);
    expect(nb[0].disabled).toBe(true);
    expect(nb[0].label).toMatch(/no voice/i);
  });

  test("with no voices at all, only Default is offered", () => {
    const opts = voiceOptions({ languages: LANGS, voices: [] });
    expect(opts.filter((o) => !o.disabled)).toHaveLength(1);
  });

  test("a cloud key changes Default's label but is never a separate entry", () => {
    // It stays part of the default chain. Picking it apart from the chain
    // would need its own bypass mode, to answer a question almost nobody has.
    const withKey = voiceOptions({ languages: LANGS, voices: VOICES, hasCloud: true });
    expect(withKey[0].label).toMatch(/cloud/i);
    expect(withKey.filter((o) => o.id !== DEFAULT_VOICE).every((o) => /^(none:|en\||nb\|)/.test(o.id))).toBe(true);
  });

  test("every pickable option is either Default or a real browser voice", () => {
    for (const o of voiceOptions({ languages: LANGS, voices: VOICES, hasCloud: true, hasBaked: true })) {
      expect(o.id === DEFAULT_VOICE || o.disabled === true || parseVoiceId(o.id) !== null).toBe(true);
    }
  });
});

describe("parseVoiceId", () => {
  test("an option round-trips to the language and voice it names", () => {
    const opt = voiceOptions({ languages: LANGS, voices: VOICES }).find((o) => o.label === "Nora")!;
    expect(parseVoiceId(opt.id)).toEqual({ lang: "nb", voiceURI: "uri:Nora" });
  });

  test("Default parses to nothing — it means follow the chain", () => {
    expect(parseVoiceId(DEFAULT_VOICE)).toBeNull();
    expect(parseVoiceId("")).toBeNull();
  });

  test("a voiceURI containing the separator survives", () => {
    // Chrome's voiceURIs are URLs; a naive split on the separator would cut
    // one in half and select a voice that does not exist.
    const weird = [{ name: "Odd", lang: "en-US", voiceURI: "urn:moz-tts:sapi:Microsoft|David" }];
    const opt = voiceOptions({ languages: LANGS, voices: weird }).find((o) => o.label === "Odd")!;
    expect(parseVoiceId(opt.id)).toEqual({ lang: "en", voiceURI: "urn:moz-tts:sapi:Microsoft|David" });
  });

  test("a stale id from another machine parses but selects nothing installed", () => {
    expect(parseVoiceId("nb|uri:GoneForever")).toEqual({ lang: "nb", voiceURI: "uri:GoneForever" });
  });
});
