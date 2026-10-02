// The account bar (spec 2026-10-03-looks-feedback-account §5): in a budget
// question each bar moves on its own; a "Left" bar beside the plot shows
// budget − sum (red, hanging below the baseline, when overspent); Answer
// waits until it balances. The movie glides to the default split and ends
// balanced, never waiting.

import { describe, expect, test } from "vitest";
import * as handles from "../src/guess/handles";
import { accountOf, balancedSplit, budgetBalanced, budgetOf, formatterFor, nudge, type GuessHandle, type GuessSetup } from "../src/guess/handles";
import { ACCOUNT_RED, accountMarks, GUESS_COLOR } from "../src/guess/marks";
import { Player, type AnswerEvent, type GuessRuntime, type GuessSession, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { GuessMarks } from "../src/guess/marks";
import type { Command, Spec } from "../src/spec/types";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { guessParts, guessSetup, startValues } from "../src/guess/handles";
import { CANVAS } from "../src/layout/canvas";
import examples from "../src/examples.json";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

/** Bar k of a 0–100 chart: centres 100, 200, 300 …, 1 logical unit per unit of value, baseline at y 50. */
const bar = (k: number, truth: number): GuessHandle => ({
  part: `bar_${k + 1}`,
  shows: [`bar_${k + 1}`],
  kind: "height",
  truth: [truth],
  min: 0,
  max: 100,
  step: 1,
  label: `B${k + 1}`,
  format: formatterFor(1),
  unit: "",
  paths: [`values.${k}`],
  cx: 100 * (k + 1),
  halfW: 30,
  toLogical: ([x, y]) => [x, 50 + y],
  toDomain: ([x, y]) => [x, y - 50],
});
const bars = (...truth: number[]): GuessHandle[] => truth.map((t, k) => bar(k, t));

describe("the account", () => {
  test("is budget − sum", () => {
    expect(accountOf([[40], [20], [15]], 100)).toBe(25);
    expect(accountOf([[60], [50]], 100)).toBe(-10);
    expect(accountOf([[33.3], [33.3], [33.4]], 100)).toBe(0);
  });

  test("a budget needs two or more bars", () => {
    expect(budgetOf(bars(1, 2, 3), 100)).toBe(100);
    expect(budgetOf(bars(1), 100)).toBeNull();
    expect(budgetOf(bars(1, 2), undefined)).toBeNull();
  });

  test("balanced within half a step", () => {
    const hs = bars(1, 2);
    expect(budgetBalanced(hs, [[50], [50]], 100)).toBe(true);
    expect(budgetBalanced(hs, [[50], [49.6]], 100)).toBe(true);
    expect(budgetBalanced(hs, [[50], [49]], 100)).toBe(false);
    expect(budgetBalanced(hs, [[50], [51]], 100)).toBe(false);
  });

  test("moving one bar leaves the others unchanged (no rebalancing)", () => {
    expect((handles as Record<string, unknown>).withBudget).toBeUndefined();
    const hs = bars(1, 2, 3);
    const values = [[30], [30], [40]];
    values[0] = nudge(hs[0], values[0], 0, 1);
    expect(values).toEqual([[35], [30], [40]]);
    expect(accountOf(values, 100)).toBe(-5);
  });

  test("the movie's split balances: a default that does not add up is scaled to the budget", () => {
    expect(balancedSplit([[40], [20], [15], [25]], 100)).toEqual([[40], [20], [15], [25]]);
    expect(balancedSplit([[40], [20], [20]], 100)).toEqual([[50], [25], [25]]);
    expect(accountOf(balancedSplit([[1], [1], [1]], 100), 100)).toBe(0);
    expect(balancedSplit([[0], [0]], 10)).toEqual([[5], [5]]);
  });

  test("a bar dragged, or a number typed, past the budget: the account goes red", () => {
    const hs = bars(1, 2);
    const values = [[100], [30]]; // the most a bar may be, past what is left
    expect(accountOf(values, 100)).toBe(-30);
    expect(budgetBalanced(hs, values, 100)).toBe(false);
    expect(accountMarks(hs, values, 100).color).toBe(ACCOUNT_RED);
  });
});

describe("the account bar mark", () => {
  const ys = (m: GuessMarks): number[] => m.lines.flatMap((l) => l.pts.map((p) => p[1]));
  const xs = (m: GuessMarks): number[] => m.lines.flatMap((l) => l.pts.map((p) => p[0]));

  test("stands right of the plot, on the same scale, labelled Left, with its number", () => {
    const hs = bars(10, 20, 30);
    const m = accountMarks(hs, [[20], [20], [20]], 100);
    expect(m.color).toBe(GUESS_COLOR);
    expect(Math.min(...xs(m))).toBeGreaterThan(300 + 30);
    // 40 left: from the baseline (50) up to 90.
    expect(Math.min(...ys(m))).toBeCloseTo(50);
    expect(Math.max(...ys(m))).toBeCloseTo(90);
    expect(m.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Left", "40"]));
  });

  test("negative: hangs below the baseline, red, with its number", () => {
    const hs = bars(10, 20);
    const m = accountMarks(hs, [[70], [50]], 100, "Kvar");
    expect(m.color).toBe(ACCOUNT_RED);
    expect(ACCOUNT_RED).toBe("#b3412e");
    expect(Math.min(...ys(m))).toBeCloseTo(30);
    expect(Math.max(...ys(m))).toBeCloseTo(50);
    expect(m.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["Kvar", "−20"]));
  });

  test("a whole number reads as the dock says it: 22, not 22.0", () => {
    // A 0.1 step formats 22 as "22.0"; the dock strips the ".0", so the bar does too.
    const fine = (k: number, t: number): GuessHandle => ({ ...bar(k, t), step: 0.1, format: formatterFor(0.1) });
    const m = accountMarks([fine(0, 1), fine(1, 2)], [[40], [38]], 100);
    expect(m.texts.map((t) => t.text)).toContain("22");
    expect(m.texts.map((t) => t.text)).not.toContain("22.0");
    const over = accountMarks([fine(0, 1), fine(1, 2)], [[60], [44.8]], 100);
    expect(over.texts.map((t) => t.text)).toContain("−4.8");
  });

  test("balanced: the number is 0, in the guess colour", () => {
    const m = accountMarks(bars(1, 2), [[50], [50]], 100);
    expect(m.color).toBe(GUESS_COLOR);
    expect(m.texts.map((t) => t.text)).toContain("0");
  });
});

describe("the gap's number at the reveal", () => {
  test("a guess a little above the truth: the number clears the bar's value label (centred 13 over the true top)", async () => {
    const { guessMarks } = await import("../src/guess/marks");
    for (const g of [8, 12, 20, 40]) {
      const m = guessMarks([bar(0, 3)], [[g]], 1);
      const t = m.texts[0];
      const truthTop = 50 + 3;
      // 20-unit type centred on its point; the value label is 15-unit type centred at truthTop + 13.
      expect(t.at[1] - 10).toBeGreaterThanOrEqual(truthTop + 13 + 7.5 + 2);
    }
  });
});

// —— the player ——

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

function makePlayer(commands: Command[]) {
  const ids = ["axes", "bar_1", "bar_2", "bar_3"];
  const plan = planCommands(commands, ids, {
    animateBase: { values: [61, 18, 21] },
    guessParts: () => ({ parts: ["bar_1", "bar_2", "bar_3"], shows: ["bar_1", "bar_2", "bar_3"] }),
  });
  const speech = new CapturingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
  const rp: Reprojector = { frame: () => {}, commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (): GuessSetup => ({ handles: bars(61, 18, 21), pin: {}, warnings: [] }),
    patch: (_s, values) => ({ params: Object.fromEntries(values.map((r, k) => [`values.${k}`, r[0]])) }),
  };
  player.guess = runtime;
  const marks: { owner: string; m: GuessMarks | null }[] = [];
  const setGuessMarks = (owner: string, m: GuessMarks | null): void => void marks.push({ owner, m });
  // Every other effect is a no-op.
  (player as unknown as { effects: unknown }).effects = new Proxy({}, { get: (_t, k) => (k === "setGuessMarks" ? setGuessMarks : () => {}) });
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events, speech, marks };
}

