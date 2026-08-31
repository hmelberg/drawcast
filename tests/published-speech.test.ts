// Speaking from audio that was baked at publish time.
//
// The lookup is the whole design: a clip is found by the SENTENCE it speaks,
// never by its position. A drawcast is not a linear tape — a wrong quiz answer
// can goto back and replay lines, ask/retry repeats until the viewer is right,
// a right answer skips ahead, and skipQuestions drops whole steps. An ordered
// list of clips would desync the moment anyone answered a question wrong.
//
// Keying by sentence also buys the safety property for free: edit a line and
// the lookup misses, so it speaks live rather than speaking yesterday's words.
import { describe, expect, test, vi } from "vitest";
import { PublishedSpeech } from "../src/render/published-speech";
import { SpeechManager } from "../src/render/speech";
import { speechKey } from "../src/render/delivery";

/** Records what it was asked to say; stands in for CloudSpeech/browser voice. */
class InnerSpeech extends SpeechManager {
  spoken: string[] = [];
  cancelled = 0;
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }
  override cancel(): void {
    this.cancelled++;
  }
}

/** A ClipSource that resolves immediately and records what it played. */
function fakeClips(keys: string[]) {
  const played: string[] = [];
  const have = new Set(keys);
  return {
    played,
    stop: vi.fn(),
    setMuted: vi.fn(),
    has: (key: string) => have.has(key),
    play: vi.fn(async (key: string) => {
      played.push(key);
    }),
  };
}

const LINE = "Supply meets demand.";
const KEY = speechKey({ text: LINE });

describe("a baked line plays from its clip", () => {
  test("the clip is played and the inner voice never speaks", async () => {
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(inner, f);
    await speech.speak(LINE, 1);
    expect(f.played).toEqual([KEY]);
    expect(inner.spoken).toEqual([]);
  });

  test("the speed multiplier reaches the player, so 2x is honoured", async () => {
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(new InnerSpeech(), f);
    await speech.speak(LINE, 2);
    expect(f.play).toHaveBeenCalledWith(KEY, 2, undefined);
  });

  test("the same sentence in another voice is a different clip", async () => {
    // speechKey carries gender/speaker/delivery, so a line said twice by two
    // narrators cannot collide onto one recording.
    const male = speechKey({ text: LINE, gender: "male" });
    const f = fakeClips([male]);
    const inner = new InnerSpeech();
    const speech = new PublishedSpeech(inner, f);
    await speech.speak(LINE, 1, undefined, { gender: "female" });
    expect(f.played).toEqual([]);
    expect(inner.spoken).toEqual([LINE]);
  });
});

describe("anything not baked falls through", () => {
  test("a line with no clip is spoken by the inner manager", async () => {
    const inner = new InnerSpeech();
    const f = fakeClips([]);
    const speech = new PublishedSpeech(inner, f);
    await speech.speak("Never baked.", 1);
    expect(inner.spoken).toEqual(["Never baked."]);
  });

  test("an EDITED line falls through rather than speaking the old wording", async () => {
    // The safety property. The key contains the text, so changing a word
    // changes the key, so the lookup misses. Stale audio cannot play.
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(inner, f);
    await speech.speak("Supply meets demand, roughly.", 1);
    expect(f.played).toEqual([]);
    expect(inner.spoken).toEqual(["Supply meets demand, roughly."]);
  });

  test("a clip that fails to play falls through instead of going silent", async () => {
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    f.play.mockRejectedValueOnce(new Error("decode failed"));
    const speech = new PublishedSpeech(inner, f);
    await speech.speak(LINE, 1);
    expect(inner.spoken).toEqual([LINE]);
  });

  test("a partly baked drawcast plays each line the right way", async () => {
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(inner, f);
    await speech.speak(LINE, 1);
    await speech.speak("Added after the bake.", 1);
    expect(f.played).toEqual([KEY]);
    expect(inner.spoken).toEqual(["Added after the bake."]);
  });
});

describe("the SpeechManager contract still holds", () => {
  test("cancel reaches both the clips and the inner manager", () => {
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(inner, f);
    speech.cancel();
    expect(f.stop).toHaveBeenCalled();
    expect(inner.cancelled).toBe(1);
  });

  test("mute reaches the clips too, not just the live voice", () => {
    const f = fakeClips([KEY]);
    new PublishedSpeech(new InnerSpeech(), f).setMuted(true);
    expect(f.setMuted).toHaveBeenCalledWith(true);
  });

  test("available is false, so the Player never touches window.speechSynthesis", () => {
    // The base class pauses/resumes the browser synthesizer when available;
    // a baked drawcast is not driving it, so saying yes would let the Player
    // pause something that is not playing.
    const f = fakeClips([]);
    expect(new PublishedSpeech(new InnerSpeech(), f).available).toBe(false);
  });

  test("an aborted signal speaks nothing at all", async () => {
    const inner = new InnerSpeech();
    const f = fakeClips([KEY]);
    const speech = new PublishedSpeech(inner, f);
    await speech.speak(LINE, 1, AbortSignal.abort());
    expect(f.played).toEqual([]);
    expect(inner.spoken).toEqual([]);
  });
});
