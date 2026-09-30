import { describe, expect, test } from "vitest";
import { addCosts, bakeCost, costLabel, courseNarrationProjection, creditBakeCost, TTS_PRICE_PER_MILLION, TYPICAL_LECTURE_CHARS, voiceTier } from "../src/export/tts-cost";
import { sayable } from "../src/render/pronounce";

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

// Registry delivery 3, fix round 1: bakeCost prices for the OWN-key hint
// (Google bills an own key directly, at whatever it actually picks for an
// unnamed voice — neural-class in practice). creditBakeCost prices what
// /tts will ACTUALLY charge against narration credit, which must not
// under-estimate: the server's own unnamed-tier default is chirp (the
// pricier of neural2 and chirp, server_code/credit.py), not neural2 — a
// neural2 estimate here would under-price by ~1.9x, hide the Buy-credit
// row, and let a bake die mid-way on a CreditError the hint never warned
// about.
describe("creditBakeCost — what /tts will actually charge against credit", () => {
  test("an unnamed voice prices at chirp — bakeCost prices the SAME line's gender/speaker decision cheaper, at neural2/wavenet (the ~1.9x under-estimate the fix closes)", () => {
    // Speaker "b" forces a definite gender (effectiveGender never null for a
    // dialogue speaker) regardless of which language gets guessed, so this
    // isolates the UNNAMED-tier question alone: VOICES has no "de" entry, so
    // the declared-German line resolves to a bare {languageCode}, while the
    // very same line — priced by bakeCost's own detectLang sniff, which can
    // only ever answer "en" or "nb", both of which DO have a VOICES entry —
    // always comes out NAMED.
    const line = { text: "This line is dialogue in reply to the previous speaker.", speaker: "b" as const };
    const credit = creditBakeCost([line], undefined, "de");
    const own = bakeCost([line], undefined);
    expect(credit.usd).toBeCloseTo((credit.chars * TTS_PRICE_PER_MILLION.chirp) / 1_000_000, 6);
    // own's tier is whichever of neural2/wavenet detectLang's en/nb guess
    // lands on — both are priced identically (16), so either pins it.
    expect(own.usd).toBeCloseTo((own.chars * TTS_PRICE_PER_MILLION.neural2) / 1_000_000, 6);
    expect(credit.usd / own.usd).toBeCloseTo(TTS_PRICE_PER_MILLION.chirp / TTS_PRICE_PER_MILLION.neural2, 6); // ~1.875
  });

  test("a NAMED voice (the author's pick) prices at its own tier, same as bakeCost — the fix only changes the UNNAMED default", () => {
    const lines = [{ text: "hello world of english text" }];
    const credit = creditBakeCost(lines, { en: "en-US-Chirp3-HD-Charon" }, "en");
    const own = bakeCost(lines, { en: "en-US-Chirp3-HD-Charon" });
    expect(credit.usd).toBeCloseTo((credit.chars * TTS_PRICE_PER_MILLION.chirp) / 1_000_000, 6);
    expect(credit.usd).toBeCloseTo(own.usd, 6);
  });

  test("prices the SAYABLE text — a respelling that adds characters (e.g. QALY -> qualy) is billed, matching what the server receives", () => {
    const raw = "The QALY is high.";
    const credit = creditBakeCost([{ text: raw }], undefined);
    expect(credit.chars).toBe(sayable(raw).length);
    expect(credit.chars).toBeGreaterThan(raw.length);
  });

  test("honors the declared language over a per-line sniff, exactly like the bake's own voiceOf — a declared Norwegian document prices the Wavenet default even on a line the sniff alone reads as English", () => {
    // No letters at all, so detectLang's word-count sniff (its only signal)
    // finds nothing and defaults to "en" — creditBakeCost with NO declared
    // language matches that default exactly (same decision as bakeCost);
    // WITH a declared "nb" it must override it, exactly as runLang does for
    // the real bake's voiceOf.
    const line = { text: "1 2 3 4 5 6 7 8 9 10" };
    const own = bakeCost([line], undefined);
    const creditUndeclared = creditBakeCost([line], undefined, undefined);
    const creditNb = creditBakeCost([line], undefined, "nb");
    expect(creditUndeclared.usd).toBeCloseTo(own.usd, 6); // same decision, undeclared
    expect(creditNb.usd).toBeCloseTo((creditNb.chars * TTS_PRICE_PER_MILLION.wavenet) / 1_000_000, 6);
    expect(creditNb.usd).not.toBeCloseTo(creditUndeclared.usd, 6);
  });

  test("blanks cost nothing, same as bakeCost", () => {
    expect(creditBakeCost([{ text: "  " }], undefined).chars).toBe(0);
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
