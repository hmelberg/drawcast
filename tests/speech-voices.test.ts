import { describe, expect, test } from "vitest";
import { DELIVERY, dbToGain, effectiveGender, speechKey } from "../src/render/delivery";
import { SpeechManager } from "../src/render/speech";

describe("delivery table", () => {
  test("keys are stable and distinct per speaker/delivery/gender", () => {
    expect(speechKey({ text: "Hi" })).toBe("|a||Hi");
    expect(speechKey({ text: "Hi", speaker: "b", delivery: "soft", gender: "male" })).toBe("male|b|soft|Hi");
  });
  test("effectiveGender: null without request; b contrasts a", () => {
    expect(effectiveGender(undefined)).toBeNull();
    expect(effectiveGender({ speaker: "a" })).toBe("female");
    expect(effectiveGender({ speaker: "b" })).toBe("male");
    expect(effectiveGender({ gender: "male", speaker: "b" })).toBe("female");
  });
  test("deltas are gentle", () => {
    for (const d of Object.values(DELIVERY)) {
      expect(d.rate).toBeGreaterThan(0.8);
      expect(d.rate).toBeLessThan(1.2);
    }
    expect(dbToGain(-3)).toBeCloseTo(0.708, 2);
  });
});

function fakeVoice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, voiceURI: name, localService: true, default: false } as SpeechSynthesisVoice;
}

describe("gendered voice pick", () => {
  test("bestVoice(lang, gender) prefers a known-gender name and falls back to the ungendered best", () => {
    const m = new SpeechManager();
    (m as unknown as { synth: unknown }).synth = { getVoices: () => [fakeVoice("Samantha", "en-US"), fakeVoice("Daniel", "en-GB")] };
    expect(m.bestVoice("en", "male")?.name).toBe("Daniel");
    expect(m.bestVoice("en", "female")?.name).toBe("Samantha");
    (m as unknown as { synth: unknown }).synth = { getVoices: () => [fakeVoice("Samantha", "en-US")] };
    expect(m.bestVoice("en", "male")?.name).toBe("Samantha"); // shared-voice fallback
  });
});
