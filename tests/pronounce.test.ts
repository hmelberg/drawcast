// How a line is SAID versus how it is spelled. The rule is one-directional:
// an acronym said as a word gets lowercased for the engine, everything else
// is left exactly as written — which is already correct for the spelled kind.

import { describe, expect, test } from "vitest";
import { sayable, SAID_AS_WORD } from "../src/render/pronounce";

describe("spoken form", () => {
  test("word-like acronyms are lowercased; spelled-out ones are untouched", () => {
    expect(sayable("Surgery wins on expected QALYs.")).toBe("Surgery wins on expected qalys.");
    expect(sayable("The ICER lands at thirty thousand.")).toBe("The icer lands at thirty thousand.");
    // The default is ALREADY right for these — capitals are the engine's own
    // cue to spell them, so marking them would break what works.
    expect(sayable("The UN reported that GDP fell, and DNA was the evidence.")).toBe(
      "The UN reported that GDP fell, and DNA was the evidence.",
    );
  });

  test("whole words only — a longer token that merely starts the same is left alone", () => {
    expect(sayable("QALYX is a brand.")).toBe("QALYX is a brand.");
    expect(sayable("PRICER")).toBe("PRICER"); // not the ICER we mean
    expect(sayable("qaly")).toBe("qaly"); // already spoken form, unchanged
  });

  test("the plural rides along, since the table lists base forms", () => {
    expect(sayable("QALY and QALYs")).toBe("qaly and qalys");
    expect(sayable("two ICERs")).toBe("two icers");
  });

  test("pure and total: empty text, no matches, and repeated calls agree", () => {
    expect(sayable("")).toBe("");
    const line = "Nothing here needs saying differently.";
    expect(sayable(line)).toBe(line);
    expect(sayable(sayable("QALYs gained"))).toBe(sayable("QALYs gained")); // idempotent
  });

  test("the table itself is written in capitals, which is what the rule reads", () => {
    for (const w of SAID_AS_WORD) expect(w, w).toBe(w.toUpperCase());
  });

  test("a caller's own table overrides the default", () => {
    expect(sayable("The NHS pays", ["NHS"])).toBe("The nhs pays");
    expect(sayable("The QALY", ["NHS"])).toBe("The QALY"); // not in the given table
  });
});
