import { describe, expect, test } from "vitest";
import { hitElement } from "../src/ui/hit";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

// node has no rAF; drive Player.progress with a timer-based stand-in.
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

describe("hitElement", () => {
  const boxes = new Map([
    ["big", { x: 0, y: 0, w: 100, h: 100 }],
    ["small", { x: 40, y: 40, w: 20, h: 20 }],
    ["off", { x: 200, y: 200, w: 10, h: 10 }],
  ]);

  test("the smallest containing box wins", () => {
    expect(hitElement(boxes, [50, 50])).toBe("small");
    expect(hitElement(boxes, [10, 10])).toBe("big");
  });

  test("a miss returns null", () => {
    expect(hitElement(boxes, [150, 150])).toBe(null);
  });
});

describe("widget validation", () => {
  const spec = (ask: object) => ({
    elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
    commands: [{ draw: ["a"] }, { ask }],
  });

  test("widget click with an answer passes", () => {
    expect(validateSpec(spec({ question: "Click it.", answer: "a", widget: "click" })).ok).toBe(true);
  });

  test("widget without answer fails", () => {
    expect(validateSpec(spec({ question: "Click it.", widget: "click", store: "x", default: "a" })).ok).toBe(false);
  });

  test("an unknown widget name fails", () => {
    expect(validateSpec(spec({ question: "Q?", answer: "a", widget: "harp" })).ok).toBe(false);
  });
});

describe("widget planning and the auto demo", () => {
  const CMDS: Command[] = [
    { draw: ["eq"] },
    { ask: { question: "Click the equilibrium.", answer: "eq", widget: "click", right: "There it is." } },
  ];
  const bboxOf = (id: string) => (id === "eq" ? { x: 10, y: 20, w: 30, h: 40 } : null);

  test("the ask step carries widget and the answer's box", () => {
    const plan = planCommands(CMDS, ["eq"], { bboxOf });
    const s = plan.steps.find((st) => st.kind === "ask");
    if (s?.kind !== "ask") throw new Error("no ask step");
    expect(s.widget).toBe("click");
    expect(s.answerBox).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  test("auto path (no gate): resolves the answer and speaks right", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(CMDS, ["eq"], { bboxOf }), new Map(), speech, null, { mode: "narrated" });
    await player.play();
    expect(speech.spoken).toEqual(["Click the equilibrium.", "There it is."]);
    expect(player.state).toBe("done");
  });

  test("a live gate resolving the clicked id is judged as usual", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(CMDS, ["eq"], { bboxOf }), new Map(), speech, null, { mode: "narrated" });
    player.askGate = async () => "eq";
    await player.play();
    expect(speech.spoken).toEqual(["Click the equilibrium.", "There it is."]);
  });
});
