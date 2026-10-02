// A choose (or decide) branch shapes the figure with the chosen branch's
// steps only (final fix wave E, item 1): the course's doors — pick door 1,
// and at "Stay or switch?" the figure showed You under door 3 and door 1
// open, because the scene at the jump to `then` was the plan's linear state
// (every branch applied in order).

import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class QuietSpeech extends SpeechManager {
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

interface Fake {
  id: string;
  durationMs: number;
  shown: boolean;
  off: [number, number];
  alpha: number;
  setProgress(t: number): void;
  finish(): void;
  hide(): void;
  setOffset(dx: number, dy: number): void;
  setOpacity(a: number): void;
}
const fake = (id: string): Fake => ({
  id,
  durationMs: 0,
  shown: false,
  off: [0, 0],
  alpha: 1,
  setProgress(t) {
    this.shown = t > 0;
  },
  finish() {
    this.shown = true;
  },
  hide() {
    this.shown = false;
  },
  setOffset(dx, dy) {
    this.off = [dx, dy];
  },
  setOpacity(a) {
    this.alpha = a;
  },
});

const BOXES: Record<string, { x: number; y: number; w: number; h: number }> = {
  door_1: { x: 0, y: 0, w: 100, h: 200 },
  door_2: { x: 200, y: 0, w: 100, h: 200 },
  door_3: { x: 400, y: 0, w: 100, h: 200 },
  you: { x: 0, y: -60, w: 100, h: 40 },
  goat_1: { x: 0, y: 220, w: 60, h: 60 },
  goat_3: { x: 400, y: 220, w: 60, h: 60 },
  marker: { x: 600, y: 0, w: 40, h: 40 },
};
const IDS = Object.keys(BOXES);

const DOORS: Command[] = [
  { draw: ["door_1", "door_2", "door_3"] },
  {
    ask: {
      question: "Pick a door.",
      choose: [
        { id: "door_1", goto: "p1" },
        { id: "door_2", goto: "p2" },
        { id: "door_3", goto: "p3" },
      ],
      then: "offer",
      store: "d",
      judge: false,
    },
  } as Command,
  { label: "p1" },
  { draw: ["you"] },
  { fade: { target: ["door_3"], to: 0.15 } },
  { draw: ["goat_3"] },
  { label: "p2" },
  { draw: ["you"] },
  { move: { target: "you", by: [200, 0] } },
  { fade: { target: ["door_3"], to: 0.15 } },
  { draw: ["goat_3"] },
  { label: "p3" },
  { draw: ["you"] },
  { move: { target: "you", by: [400, 0] } },
  { fade: { target: ["door_1"], to: 0.15 } },
  { draw: ["goat_1"] },
  { label: "offer" },
  { speak: "Stay or switch?" },
  { draw: ["marker"] },
  { speak: "The end." },
];

function run(commands: Command[]) {
  const plan = planCommands(commands, IDS, { bboxOf: (id) => BOXES[id] ?? null });
  const els = new Map(IDS.map((id) => [id, fake(id)]));
  const speech = new QuietSpeech();
  const p = new Player(plan, els as never, speech, null, { mode: "narrated", breath: false });
  return { p, els, speech, plan };
}

describe("a choose branch shapes the figure with its own steps only", () => {
  test("door 1: at the offer, You under door 1, door 3 open on a goat, door 1 closed", async () => {
    const { p, els, speech } = run(DOORS);
    p.askGate = async () => "door_1";
    await p.play();
    expect(speech.spoken).toEqual(["Pick a door.", "Stay or switch?", "The end."]);
    expect(els.get("you")!.shown).toBe(true);
    expect(els.get("you")!.off).toEqual([0, 0]);
    expect(els.get("goat_3")!.shown).toBe(true);
    expect(els.get("goat_1")!.shown).toBe(false);
    expect(els.get("door_1")!.alpha).toBe(1);
    expect(els.get("door_3")!.alpha).toBeCloseTo(0.15);
    expect(els.get("marker")!.shown).toBe(true);
  });

  test("door 2: entering the branch drops door 1's branch; at the offer You under door 2", async () => {
    const { p, els } = run(DOORS);
    p.askGate = async () => "door_2";
    await p.play();
    expect(els.get("you")!.off).toEqual([200, 0]);
    expect(els.get("goat_3")!.shown).toBe(true);
    expect(els.get("goat_1")!.shown).toBe(false);
    expect(els.get("door_1")!.alpha).toBe(1);
    expect(els.get("door_3")!.alpha).toBeCloseTo(0.15);
  });

  test("door 3: the last branch, entered without the first two's steps", async () => {
    const { p, els } = run(DOORS);
    p.askGate = async () => "door_3";
    await p.play();
    expect(els.get("you")!.off).toEqual([400, 0]);
    expect(els.get("goat_3")!.shown).toBe(false);
    expect(els.get("goat_1")!.shown).toBe(true);
    expect(els.get("door_3")!.alpha).toBe(1);
    expect(els.get("door_1")!.alpha).toBeCloseTo(0.15);
  });

  test("a scrub back before the choose forgets the branch: the planned figure again", async () => {
    const { p, els, plan } = run(DOORS);
    p.askGate = async () => "door_1";
    await p.play();
    p.renderUpTo(1);
    expect(els.get("you")!.shown).toBe(false);
    p.renderUpTo(plan.steps.length);
    // Nothing chosen any more: the plan's own (linear) end.
    expect(els.get("goat_1")!.shown).toBe(true);
  });
});

describe("the planner starts every branch from the question's figure", () => {
  test("a decide card's branches (cardsFor gotos) each start from the ask", () => {
    const plan = planCommands(
      [
        { draw: ["door_1"] },
        { ask: { question: "Stay or switch?", on: "move" } } as Command,
        { label: "stay" },
        { draw: ["goat_1"] },
        { label: "switch" },
        { draw: ["goat_3"] },
        { label: "open" },
      ],
      [...IDS, "move", "move_1", "move_2"],
      {
        bboxOf: (id) => BOXES[id] ?? null,
        cardsFor: (id) => (id === "move" ? { cards: ["move_1", "move_2"], offsets: {}, gotos: ["stay", "switch"] } : null),
      },
    );
    const sw = plan.labels["switch"];
    // The switch branch's label boundary (after the label step) has no goat_1.
    expect(plan.states[sw].visible).not.toContain("goat_1");
    expect(plan.states[sw + 1].visible).toContain("goat_3");
    expect(plan.states[sw + 1].visible).not.toContain("goat_1");
  });

  test("an ordinary label (no branching question) changes nothing", () => {
    const plan = planCommands([{ draw: ["door_1"] }, { label: "a" }, { draw: ["door_2"] }, { label: "b" }], IDS, { bboxOf: (id) => BOXES[id] ?? null });
    expect(plan.states[plan.labels["b"]].visible).toEqual(["door_1", "door_2"]);
  });
});
