import { describe, expect, test } from "vitest";
import { IDLE_MAX_MS, INK_AFTER_VOICE_MAX_MS, INTRO_IDLE_MAX_MS, OVERLONG_BEAT_MS, lengthBand, pacingReport, timeBeats } from "../src/lint/pacing-report";
import { lineMs } from "../src/render/cue";
import type { PlanStep } from "../src/render/plan";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const speak = (text: string, extra: Partial<Extract<PlanStep, { kind: "speak" }>> = {}): PlanStep => ({ kind: "speak", text, blocking: true, ...extra });
const draw = (narration?: string, extra: Partial<PlanStep> = {}): PlanStep => ({ kind: "draw", ids: ["a"], parallel: false, ...(narration ? { narration } : {}), ...extra }) as PlanStep;
const runs = (ms: Record<number, number>) => (i: number) => ms[i] ?? 0;

describe("pacing report — the player's timing, read off the plan", () => {
  test("a narrated draw lasts the longer of its line and its ink; speak-only lines add up", () => {
    const line = words(17); // 6 s at 170 wpm
    const { beats, totalMs } = timeBeats([draw(line), speak(words(17))], runs({ 0: 2000 }));
    expect(beats[0]).toMatchObject({ at: 1, start: 0, end: lineMs(line, undefined), actionMs: 2000, active: [[0, 2000]] });
    expect(beats[1].start).toBeCloseTo(6000);
    expect(totalMs).toBeCloseTo(12000);
  });

  test("two speak-only lines after a short draw are an idle stretch naming each beat", () => {
    const steps = [draw(words(6)), speak(words(12)), speak(words(12)), draw(words(6))];
    const r = pacingReport(steps, runs({ 0: 1500, 3: 1500 }));
    const idle = r.problems.filter((p) => p.kind === "idle");
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({ from: 1, to: 3 });
    expect(idle[0].ms).toBeGreaterThan(IDLE_MAX_MS);
    expect(idle[0].message).toMatch(/^@1–@3 idle \d+\.\d s: nothing new on the canvas \(@1 line .* draw; @2 speak-only; @3 speak-only\)$/);
  });

  test("a beat that keeps things moving is not idle, however long the lines", () => {
    const steps = Array.from({ length: 6 }, () => draw(words(14)));
    const r = pacingReport(steps, runs({ 0: 3500, 1: 3500, 2: 3500, 3: 3500, 4: 3500, 5: 3500 }));
    expect(r.problems).toEqual([]);
    expect(r.lines[1]).toMatch(/no pacing flags/);
  });

  test("a gesture held to its sentence moves for the whole line", () => {
    const hl: PlanStep = { kind: "highlight", ids: ["a"], boxes: {}, effect: "underline", seconds: 1.5, untilNarrationEnd: true, narration: words(30) };
    expect(pacingReport([draw(words(4)), hl], runs({ 0: 1000, 1: 1500 })).problems).toEqual([]);
    // …but the same highlight with a fixed 1.5 s under a 10.6 s line leaves the canvas still
    const fixed = { ...hl, untilNarrationEnd: undefined } as PlanStep;
    expect(pacingReport([draw(words(4)), fixed], runs({ 0: 1000, 1: 1500 })).problems.map((p) => p.kind)).toEqual(["idle"]);
  });

  test("in a book, a block written or marked on the text pane is activity for its line (2026-10-05)", () => {
    const write: PlanStep = { kind: "text", op: { op: "write", id: "a", text: "Elastic: **big** response", temp: false }, narration: words(30) };
    expect(pacingReport([draw(words(4)), write], runs({ 0: 1000 })).problems).toEqual([]);
    const mark: PlanStep = { kind: "text", op: { op: "mark", ids: ["a"], effect: "light", keep: false }, narration: words(30) };
    expect(pacingReport([draw(words(4)), write, mark], runs({ 0: 1000 })).problems).toEqual([]);
    // a view switch or a clear of the pane is not new ink
    const view: PlanStep = { kind: "text", op: { op: "view", view: "both" }, narration: words(30) };
    expect(pacingReport([draw(words(4)), view], runs({ 0: 1000 })).problems.map((p) => p.kind)).toEqual(["idle"]);
  });

  test("a long pause is idle; a short one between moving beats is not", () => {
    const long = pacingReport([draw(words(6)), { kind: "pause", seconds: 7 }, draw(words(6))], runs({ 0: 2000, 2: 2000 }));
    expect(long.problems[0].message).toMatch(/pause 7\.0 s/);
    expect(pacingReport([draw(words(6)), { kind: "pause", seconds: 0.5 }, draw(words(6))], runs({ 0: 2000, 2: 2000 })).problems).toEqual([]);
  });

  test("speech before the first ink counts, and so does a closing line over a finished figure", () => {
    const r = pacingReport([speak(words(12)), speak(words(12)), draw(words(6)), speak(words(20))], runs({ 2: 2000 }));
    expect(r.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/^@1–@2 idle 8\.5 s before the first ink \(the opening allows 2\.0 s\): nothing new on the canvas \(@1 speak-only; @2 speak-only\)$/),
      expect.stringMatching(/^@3–@4 idle .* to the end/),
    ]);
  });

  test("an interactive beat stops the clock and splits the idle count", () => {
    const steps: PlanStep[] = [draw(words(6)), speak(words(10)), { kind: "wait" }, speak(words(10)), draw(words(6))];
    const r = pacingReport(steps, runs({ 0: 2000, 4: 2000 }));
    expect(r.interactive).toEqual([3]);
    expect(r.problems).toEqual([]);
    expect(r.lines[0]).toMatch(/clock stops at @3/);
  });

  test("silent ink: an animation running well past its sentence", () => {
    const anim: PlanStep = { kind: "animate", targets: {}, starts: {}, seconds: 6, narration: words(6) };
    const r = pacingReport([anim], runs({ 0: 6000 }));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ kind: "ink-after-voice", from: 1 });
    expect(r.problems[0].ms).toBeGreaterThan(INK_AFTER_VOICE_MAX_MS);
    expect(r.problems[0].message).toMatch(/^@1 silent ink 3\.9 s: the animate runs on after its sentence ends \(line 2\.1 s, animate 6\.0 s\)$/);
    // a draw that finishes with its line is fine
    expect(pacingReport([draw(words(10))], runs({ 0: 3500 })).problems).toEqual([]);
  });

  test("a cued action starts inside its line (cueStartMs), which can push the ink past the voice", () => {
    const line = words(17); // 6 s
    const cued = draw(line, { cue: 0.8 });
    const { beats } = timeBeats([cued], runs({ 0: 3500 }));
    expect(beats[0].active[0][0]).toBeCloseTo(lineMs(line, undefined) * 0.8);
    const r = pacingReport([cued], runs({ 0: 3500 }));
    // Alone, the cued draw is also the opening: 4.8 s of talk before any ink.
    expect(r.problems.map((p) => p.kind)).toEqual(["idle", "ink-after-voice"]);
    expect(r.problems[1].message).toMatch(/cued at 4\.8 s/);
  });

  test("overlong beat: a line at the estimator's cap", () => {
    const r = pacingReport([draw(words(50))], runs({ 0: 3500 }));
    const over = r.problems.find((p) => p.kind === "overlong")!;
    expect(over.ms).toBeGreaterThanOrEqual(OVERLONG_BEAT_MS);
    expect(over.message).toMatch(/^@1 overlong beat 15\.0 s \(line 15\.0 s, draw 3\.5 s\)$/);
  });

  test("a non-blocking speak runs under the next gesture; a draw waits for it", () => {
    const pt: PlanStep = { kind: "point", x: 0, y: 0, gesture: "tap", seconds: 2 };
    const { beats } = timeBeats([speak(words(17), { blocking: false }), pt, draw()], runs({ 1: 2000, 2: 1000 }));
    expect(beats[1].start).toBe(0);
    expect(beats[2].start).toBeCloseTo(6000);
  });

  test("labels, ifs and a command's parallel marks take no time of their own", () => {
    const mark = (parallel?: true): PlanStep => ({ kind: "mark", owner: "p", mark: "light", frame: { x: 0, y: 0, w: 1, h: 1 }, stops: [], seconds: 2, ...(parallel ? { parallel } : {}) }) as PlanStep;
    const { totalMs } = timeBeats([{ kind: "label", name: "x" }, mark(), mark(true)], runs({ 1: 2000, 2: 2000 }));
    expect(totalMs).toBe(2000);
  });

  test("totals: running time, line count and the length band from the brief controls", () => {
    const steps = Array.from({ length: 15 }, () => draw(words(12)));
    const r = pacingReport(steps, () => 2000);
    expect(r.spokenLines).toBe(15);
    expect(r.lengthBand).toBe("standard (14–20)");
    expect(r.lines[0]).toMatch(/^pacing \(soft limits\): ≈ 1:04 \(64 s at the reading estimate\) · 15 spoken lines — standard \(14–20\)$/);
  });

  test("length bands", () => {
    expect(lengthBand(6)).toBe("very short (5–7)");
    expect(lengthBand(13)).toBe("between short (8–12) and standard (14–20)");
    expect(lengthBand(21)).toBe("between standard (14–20) and long (22–30)");
    expect(lengthBand(3)).toBe("under very short (5–7)");
    expect(lengthBand(55)).toBe("over very long (30–40)");
  });

  test("soft limits: 5 s in the body; the opening is stricter — little talk before the first ink", () => {
    expect(IDLE_MAX_MS).toBe(5000);
    expect(INTRO_IDLE_MAX_MS).toBeLessThan(IDLE_MAX_MS);
    // ~3.5 s of speech before anything is drawn: fine mid-cast, flagged in the opening
    const opening = pacingReport([speak(words(10)), draw(words(6)), draw(words(6))], runs({ 1: 2000, 2: 2000 }));
    expect(opening.problems.map((p) => p.message)).toEqual([expect.stringMatching(/^@1 idle 3\.5 s before the first ink \(the opening allows 2\.0 s\)/)]);
    const body = pacingReport([draw(words(6)), speak(words(10)), draw(words(6))], runs({ 0: 2000, 2: 2000 }));
    expect(body.problems).toEqual([]);
    // the header says the limits are soft
    expect(body.lines[0]).toMatch(/soft limits/);
  });
});
