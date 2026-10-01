import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent, type GuessRuntime, type GuessSession, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import { guessParts, guessSetup, marketGrab, nudge, patchFor, pointFor, valueAt } from "../src/guess/handles";
import { skOf } from "../src/guess/market";
import type { GuessMarks } from "../src/guess/marks";
import type { Command, Spec } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const params = { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
const spec = expandSpec({ template: "supply_demand", params, commands: [] } as unknown as Spec);
const layout = layoutSpec(spec);
const IDS = [...layout.order];

const ASK: Command = { ask: { question: "Show it", on: "supply_curve", predict: true, store: "t", right: "Yes: {t.why}", wrong: "No: {t.why}" } };
const COMMANDS: Command[] = [{ draw: IDS }, ASK, { animate: { "tax.amount": 40 }, duration: 1 }];

function makePlayer(commands: Command[]) {
  const plan = planCommands(commands, IDS, {
    animateBase: params,
    guessParts: (on) => {
      const parts = Array.isArray(on) ? on : [on];
      return { parts, shows: parts };
    },
  });
  const speech = new CapturingSpeech();
  const marks = new Map<string, GuessMarks | null>();
  const effects = new Proxy({ setGuessMarks: (owner: string, m: GuessMarks | null) => marks.set(owner, m) } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? (() => {}),
  }) as unknown as BackendEffects;
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const frames: Record<string, unknown>[] = [];
  const rp: Reprojector = { frame: (p) => void frames.push(p), commit: () => new Map(), committed: () => null };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (on, from, p, _onScreen, opts) =>
      guessSetup(spec, withOverrides(params, p), layout, guessParts(spec, on), {
        from,
        ...(opts?.end ? { end: { params: withOverrides(params, opts.end.params), targets: opts.end.targets } } : {}),
      }),
    patch: (setup, values) => patchFor(spec, setup, values),
  };
  player.guess = runtime;
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events, frames, speech, marks, plan };
}

const endOf = { params: withOverrides(params, { "tax.amount": 40 }), targets: { "tax.amount": 40 } };

describe("market handle setup and gesture", () => {
  test("a predict on supply builds a market handle from the next animate", () => {
    const setup = guessSetup(spec, params, layout, ["supply_curve"], { end: endOf });
    expect(setup.warnings).toEqual([]);
    const h = setup.handles[0];
    expect(h.kind).toBe("market");
    expect(h.part).toBe("supply_curve");
    expect(h.shows).toEqual(["supply_curve"]);
    expect(h.truth[1]).toBeGreaterThan(h.truth[0] * 1.3);
    expect(h.min).toBe(-100);
    expect(h.max).toBe(100);
    expect(h.step).toBe(2);
  });

  test("without the next animate, or on a curve it does not move: no handle, a warning", () => {
    expect(guessSetup(spec, params, layout, ["supply_curve"]).handles).toEqual([]);
    const off = guessSetup(spec, params, layout, ["demand_curve"], { end: endOf });
    expect(off.handles).toEqual([]);
    expect(off.warnings[0]).toMatch(/does not move demand_curve/);
  });

  test("move from the middle, turn from an end; keys move and turn", () => {
    const h = guessSetup(spec, params, layout, ["supply_curve"], { end: endOf }).handles[0];
    const mid = pointFor(h, [0, 0])!;
    expect(marketGrab(h, [0, 0], mid)).toBe(0);
    // Moved up by 10 domain units: both gaps grow by 10.
    const up = h.toLogical!([0, 10]);
    const zero = h.toLogical!([0, 0]);
    const moved = valueAt(h, [mid[0], mid[1] + (up[1] - zero[1])], [0, 0], mid, 0);
    expect(moved[0]).toBeCloseTo(10, 1);
    expect(moved[1]).toBeCloseTo(10, 1);
    // An end grabbed and pulled up: a turn about price 0 (k > 1, s kept).
    const end = pointFor(h, [0, 0], 1)!;
    expect(marketGrab(h, [0, 0], end)).toBe(1);
    const turned = valueAt(h, [end[0], end[1] + (up[1] - zero[1])], [0, 0], end, 1);
    const sk = skOf(h.market!, [turned[0], turned[1]]);
    expect(sk.s).toBeCloseTo(0, 5);
    expect(sk.k).toBeGreaterThan(1);
    // Keys: ↑ moves evenly, Shift+↑ turns.
    const k1 = nudge(h, [0, 0], 0, 1);
    expect(k1[0]).toBeCloseTo(k1[1], 5);
    expect(k1[0]).toBeGreaterThan(0);
    const k2 = nudge(h, [0, 0], 0, 1, true);
    expect(k2[1]).toBeGreaterThan(k2[0]);
  });
});

