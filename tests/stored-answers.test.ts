// The stored-answers round (spec docs/superpowers/specs/2026-09-15-stored-answers-design.md):
// quiz store, the _answers namespace with .ok/.secs, carry across playlist
// items, the movie's mirror of the names, the local record, and the lint.
import { describe, expect, test } from "vitest";
import { collectSpeakLines } from "../src/export/video";
import { AnswerCarry, questionCount, questionOffsets } from "../src/playlist/carry";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command, Spec } from "../src/spec/types";

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

function makePlayer(commands: Command[], speech: RecordingSpeech, opts: { vars?: Map<string, string>; questionOffset?: number } = {}) {
  return new Player(planCommands(commands, []), new Map(), speech, null, { mode: "narrated", ...opts });
}

describe("the _answers namespace in the player", () => {
  test("every question lands under _answers.N with .ok, .secs, last and count; a store name gets the same fields", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
        { ask: { question: "Name?", store: "name", default: "friend" } },
        { ask: { question: "Two?", answer: "x" } },
        { speak: "{_answers.1}/{_answers.1.ok} {_answers.2}/{name.ok} {_answers.3}/{_answers.3.ok} last={_answers.last} n={_answers.count}" },
      ],
      speech,
    );
    player.quizGate = async () => 1;
    player.askGate = async (_s, step) => (step.store ? "Hans" : "x");
    await player.play();
    expect(speech.spoken.at(-1)).toBe("b/false Hans/{name.ok} x/true last=x n=3");
    expect(player.vars.get("_answers.1.secs")).toMatch(/^\d+\.\d$/);
    expect(player.vars.get("name.secs")).toMatch(/^\d+\.\d$/);
    expect(player.vars.get("_answers.last.secs")).toBe(player.vars.get("_answers.3.secs"));
  });

  test("questionOffset continues the numbering and a seeded map is readable", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer([{ quiz: { question: "One?", choices: ["a", "b"], correct: 1 } }, { speak: "Hi {name}: {_answers.3} then {_answers.1}" }], speech, {
      vars: new Map([
        ["name", "Hans"],
        ["_answers.1", "old"],
      ]),
      questionOffset: 2,
    });
    player.quizGate = async () => 0;
    await player.play();
    expect(speech.spoken.at(-1)).toBe("Hi Hans: a then old");
  });

  test("a skipped question keeps its ordinal for the next one; no gate means no seconds", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { quiz: { question: "One?", choices: ["a", "b"], correct: 1 } },
        { quiz: { question: "Two?", choices: ["a", "b"], correct: 2 } },
        { speak: "{_answers.2} {_answers.count}" },
      ],
      speech,
    );
    const answers: (number | null)[] = [null, 1];
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken.at(-1)).toBe("b 2");
    const bare = makePlayer([{ quiz: { question: "One?", choices: ["a", "b"], correct: 1 } }, { speak: "{_answers.1.secs}" }], new RecordingSpeech());
    await bare.play();
    expect(bare.vars.get("_answers.1")).toBe("a");
    expect(bare.vars.has("_answers.1.secs")).toBe(false);
  });

  test("re-answering after a wrong_goto overwrites the same ordinal — latest wins", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(
      [
        { label: "recap" },
        { speak: "Think." },
        { quiz: { question: "One?", choices: ["a", "b"], correct: 1, wrong_goto: "recap", store: "pick" } },
        { speak: "{pick} {_answers.1} {_answers.1.ok} n={_answers.count}" },
      ],
      speech,
    );
    const answers = [1, 0];
    player.quizGate = async () => answers.shift() ?? null;
    await player.play();
    expect(speech.spoken.at(-1)).toBe("a a true n=1");
  });
});

describe("the movie's lines", () => {
  test("store the correct option under a quiz store", () => {
    const lines = collectSpeakLines({
      elements: [],
      commands: [{ quiz: { question: "Pick?", choices: ["apples", "pears"], correct: 2, store: "pick" } }, { speak: "You chose {pick}." }],
    } as unknown as Spec);
    expect(lines.map((l) => l.text)).toContain("You chose pears.");
  });
});

describe("carry across playlist items", () => {
  const a = {
    elements: [],
    commands: [{ quiz: { question: "?", choices: ["a", "b"], correct: 1 } }, { ask: { question: "?", answer: "x" } }, { speak: "x" }],
  } as unknown as Spec;
  const b = { elements: [], commands: [{ ask: { question: "?", store: "n", default: "d" } }] } as unknown as Spec;

  test("question offsets are static sums of earlier items' quiz/ask commands", () => {
    expect(questionCount(a)).toBe(2);
    expect(questionOffsets([a, b, a])).toEqual([0, 2, 3]);
  });

  test("the plan has exactly one quiz/ask step per counted command — the offsets and the ordinals agree", () => {
    const plan = planCommands(a.commands, []);
    expect(plan.steps.filter((s) => s.kind === "quiz" || s.kind === "ask")).toHaveLength(questionCount(a));
  });

  test("the carry absorbs a player's map, latest wins", () => {
    const c = new AnswerCarry();
    c.absorb(
      new Map([
        ["name", "Hans"],
        ["_answers.1", "a"],
      ]),
    );
    c.absorb(
      new Map([
        ["_answers.1", "b"],
        ["_answers.count", "1"],
      ]),
    );
    expect(c.vars.get("name")).toBe("Hans");
    expect(c.vars.get("_answers.1")).toBe("b");
  });

  test("the movie's lines name every question _answers.N with the auto answer and carry across items", () => {
    const carry = { vars: new Map<string, string>(), questionOffset: 0 };
    const first = {
      elements: [],
      commands: [{ ask: { question: "Name?", store: "name", default: "friend" } }, { quiz: { question: "?", choices: ["a", "b"], correct: 2 } }],
    } as unknown as Spec;
    const second = { elements: [], commands: [{ speak: "Hi {name}, {_answers.2}, {_answers.2.ok}, {_answers.last}, n={_answers.count}" }] } as unknown as Spec;
    collectSpeakLines(first, carry);
    const lines = collectSpeakLines(second, { vars: carry.vars, questionOffset: 2 });
    expect(lines.map((l) => l.text)).toContain("Hi friend, b, true, b, n=2");
    expect(carry.vars.has("_answers.1.secs")).toBe(false);
    expect(carry.vars.has("name.ok")).toBe(false); // collect mode: nothing judged
  });
});
