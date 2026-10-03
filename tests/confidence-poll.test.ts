// W16 (page-frame spec round 2): the confidence bet on a quiz, and the poll
// that compares an opinion with a study's answers.

import { describe, expect, test } from "vitest";
import { brier, calibBand, calibVars, confidenceBias, confidenceBoxes, confidenceMarks, CONFIDENCE_BUTTON } from "../src/guess/confidence";
import { nearestBucket, pollChoiceMarks, pollChoiceVars, pollPlan, pollScaleVars, sourceTag } from "../src/guess/poll";
import { expandPolls, pollMean } from "../src/spec/poll";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { collectSpeakLines } from "../src/export/video";
import { CAPTION_TOP, CONTENT_TOP, MARGIN, PAGE_W } from "../src/layout/page";
import type { Command, Spec } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

describe("calibration", () => {
  test("Brier: (p − outcome)² averaged", () => {
    expect(brier([{ p: 0.95, ok: true }])).toBeCloseTo(0.0025);
    expect(brier([{ p: 0.95, ok: false }])).toBeCloseTo(0.9025);
    expect(brier([{ p: 0.75, ok: true }, { p: 0.55, ok: false }])).toBeCloseTo((0.0625 + 0.3025) / 2);
    expect(brier([])).toBe(0);
  });

  test("bias is how sure minus how often right", () => {
    expect(confidenceBias([{ p: 0.95, ok: true }, { p: 0.95, ok: false }])).toBeCloseTo(0.45);
    expect(confidenceBias([{ p: 0.55, ok: true }, { p: 0.55, ok: true }])).toBeCloseTo(-0.45);
  });

  test("bands: well within a quarter, a bit over, over, under", () => {
    expect(calibBand([{ p: 0.75, ok: true }, { p: 0.75, ok: true }, { p: 0.75, ok: false }])).toBe("well");
    expect(calibBand([{ p: 0.95, ok: true }, { p: 0.95, ok: true }, { p: 0.95, ok: false }])).toBe("over");
    expect(calibBand([{ p: 0.95, ok: false }, { p: 0.95, ok: true }, { p: 0.95, ok: false }])).toBe("overMuch");
    expect(calibBand([{ p: 0.55, ok: true }, { p: 0.55, ok: true }, { p: 0.55, ok: true }])).toBe("under");
    // The movie's bets (right at Fairly sure): well calibrated.
    expect(calibBand([{ p: 0.75, ok: true }])).toBe("well");
  });

  test("{calib}, {calib.score}, {calib.n} — in English and Norwegian; nothing before a bet", () => {
    expect(calibVars([{ p: 0.75, ok: true }], "en")).toEqual({ calib: "well calibrated", "calib.score": "94", "calib.n": "1" });
    expect(calibVars([{ p: 0.95, ok: false }, { p: 0.95, ok: true }, { p: 0.95, ok: false }], "en").calib).toBe("overconfident");
    expect(calibVars([{ p: 0.95, ok: true }, { p: 0.95, ok: true }, { p: 0.95, ok: false }], "en").calib).toBe("a bit overconfident");
    expect(calibVars([{ p: 0.55, ok: true }, { p: 0.55, ok: true }], "nb").calib).toBe("for forsiktig");
    expect(calibVars([], "en")).toEqual({});
  });
});

describe("the bet's buttons", () => {
  test("three, in a row or a column, inside the content area and clear of the figure", () => {
    const fig = { x: 200, y: 300, w: 600, h: 300 };
    const boxes = confidenceBoxes([fig]);
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      expect(b.w).toBe(CONFIDENCE_BUTTON.w);
      expect(b.x).toBeGreaterThanOrEqual(MARGIN - 1);
      expect(b.x + b.w).toBeLessThanOrEqual(PAGE_W - MARGIN + 1);
      expect(b.y).toBeGreaterThanOrEqual(CAPTION_TOP);
      expect(b.y + b.h).toBeLessThanOrEqual(CONTENT_TOP + 1);
      const apart = b.x + b.w <= fig.x || fig.x + fig.w <= b.x || b.y + b.h <= fig.y || fig.y + fig.h <= b.y;
      expect(apart).toBe(true);
    }
  });

  test("the marks: three boxes and words, the question over them; a bet fills its own", () => {
    const boxes = confidenceBoxes([]);
    const asking = confidenceMarks(boxes, ["50/50", "Fairly sure", "Certain"], "How sure are you?");
    expect(asking.texts.map((t) => t.text)).toEqual(["50/50", "Fairly sure", "Certain", "How sure are you?"]);
    const bet = confidenceMarks(boxes, ["50/50", "Fairly sure", "Certain"], "How sure are you?", 2, { x: 0, y: 0, w: 10, h: 10 });
    expect(bet.texts).toHaveLength(3); // the question goes once they bet
    expect(bet.lines).toHaveLength(4); // the answer's outline + three boxes
    expect(bet.lines[3].fill).not.toBe(bet.lines[1].fill);
  });
});

