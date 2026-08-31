// Building a subtitle track: which lines to send, and putting the answer back.
//
// The set of lines matters more than it looks. A track keyed on a line the
// caption never shows is waste; a line the caption DOES show and the track
// misses reverts to the source language mid-drawcast, which is the failure a
// viewer actually notices. So the collector is pinned to the player by a test
// that runs the real Player and checks that every caption it displayed was
// offered for translation — not by a second reading of the same rules.
import { describe, expect, test } from "vitest";
import { captionLines, withSubtitles } from "../src/llm/subtitles";
import { Player } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command, Spec } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class MuteSpeech extends SpeechManager {
  override get available(): boolean {
    return false;
  }
  override speak(): Promise<void> {
    return Promise.resolve();
  }
  override cancel(): void {}
}

/** Records every caption the player put on screen. */
function recordingCaption(seen: string[]) {
  return {
    set textContent(v: string) {
      seen.push(v);
    },
    get textContent() {
      return seen[seen.length - 1] ?? "";
    },
    classList: { toggle: () => {} },
  } as unknown as HTMLElement;
}

const spec = (commands: Command[]): Spec => ({ elements: [], commands }) as Spec;

// Every construct that can put words in the caption.
const EVERYTHING: Command[] = [
  { speak: "Supply meets demand." },
  { draw: ["a"], speak: "The curve goes up." },
  {
    quiz: {
      question: "Which way?",
      intro: "Think about it.",
      choices: ["down", "up"],
      correct: 2,
      right: "Up it goes.",
      wrong: "Not quite.",
    },
  },
  {
    ask: { question: "Name the point?", answer: "equilibrium", right: "That's it.", wrong: "Try again.", reveal: true },
  },
  { quiz: { question: "And the price?", choices: ["falls", "rises"], correct: 1 } },
  { ask: { question: "And the quantity?", answer: "equilibrium", reveal: true } },
];

describe("captionLines", () => {
  test("collects narration, speak, and both sides of a question's feedback", () => {
    const lines = captionLines(spec(EVERYTHING));
    for (const expected of [
      "Supply meets demand.",
      "The curve goes up.",
      "Up it goes.",
      "Not quite.",
      "That's it.",
      "Try again.",
      "falls", // a quiz with no `right` reveals the correct choice instead
      "equilibrium", // an ask with no `right` reveals the answer instead
    ]) {
      expect(lines).toContain(expected);
    }
  });

  test("the bare answer is NOT collected when the ask has its own reveal line", () => {
    // `right ?? answer`: with a `right` line the answer string is never spoken,
    // so subtitling it would pay for a line no viewer ever reads.
    const lines = captionLines(spec([{ ask: { question: "Q?", answer: "secret", right: "That's it.", reveal: true } }]));
    expect(lines).toContain("That's it.");
    expect(lines).not.toContain("secret");
  });

  test("no duplicates — the same sentence is translated once", () => {
    const lines = captionLines(spec([{ speak: "Twice." }, { draw: ["a"], speak: "Twice." }]));
    expect(lines.filter((l) => l === "Twice.")).toHaveLength(1);
  });

  test("blank and absent lines are not sent", () => {
    expect(captionLines(spec([{ draw: ["a"] }, { speak: "   " }]))).toEqual([]);
  });

  test("a figure of pure geometry has nothing to subtitle", () => {
    expect(captionLines(spec([{ draw: ["a"] }]))).toEqual([]);
  });
});

describe("what the player actually shows is what we offer to translate", () => {
  /** Play once, answering every question the given way; return the captions. */
  async function captionsFrom(commands: Command[], answer: "right" | "wrong"): Promise<string[]> {
    const seen: string[] = [];
    const player = new Player(planCommands(commands, []), new Map(), new MuteSpeech(), recordingCaption(seen), {
      mode: "narrated",
    });
    player.quizGate = async (_s, step) => (answer === "right" ? step.correct : (step.correct + 1) % step.choices.length);
    player.askGate = async (_s, step) => (answer === "right" ? (step.answer ?? "") : "nonsense");
    await player.play();
    return seen.filter((t) => t.trim() !== "");
  }

  test("every caption on the correct path was offered", async () => {
    const offered = new Set(captionLines(spec(EVERYTHING)));
    for (const shown of await captionsFrom(EVERYTHING, "right")) expect([...offered]).toContain(shown);
  });

  test("every caption on the wrong path was offered too", async () => {
    // The movie never speaks the `wrong` line, so a collector built from the
    // export's line list would miss it — and a live viewer who answers wrong
    // is exactly who gets it.
    const offered = new Set(captionLines(spec(EVERYTHING)));
    for (const shown of await captionsFrom(EVERYTHING, "wrong")) expect([...offered]).toContain(shown);
  });
});

describe("withSubtitles", () => {
  const base = { ...spec([{ speak: "Hello." }]), title: "T" };

  test("adds a track without touching anything else", () => {
    const out = withSubtitles(base, "nb", { "Hello.": "Hei." });
    expect(out.subtitles).toEqual({ nb: { "Hello.": "Hei." } });
    expect(out.title).toBe("T");
    expect(out.commands).toEqual(base.commands);
  });

  test("a second language joins the first rather than replacing it", () => {
    const one = withSubtitles(base, "nb", { "Hello.": "Hei." });
    const two = withSubtitles(one, "de", { "Hello.": "Hallo." });
    expect(Object.keys(two.subtitles!).sort()).toEqual(["de", "nb"]);
  });

  test("re-translating a language replaces that track outright", () => {
    const one = withSubtitles(base, "nb", { "Hello.": "Hei.", Stale: "Gammel" });
    const two = withSubtitles(one, "nb", { "Hello.": "Hallo der." });
    expect(two.subtitles!.nb).toEqual({ "Hello.": "Hallo der." });
  });

  test("the original spec is never mutated — the library holds these objects by reference", () => {
    withSubtitles(base, "nb", { "Hello.": "Hei." });
    expect(base.subtitles).toBeUndefined();
  });

  test("an empty track removes the language instead of leaving a dead entry in the CC menu", () => {
    const one = withSubtitles(base, "nb", { "Hello.": "Hei." });
    expect(withSubtitles(one, "nb", {}).subtitles).toBeUndefined();
  });
});
