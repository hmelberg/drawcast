import { describe, expect, test } from "vitest";
import { addCosts, bakeCost, costLabel, courseNarrationProjection, TTS_PRICE_PER_MILLION, TYPICAL_LECTURE_CHARS, voiceTier } from "../src/export/tts-cost";

// Hans 2026-09-02: "an estimate for the narration costs (especially for
// courses) before we press generate". The estimate prices the exact voices
// narrationVoice() would buy — Studio for the undeclared English narrator.

describe("voiceTier", () => {
  test("names map to Google's price families; unnamed fallbacks price as neural", () => {
    expect(voiceTier("en-US-Studio-Q")).toBe("studio");
    expect(voiceTier("en-US-Chirp3-HD-Charon")).toBe("chirp");
    expect(voiceTier("en-US-Neural2-F")).toBe("neural2");
    expect(voiceTier("nb-NO-Wavenet-E")).toBe("wavenet");
    expect(voiceTier(undefined)).toBe("neural2");
  });
});

describe("bakeCost", () => {
  test("undeclared English narration prices at the Studio default", () => {
    const c = bakeCost([{ text: "x".repeat(1000) + " hello there this is english" }], undefined);
    expect(c.usd).toBeCloseTo((c.chars * TTS_PRICE_PER_MILLION.studio) / 1_000_000, 6);
  });

  test("a declared gender prices at its neural table voice, and blanks cost nothing", () => {
    const c = bakeCost([{ text: "a".repeat(1000) + " plain english words", gender: "female" }, { text: "  " }], undefined);
    expect(c.usd).toBeCloseTo((c.chars * TTS_PRICE_PER_MILLION.neural2) / 1_000_000, 6);
  });

  test("the author's pick reprices the lines it applies to", () => {
    const c = bakeCost([{ text: "hello world of english text" }], { en: "en-US-Chirp3-HD-Charon" });
    expect(c.usd).toBeCloseTo((c.chars * TTS_PRICE_PER_MILLION.chirp) / 1_000_000, 6);
  });
});

describe("labels and projections", () => {
  test("costLabel is compact and honest about tiny sums", () => {
    expect(costLabel({ chars: 0, usd: 0 })).toBe("");
    expect(costLabel({ chars: 500, usd: 0.001 })).toBe("500 characters ≈ <$0.01");
    expect(costLabel({ chars: 229_000, usd: 36.64 })).toBe("229k characters ≈ $36.64");
  });

  test("a course projects from its own generated lectures", () => {
    const proj = courseNarrationProjection([{ chars: 10_000, usd: 1.6 }, { chars: 14_000, usd: 2.24 }], 20, undefined);
    expect(proj.chars).toBe(240_000); // avg 12k × 20
    expect(proj.usd).toBeCloseTo(38.4, 3);
  });

  test("with nothing generated yet, a measured typical lecture stands in", () => {
    const proj = courseNarrationProjection([], 20, undefined);
    expect(proj.chars).toBe(TYPICAL_LECTURE_CHARS * 20);
    expect(proj.usd).toBeGreaterThan(30); // Studio-priced English
  });

  test("addCosts sums", () => {
    expect(addCosts([{ chars: 1, usd: 0.1 }, { chars: 2, usd: 0.2 }])).toEqual({ chars: 3, usd: 0.30000000000000004 });
  });
});
