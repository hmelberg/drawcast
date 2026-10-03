// A right quiz answer's affirmation (render/affirm.ts, Hans 2026-10-04):
// varied, never the same twice in a row, a joke now and then only where the
// cast's feedback asks for flavour, streak lines, and the `affirm` hatch.
import { describe, expect, test } from "vitest";
import { AFFIRM, Affirmer, affirmLines, humourChance, parseAffirm, type AffirmMemory, type AffirmMoment } from "../src/render/affirm";
import { resolveFeedback, type FeedbackSpec } from "../src/feedback/bands";
import { FALLBACK_LINES } from "../src/feedback/lines";
import { validateSpec } from "../src/spec/schema";
import { parseScriptPages } from "../src/spec/script/parse";
import { printScriptPages } from "../src/spec/script/print";
import { applyTranslations, translatableStrings } from "../src/spec/i18n";
import type { Spec } from "../src/spec/types";

/** mulberry32: a seeded random source. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fresh = (): AffirmMemory => ({ last: null, joke: false });
const quiz = (n: number) => Array.from({ length: n }, (_, i) => ({ quiz: { question: `Question ${i}?`, choices: ["a", "b"], correct: 1 } }));
/** A middle answer with no streak to speak of: streak 1 after a run of rights (no miss). */
const plainMoment: AffirmMoment = { streak: 1, score: 1, total: 1, last: false };

function affirmer(spec: Record<string, unknown>, seed = 1): Affirmer {
  const a = new Affirmer(seeded(seed), fresh());
  a.configure({ commands: quiz(5), ...spec });
  return a;
}
const step = (feedback?: FeedbackSpec, question = "Which is it?") => ({ question, ...(feedback ? { feedback } : {}) });
const warm: FeedbackSpec = { style: "warm", reward: "auto", lines: {} };
const dry: FeedbackSpec = { style: "dry", reward: "auto", lines: {} };

describe("the default pool", () => {
  test("never the same phrase twice in a row", () => {
    for (const fb of [undefined, warm, dry]) {
      const a = affirmer({});
      let prev: string | null = null;
      for (let i = 0; i < 500; i++) {
        const line = a.say("en", step(fb), plainMoment);
        expect(line).not.toBe(prev);
        prev = line;
      }
    }
  });

  test("varied: a plain cast hears most of the pool, never 'Correct.'", () => {
    const a = affirmer({});
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(a.say("en", step(), plainMoment)!);
    expect(seen.size).toBeGreaterThanOrEqual(10);
    expect(seen.has("Correct.")).toBe(false);
    for (const l of seen) expect([...AFFIRM.en.plain, ...AFFIRM.en.warm]).toContain(l);
  });

  test("no feedback block: no jokes at all (it may be a serious topic)", () => {
    const a = affirmer({});
    for (let i = 0; i < 1000; i++) expect(AFFIRM.en.humour).not.toContain(a.say("en", step(), plainMoment));
  });

  test("warm: about 1 in 5 is a joke; dry with no band line after it: about 1 in 3; never two in a row", () => {
    const rate = (fb: FeedbackSpec, lang: string) => {
      const a = affirmer({}, 7);
      let jokes = 0;
      let prevJoke = false;
      const pool = AFFIRM[lang].humour;
      const N = 6000;
      for (let i = 0; i < N; i++) {
        const joke = pool.includes(a.say(lang, step(fb), plainMoment)!);
        expect(joke && prevJoke).toBe(false);
        prevJoke = joke;
        if (joke) jokes++;
      }
      return jokes / N;
    };
    const w = rate(warm, "en");
    expect(w).toBeGreaterThan(0.15);
    expect(w).toBeLessThan(0.25);
    // A Norwegian dry cast with no lines of its own: no band line follows.
    const d = rate(dry, "nb");
    expect(d).toBeGreaterThan(0.28);
    expect(d).toBeLessThan(0.39);
  });

  test("dry with a band line about to follow: that line is the joke, the affirmation stays plain", () => {
    expect(humourChance(dry, "en")).toBe(0);
    expect(humourChance({ ...dry, lines: { perfect: ["Mistenkelig flink."] } }, "nb")).toBe(0);
    const a = affirmer({});
    for (let i = 0; i < 300; i++) expect(AFFIRM.en.humour).not.toContain(a.say("en", step(dry), plainMoment));
  });

  test("nothing that the band line after it would echo", () => {
    // warm's bundled perfect lines: "Spot on — every one.", "All of it. Nicely done.", "Exactly right."
    const a = affirmer({});
    const echoed = ["Spot on.", "Nicely done.", "Exactly.", "Right."];
    for (let i = 0; i < 500; i++) expect(echoed).not.toContain(a.say("en", step(warm), plainMoment));
    expect(FALLBACK_LINES.warm.perfect).toContain("Exactly right.");
  });

  test("a warm cast leans on the warm phrases", () => {
    const a = affirmer({});
    let warmCount = 0;
    for (let i = 0; i < 2000; i++) if (AFFIRM.nb.warm.includes(a.say("nb", step(warm), plainMoment)!)) warmCount++;
    expect(warmCount / 2000).toBeGreaterThan(0.3);
  });

  test("the cast's language: Norwegian casts hear Norwegian, an unknown language English", () => {
    const a = affirmer({});
    for (let i = 0; i < 100; i++) expect([...AFFIRM.nb.plain, ...AFFIRM.nb.warm]).toContain(a.say("nb", step(), plainMoment));
    for (let i = 0; i < 100; i++) expect([...AFFIRM.en.plain, ...AFFIRM.en.warm]).toContain(a.say("xx", step(), plainMoment));
    // No lang: read off the question.
    for (let i = 0; i < 50; i++) expect([...AFFIRM.nb.plain, ...AFFIRM.nb.warm]).toContain(a.say(null, step(undefined, "Hvilken av disse er størst, tror du?"), plainMoment));
  });

  test("every language: pools filled, phrases short (1–5 words)", () => {
    for (const [code, p] of Object.entries(AFFIRM)) {
      expect(p.plain.length, code).toBeGreaterThanOrEqual(5);
      expect(p.warm.length, code).toBeGreaterThanOrEqual(2);
      const s = p.streak;
      for (const l of [...p.plain, ...p.warm, ...p.humour, s.two, s.three, s.threeOfThree, s.four, s.five, s.roll, s.back, ...s.sweep]) {
        const n = l.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
        expect(n, `${code}: ${l}`).toBeGreaterThanOrEqual(1);
        expect(n, `${code}: ${l}`).toBeLessThanOrEqual(5);
      }
    }
  });

  test("the same seed says the same lines (a replay, a test)", () => {
    const run = () => {
      const a = affirmer({}, 42);
      return Array.from({ length: 30 }, () => a.say("en", step(warm), plainMoment));
    };
    expect(run()).toEqual(run());
  });
});