const ask = (extra: Record<string, unknown> = {}): Command =>
  ({ ask: { question: "How would you split it?", on: "all", budget: 100, judge: false, store: "a", right: "You gave most to {a.biggest}.", ...extra } }) as Command;

describe("a budget ask in the player", () => {
  test("live: the session carries the account; the bars start low, unbalanced", async () => {
    const { player, marks } = makePlayer([ask({ account_label: "Igjen" })]);
    let session: GuessSession | null = null;
    player.askGate = async (_s, step) => {
      session = (step as unknown as { guess: GuessSession }).guess;
      return "50,30,20";
    };
    await player.play();
    expect(session!.account).toEqual({ budget: 100, label: "Igjen" });
    // Every bar at its own low start, the budget in the account: nothing is balanced yet.
    expect(session!.start).toEqual(session!.setup.handles.map(startValues));
    expect(budgetBalanced(session!.setup.handles, session!.start, 100)).toBe(false);
    // The account bar is painted while asked, then taken off for the reveal.
    const acc = marks.filter((x) => x.owner.endsWith("_account"));
    expect(acc.some((x) => x.m !== null && x.m.texts.some((t) => t.text === "Igjen"))).toBe(true);
    expect(acc[acc.length - 1].m).toBeNull();
  });

  test("no account_label: the default word, in the cast's language, flagged as the default", async () => {
    for (const [lang, word] of [["en", "Left"], ["nb", "Igjen"], [null, "Left"]] as [string | null, string][]) {
      const { player } = makePlayer([ask()]);
      if (lang) player.setSourceLang(lang);
      let session: GuessSession | null = null;
      player.askGate = async (_s, step) => {
        session = (step as unknown as { guess: GuessSession }).guess;
        return "50,30,20";
      };
      await player.play();
      expect(session!.account).toEqual({ budget: 100, label: word, isDefault: true });
    }
  });

  test("the movie ends balanced and never waits", async () => {
    const { player, events, marks } = makePlayer([ask({ default: "40,20,15" })]);
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    let waited = false;
    player.askGate = async () => {
      waited = true;
      return null;
    };
    await player.play();
    expect(waited).toBe(false);
    // A default that does not add up is scaled to the budget: 40:20:15 of 100.
    const given = events.length > 0 ? events[0].given : [];
    expect(given).toEqual([]); // the movie reports no answers
    const acc = marks.filter((x) => x.owner.endsWith("_account") && x.m !== null).map((x) => x.m!);
    expect(acc.length).toBeGreaterThan(1);
    // The account starts with money left and reaches zero.
    expect(acc[0].texts.some((t) => t.text !== "0" && /\d/.test(t.text))).toBe(true);
    expect(acc[acc.length - 1].texts.map((t) => t.text)).toContain("0");
  });

  test("judge: false is unchanged: right is spoken, nothing is wrong", async () => {
    const { player, events, speech } = makePlayer([ask()]);
    player.askGate = async () => "70,20,10";
    await player.play();
    expect(events[0].correct).toBe(true);
    expect(speech.said.some((t) => t.includes("You gave most to B1."))).toBe(true);
  });
});