describe("poll vars and marks", () => {
  test("choices: the share who chose the same, the commonest answer", () => {
    expect(pollChoiceVars("P", ["Half", "Forty", "Less"], [0.5, 0.35, 0.15], 1)).toEqual({ "p.share": "35%", "p.most": "Half", "p.most.share": "50%" });
  });

  test("a scale: the nearest bucket's share, the mean, the commonest value", () => {
    const others = [{ value: 50, share: 0.45 }, { value: 40, share: 0.35 }, { value: 20, share: 0.2 }];
    expect(nearestBucket(others, 44)).toBe(1);
    expect(nearestBucket(others, 45)).toBe(0); // a tie: the one listed first
    const v = pollScaleVars("p", others, 48, (n) => `${n}%`);
    expect(v).toEqual({ "p.share": "45%", "p.most": "50%", "p.most.share": "45%", "p.mean": "40.5%" });
  });

  test("the marks grow a fill per button and write its share; the viewer's is outlined; the study is named", () => {
    const boxes = [{ x: 100, y: 200, w: 200, h: 72 }, { x: 320, y: 200, w: 200, h: 72 }];
    const m = pollChoiceMarks(boxes, [0.7, 0.3], 1, { lang: "en", source: "Güth et al. 1982" });
    expect(m.texts.map((t) => t.text)).toEqual(["70%", "30%", "What people chose (Güth et al. 1982)"]);
    expect(m.lines.filter((l) => l.fill !== undefined)).toHaveLength(2);
    expect(m.lines.some((l) => l.fill === undefined && l.closed)).toBe(true); // the outline
    const half = pollChoiceMarks(boxes, [0.7, 0.3], 1, { lang: "nb" }, 0.5);
    expect(half.texts[0].text).toBe("35%");
    expect(half.texts[2].text).toBe("Hva folk valgte");
  });

  test("the plan's poll: shares per button, the study's name from sources", () => {
    expect(pollPlan({ choices: [{ share: 0.4 }, { share: 0.6 }], source: "g" }, [{ id: "g", authors: "Güth et al.", year: 1982, title: "x" }])).toEqual({ shares: [0.4, 0.6], source: "Güth et al. 1982" });
    expect(sourceTag(undefined)).toBe("");
    expect(pollMean([{ value: 50, share: 0.5 }, { value: 30, share: 0.5 }])).toBe(40);
  });
});

const POLL: Spec = {
  title: "How much would you offer?",
  sources: [{ id: "oost", title: "A meta-analysis of ultimatum games", authors: "Oosterbeek et al.", year: 2004 }],
  elements: [{ id: "q", type: "text", text: "100 kr to share", x: 500, y: 500 }],
  commands: [
    { draw: ["q"], speak: "You get a hundred kroner to share with a stranger." },
    { ask: { question: "How much do you offer?", poll: { choices: [{ text: "Half", share: 0.5 }, { text: "Forty", share: 0.3 }, { text: "Less", share: 0.2 }], source: "oost" }, judge: false, store: "p", right: "You and {p.share} of people chose {p}." } },
    { speak: "Most offered {p.most}." },
  ],
} as Spec;