describe("streak lines", () => {
  const always = () => 0; // every "sometimes" fires; picks take the first fresh phrase
  const a = (n = 5) => {
    const x = new Affirmer(always, fresh());
    x.configure({ commands: quiz(n) });
    return x;
  };

  test("two, three, three for three, four or on a roll", () => {
    expect(a().say("en", step(), { streak: 2, score: 2, total: 2, last: false })).toBe("Two in a row.");
    expect(a().say("en", step(), { streak: 3, score: 3, total: 3, last: false })).toBe("Three for three.");
    expect(a().say("en", step(), { streak: 3, score: 3, total: 4, last: false })).toBe("Three in a row.");
    expect(a().say("en", step(), { streak: 4, score: 4, total: 4, last: false })).toBe("Four in a row.");
    expect(a().say("en", step(), { streak: 8, score: 8, total: 8, last: false })).toBe("On a roll.");
    expect(a().say("nb", step(), { streak: 2, score: 2, total: 2, last: false })).toBe("To på rad.");
  });

  test("the last question, every answer right: a clean sweep", () => {
    expect(AFFIRM.en.streak.sweep).toContain(a().say("en", step(), { streak: 5, score: 5, total: 5, last: true }));
    // Not with a miss along the way.
    expect(AFFIRM.en.streak.sweep).not.toContain(a().say("en", step(), { streak: 2, score: 4, total: 5, last: true }));
  });

  test("right straight after a miss: back on track", () => {
    expect(a().say("en", step(), { streak: 1, score: 2, total: 3, last: false })).toBe("Back on track.");
    expect(a().say("nb", step(), { streak: 1, score: 2, total: 3, last: false })).toBe("Tilbake på sporet.");
  });

  test("only sometimes, and none in a one-question cast", () => {
    expect(a(1).say("en", step(), { streak: 2, score: 2, total: 2, last: false })).not.toBe("Two in a row.");
    const x = affirmer({}, 3);
    let twos = 0;
    for (let i = 0; i < 1000; i++) if (x.say("en", step(), { streak: 2, score: 2, total: 2, last: false }) === "Two in a row.") twos++;
    expect(twos).toBeGreaterThan(200);
    expect(twos).toBeLessThan(500);
  });
});

