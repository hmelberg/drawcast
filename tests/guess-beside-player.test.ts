import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { Player, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { withOverrides } from "../src/render/params";
import { guessParts, guessSetup, patchFor } from "../src/guess/handles";
import type { GuessMarks } from "../src/guess/marks";
import { EACH_MS, FADED, YOURS } from "../src/guess/reveal";
import type { Command, Spec } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

beforeAll(() => {
  registerPack("data", dataYaml);
});

class CapturingSpeech extends SpeechManager {
  said: string[] = [];
  override get available(): boolean { return false; }
  override speak(text: string): Promise<void> {
    this.said.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const params = { labels: ["A", "B", "C"], values: [40, 80, 20], value_labels: true };

function makePlayer(commands: Command[]) {
  const spec = expandSpec({ template: "bar_chart", params, commands: [] } as unknown as Spec);
  const layout = layoutSpec(spec);
  const ids = [...layout.order];
  const plan = planCommands(commands, ids, {
    animateBase: params,
    guessParts: (on) => {
      const parts = guessParts(spec, on);
      return { parts, shows: parts };
    },
  });
  const speech = new CapturingSpeech();
  const marks = new Map<string, GuessMarks | null>();
  const history: { owner: string; m: GuessMarks | null }[] = [];
  const effects = new Proxy(
    {
      setGuessMarks: (owner: string, m: GuessMarks | null) => {
        marks.set(owner, m);
        history.push({ owner, m });
      },
    } as Record<string, unknown>,
    { get: (t, k: string) => t[k] ?? (() => {}) },
  ) as unknown as BackendEffects;
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const frames: { at: number; p: Record<string, unknown> }[] = [];
  const commits: Record<string, unknown>[] = [];
  const rp: Reprojector = {
    frame: (p) => void frames.push({ at: performance.now(), p }),
    commit: (p) => {
      commits.push(p);
      return new Map();
    },
    committed: () => null,
  };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: (on, from, p) => guessSetup(spec, withOverrides(params, p), layout, guessParts(spec, on), { from }),
    patch: (setup, values) => patchFor(spec, setup, values),
  };
  player.guess = runtime;
  return { player, frames, commits, marks, history, speech };
}

const DRAW: Command = { draw: ["axes", "bar_1", "bar_3"] };
const ask = (extra: Record<string, unknown> = {}): Command =>
  ({ ask: { question: "How tall?", on: "bar_2", store: "g", right: "Yes.", wrong: "It is {g.true}.", ...extra } }) as Command;

describe("a guess on a bar: beside (the default) and morph", () => {
  test("beside: the true bar grows from zero in the right half; yours stays, blue, in the left; the chart stays halved", async () => {
    const { player, frames, commits, marks } = makePlayer([DRAW, ask()]);
    player.askGate = async () => "50";
    await player.play();
    const reveal = frames.filter((f) => f.p["beside_bars"] !== undefined);
    expect(reveal.length).toBeGreaterThan(2);
    expect(reveal.every((f) => JSON.stringify(f.p["beside_bars"]) === "[1]")).toBe(true);
    // From zero up to the truth — never from the guess.
    expect(reveal[0].p["values.1"] as number).toBeLessThan(20);
    expect(reveal[reveal.length - 1].p["values.1"]).toBeCloseTo(80);
    // The commit after the reveal keeps the halves.
    expect(JSON.stringify(commits[commits.length - 1]["beside_bars"])).toBe("[1]");
    const m = marks.get("guess_1")!;
    expect(m.lines.some((l) => l.fill === YOURS)).toBe(true);
    expect(m.texts.some((t) => t.text === "+30")).toBe(true);
  });

  test("morph keeps today's glide: guess → truth, a dashed ghost, no halves", async () => {
    const { player, frames, commits, marks } = makePlayer([DRAW, ask({ reveal_style: "morph" })]);
    player.askGate = async () => "50";
    await player.play();
    expect(frames.some((f) => f.p["beside_bars"] !== undefined)).toBe(false);
    expect(commits.some((c) => c["beside_bars"] !== undefined)).toBe(false);
    const vals = frames.map((f) => f.p["values.1"]).filter((v): v is number => typeof v === "number");
    // Painted at the guess, then from the guess up to the truth.
    const firstReveal = vals.findIndex((v) => v > 50.01);
    expect(vals[firstReveal - 1]).toBeCloseTo(50, 1);
    expect(vals[vals.length - 1]).toBeCloseTo(80);
    const m = marks.get("guess_1")!;
    expect(m.lines.some((l) => l.dashed)).toBe(true);
    expect(m.lines.some((l) => l.fill !== undefined)).toBe(false);
  });

  test("yours stays at full strength while the ask's lines are spoken, then fades at the next command", async () => {
    const { player, history, speech } = makePlayer([DRAW, ask(), { speak: "Next." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(speech.said).toContain("Next.");
    const own = history.filter((h) => h.owner === "guess_1" && h.m !== null).map((h) => h.m!);
    const fill = (m: GuessMarks) => m.lines.find((l) => l.fill === YOURS)?.fillOpacity;
    // The last full-strength set, then the faded one.
    expect(fill(own[own.length - 2])).toBeCloseTo(0.6);
    expect(fill(own[own.length - 1])).toBeCloseTo(0.6 * FADED);
  });

  test("erased with its figure; a scrub back clears yours and the truth's room", async () => {
    const erased = makePlayer([DRAW, ask(), { erase: ["bar_2"] }]);
    erased.player.askGate = async () => "50";
    await erased.player.play();
    expect(erased.marks.get("guess_1")).toBeNull();

    const { player, marks, commits } = makePlayer([DRAW, ask(), { speak: "Next." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeTruthy();
    player.renderUpTo(1);
    expect(marks.get("guess_1")).toBeNull();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
    // Forward again (Review Focus 5): yours and the truth come back — faded, a command has followed.
    player.renderUpTo(3);
    expect(JSON.stringify(commits[commits.length - 1]["beside_bars"])).toBe("[1]");
    const back = marks.get("guess_1")!;
    expect(back.lines.find((l) => l.fill === YOURS)?.fillOpacity).toBeCloseTo(0.6 * FADED);
    // Right after the ask: at full strength.
    player.renderUpTo(2);
    expect(marks.get("guess_1")!.lines.find((l) => l.fill === YOURS)?.fillOpacity).toBeCloseTo(0.6);
  });

  test("an erase, then the part drawn again: the template is committed whole (no half bar left)", async () => {
    const { player, commits } = makePlayer([DRAW, ask(), { erase: ["bar_2"] }, { draw: ["bar_2"] }, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
    // A seek past the erase does not bring yours back.
    player.renderUpTo(4);
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
  });

  test("an animate of the chart ends yours and the halves before it plays (example 386)", async () => {
    const { player, marks, frames } = makePlayer([DRAW, ask(), { animate: { "values.1": 20 }, duration: 0.2 } as Command, { speak: "End." }]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeNull();
    // After the reveal's last halved frame: the animate's frames, the bars whole, values.1 on its way to 20.
    const lastHalved = frames.map((f) => f.p["beside_bars"] !== undefined).lastIndexOf(true);
    const after = frames.slice(lastHalved + 1);
    expect(after.some((f) => typeof f.p["values.1"] === "number" && (f.p["values.1"] as number) < 79 && (f.p["values.1"] as number) > 21)).toBe(true);
    expect(after.every((f) => f.p["beside_bars"] === undefined)).toBe(true);
  });

  test("Test me's reveal goes when the cast plays on", async () => {
    const { player, marks, commits } = makePlayer([{ draw: ["axes", "bar_1", "bar_2", "bar_3"] }, { speak: "Look." }, { speak: "More." }]);
    player.renderUpTo(1);
    expect(await player.selfTest(async () => "10;10;10")).toBe(true);
    expect(marks.get("guess_self")).toBeTruthy();
    player.cancelSelfTest();
    await player.play();
    expect(marks.get("guess_self")).toBeNull();
    expect(commits[commits.length - 1]["beside_bars"]).toBeUndefined();
  });

  test("the next question takes yours away and the bars are whole again", async () => {
    const { player, marks, commits } = makePlayer([DRAW, ask(), ask({ on: "bar_1", store: "h" })]);
    player.askGate = async () => "50";
    await player.play();
    expect(marks.get("guess_1")).toBeNull();
    const keys = commits.map((c) => JSON.stringify(c["beside_bars"] ?? null));
    const firstHalved = keys.indexOf("[1]");
    const whole = keys.indexOf("null", firstHalved);
    expect(firstHalved).toBeGreaterThanOrEqual(0);
    expect(whole).toBeGreaterThan(firstHalved);
    expect(keys.indexOf("[0]", whole)).toBeGreaterThan(whole);
  });

  test("reveal_order each: the true bars grow one after another, about 0.6 s apart", async () => {
    const { player, frames } = makePlayer([{ draw: ["axes"] }, ask({ on: "all", reveal_order: "each" })]);
    player.askGate = async () => "10,10,10";
    await player.play();
    const reveal = frames.filter((f) => f.p["beside_bars"] !== undefined);
    const firstUp = (k: number) => reveal.find((f) => (f.p[`values.${k}`] as number) > 1)!.at;
    const t0 = firstUp(0), t1 = firstUp(1), t2 = firstUp(2);
    expect(t1 - t0).toBeGreaterThan(EACH_MS * 0.6);
    expect(t2 - t1).toBeGreaterThan(EACH_MS * 0.6);
    // All at once without it.
    const together = makePlayer([{ draw: ["axes"] }, ask({ on: "all" })]);
    together.player.askGate = async () => "10,10,10";
    await together.player.play();
    const r2 = together.frames.filter((f) => f.p["beside_bars"] !== undefined);
    const up = (k: number) => r2.find((f) => (f.p[`values.${k}`] as number) > 1)!.at;
    expect(Math.abs(up(2) - up(0))).toBeLessThan(EACH_MS * 0.5);
  }, 10000);

  test("a movie demonstrates the default beside the truth and never waits", async () => {
    const { player, marks } = makePlayer([DRAW, ask({ default: "60" })]);
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    let asked = false;
    player.askGate = async () => {
      asked = true;
      return null;
    };
    await player.play();
    expect(asked).toBe(false);
    expect(marks.get("guess_1")?.texts.some((t) => t.text === "+20")).toBe(true);
  });
});
