// Choose on the figure (spec 2026-10-03-round6 §4): an ask whose options are
// drawn elements — the viewer taps the thing itself. Judged (answer), an
// opinion (judge: false) or a branch (goto/then, like decide cards).

import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

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

const fakeEffects = () => {
  const calls: { ids: string[]; color?: string }[] = [];
  const pointer: unknown[] = [];
  const effects = {
    setHighlight: (ids: string[], _effect: string, _t: number, _box: unknown, color?: string) => void calls.push({ ids, color }),
    endHighlight: () => undefined,
    setPointer: (p: unknown) => void pointer.push(p),
    setCamera: () => undefined,
  };
  return { effects, calls, pointer };
};

const BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
  door_1: { x: 0, y: 0, w: 100, h: 200 },
  door_2: { x: 200, y: 0, w: 100, h: 200 },
  door_3: { x: 400, y: 0, w: 100, h: 200 },
  bag_now: { x: 0, y: 300, w: 80, h: 80 },
  bag_later: { x: 200, y: 300, w: 80, h: 80 },
};
const LABELS: Record<string, string> = { door_1: "Door 1", door_2: "Door 2", door_3: "Door 3", bag_now: "Money now", bag_later: "Money later" };
const IDS = [...Object.keys(BOXES), "pair_a", "pair_b"];

function player(commands: Command[], speech: RecordingSpeech, effects?: unknown, groups: Record<string, string[]> = {}) {
  const plan = planCommands(commands, IDS, {
    bboxOf: (id) => BOXES[id] ?? null,
    labelOf: (id) => LABELS[id] ?? null,
    expandGroup: (id) => groups[id] ?? null,
  });
  return new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false, ...(effects ? { effects: effects as never } : {}) });
}

const DOORS: Command[] = [
  { draw: ["door_1", "door_2", "door_3"] },
  { ask: { question: "Which door hides the car?", choose: ["door_1", "door_2", "door_3"], answer: "door_2", store: "c", right: "Door two: {c}.", wrong: "Not {c}." } } as Command,
];

describe("the plan of a choose ask", () => {
  test("each option carries its id, label, box and members", () => {
    const plan = planCommands(DOORS, IDS, { bboxOf: (id) => BOXES[id] ?? null, labelOf: (id) => LABELS[id] ?? null });
    const ask = plan.steps.find((s) => s.kind === "ask");
    expect(ask?.kind === "ask" && ask.choose).toEqual([
      { id: "door_1", label: "Door 1", members: ["door_1"], box: BOXES.door_1 },
      { id: "door_2", label: "Door 2", members: ["door_2"], box: BOXES.door_2 },
      { id: "door_3", label: "Door 3", members: ["door_3"], box: BOXES.door_3 },
    ]);
  });

  test("a group option stands for its members; its box is theirs together; no label → the id humanised", () => {
    const plan = planCommands(
      [{ draw: ["door_1", "door_2"] }, { ask: { question: "Which?", choose: ["pair_a", "door_3"], store: "c", judge: false } } as Command],
      IDS,
      { bboxOf: (id) => BOXES[id] ?? null, expandGroup: (id) => (id === "pair_a" ? ["door_1", "door_2"] : null) },
    );
    const ask = plan.steps.find((s) => s.kind === "ask");
    if (ask?.kind !== "ask") throw new Error("no ask");
    expect(ask.choose![0]).toEqual({ id: "pair_a", label: "pair a", members: ["door_1", "door_2"], box: { x: 0, y: 0, w: 300, h: 200 } });
  });

  test("gotos and then ride along", () => {
    const plan = planCommands(
      [
        { draw: ["bag_now", "bag_later"] },
        { ask: { question: "Which?", choose: [{ id: "bag_now", goto: "now" }, { id: "bag_later", goto: "later" }], then: "after" } } as Command,
        { label: "now" },
        { label: "later" },
        { label: "after" },
      ],
      IDS,
      { bboxOf: (id) => BOXES[id] ?? null },
    );
    const ask = plan.steps.find((s) => s.kind === "ask");
    if (ask?.kind !== "ask") throw new Error("no ask");
    expect(ask.choose!.map((o) => o.goto)).toEqual(["now", "later"]);
    expect(ask.then).toBe("after");
  });
});

describe("a judged choose", () => {
  test("right: {c} is the tapped thing's label, {c.id} its id; the answer glows green", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const p = player([...DOORS, { speak: "You picked {c.id}." }], speech, effects);
    let gated: unknown = null;
    p.askGate = async (_s, step) => {
      gated = step;
      return "door_2";
    };
    await p.play();
    expect((gated as { choose?: unknown[] }).choose).toHaveLength(3);
    expect(speech.spoken).toEqual(["Which door hides the car?", "Door two: Door 2.", "You picked door_2."]);
    expect(p.vars.get("c")).toBe("Door 2");
    expect(p.vars.get("c.id")).toBe("door_2");
    expect(p.vars.get("c.ok")).toBe("true");
    expect(p.vars.get("score")).toBe("1");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ ids: ["door_2"], color: "#4a7c59" });
  });

  test("wrong: the wrong line names the tapped thing, then the answer is revealed", async () => {
    const speech = new RecordingSpeech();
    const { effects, calls } = fakeEffects();
    const p = player(DOORS, speech, effects);
    p.askGate = async () => "door_3";
    await p.play();
    expect(speech.spoken).toEqual(["Which door hides the car?", "Not Door 3.", "Door two: Door 3."]);
    expect(p.vars.get("c.ok")).toBe("false");
    expect(p.vars.get("score")).toBe("0");
    // The reveal glows the right door in the highlight colour.
    expect(calls.some((c) => c.ids.join() === "door_2" && c.color === undefined)).toBe(true);
  });

  test("an answer the viewer gives is reported to onAnswer", async () => {
    const speech = new RecordingSpeech();
    const answers: unknown[] = [];
    const plan = planCommands(DOORS, IDS, { bboxOf: (id) => BOXES[id] ?? null, labelOf: (id) => LABELS[id] ?? null });
    const p = new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false }, { onAnswer: (a) => void answers.push(a) });
    p.askGate = async () => "door_1";
    await p.play();
    expect(answers).toMatchObject([{ kind: "ask", given: ["door_1"], expected: "door_2", correct: false }]);
  });
});