describe("the poll expands", () => {
  test("choices → wider buttons, drawn; an ask with choose and judge: false; the buttons stay", () => {
    const out = expandPolls(POLL);
    const ids = ["poll_1_btn_1", "poll_1_btn_2", "poll_1_btn_3"];
    expect(out.elements!.filter((e) => ids.includes(e.id))).toHaveLength(3);
    expect(out.elements!.some((e) => e.id === "poll_1_buttons")).toBe(true);
    expect(out.commands![1]).toEqual({ draw: ids, parallel: true });
    expect(out.commands![2].ask).toMatchObject({ choose: ids, judge: false, store: "p", poll: POLL.commands![1].ask!.poll });
    expect(out.commands!.some((c) => c.hide !== undefined)).toBe(false);
  });

  test("on a scale with no value: the people's mean becomes its value (the reveal marks it)", () => {
    const spec = {
      title: "t",
      elements: [{ id: "offer", type: "scale", min: 0, max: 100, unit: "%" }],
      commands: [
        { draw: ["offer"] },
        { ask: { question: "How much?", poll: { on: "offer", others: [{ value: 50, share: 0.6 }, { value: 30, share: 0.4 }] }, store: "p", default: "50" } },
      ],
    } as unknown as Spec;
    const out = expandPolls(spec);
    expect((out.elements![0] as { value?: number }).value).toBe(42);
    expect(out.commands![1].ask).toMatchObject({ on: "offer", judge: false });
  });

  test("validates", () => {
    expect(validateSpec(POLL).errors ?? []).toEqual([]);
  });
});

describe("validation", () => {
  const ask = (poll: unknown, extra: Record<string, unknown> = {}): Spec =>
    ({ ...POLL, commands: [{ ask: { question: "Q?", poll, store: "p", ...extra } }] }) as unknown as Spec;
  const errs = (s: Spec): string => (validateSpec(s).errors ?? []).join("\n");

  test("one form, real shares, a known study, a scale to stand on", () => {
    expect(errs(ask({ choices: [{ text: "A", share: 0.5 }, { text: "B", share: 0.5 }], on: "x" }))).toMatch(/exactly one/);
    expect(errs(ask({ choices: [{ text: "A", share: 0.8 }, { text: "B", share: 0.5 }] }))).toMatch(/more than 1/);
    expect(errs(ask({ choices: [{ text: "A", share: 50 }, { text: "B", share: 0.5 }] }))).toMatch(/fraction|<= 1/);
    expect(errs(ask({ choices: [{ text: "A", share: 0.5 }, { text: "B", share: 0.5 }], source: "nope" }))).toMatch(/not in sources/);
    expect(errs(ask({ on: "q", others: [{ value: 1, share: 0.5 }, { value: 2, share: 0.5 }] }))).toMatch(/scale element/);
    expect(errs(ask({ choices: [{ text: "A", share: 0.5 }, { text: "B", share: 0.5 }] }, { answer: "A" }))).toMatch(/leave out answer/);
    expect(errs(ask({ choices: [{ text: "A", share: 0.5 }, { text: "B", share: 0.5 }] }, { judge: true }))).toMatch(/opinion/);
  });

  test("live: true validates (the plan warns: not yet)", () => {
    const s = ask({ choices: [{ text: "A", share: 0.5 }, { text: "B", share: 0.5 }], live: true });
    expect(errs(s)).toBe("");
    const plan = planCommands(expandSpec(s).commands, ["poll_1_btn_1", "poll_1_btn_2"], {});
    expect(plan.warnings.join("\n")).toMatch(/not built yet/);
  });

  test("confidence: on a quiz; on an ask only with choose and answer; calib is not a store", () => {
    const quiz = { ...POLL, commands: [{ quiz: { question: "Q?", choices: ["a", "b"], correct: 1, confidence: true } }] } as unknown as Spec;
    expect(errs(quiz)).toBe("");
    expect(errs({ ...POLL, commands: [{ quiz: { question: "Q?", choices: ["a", "b"], correct: 1, confidence: true, on_canvas: true } }] } as unknown as Spec)).toBe("");
    expect(errs({ ...POLL, commands: [{ ask: { question: "Q?", answer: "x", confidence: true } }] } as unknown as Spec)).toMatch(/confidence bets on a judged answer/);
    expect(errs({ ...POLL, commands: [{ quiz: { question: "Q?", choices: ["a", "b"], correct: 1, store: "calib" } }] } as unknown as Spec)).toMatch(/reserved/);
  });
});

