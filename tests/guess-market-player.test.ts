import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent, type GuessRuntime, type GuessSession, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import { guessParts, guessSetup, marketAnchor, marketGrab, marketKey, nudge, patchFor, pickHandle, pointFor, valueAt } from "../src/guess/handles";
import { along, marketKind, marketPoint, skOf } from "../src/guess/market";
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

function makePlayer(commands: Command[], pointers: ([number, number] | null)[] = []) {
  const plan = planCommands(commands, IDS, {
    animateBase: params,
    guessParts: (on) => {
      const parts = Array.isArray(on) ? on : [on];
      return { parts, shows: parts };
    },
  });
  const speech = new CapturingSpeech();
  const marks = new Map<string, GuessMarks | null>();
  const effects = new Proxy({ setGuessMarks: (owner: string, m: GuessMarks | null) => marks.set(owner, m), setPointer: (p: [number, number] | null) => pointers.push(p) } as Record<string, unknown>, {
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
    // A press alone changes nothing, in either grab.
    expect(valueAt(h, end, [0, 0], null, 1, marketAnchor(h, [0, 0], end))).toEqual([0, 0]);
    expect(valueAt(h, mid, [0, 0], null, 0)).toEqual([0, 0]);
    // Keys: ↑ moves evenly, Shift+↑ turns.
    const k1 = nudge(h, [0, 0], 0, 1);
    expect(k1[0]).toBeCloseTo(k1[1], 5);
    expect(k1[0]).toBeGreaterThan(0);
    const k2 = nudge(h, [0, 0], 0, 1, true);
    expect(k2[1]).toBeGreaterThan(k2[0]);
  });
});

describe("market gesture: fix round 1", () => {
  const h = guessSetup(spec, params, layout, ["supply_curve"], { end: endOf }).handles[0];
  const m = h.market!;
  const dy = h.toLogical!([0, 10])[1] - h.toLogical!([0, 0])[1];

  test("a turn moves the GRABBED point with the pointer, from wherever the press was", () => {
    // Grab near the low end (a fifth of the way along the copy), a little off the line.
    const line = m.base.map(h.toLogical!);
    const near = line[Math.floor(line.length * 0.1)];
    const press: [number, number] = [near[0] + 6, near[1] - 8];
    expect(marketGrab(h, [0, 0], press)).toBe(1);
    const anchor = marketAnchor(h, [0, 0], press);
    const v = valueAt(h, [press[0], press[1] + dy], [0, 0], press, 1, anchor);
    const at = marketPoint(m, [v[0], v[1]], anchor)!;
    expect(at[1]).toBeCloseTo(along("price", m.base, anchor)! + 10, 4);
    expect(skOf(m, [v[0], v[1]]).s).toBeCloseTo(0, 5);
  });

  test("a turn grabbed outside the old curve's span still turns (the anchor is clamped)", () => {
    const end = pointFor(h, [0, 0], 1)!;
    const v = valueAt(h, [end[0], end[1] + dy], [0, 0], end, 1, 1000);
    expect(skOf(m, [v[0], v[1]]).k).toBeGreaterThan(1);
  });

  test("a press away from the copy takes nothing", () => {
    const mid = pointFor(h, [0, 0])!;
    expect(pickHandle([h], [[0, 0]], mid)).toBe(0);
    expect(pickHandle([h], [[0, 0]], [mid[0] + 200, mid[1] + 200])).toBeNull();
  });

  test("keys by the screen: the axis's own arrows", () => {
    expect(marketKey(h, "ArrowUp")).toBe(1);
    expect(marketKey(h, "ArrowDown")).toBe(-1);
    expect(marketKey(h, "ArrowRight")).toBeNull();
    const el = guessSetup(spec, params, layout, ["supply_curve"], { end: { params: withOverrides(params, { "supply.elasticity": 1.5 }), targets: { "supply.elasticity": 1.5 } } }).handles[0];
    expect(el.market!.axis).toBe("quantity");
    expect(marketKey(el, "ArrowRight")).toBe(1);
    expect(marketKey(el, "ArrowLeft")).toBe(-1);
    expect(marketKey(el, "ArrowUp")).toBeNull();
  });

  test("marketKind reads the asked curve's own elasticity only", () => {
    expect(marketKind("supply_curve", params, { "demand.elasticity": 1.5, "supply_shift.amount": 10 })).toBe("shift");
    expect(marketKind("supply_curve", params, { "supply.elasticity": 1.5 })).toBe("elasticity");
  });
});

describe("market asks in the player", () => {
  test("the movie of a turn about the equilibrium: the laser holds the copy's end", async () => {
    const pointers: ([number, number] | null)[] = [];
    const { player } = makePlayer([{ draw: IDS }, { ask: { question: "More elastic?", on: "supply_curve", predict: true, store: "e" } }, { animate: { "supply.elasticity": 1.5 }, duration: 0.2 }], pointers);
    await player.play();
    const h = guessSetup(spec, params, layout, ["supply_curve"], { end: { params: withOverrides(params, { "supply.elasticity": 1.5 }), targets: { "supply.elasticity": 1.5 } } }).handles[0];
    const shown = pointers.filter((p): p is [number, number] => p !== null);
    const last = shown[shown.length - 1];
    const endAt = pointFor(h, h.truth, 1)!;
    const midAt = pointFor(h, h.truth, 0)!;
    expect(Math.hypot(last[0] - endAt[0], last[1] - endAt[1])).toBeLessThan(Math.hypot(last[0] - midAt[0], last[1] - midAt[1]));
    expect(player.vars.get("e.ok")).toBe("true");
  });

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
    // check: shape (the default): the right sentence names the shape and the way.
    expect(player.vars.get("t.why")).toBe("It turns up and gets steeper.");
  });

  test("the right-answer why follows check: direction names the way, size the place", async () => {
    const run = async (check: "direction" | "size") => {
      const { player } = makePlayer([{ draw: IDS }, { ask: { ...ASK.ask!, check } }, { animate: { "tax.amount": 40 }, duration: 0.2 }]);
      player.askGate = async (_s, step) => {
        const t = (step as unknown as { guess: GuessSession }).guess.setup.handles[0].truth;
        return `${t[0]},${t[1]}`;
      };
      await player.play();
      return player.vars.get("t.why");
    };
    expect(await run("direction")).toBe("It moves up.");
    expect(await run("size")).toBe("The new curve is where you put it.");
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
