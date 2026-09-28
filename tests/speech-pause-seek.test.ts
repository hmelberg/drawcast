import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

/**
 * A speechSynthesis that behaves like Chrome and Safari where it matters:
 * cancel() empties the queue but leaves `paused` standing, and nothing is
 * heard while paused — an utterance spoken then only starts on resume().
 */
class FakeSynth {
  paused = false;
  speaking = false;
  pending = false;
  queue: Array<{ text: string; onstart?: () => void; onend?: () => void }> = [];
  heard: string[] = [];
  getVoices() {
    return [];
  }
  addEventListener() {}
  speak(u: { text: string; onstart?: () => void; onend?: () => void }) {
    this.queue.push(u);
    this.pending = true;
    this.pump();
  }
  cancel() {
    this.queue = [];
    this.pending = false;
    this.speaking = false;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    this.pump();
  }
  private pump() {
    if (this.paused) return;
    const u = this.queue.shift();
    if (!u) return;
    this.heard.push(u.text);
    u.onstart?.();
    setTimeout(() => u.onend?.(), 5);
  }
}

const g = globalThis as Record<string, unknown>;
let synth: FakeSynth;

beforeEach(() => {
  synth = new FakeSynth();
  g.window = { speechSynthesis: synth };
  g.SpeechSynthesisUtterance = class {
    text: string;
    constructor(t: string) {
      this.text = t;
    }
  };
});
afterEach(() => {
  delete g.window;
  delete g.SpeechSynthesisUtterance;
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("pause → seek → play keeps the voice", () => {
  test("SpeechManager.cancel() lifts a pause the browser keeps across cancel", () => {
    const speech = new SpeechManager();
    speech.pause();
    expect(synth.paused).toBe(true);
    speech.cancel();
    expect(synth.paused).toBe(false);
  });

  test("a seek while paused, then play, is heard", async () => {
    const commands: Command[] = [{ speak: "first line" }, { speak: "second line" }, { speak: "third line" }];
    const player = new Player(planCommands(commands, []), new Map(), new SpeechManager(), null, { mode: "narrated", breath: false });
    void player.play();
    await tick(1);
    expect(synth.heard).toEqual(["first line"]);
    player.pause();
    expect(synth.paused).toBe(true);
    // the seek bar / ☰ jump / step across a part edge all land here
    player.renderUpTo(1);
    const done = player.play();
    await tick();
    expect(synth.heard).toContain("second line");
    player.renderUpTo(3);
    await done;
  });

  test("a fresh run resumes a synthesizer left paused by someone else", async () => {
    const player = new Player(planCommands([{ speak: "only line" }], []), new Map(), new SpeechManager(), null, { mode: "narrated", breath: false });
    synth.pause();
    const done = player.play();
    await tick();
    expect(synth.heard).toEqual(["only line"]);
    await done;
  });
});
