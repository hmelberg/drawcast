// How a line is SAID versus how it is spelled. The table holds respellings
// arrived at BY EAR against the real voices (Hans, 2026-08-29) — "qualy", not
// "qaly" — and holds only exceptions: the spelled-out acronyms are already
// right, because capitals are the engine's own cue to spell them.

import { describe, expect, test } from "vitest";
import { sayable, SAID_AS } from "../src/render/pronounce";

describe("spoken form", () => {
  test("the measured respellings: QALY is qualy, ICER is iceer", () => {
    expect(sayable("Surgery wins on expected QALYs.")).toBe("Surgery wins on expected qualys.");
    expect(sayable("A QALY is a year of life weighted by how good it is.")).toBe(
      "A qualy is a year of life weighted by how good it is.",
    );
    expect(sayable("The ICER lands at thirty thousand.")).toBe("The iceer lands at thirty thousand.");
  });

  test("the plural rides along, so the table lists base forms only", () => {
    expect(sayable("QALY and QALYs")).toBe("qualy and qualys");
    expect(sayable("two ICERs")).toBe("two iceers");
  });

  test("everything absent keeps its capitals — the default already says those right", () => {
    // Spelling these out is what the engine does with capitals, and it is
    // what they should sound like; an entry here would BREAK them.
    expect(sayable("The UN reported that GDP fell, and DNA was the evidence.")).toBe(
      "The UN reported that GDP fell, and DNA was the evidence.",
    );
    // The SIR model's letters really are spelled out, so it stays out.
    expect(sayable("An SIR model of an epidemic")).toBe("An SIR model of an epidemic");
  });

  test("whole words only — a longer token that merely contains one is left alone", () => {
    expect(sayable("QALYX is a brand.")).toBe("QALYX is a brand.");
    expect(sayable("PRICER")).toBe("PRICER"); // not the ICER we mean
  });

  test("pure, total and idempotent — a respelling never matches itself", () => {
    expect(sayable("")).toBe("");
    const plain = "Nothing here needs saying differently.";
    expect(sayable(plain)).toBe(plain);
    expect(sayable(sayable("QALYs gained"))).toBe("qualys gained");
    expect(sayable("qualy")).toBe("qualy"); // already the spoken form
  });

  test("every entry is a real respelling of an ALL-CAPS written form", () => {
    for (const [written, spoken] of Object.entries(SAID_AS)) {
      expect(written, written).toBe(written.toUpperCase());
      expect(spoken, written).toBe(spoken.toLowerCase());
      expect(spoken, written).not.toBe(written.toLowerCase()); // else it earns no entry
    }
  });

  test("a caller's own table overrides the default", () => {
    expect(sayable("The NHS pays", { NHS: "en aitch ess" })).toBe("The en aitch ess pays");
    expect(sayable("The QALY", { NHS: "en aitch ess" })).toBe("The QALY");
  });
});
