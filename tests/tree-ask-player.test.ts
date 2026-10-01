import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent, type GuessRuntime, type Reprojector } from "../src/render/player";
import type { BackendEffects } from "../src/render/backend";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import { encodeTreeAnswer } from "../src/tree/blanks";
import type { GuessMarks } from "../src/guess/marks";
import type { DecisionTreeParams } from "../src/scenes/decision_tree/layout";
import type { Command } from "../src/spec/types";

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

const root = {
  id: "start", type: "decision", label: "Choose",
  children: [
    { label: "Treat", node: { id: "treat", type: "chance", label: "", children: [
      { label: "Cured", probability: 0.3, node: { id: "cured", type: "terminal", label: "", payoff: 10 } },
      { label: "Not", node: { id: "not", type: "terminal", label: "", payoff: 4 } },
    ] } },
    { label: "Wait", node: { id: "wait", type: "terminal", label: "", payoff: 5, work: "5 × 1" } },
  ],
};
const params = { root, rollback: true } as unknown as DecisionTreeParams;
const IDS = ["edge_start_treat", "edge_start_wait", "value_treat", "effect_wait", "branchlabel_treat_not"];

function makePlayer(commands: Command[], ids: string[] = IDS, treeParams: DecisionTreeParams = params) {
  const plan = planCommands(commands, ids, {});
  const speech = new CapturingSpeech();
  const marks = new Map<string, GuessMarks | null>();
  // Every other effect is a no-op.
  const effects = new Proxy({ setGuessMarks: (owner: string, m: GuessMarks | null) => marks.set(owner, m) } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? (() => {}),
  }) as unknown as BackendEffects;
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated", effects });
  const frames: Record<string, unknown>[] = [];
  const commits: Record<string, unknown>[] = [];
  const scenes: ReadonlySet<string>[] = [];
  const rp: Reprojector = {
    frame: (p, scene) => {
      frames.push(p);
      scenes.push(scene.visible);
    },
    commit: (p) => {
      commits.push(p);
      return new Map();
    },
    committed: () => null,
  };
  player.reprojector = rp;
  const runtime: GuessRuntime = {
    setup: () => ({ handles: [], pin: {}, warnings: [] }),
    patch: () => ({ params: {} }),
    tree: () => ({
      params: treeParams,
      boxes: () =>
        new Map([
          ["value_treat", { x: 100, y: 200, w: 30, h: 12 }],
          ["effect_wait", { x: 300, y: 100, w: 20, h: 12 }],
          ["branchlabel_treat_not", { x: 200, y: 150, w: 40, h: 12 }],
        ]),
      edges: () => ({ edge_start_treat: [[0, 0], [100, 200]], edge_start_wait: [[0, 0], [100, -200]] }),
    }),
  };
  player.guess = runtime;
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events, frames, commits, scenes, speech, marks, plan };
}

const ASK: Command = { ask: { question: "EV?", blanks: ["value_treat"], store: "e", right: "Yes", wrong: "No: {e.work}" } };
const COMMANDS: Command[] = [{ draw: IDS }, ASK];

