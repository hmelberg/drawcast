import { describe, expect, test } from "vitest";
import { pianoKeyAt, pianoKeyBox, pianoNoteForKey, pianoOctaves } from "../src/render/widgets";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { PlayVoice } from "../src/spec/types";

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

describe("piano key geometry", () => {
  test("white keys map by column (1 octave starts at C4)", () => {
    const c4 = pianoKeyBox(1, "C4")!;
    expect(pianoKeyAt(1, [c4.x + c4.w / 2, c4.y + 10])).toBe("C4");
    const b4 = pianoKeyBox(1, "B4")!;
    expect(pianoKeyAt(1, [b4.x + b4.w / 2, b4.y + 10])).toBe("B4");
  });

  test("black keys win in the top zone", () => {
    const cs = pianoKeyBox(1, "C#4")!;
    expect(pianoKeyAt(1, [cs.x + cs.w / 2, cs.y + 10])).toBe("C#4");
    // Below the black zone, the same x belongs to a white key.
    expect(pianoKeyAt(1, [cs.x + cs.w / 2, 300])).toMatch(/^[CD]4$/);
  });

  test("two octaves start at C3; E has no sharp", () => {
    const c3 = pianoKeyBox(2, "C3")!;
    expect(pianoKeyAt(2, [c3.x + c3.w / 2, 300])).toBe("C3");
    expect(pianoKeyBox(1, "E#4")).toBe(null);
  });

  test("outside the keyboard is a miss", () => {
    expect(pianoKeyAt(1, [10, 400])).toBe(null);
    expect(pianoKeyAt(1, [500, 100])).toBe(null);
  });

  test("octaves param folds like the template", () => {
    expect(pianoOctaves({ octaves: 1 })).toBe(1);
    expect(pianoOctaves({ octaves: 2 })).toBe(2);
    expect(pianoOctaves({})).toBe(2);
    expect(pianoOctaves(null)).toBe(2);
  });
});

describe("typed-letter note entry", () => {
  test("the drawn label is the mapping: E types E4", () => {
    expect(pianoNoteForKey(1, "e", false)).toBe("E4");
    expect(pianoNoteForKey(1, "D", false)).toBe("D4");
    expect(pianoNoteForKey(2, "c", false)).toBe("C3");
  });

  test("Shift adds the sharp where one exists", () => {
    expect(pianoNoteForKey(1, "c", true)).toBe("C#4");
    expect(pianoNoteForKey(1, "e", true)).toBe(null); // E has no sharp
  });

  test("non-note keys are ignored", () => {
    expect(pianoNoteForKey(1, "x", false)).toBe(null);
    expect(pianoNoteForKey(1, "Enter", false)).toBe(null);
  });
});

describe("piano widget auto path", () => {
  test("the demo sounds the answer note and speaks right", async () => {
    const speech = new RecordingSpeech();
    const plan = planCommands(
      [{ ask: { question: "Press the E.", answer: "E4", widget: "piano", right: "E — the third." } }],
      [],
      { animateBase: { octaves: 1 } },
    );
    const s = plan.steps[0];
    if (s.kind !== "ask") throw new Error("no ask step");
    expect(s.answerBox).toEqual(pianoKeyBox(1, "E4"));
    const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
    const played: string[] = [];
    player.tones = {
      play: (voices: PlayVoice[]) => {
        played.push(voices[0].notes);
        return 100;
      },
      cancel: () => {},
      pause: () => {},
      resume: () => {},
    } as never;
    await player.play();
    expect(speech.spoken).toEqual(["Press the E.", "E — the third."]);
    expect(played).toEqual(["E4:q"]);
  });
});
