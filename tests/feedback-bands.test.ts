import { describe, expect, test } from "vitest";
import { bandOf, pickLine, resolveFeedback, seedOf, type FeedbackSpec } from "../src/feedback/bands";
import { FALLBACK_LINES } from "../src/feedback/lines";

describe("bandOf", () => {
  test("counted tasks: all, two thirds, some, none", () => {
    expect(bandOf({ ok: true, within: 4, count: 4 })).toBe("perfect");
    expect(bandOf({ ok: false, within: 3, count: 4 })).toBe("good");
    expect(bandOf({ ok: false, within: 2, count: 3 })).toBe("good");
    expect(bandOf({ ok: false, within: 1, count: 4 })).toBe("poor");
    expect(bandOf({ ok: false, within: 0, count: 4 })).toBe("none");
  });

  test("a single guess: within tolerance, within twice, else poor", () => {
    expect(bandOf({ ok: true, frac: 0.05, tolerance: 0.1 })).toBe("perfect");
    expect(bandOf({ ok: false, frac: 0.15, tolerance: 0.1 })).toBe("good");
    expect(bandOf({ ok: false, frac: 0.2, tolerance: 0.1 })).toBe("good");
    expect(bandOf({ ok: false, frac: 0.5, tolerance: 0.1 })).toBe("poor");
  });

  test("a single right/wrong ask: perfect or none", () => {
    expect(bandOf({ ok: true })).toBe("perfect");
    expect(bandOf({ ok: false })).toBe("none");
  });
});

describe("resolveFeedback", () => {
  test("default is plain, with no reward", () => {
    expect(resolveFeedback(undefined, undefined)).toEqual({ style: "plain", reward: "none", lines: {} });
  });

  test("a cast-level style applies; reward auto when not plain", () => {
    expect(resolveFeedback("dry", undefined)).toEqual({ style: "dry", reward: "auto", lines: {} });
  });

  test("the ask's style wins; the ask's lines win band by band over the cast's", () => {
    const fb = resolveFeedback(
      { style: "warm", perfect: "Cast perfect", poor: ["Cast poor 1", "Cast poor 2"] },
      { style: "dry", perfect: "Ask perfect", reward: "confetti" },
    );
    expect(fb.style).toBe("dry");
    expect(fb.reward).toBe("confetti");
    expect(fb.lines.perfect).toEqual(["Ask perfect"]);
    expect(fb.lines.poor).toEqual(["Cast poor 1", "Cast poor 2"]);
  });

  test("an ask's plain silences a cast's style", () => {
    expect(resolveFeedback({ style: "dry", poor: "x" }, "plain").style).toBe("plain");
  });

  test("an object with lines but no style asks for more than plain", () => {
    expect(resolveFeedback(undefined, { poor: "Oops" }).style).not.toBe("plain");
  });
});

describe("pickLine", () => {
  const dry: FeedbackSpec = { style: "dry", reward: "auto", lines: {} };

  test("plain never adds a line", () => {
    expect(pickLine({ style: "plain", reward: "none", lines: { perfect: ["x"] } }, "perfect", "en", 1, new Set())).toBeNull();
  });

  test("the author's own lines first", () => {
    const fb: FeedbackSpec = { style: "dry", reward: "auto", lines: { poor: ["Good thing you're not a pharmacist."] } };
    expect(pickLine(fb, "poor", "nb", 7, new Set())).toBe("Good thing you're not a pharmacist.");
  });

  test("falls back to the English set for an English cast (or no lang)", () => {
    const a = pickLine(dry, "none", "en", 3, new Set());
    expect(FALLBACK_LINES.dry.none).toContain(a);
    const b = pickLine(dry, "none", undefined, 3, new Set());
    expect(FALLBACK_LINES.dry.none).toContain(b);
    const c = pickLine({ ...dry, style: "warm" }, "good", "en-GB", 3, new Set());
    expect(FALLBACK_LINES.warm.good).toContain(c);
  });

  test("a Norwegian cast without its own lines gets no line", () => {
    expect(pickLine(dry, "poor", "nb", 3, new Set())).toBeNull();
    expect(pickLine(dry, "poor", "no", 3, new Set())).toBeNull();
  });

  test("no repeat within a cast; null when the band's lines are used up", () => {
    const fb: FeedbackSpec = { style: "dry", reward: "auto", lines: { poor: ["one", "two"] } };
    const used = new Set<string>();
    const a = pickLine(fb, "poor", "en", 11, used);
    const b = pickLine(fb, "poor", "en", 11, used);
    expect(new Set([a, b])).toEqual(new Set(["one", "two"]));
    expect(pickLine(fb, "poor", "en", 11, used)).toBeNull();
  });

  test("the same seed picks the same lines (a replay is the same)", () => {
    const run = (): (string | null)[] => {
      const used = new Set<string>();
      return [pickLine(dry, "poor", "en", 42, used), pickLine(dry, "poor", "en", 42, used)];
    };
    expect(run()).toEqual(run());
    expect(seedOf("abc")).toBe(seedOf("abc"));
    expect(seedOf("abc")).not.toBe(seedOf("abd"));
  });

  test("the fallback set is generic (no {role})", () => {
    for (const style of ["warm", "dry"] as const) {
      for (const lines of Object.values(FALLBACK_LINES[style])) {
        expect(lines.length).toBeGreaterThan(1);
        for (const l of lines) expect(l).not.toMatch(/\{/);
      }
    }
  });
});

describe("feedback in the schema", () => {
  test("the cast, an ask and a quiz may carry feedback; a wrong style is refused", async () => {
    const { validateSpec } = await import("../src/spec/schema");
    const ok = validateSpec({
      feedback: "dry",
      elements: [{ id: "t", type: "text", text: "x", x: 100, y: 100 }],
      commands: [
        { ask: { question: "Q?", answer: "4", feedback: { style: "dry", perfect: "Pharmacist?", poor: ["a", "b"] } } },
        { quiz: { question: "Q?", choices: ["a", "b"], correct: 1, feedback: "warm" } },
      ],
    });
    expect(ok.ok).toBe(true);
    const bad = validateSpec({ feedback: "snarky", elements: [{ id: "t", type: "text", text: "x", x: 100, y: 100 }], commands: [] });
    expect(bad.ok).toBe(false);
  });
});