// —— on the real layout: the account bar stays on the canvas ——

describe("the account bar on a real chart", () => {
  registerPack("data", dataYaml);
  const health = (examples as unknown as { spec: Spec }[]).map((e) => e.spec).find((sp) => sp?.title === "Your health budget")!;
  const hours = (examples as unknown as { spec: Spec }[]).map((e) => e.spec).find((sp) => sp?.title === "Where do your 24 hours go?")!;
  const variant = (n: number): Spec => ({
    ...health,
    params: { ...health.params, labels: Array.from({ length: n }, (_, k) => `Item ${k + 1}`), values: Array.from({ length: n }, () => 100 / n) },
  }) as Spec;
  const handlesOf = (spec: Spec): GuessHandle[] => {
    const s = expandSpec(spec);
    const layout = layoutSpec(s);
    return guessSetup(s, s.params ?? {}, layout, guessParts(s, "all")).handles;
  };
  /** Rough text extent: 20 px type, ~0.6 em a character. */
  const textBox = (t: { at: [number, number]; text: string; anchor: string }): [number, number] => {
    const w = t.text.length * 12;
    const x0 = t.anchor === "middle" ? t.at[0] - w / 2 : t.anchor === "end" ? t.at[0] - w : t.at[0];
    return [x0, x0 + w];
  };

  for (const [name, spec] of [["Your health budget (4 bars)", health], ["2 bars", variant(2)], ["10 bars", variant(10)]] as [string, Spec][]) {
    test(`${name}: inside the canvas and clear of the bars, balanced, under- and overspent`, () => {
      const hs = handlesOf(spec);
      expect(hs.length).toBeGreaterThan(1);
      const lastEdge = Math.max(...hs.map((h) => h.cx! + h.halfW!));
      const cases = [hs.map(() => [100 / hs.length]), hs.map(startValues), hs.map((h) => [h.max]), hs.map(() => [0])];
      for (const values of cases) {
        const m = accountMarks(hs, values, 100, "Left");
        for (const l of m.lines)
          for (const [x, y] of l.pts) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(CANVAS.w);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(CANVAS.h);
            expect(x).toBeGreaterThan(lastEdge);
          }
        for (const t of m.texts) {
          const [x0, x1] = textBox(t);
          expect(x0).toBeGreaterThanOrEqual(0);
          expect(x1).toBeLessThanOrEqual(CANVAS.w);
          expect(t.at[1]).toBeGreaterThanOrEqual(10);
          expect(t.at[1]).toBeLessThanOrEqual(CANVAS.h - 10);
        }
      }
    });
  }

  /** The x-axis arrow's tip, from the real layout. */
  const tipOf = (spec: Spec): { x: number; y: number } => {
    const s = expandSpec(spec);
    const find = (ds: { id?: string; children?: unknown[]; pts?: [number, number][] }[]): [number, number] | null => {
      for (const d of ds) {
        if (d.id === "axes__x" && d.pts) return d.pts[d.pts.length - 1];
        const c = d.children ? find(d.children as never) : null;
        if (c) return c;
      }
      return null;
    };
    const t = find(layoutSpec(s).drawables as never)!;
    return { x: t[0], y: t[1] };
  };

  for (const [name, spec, label] of [["Your health budget", health, "Left"], ["Where do your 24 hours go?", hours, "Hours left"]] as [string, Spec, string][]) {
    test(`${name}: the account bar and its words stay clear of the x-axis arrowhead`, () => {
      const hs = handlesOf(spec);
      const tip = tipOf(spec);
      const budget = name.startsWith("Where") ? 24 : 100;
      const cases = [hs.map(startValues), hs.map(() => [budget / hs.length]), hs.map((h) => [h.max])];
      for (const values of cases) {
        const m = accountMarks(hs, values, budget, label);
        // The arrowhead: its arms reach ~13 back from the tip and ~7 either side of the axis.
        for (const l of m.lines) for (const [x, y] of l.pts) expect(x > tip.x + 3 || Math.abs(y - tip.y) > 12 || x < tip.x - 20).toBe(true);
        for (const t of m.texts) {
          const [x0, x1] = textBox(t);
          const clearX = x0 > tip.x + 3 || x1 < tip.x - 20;
          // 20-unit type, centred on its point (with some slack).
          const clearY = t.at[1] - 4 > tip.y + 10 || t.at[1] + 16 < tip.y - 10;
          expect(clearX || clearY).toBe(true);
        }
      }
    });
  }

  test("plenty left, past the top of the canvas: cut, but no break mark (that means overspent)", () => {
    const hs = handlesOf(hours);
    const m = accountMarks(hs, hs.map(startValues), 24, "Hours left");
    expect(m.color).toBe(GUESS_COLOR);
    const slanted = m.lines.filter((l) => l.pts.length === 2 && Math.abs(l.pts[0][0] - l.pts[1][0]) > 1 && Math.abs(l.pts[0][1] - l.pts[1][1]) > 1);
    expect(slanted).toEqual([]);
    // The label, wrapped to the room beside the bars, reads top to bottom.
    const words = m.texts.slice(1).reverse().map((t) => t.text).join(" ");
    expect(words).toBe("Hours left");
    for (const t of m.texts) expect(t.at[1]).toBeLessThanOrEqual(CANVAS.h - 10);
  });

  test("overspent past the room below the baseline: cut, with a break mark, the number still shown", () => {
    const hs = handlesOf(health);
    const m = accountMarks(hs, hs.map((h) => [h.max]), 100);
    expect(m.color).toBe(ACCOUNT_RED);
    expect(m.texts.map((t) => t.text)).toContain(`−${hs[0].format(hs.length * hs[0].max - 100)}`);
    // The break: two short slanted ticks (neither horizontal nor vertical).
    const slanted = m.lines.filter((l) => l.pts.length === 2 && Math.abs(l.pts[0][0] - l.pts[1][0]) > 1 && Math.abs(l.pts[0][1] - l.pts[1][1]) > 1);
    expect(slanted.length).toBe(2);
  });
});