describe("the affirm hatch", () => {
  test("parse: plain, own list, false; anything else unset", () => {
    expect(parseAffirm("plain")).toBe("plain");
    expect(parseAffirm(false)).toBe(false);
    expect(parseAffirm([" Ja ", "", "Nemlig."])).toEqual(["Ja", "Nemlig."]);
    expect(parseAffirm([])).toBeUndefined();
    expect(parseAffirm("loud")).toBeUndefined();
    expect(parseAffirm(true)).toBeUndefined();
  });

  test("plain: the one word, every time — streaks and all", () => {
    const a = affirmer({ affirm: "plain" });
    expect(a.say("en", step(dry), { streak: 3, score: 3, total: 3, last: true })).toBe("Correct.");
    expect(a.say("nb", step(), plainMoment)).toBe("Riktig.");
  });

  test("own list: only its phrases, never twice in a row", () => {
    const a = affirmer({ affirm: ["Aye.", "Right you are."] });
    let prev: string | null = null;
    for (let i = 0; i < 50; i++) {
      const l = a.say("en", step(warm), { streak: 2, score: 2, total: 2, last: false });
      expect(["Aye.", "Right you are."]).toContain(l);
      expect(l).not.toBe(prev);
      prev = l;
    }
  });

  test("false: silent", () => {
    expect(affirmer({ affirm: false }).say("en", step(), plainMoment)).toBeNull();
  });

  test("schema: the three forms validate, others do not", () => {
    const base = { title: "T", elements: [{ id: "a", type: "text", text: "A", x: 100, y: 100 }], commands: [] };
    for (const affirm of ["plain", ["Yes.", "Aye."], false]) expect(validateSpec({ ...base, affirm }).ok, JSON.stringify(affirm)).toBe(true);
    for (const affirm of ["loud", true, [], 3]) expect(validateSpec({ ...base, affirm }).ok, JSON.stringify(affirm)).toBe(false);
  });

  test(".cast: affirm is a setting that reads and prints back", () => {
    for (const v of ["plain", "false", '["Ja.", "Nemlig."]']) {
      const text = `# Quiz\naffirm: ${v}\n\nHello.\n`;
      const spec = parseScriptPages(text).pages[0].spec as Spec;
      expect(spec.affirm, v).toEqual(v === "plain" ? "plain" : v === "false" ? false : ["Ja.", "Nemlig."]);
      const again = parseScriptPages(printScriptPages({}, [{ spec }])).pages[0].spec as Spec;
      expect(again.affirm).toEqual(spec.affirm);
    }
  });

  test("a translation reaches the cast's own phrases", () => {
    const spec = { title: "T", affirm: ["Yes."], commands: [] } as unknown as Spec;
    expect(translatableStrings(spec).map((t) => t.text)).toContain("Yes.");
    expect(applyTranslations(spec, { "Yes.": "Ja." }).affirm).toEqual(["Ja."]);
  });
});

describe("affirmLines: what a bake records", () => {
  const cast = (extra: Record<string, unknown>, n = 3) => ({ title: "T", commands: quiz(n), ...extra });

  test("no quiz: nothing", () => {
    expect(affirmLines({ commands: [{ speak: "Hi." }] })).toEqual([]);
  });

  test("a plain English cast: plain + warm + streak lines, no jokes", () => {
    const lines = affirmLines(cast({ lang: "en" }));
    for (const l of [...AFFIRM.en.plain, ...AFFIRM.en.warm, "Two in a row.", "Back on track.", "A clean sweep."]) expect(lines).toContain(l);
    for (const l of AFFIRM.en.humour) expect(lines).not.toContain(l);
  });

  test("one question: no streak lines; the cast's language only", () => {
    const lines = affirmLines(cast({ lang: "nb" }, 1));
    expect(lines).not.toContain("To på rad.");
    expect(lines.every((l) => [...AFFIRM.nb.plain, ...AFFIRM.nb.warm].includes(l))).toBe(true);
  });

  test("a warm English cast: its jokes too, not the echoed phrases", () => {
    const lines = affirmLines(cast({ lang: "en", feedback: "warm" }));
    for (const l of AFFIRM.en.humour) expect(lines).toContain(l);
    expect(lines).not.toContain("Exactly.");
  });

  test("hatches: plain is the one word, a list itself, false nothing", () => {
    expect(affirmLines(cast({ lang: "nb", affirm: "plain" }))).toEqual(["Riktig."]);
    expect(affirmLines(cast({ affirm: ["Aye."] }))).toEqual(["Aye."]);
    expect(affirmLines(cast({ affirm: false }))).toEqual([]);
  });

  test("covers every line the player can say for that cast", () => {
    for (const extra of [{ lang: "en" }, { lang: "en", feedback: "warm" }, { lang: "nb", feedback: "dry" }, { lang: "en", feedback: { style: "dry", perfect: "Are you a botanist?" } }]) {
      const spec = cast(extra, 4);
      const baked = new Set(affirmLines(spec));
      const fb = resolveFeedback((extra as { feedback?: unknown }).feedback, undefined);
      const a = new Affirmer(seeded(9), fresh());
      a.configure(spec);
      const moments: AffirmMoment[] = [plainMoment, { streak: 2, score: 2, total: 2, last: false }, { streak: 1, score: 2, total: 3, last: false }, { streak: 3, score: 3, total: 3, last: false }, { streak: 4, score: 4, total: 4, last: true }, { streak: 9, score: 9, total: 9, last: false }];
      for (let i = 0; i < 2000; i++) {
        const l = a.say(extra.lang, step(fb.style === "plain" ? undefined : fb), moments[i % moments.length])!;
        expect(baked.has(l), `${JSON.stringify(extra)}: ${l}`).toBe(true);
      }
    }
  });
});
