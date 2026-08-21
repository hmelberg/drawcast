import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

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

function makePlayer(commands: Command[], speech: SpeechManager): Player {
  // No elements: draw steps carry no animation, so completion order reflects
  // pure sequencing — exactly what these tests are about.
  const plan = planCommands(commands, []);
  return new Player(plan, new Map(), speech, null, { mode: "narrated" });
}

describe("narration barrier — visuals never race ahead of the voice", () => {
  test("a draw step waits for pending non-blocking narration to finish", async () => {
    const speech = new StubSpeech();
    const player = makePlayer([{ speak: "about the last element", blocking: false }, { draw: ["x"] }], speech);
    const done = player.play();
    await tick();
    // The speak step completed (non-blocking), but the draw must be held
    // until the sentence lands.
    expect(player.position).toBe(1);
    speech.resolvers[0]();
    await done;
    expect(player.position).toBe(2);
    expect(player.state).toBe("done");
  });

  test("a wait gate also lands after the narration", async () => {
    const speech = new StubSpeech();
    let gated = false;
    const player = makePlayer([{ speak: "listen first", blocking: false }, { wait: "click" }], speech);
    player.inputGate = () => {
      gated = true;
      return Promise.resolve();
    };
    const done = player.play();
    await tick();
    expect(gated).toBe(false); // still narrating — no gate yet
    speech.resolvers[0]();
    await done;
    expect(gated).toBe(true);
  });

  test("consecutive beats stay in lockstep: second draw waits for second sentence", async () => {
    const speech = new StubSpeech();
    const player = makePlayer(
      [
        { draw: ["a"] },
        { speak: "about a", blocking: false },
        { draw: ["b"] },
        { speak: "about b", blocking: false },
        { draw: ["c"] },
      ],
      speech,
    );
    const done = player.play();
    await tick();
    expect(player.position).toBe(2); // held before draw b
    speech.resolvers[0]();
    await tick();
    expect(player.position).toBe(4); // held before draw c
    speech.resolvers[1]();
    await done;
    expect(player.position).toBe(5);
  });
});