describe("account_label: lint and schema", () => {
  test("account_label without a budget warns", async () => {
    const { lintCommands } = await import("../src/lint/lint");
    const spec = (ask: Record<string, unknown>): Spec =>
      expandSpec({ template: "bar_chart", params: { labels: ["A", "B"], values: [1, 2] }, commands: [{ draw: ["axes"] }, { ask: { question: "Split?", on: "all", judge: false, ...ask } }] } as Spec);
    const warned = (s: Spec) => lintCommands(s).filter((i) => /account_label/.test(i.message));
    expect(warned(spec({ account_label: "Igjen" }))).toHaveLength(1);
    expect(warned(spec({ account_label: "Igjen" }))[0].severity).toBe("warn");
    expect(warned(spec({ account_label: "Igjen", budget: 100 }))).toHaveLength(0);
  });

  test("a budget the bars cannot reach within their axis is a lint error", async () => {
    registerPack("data", dataYaml);
    const { lintCommands } = await import("../src/lint/lint");
    const spec = (params: Record<string, unknown>, budget: number): Spec =>
      expandSpec({ template: "bar_chart", params: { labels: ["A", "B"], ...params }, commands: [{ draw: ["axes"] }, { ask: { question: "Split?", on: "all", budget } }] } as Spec);
    const errs = (s: Spec) => lintCommands(s).filter((i) => /budget/.test(i.message) && i.severity === "error");
    // Values 30 and 50: the axis tops out at 54, so two bars make at most 108.
    expect(errs(spec({ values: [30, 50] }, 100))).toHaveLength(0);
    expect(errs(spec({ values: [30, 50] }, 120))).toHaveLength(1);
    // The lint's range is the gate's: the real handles say the same.
    const s = spec({ values: [30, 50] }, 120);
    const hs = guessSetup(s, s.params ?? {}, layoutSpec(s), guessParts(s, "all")).handles;
    expect(handles.budgetReachable(hs, 120)).toBe(false);
    expect(handles.budgetReachable(hs, 100)).toBe(true);
    // An ylim floor above zero: the bars cannot go under it.
    expect(errs(spec({ values: [30, 50], ylim: [20, 100] }, 30))).toHaveLength(1);
    expect(errs(spec({ values: [30, 50], ylim: [20, 100] }, 150))).toHaveLength(0);
  });

  test("the schema refuses account_label on an ask that is not a guess", async () => {
    const { validateSpec } = await import("../src/spec/schema");
    const r = validateSpec({ title: "t", template: "bar_chart", params: { labels: ["A"], values: [1] }, commands: [{ ask: { question: "Q?", answer: "x", account_label: "Left" } }] });
    expect(JSON.stringify(r)).toMatch(/account_label/);
  });
});