describe("market asks in the player", () => {
  test("the movie: the commonest guess (an even move), scored by shape, the why spoken; marks stay until a seek", async () => {
    const { player, events, speech, marks, frames } = makePlayer(COMMANDS);
    await player.play();
    expect(events).toEqual([]); // the movie reports no answers
    expect(player.vars.get("t")).toBe("moved up");
    expect(player.vars.get("t.true")).toBe("turned up");
    expect(player.vars.get("t.ok")).toBe("false");
    expect(player.vars.get("t.why")).toMatch(/steeper/);
    expect(player.vars.get("t.price")).toBeDefined();
    expect(player.vars.get("t.price_true")).toBeDefined();
    expect(player.vars.get("t.quantity")).toBeDefined();
    expect(player.vars.get("t.off")).toBeDefined();
    expect(speech.said.some((s) => s.startsWith("No: ") && /steeper/.test(s))).toBe(true);
    // The animate ran from the template's own start to the truth: the tax swept.
    expect(frames.some((f) => typeof f["tax.amount"] === "number" && (f["tax.amount"] as number) > 0 && (f["tax.amount"] as number) < 40)).toBe(true);
    // After the animate: the copy (dashed), two gap lines and an open dot.
    const m = marks.get("guess_1");
    expect(m).toBeTruthy();
    expect(m!.lines.filter((l) => l.dashed)).toHaveLength(1);
    expect(m!.lines.filter((l) => !l.dashed && !l.closed)).toHaveLength(2);
    expect(m!.lines.some((l) => l.closed)).toBe(true);
    player.renderUpTo(0);
    expect(marks.get("guess_1")).toBeNull();
  });

  test("live: the copy starts on the curve; the Answer button (release false); a right turn is right", async () => {
    const { player, events, marks } = makePlayer(COMMANDS);
    let session: GuessSession | null = null;
    player.askGate = async (_s, step) => {
      session = (step as unknown as { guess: GuessSession }).guess;
      // While asked, the copy is painted as a mark on the curve.
      expect(marks.get("guess_1")?.lines.some((l) => l.dashed)).toBe(true);
      const t = session.setup.handles[0].truth;
      return `${t[0]},${t[1]}`;
    };
    await player.play();
    expect(session!.start).toEqual([[0, 0]]);
    expect(events[0]).toMatchObject({ kind: "ask", correct: true });
    expect(player.vars.get("t")).toBe("turned up");
    expect(player.vars.get("t.why")).toBe("The new curve is where you put it.");
  });

  test("an ask on a curve the animate does not move asks nothing", async () => {
    const { player, events, speech } = makePlayer([{ draw: IDS }, { ask: { ...ASK.ask!, on: "demand_curve" } }, { animate: { "tax.amount": 40 }, duration: 0.2 }]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      let asked = false;
      player.askGate = async () => {
        asked = true;
        return null;
      };
      await player.play();
      expect(asked).toBe(false);
    } finally {
      console.warn = warn;
    }
    expect(events).toEqual([]);
    expect(speech.said.some((s) => s.startsWith("No:") || s.startsWith("Yes:"))).toBe(false);
  });
});
