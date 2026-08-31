// The CC track in the player: the caption is translated, the narration is not.
//
// Two invariants worth holding down. First, the VOICE stays in the language
// the drawcast was recorded in — a subtitle track is text, and swapping the
// caption must never change what is spoken. Second, translation happens
// BEFORE {var} substitution: the translator copies curly-brace tokens through
// verbatim, so the track's keys are the raw spec lines, and looking one up
// after substitution would miss every personalized line.
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

/** The caption element, reduced to what Player actually touches. */
function fakeCaption() {
  const classes = new Set<string>();
  return {
    textContent: "",
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      has: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement & { classList: { has(n: string): boolean } };
}

const NB = {
  "Supply meets demand.": "Tilbud møter etterspørsel.",
  "The price settles.": "Prisen faller til ro.",
};

function makePlayer(commands: Command[], speech: RecordingSpeech, caption?: HTMLElement) {
  return new Player(planCommands(commands, []), new Map(), speech, caption ?? null, { mode: "narrated" });
}

const TWO_LINES: Command[] = [{ speak: "Supply meets demand." }, { speak: "The price settles." }];

describe("the caption follows the chosen track", () => {
  test("with no track, the caption is the source line", async () => {
    const cap = fakeCaption();
    const player = makePlayer(TWO_LINES, new RecordingSpeech(), cap);
    await player.play();
    expect(cap.textContent).toBe("The price settles.");
  });

  test("with a track, the caption is translated", async () => {
    const cap = fakeCaption();
    const player = makePlayer(TWO_LINES, new RecordingSpeech(), cap);
    player.setSubtitles(NB);
    await player.play();
    expect(cap.textContent).toBe("Prisen faller til ro.");
  });

  test("the narration is NOT translated — the recorded voice is the source language", async () => {
    const speech = new RecordingSpeech();
    const player = makePlayer(TWO_LINES, speech, fakeCaption());
    player.setSubtitles(NB);
    await player.play();
    expect(speech.spoken).toEqual(["Supply meets demand.", "The price settles."]);
  });

  test("a line the track misses keeps its source wording rather than going blank", async () => {
    const cap = fakeCaption();
    const player = makePlayer([{ speak: "A line nobody translated." }], new RecordingSpeech(), cap);
    player.setSubtitles(NB);
    await player.play();
    expect(cap.textContent).toBe("A line nobody translated.");
  });
});

describe("switching language mid-drawcast", () => {
  test("the caption on screen is re-rendered at once, without moving the playhead", async () => {
    const cap = fakeCaption();
    const player = makePlayer(TWO_LINES, new RecordingSpeech(), cap);
    await player.play();
    expect(cap.textContent).toBe("The price settles.");
    const at = player.position;

    player.setSubtitles(NB);
    expect(cap.textContent).toBe("Prisen faller til ro.");
    expect(player.position).toBe(at);

    player.setSubtitles(undefined);
    expect(cap.textContent).toBe("The price settles.");
  });

  test("the empty caption between beats stays empty in every language", async () => {
    const cap = fakeCaption();
    const player = makePlayer(TWO_LINES, new RecordingSpeech(), cap);
    player.showPoster();
    expect(cap.textContent).toBe("");
    player.setSubtitles(NB);
    expect(cap.textContent).toBe("");
    expect(cap.classList.has("cs-caption-empty")).toBe(true);
  });
});

describe("{var} tokens", () => {
  // The translator is told to copy curly braces exactly, so a track's keys are
  // the RAW spec lines. Translating after substitution would look up
  // "You answered up." and find nothing.
  const ASKED: Command[] = [
    { ask: { question: "Which way?", store: "answer", default: "up" } },
    { speak: "You answered {answer}." },
  ];

  test("the track is keyed on the un-substituted line, and the value is substituted after", async () => {
    const cap = fakeCaption();
    const player = makePlayer(ASKED, new RecordingSpeech(), cap);
    player.askGate = async () => "up";
    player.setSubtitles({ "You answered {answer}.": "Du svarte {answer}." });
    await player.play();
    expect(cap.textContent).toBe("Du svarte up.");
  });
});