describe("tree asks in the player", () => {
  test("a movie fills the blank with the truth and draws it in", async () => {
    const { player, frames, plan } = makePlayer(COMMANDS);
    expect((plan.steps[1] as { tree?: unknown }).tree).toEqual({ blanks: ["value_treat"] });
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    expect(player.vars.get("e")).toBe("5.8");
    expect(player.vars.get("e.true")).toBe("5.8");
    expect(player.vars.get("e.work")).toBe("0.3 × 10 + 0.7 × 4 = 5.8");
    const answers = frames.map((f) => f.answers as Record<string, string> | undefined);
    // "?" while asking, the number typed in, then the truth drawn.
    expect(answers.some((a) => a?.value_treat === "?")).toBe(true);
    expect(answers.some((a) => a?.value_treat === "5.8")).toBe(true);
    expect(answers[answers.length - 1]).toBeUndefined();
  });

  test("a wrong live blank: scored, the working line under it, cleared by a seek", async () => {
    const { player, events, marks, speech } = makePlayer(COMMANDS);
    let seen: { treeSession?: { blanks: unknown[]; boxOf(p: string): unknown } } | null = null;
    player.askGate = async (_s, step) => {
      seen = step as never;
      return encodeTreeAnswer([6.5], null);
    };
    await player.play();
    expect(seen!.treeSession!.blanks).toHaveLength(1);
    expect(seen!.treeSession!.boxOf("value_treat")).toEqual({ x: 100, y: 200, w: 30, h: 12 });
    expect(player.vars.get("e")).toBe("6.5");
    expect(player.vars.get("e.ok")).toBe("false");
    expect(player.vars.get("e.true")).toBe("5.8");
    expect(player.vars.get("e.within")).toBe("0");
    expect(player.vars.get("e.count")).toBe("1");
    expect(events[0]).toMatchObject({ kind: "ask", correct: false, given: ["6.5;"] });
    expect(speech.said.some((t) => t.includes("No: 0.3 × 10 + 0.7 × 4 = 5.8"))).toBe(true);
    const m = marks.get("tree_1");
    expect(m?.texts.map((t) => t.text)).toContain("0.3 × 10 + 0.7 × 4 = 5.8");
    expect(m?.lines.some((l) => l.dashed)).toBe(true);
    player.renderUpTo(0);
    expect(marks.get("tree_1")).toBeNull();
  });

  test("a right blank leaves no working line (work: false never; work: all always)", async () => {
    const right = makePlayer(COMMANDS);
    right.player.askGate = async () => encodeTreeAnswer([5.85], null);
    await right.player.play();
    expect(right.player.vars.get("e.ok")).toBe("true");
    expect(right.marks.get("tree_1") ?? null).toBeNull();

    const all = makePlayer([{ draw: IDS }, { ask: { ...ASK.ask!, work: "all" } }]);
    all.player.askGate = async () => encodeTreeAnswer([5.8], null);
    await all.player.play();
    expect(all.marks.get("tree_1")?.texts.map((t) => t.text)).toContain("0.3 × 10 + 0.7 × 4 = 5.8");
  });

  test("several blanks: 'n of m', per-blank vars, probabilities in 2 decimals", async () => {
    const { player } = makePlayer([{ draw: IDS }, { ask: { question: "Fill", blanks: ["branchlabel_treat_not", "effect_wait"], store: "f" } }]);
    player.askGate = async () => encodeTreeAnswer([0.7, null], null);
    await player.play();
    expect(player.vars.get("f")).toBe("1 of 2");
    expect(player.vars.get("f.branchlabel_treat_not")).toBe("0.70");
    expect(player.vars.get("f.branchlabel_treat_not.true")).toBe("0.70");
    expect(player.vars.get("f.effect_wait.true")).toBe("5.0");
    expect(player.vars.get("f.work")).toBe("5 × 1");
  });

  test("pick: the chosen label, the best, the difference", async () => {
    const { player, marks } = makePlayer([{ draw: IDS }, { ask: { question: "Which?", pick: "start", store: "c" } }]);
    player.askGate = async () => encodeTreeAnswer([], "wait");
    await player.play();
    expect(player.vars.get("c")).toBe("Wait");
    expect(player.vars.get("c.true")).toBe("Treat");
    expect(player.vars.get("c.pick")).toBe("Wait");
    expect(player.vars.get("c.diff")).toBe("0.8");
    expect(player.vars.get("c.ok")).toBe("false");
    expect(marks.get("tree_1")?.lines.some((l) => l.dashed)).toBe(true);
  });

  test("a pick after blanks: the blanks' working lines stay", async () => {
    const { player, marks } = makePlayer([{ draw: IDS }, ASK, { ask: { question: "Which?", pick: "start", store: "c" } }]);
    const answers = [encodeTreeAnswer([6.5], null), encodeTreeAnswer([], "treat")];
    player.askGate = async () => answers.shift() ?? null;
    await player.play();
    expect(player.vars.get("c.ok")).toBe("true");
    expect(marks.get("tree_1")?.texts.map((t) => t.text)).toContain("0.3 × 10 + 0.7 × 4 = 5.8");
    player.renderUpTo(0);
    expect(marks.get("tree_1")).toBeNull();
  });

  test("pick on a rolled-back tree: best and prune marks hidden while asked, there after", async () => {
    const MARKS = ["best_start_treat", "prune_start_wait"];
    const ids = [...IDS, ...MARKS];
    const { player, plan, scenes, marks } = makePlayer([{ draw: IDS }, { ask: { question: "Which?", pick: "start", store: "c" } }], ids);
    expect(plan.states[0].visible).not.toContain("best_start_treat");
    expect(plan.states[1].visible).toEqual(expect.arrayContaining(MARKS));
    player.askGate = async () => encodeTreeAnswer([], "wait");
    await player.play();
    expect(scenes.length).toBeGreaterThan(0);
    for (const v of scenes) for (const id of MARKS) expect(v.has(id)).toBe(false);
    // The tree's own marks are the reveal: no solid ring of ours.
    expect(marks.get("tree_1")?.lines.every((l) => l.dashed)).toBe(true);
  });

  test("pick without rollback marks: a solid ring round the best branch", async () => {
    const { player, marks } = makePlayer([{ draw: IDS }, { ask: { question: "Which?", pick: "start", store: "c" } }]);
    player.askGate = async () => encodeTreeAnswer([], "treat");
    await player.play();
    expect(marks.get("tree_1")?.lines.some((l) => !l.dashed && l.closed)).toBe(true);
  });

  test("a blank shows ? from the start until its ask, and again after a scrub back", async () => {
    const { player, commits, frames, plan } = makePlayer([{ draw: IDS }, { speak: "Look." }, ASK]);
    const blankAt = (n: number): string | undefined => {
      player.renderUpTo(n);
      const last = commits[commits.length - 1] as { answers?: Record<string, string> } | undefined;
      return last?.answers?.value_treat;
    };
    // The plan's boundaries: "?" until the ask (boundary 2), the truth after it.
    expect(plan.states[0].answers).toEqual({ value_treat: "?" });
    expect(plan.states[1].answers).toEqual({ value_treat: "?" });
    expect(plan.states[2].answers).toBeUndefined();
    expect(blankAt(0)).toBe("?");
    expect(blankAt(1)).toBe("?");
    expect(blankAt(2)).toBe("?");
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    commits.length = 0;
    frames.length = 0;
    await player.play();
    // Nothing painted before the ask ever carried the true number.
    const firstTruth = frames.findIndex((f) => (f.answers as Record<string, string> | undefined)?.value_treat === "5.8");
    expect(firstTruth).toBeGreaterThan(-1);
    for (const f of frames.slice(0, firstTruth)) expect((f.answers as Record<string, string> | undefined)?.value_treat).toBe("?");
    expect(blankAt(3)).toBeUndefined();
    expect(blankAt(1)).toBe("?");
  });

  test("a blank not drawn with the tree: its ask draws it", () => {
    const { plan } = makePlayer([{ draw: ["edge_start_treat", "edge_start_wait"] }, ASK]);
    expect(plan.states[0].visible).not.toContain("value_treat");
    expect(plan.states[1].visible).toContain("value_treat");
  });

  test("two tree asks: the later blank stays ? through the earlier ask's reveal", async () => {
    const LATER: Command = { ask: { question: "Wait?", blanks: ["effect_wait"], store: "w" } };
    const { player, frames, plan } = makePlayer([{ draw: IDS }, ASK, LATER]);
    expect(plan.states[1].answers).toEqual({ effect_wait: "?" });
    (player as unknown as { autoAnswers: boolean }).autoAnswers = true;
    await player.play();
    const firstWait = frames.findIndex((f) => (f.answers as Record<string, string> | undefined)?.effect_wait === "5.0");
    for (const f of frames.slice(0, firstWait)) {
      const a = f.answers as Record<string, string> | undefined;
      if (a !== undefined) expect(a.effect_wait).toBe("?");
    }
    // Between the asks, the earlier blank's truth with the later still hidden.
    expect(frames.some((f) => {
      const a = f.answers as Record<string, string> | undefined;
      return a !== undefined && a.value_treat === undefined && a.effect_wait === "?";
    })).toBe(true);
  });

  test("a pick on start leaves start_2's marks alone (exact ids, not a prefix)", async () => {
    const two = {
      rollback: true,
      root: { id: "start", type: "decision", label: "", children: [
        { label: "A", node: { id: "a", type: "terminal", label: "", payoff: 3 } },
        { label: "B", node: { id: "start_2", type: "decision", label: "", children: [
          { label: "C", node: { id: "c", type: "terminal", label: "", payoff: 5 } },
          { label: "D", node: { id: "d", type: "terminal", label: "", payoff: 1 } },
        ] } },
      ] },
    } as unknown as DecisionTreeParams;
    const MARKS = ["best_start_start_2", "prune_start_a", "best_start_2_c", "prune_start_2_d"];
    const ids = ["edge_start_a", "edge_start_start_2", ...MARKS];
    const { player, scenes } = makePlayer([{ draw: ids }, { ask: { question: "Which?", pick: "start", store: "c" } }], ids, two);
    player.askGate = async () => encodeTreeAnswer([], "a");
    await player.play();
    expect(scenes.length).toBeGreaterThan(0);
    for (const v of scenes) {
      expect(v.has("best_start_start_2")).toBe(false);
      expect(v.has("prune_start_a")).toBe(false);
      expect(v.has("best_start_2_c")).toBe(true);
      expect(v.has("prune_start_2_d")).toBe(true);
    }
  });
});
