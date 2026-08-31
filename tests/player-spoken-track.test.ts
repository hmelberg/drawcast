// What you READ and what you HEAR are two independent choices.
//
// Someone may want Norwegian subtitles over the original English narration
// (read-along), or Norwegian narration under English subtitles (a language
// learner), or both in one language. The player holds one track for each and
// never couples them.
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

function fakeCaption() {
  return {
    textContent: "",
    classList: { toggle: () => {} },
  } as unknown as HTMLElement;
}

const NB = { "Supply meets demand.": "Tilbud møter etterspørsel." };
const LINES: Command[] = [{ speak: "Supply meets demand." }];

function play(commands: Command[]) {
  const speech = new RecordingSpeech();
  const cap = fakeCaption();
  const player = new Player(planCommands(commands, []), new Map(), speech, cap, { mode: "narrated" });
  return { speech, cap, player };
}

describe("the two tracks are independent", () => {
  test("subtitles only: Norwegian text, original voice — the read-along case", async () => {
    const { speech, cap, player } = play(LINES);
    player.setSubtitles(NB);
    await player.play();
    expect(cap.textContent).toBe("Tilbud møter etterspørsel.");
    expect(speech.spoken).toEqual(["Supply meets demand."]);
  });

  test("voice only: Norwegian narration under English subtitles", async () => {
    const { speech, cap, player } = play(LINES);
    player.setSpokenTrack(NB);
    await player.play();
    expect(cap.textContent).toBe("Supply meets demand.");
    expect(speech.spoken).toEqual(["Tilbud møter etterspørsel."]);
  });

  test("both: the whole drawcast in Norwegian", async () => {
    const { speech, cap, player } = play(LINES);
    player.setSubtitles(NB);
    player.setSpokenTrack(NB);
    await player.play();
    expect(cap.textContent).toBe("Tilbud møter etterspørsel.");
    expect(speech.spoken).toEqual(["Tilbud møter etterspørsel."]);
  });

  test("neither: unchanged from before any of this existed", async () => {
    const { speech, cap, player } = play(LINES);
    await player.play();
    expect(cap.textContent).toBe("Supply meets demand.");
    expect(speech.spoken).toEqual(["Supply meets demand."]);
  });
});

describe("the spoken track covers every line the voice says", () => {
  const ASKED: Command[] = [
    { draw: ["a"], speak: "The curve goes up." },
    { quiz: { question: "Which way?", choices: ["down", "up"], correct: 2, right: "Up it goes." } },
  ];
  const TRACK = {
    "The curve goes up.": "Kurven går opp.",
    "Which way?": "Hvilken vei?",
    "Up it goes.": "Opp går den.",
  };

  test("narration on an action step, and a question's feedback, are both translated", async () => {
    const { speech, player } = play(ASKED);
    player.setSpokenTrack(TRACK);
    player.quizGate = async (_s, step) => step.correct;
    await player.play();
    expect(speech.spoken).toEqual(["Kurven går opp.", "Hvilken vei?", "Opp går den."]);
  });
});

describe("switching mid-drawcast", () => {
  test("changing the spoken track does not move the playhead or rewrite the caption", async () => {
    const { cap, player } = play(LINES);
    player.setSubtitles(NB);
    await player.play();
    const at = player.position;
    player.setSpokenTrack(NB);
    expect(player.position).toBe(at);
    expect(cap.textContent).toBe("Tilbud møter etterspørsel.");
  });

  test("a line the spoken track misses is said in the source language", async () => {
    const { speech, player } = play([{ speak: "Never translated." }]);
    player.setSpokenTrack(NB);
    await player.play();
    expect(speech.spoken).toEqual(["Never translated."]);
  });
});