const QUIZ: Command[] = [
  { quiz: { question: "How long does sunlight take to reach us?", choices: ["8 seconds", "8 minutes", "8 hours"], correct: 2, right: "About eight minutes.", confidence: true, store: "sun" } },
  { quiz: { question: "The largest desert?", choices: ["Sahara", "Antarctica"], correct: 2, right: "Antarctica.", confidence: true } },
  { speak: "Your bets were {calib}: {calib.score} of 100. Sun: {sun.sure}." },
];

function player(commands: Command[], speech: RecordingSpeech) {
  const plan = planCommands(commands, [], {});
  return new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false });
}

describe("the bet in the player", () => {
  test("the plan places the bet's buttons on the quiz step", () => {
    const plan = planCommands(QUIZ, [], {});
    const q = plan.steps.find((s) => s.kind === "quiz");
    expect(q?.kind === "quiz" && q.confidence?.boxes).toHaveLength(3);
  });

  test("a movie bets 'Fairly sure' and is right: well calibrated, 94", async () => {
    const speech = new RecordingSpeech();
    const p = player(QUIZ, speech);
    p.autoAnswers = true;
    await p.play();
    expect(speech.spoken).toContain("Your bets were well calibrated: 94 of 100. Sun: Fairly sure.");
    expect(p.vars.get("_answers.2.sure")).toBe("Fairly sure");
  });

  test("a live viewer: certain and wrong, then certain and right — overconfident; the verdict comes after the bet", async () => {
    const speech = new RecordingSpeech();
    const p = player(QUIZ, speech);
    const picks = [0, 1];
    let q = 0;
    const order: string[] = [];
    p.quizGate = async () => {
      order.push("pick");
      return picks[q++];
    };
    p.confidenceGate = async (_s, bet) => {
      order.push(`bet:${bet.labels.join("|")}`);
      return 2;
    };
    await p.play();
    expect(order).toEqual(["pick", "bet:50/50|Fairly sure|Certain", "pick", "bet:50/50|Fairly sure|Certain"]);
    // Brier: (0.95−0)² and (0.95−1)², mean 0.45125 → 55; bias 0.95 − 0.5 = 0.45 → "a bit overconfident".
    expect(speech.spoken).toContain("Your bets were a bit overconfident: 55 of 100. Sun: Certain.");
  });

  test("a skipped bet is not scored; skipping them all reads the movie's stand-in", async () => {
    const speech = new RecordingSpeech();
    const p = player(QUIZ, speech);
    p.quizGate = async () => 1;
    p.confidenceGate = async () => null;
    await p.play();
    expect(speech.spoken.some((l) => l.startsWith("Your bets were well calibrated: 94"))).toBe(true);
  });

  test("the movie's speak lines read {calib} the same way", () => {
    const lines = collectSpeakLines({ title: "t", commands: QUIZ } as Spec).map((l) => l.text);
    expect(lines).toContain("Your bets were well calibrated: 94 of 100. Sun: Fairly sure.");
  });
});

describe("the poll in the player", () => {
  test("a viewer's pick: {p.share} and {p.most} are set before the line", async () => {
    const spec = expandSpec(POLL);
    const ids = (spec.elements ?? []).map((e) => e.id);
    const text = new Map((spec.elements ?? []).map((e) => [e.id, (e as { text?: string }).text ?? null]));
    const plan = planCommands(spec.commands, ids, { sources: spec.sources, bboxOf: () => ({ x: 0, y: 0, w: 100, h: 50 }), labelOf: (id) => text.get(id) ?? null });
    const speech = new RecordingSpeech();
    const p = new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false });
    p.askGate = async () => "poll_1_btn_2";
    await p.play();
    expect(speech.spoken).toContain("You and 30% of people chose Forty.");
    expect(speech.spoken).toContain("Most offered Half.");
  });

  test("a movie taps the first button; its lines read that share", async () => {
    const spec = expandSpec(POLL);
    const lines = collectSpeakLines(spec).map((l) => l.text);
    expect(lines).toContain("You and 50% of people chose Half.");
  });
});
