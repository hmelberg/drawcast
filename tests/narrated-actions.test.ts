import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

const base = {
  elements: [{ id: "t", type: "text", text: "hi", x: 500, y: 375 }],
};

describe("speak as a companion to an action verb", () => {
  test("draw + speak in one command validates", () => {
    expect(validateSpec({ ...base, commands: [{ draw: ["t"], speak: "here it comes" }] }).ok).toBe(true);
  });

  test("gestures take a speak companion too", () => {
    expect(validateSpec({ ...base, commands: [{ highlight: { target: ["t"] }, speak: "look here" }] }).ok).toBe(true);
    expect(validateSpec({ ...base, commands: [{ point: { at: { ref: "t" } }, speak: "right there" }] }).ok).toBe(true);
  });

  test("standalone speak still validates; two action verbs still do not", () => {
    expect(validateSpec({ ...base, commands: [{ speak: "hello" }] }).ok).toBe(true);
    expect(validateSpec({ ...base, commands: [{ draw: ["t"], pause: 1 }] }).ok).toBe(false);
  });

  test("blocking only applies to standalone speak", () => {
    const v = validateSpec({ ...base, commands: [{ draw: ["t"], speak: "x", blocking: false }] });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain("blocking");
  });
});

describe("planCommands — narrated action steps", () => {
  test("draw + speak becomes ONE draw step carrying the narration", () => {
    const plan = planCommands([{ draw: ["t"], speak: "as it draws" }] as Command[], ["t"]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: "draw", ids: ["t"], narration: "as it draws" });
    expect(plan.states[0].visible).toEqual(["t"]);
  });

  test("a narrated highlight keeps its narration", () => {
    const plan = planCommands(
      [{ draw: ["t"] }, { highlight: { target: ["t"] }, speak: "note this" }] as Command[],
      ["t"],
    );
    expect(plan.steps[1]).toMatchObject({ kind: "highlight", narration: "note this" });
  });
});

class StubSpeech extends SpeechManager {
  resolvers: (() => void)[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return new Promise((res) => this.resolvers.push(res));
  }
  override cancel(): void {}
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("Player — narrated actions join voice and animation", () => {
  test("a narrated draw step completes only when the voice finishes", async () => {
    const plan = planCommands([{ draw: ["x"], speak: "while drawing" }] as Command[], []);
    const speech = new StubSpeech();
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
    const done = player.play();
    await tick();
    // The (empty) animation finished instantly; the step must still be open.
    expect(player.position).toBe(0);
    speech.resolvers[0]();
    await done;
    expect(player.position).toBe(1);
    expect(player.state).toBe("done");
  });
});