describe("an opinion (judge: false)", () => {
  test("right is spoken whatever is tapped, nothing is scored", async () => {
    const speech = new RecordingSpeech();
    const p = player(
      [
        { draw: ["bag_now", "bag_later"] },
        { ask: { question: "Which bag would you take?", choose: ["bag_now", "bag_later"], store: "c", judge: false, right: "You took {c}." } } as Command,
      ],
      speech,
    );
    p.askGate = async () => "bag_later";
    await p.play();
    expect(speech.spoken).toEqual(["Which bag would you take?", "You took Money later."]);
    expect(p.vars.get("c.id")).toBe("bag_later");
    expect(p.vars.has("c.ok")).toBe(false);
    expect(p.vars.get("score") ?? "0").toBe("0");
  });
});

describe("a branch (goto / then)", () => {
  const BRANCH: Command[] = [
    { draw: ["bag_now", "bag_later"] },
    { ask: { question: "Treat or wait?", choose: [{ id: "bag_now", goto: "treat" }, { id: "bag_later", goto: "wait" }], then: "after" } } as Command,
    { label: "treat" },
    { speak: "You treat." },
    { label: "wait" },
    { speak: "You wait." },
    { label: "after" },
    { speak: "Either way." },
  ];

  test("live: to the chosen branch, the other skipped, on at then", async () => {
    const speech = new RecordingSpeech();
    const p = player(BRANCH, speech);
    p.askGate = async () => "bag_now";
    await p.play();
    expect(speech.spoken).toEqual(["Treat or wait?", "You treat.", "Either way."]);
  });

  test("live: the second option jumps past the first branch", async () => {
    const speech = new RecordingSpeech();
    const p = player(BRANCH, speech);
    p.askGate = async () => "bag_later";
    await p.play();
    expect(speech.spoken).toEqual(["Treat or wait?", "You wait.", "Either way."]);
  });
});

describe("the movie", () => {
  test("the laser taps the answer and the answer stands; never waits", async () => {
    const speech = new RecordingSpeech();
    const { effects, pointer } = fakeEffects();
    const p = player(DOORS, speech, effects);
    p.autoAnswers = true;
    let gated = false;
    p.askGate = async () => {
      gated = true;
      return null;
    };
    await p.play();
    expect(gated).toBe(false);
    expect(pointer.some((x) => x !== null)).toBe(true);
    // The tap lands inside door_2's box.
    const first = pointer.find((x) => x !== null) as { x: number; y: number } | undefined;
    if (first && typeof first.x === "number") expect(first.x).toBeGreaterThanOrEqual(150);
    expect(p.vars.get("c.id")).toBe("door_2");
    expect(speech.spoken).toEqual(["Which door hides the car?", "Door two: Door 2."]);
  });

  test("the laser taps `default` when given, else the first option", async () => {
    const speech = new RecordingSpeech();
    const p = player(
      [
        { draw: ["bag_now", "bag_later"] },
        { ask: { question: "Which?", choose: ["bag_now", "bag_later"], store: "c", default: "bag_later", judge: false } } as Command,
      ],
      speech,
    );
    p.autoAnswers = true;
    await p.play();
    expect(p.vars.get("c.id")).toBe("bag_later");
    const q = new RecordingSpeech();
    const p2 = player([{ draw: ["bag_now", "bag_later"] }, { ask: { question: "Which?", choose: ["bag_now", "bag_later"], store: "c", judge: false } } as Command], q);
    p2.autoAnswers = true;
    await p2.play();
    expect(p2.vars.get("c")).toBe("Money now");
  });

  test("questions skipped: the default's label and id are stored", async () => {
    const speech = new RecordingSpeech();
    const plan = planCommands(
      [{ draw: ["bag_now", "bag_later"] }, { ask: { question: "Which?", choose: ["bag_now", "bag_later"], store: "c", default: "bag_later", judge: false } } as Command, { speak: "{c}" }],
      IDS,
      { bboxOf: (id) => BOXES[id] ?? null, labelOf: (id) => LABELS[id] ?? null },
    );
    const p = new Player(plan, new Map(), speech, null, { mode: "narrated", breath: false, questions: "skip" });
    await p.play();
    expect(speech.spoken).toEqual(["Money later"]);
    expect(p.vars.get("c.id")).toBe("bag_later");
  });
});
