import { describe, expect, test } from "vitest";
import { bandOf, guessBand, pickLine, resolveFeedback, seedOf, type FeedbackSpec } from "../src/feedback/bands";
import { FALLBACK_LINES } from "../src/feedback/lines";
import { castLang } from "../src/render/quiz-words";

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

  test("a single guess with its relative error: good only within 25 % of the truth", () => {
    // 50 against 163 on a 0–400 axis: 28 % of the axis, but 69 % off the truth.
    expect(bandOf({ ok: false, frac: 0.28, tolerance: 0.15, rel: 0.69 })).toBe("poor");
    expect(bandOf({ ok: false, frac: 0.2, tolerance: 0.15, rel: 0.25 })).toBe("good");
    expect(bandOf({ ok: false, frac: 0.2, tolerance: 0.15, rel: 0.26 })).toBe("poor");
    // Within tolerance (as judged) stays perfect whatever the relative error.
    expect(bandOf({ ok: true, frac: 0.1, tolerance: 0.15, rel: 0.6 })).toBe("perfect");
  });

  test("a single right/wrong ask: perfect or none", () => {
    expect(bandOf({ ok: true })).toBe("perfect");
    expect(bandOf({ ok: false })).toBe("none");
  });
});

describe("guessBand", () => {
  test("one number by distance; several by count, in step with the verdict; a market by its check", () => {
    expect(guessBand({ ok: true, within: 1, count: 1, meanFrac: 0.05 }, 0.1, false)).toBe("perfect");
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 0.15 }, 0.1, false)).toBe("good");
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 0.4 }, 0.1, false)).toBe("poor");
    expect(guessBand({ ok: true, within: 1, count: 4, meanFrac: 0.09 }, 0.1, false)).toBe("good");
    expect(guessBand({ ok: false, within: 4, count: 4, meanFrac: 0.11 }, 0.1, false)).toBe("good");
    expect(guessBand({ ok: false, within: 0, count: 4, meanFrac: 0.5 }, 0.1, false)).toBe("none");
    expect(guessBand({ ok: true, within: 0, count: 2, meanFrac: 0.3 }, 0.1, true)).toBe("perfect");
    expect(guessBand({ ok: false, within: 1, count: 2, meanFrac: 0.3 }, 0.1, true)).toBe("poor");
    expect(guessBand({ ok: false, within: 0, count: 2, meanFrac: 0.3 }, 0.1, true)).toBe("none");
  });

  test("one number: perfect as judged, good within 25 % of the truth, 2× tolerance when the truth is 0", () => {
    // The water cast: 50 L against 163 L on 0–400, tolerance 0.15.
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 113 / 400, pct: 69.3 }, 0.15, false)).toBe("poor");
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 40 / 400, pct: 24.5 }, 0.05, false)).toBe("good");
    expect(guessBand({ ok: true, within: 1, count: 1, meanFrac: 0.1, pct: 80 }, 0.15, false)).toBe("perfect");
    // Truth 0: no relative error, so twice the tolerance.
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 0.15, pct: null }, 0.1, false)).toBe("good");
    expect(guessBand({ ok: false, within: 0, count: 1, meanFrac: 0.25, pct: null }, 0.1, false)).toBe("poor");
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
    expect(resolveFeedback(undefined, { poor: "Oops" }).style).toBe("warm");
    expect(resolveFeedback(undefined, { poor: "Oops" }).reward).toBe("auto");
  });

  test("an ask's lines without a style keep the cast's style", () => {
    expect(resolveFeedback("dry", { poor: "x" }).style).toBe("dry");
    expect(resolveFeedback({ style: "plain" }, { poor: "x" }).style).toBe("plain");
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

  test("no repeat within a cast until used up; then the lines come round again, never the one just said", () => {
    const fb: FeedbackSpec = { style: "dry", reward: "auto", lines: { poor: ["one", "two"] } };
    const used = new Set<string>();
    const a = pickLine(fb, "poor", "en", 11, used);
    const b = pickLine(fb, "poor", "en", 11, used);
    expect(new Set([a, b])).toEqual(new Set(["one", "two"]));
    const c = pickLine(fb, "poor", "en", 11, used);
    expect(c).not.toBeNull();
    expect(c).not.toBe(b);
  });

  test("one authored line per band: every ask still gets it, never the English set", () => {
    const fb: FeedbackSpec = { style: "dry", reward: "auto", lines: { poor: ["Only line."] } };
    const used = new Set<string>();
    for (let i = 0; i < 4; i++) expect(pickLine(fb, "poor", "en", 5, used)).toBe("Only line.");
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

describe("feedback in the script format", () => {
  test("the cast's, an ask's and a quiz's feedback survive print → parse", async () => {
    const { parseScriptPages } = await import("../src/spec/script/parse");
    const { printScriptPages } = await import("../src/spec/script/print");
    const spec = {
      title: "T",
      lang: "nb",
      feedback: { style: "dry", poor: ["Godt du ikke er farmasøyt.", "Oppvarming."] },
      elements: [{ id: "t", type: "text", text: "x", x: 1, y: 1 }],
      commands: [
        { ask: { question: "Q?", answer: "4", feedback: "warm" } },
        { quiz: { question: "Q", choices: ["a", "b"], correct: 1, feedback: { style: "dry", perfect: "P" } } },
      ],
    };
    const back = parseScriptPages(printScriptPages({}, [{ spec: spec as never }])).pages[0].spec;
    expect(back.feedback).toEqual(spec.feedback);
    expect(back.commands).toEqual(spec.commands);
  });
});

describe("feedback lines in the subtitle tracks", () => {
  test("the author's lines are among the caption lines to translate", async () => {
    const { captionLines } = await import("../src/llm/subtitles");
    const lines = captionLines({
      lang: "nb",
      feedback: { style: "dry", poor: "Godt du ikke er farmasøyt." },
      elements: [{ id: "t", type: "text", text: "x", x: 1, y: 1 }],
      commands: [{ ask: { question: "Q?", answer: "4", right: "Fire." } }, { ask: { question: "P?", answer: "5", feedback: "plain" } }],
    } as never);
    expect(lines).toContain("Godt du ikke er farmasøyt.");
  });
});

describe("castLang: the language of a cast with no lang", () => {
  test("declared lang wins; else the narration and questions decide; nothing to read: null", () => {
    expect(castLang({ lang: "nn", commands: [{ speak: "The cat is on the mat." }] })).toBe("nn");
    expect(castLang({ commands: [{ speak: "Hvor mange dør hvert år? Det er flere enn du tror." }] })).toBe("nb");
    expect(castLang({ commands: [{ ask: { question: "Hvor mange av dem er det som dør?" } }] })).toBe("nb");
    expect(castLang({ commands: [{ speak: "How many die each year? More than you think." }] })).toBe("en");
    expect(castLang({ commands: [] })).toBeNull();
  });
  test("a Norwegian cast without lang gets no English fallback line", () => {
    const lang = castLang({ commands: [{ speak: "Hvor mange dør hvert år? Det er flere enn du tror." }] });
    expect(pickLine({ style: "dry", reward: "none", lines: {} }, "poor", lang, 3, new Set())).toBeNull();
  });
});
