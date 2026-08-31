// Wiring baked narration into a mount: which manager plays, and what is still
// worth paying a TTS call for.
import { describe, expect, test } from "vitest";
import { bakedAudioFor } from "../src/playlist/audio";
import { PublishedSpeech } from "../src/render/published-speech";
import { SpeechManager } from "../src/render/speech";
import { speechKey } from "../src/render/delivery";
import type { Playlist } from "../src/playlist/playlist";
import type { SpeakLine } from "../src/render/delivery";

const inner = () => new SpeechManager();

const playlist = (audio?: Playlist["audio"]): Playlist => ({
  meta: { advance: "click", gap: 1, transitions: "auto" },
  entries: [],
  warnings: [],
  ...(audio ? { audio } : {}),
});

const LINES: SpeakLine[] = [{ text: "Supply meets demand." }, { text: "The price settles." }];

const trackFor = (...texts: string[]) => ({
  lang: "en",
  lines: Object.fromEntries(texts.map((t) => [speechKey({ text: t }), { mp3: "AAEC", ms: 1000 }])),
});

describe("a playlist with no baked audio", () => {
  test("plays through the live manager, untouched", () => {
    const live = inner();
    const baked = bakedAudioFor(live, playlist());
    expect(baked.speech).toBe(live);
  });

  test("every line is still worth prefetching", () => {
    expect(bakedAudioFor(inner(), playlist()).unbaked(LINES)).toEqual(LINES);
  });

  test("destroy is safe to call", () => {
    expect(() => bakedAudioFor(inner(), playlist()).destroy()).not.toThrow();
  });
});

describe("a playlist that carries baked audio", () => {
  test("plays through PublishedSpeech, with the live manager behind it", () => {
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.")));
    expect(baked.speech).toBeInstanceOf(PublishedSpeech);
  });

  test("a baked line is NOT prefetched — that would pay twice for one sentence", () => {
    // Prefetch is what spends the TTS budget. Warming a line we already have
    // on disk is money for nothing, and on a shared key it eats the cap.
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.")));
    expect(baked.unbaked(LINES)).toEqual([{ text: "The price settles." }]);
  });

  test("a line added since the bake is still prefetched", () => {
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.", "The price settles.")));
    const added = { text: "Added later." };
    expect(baked.unbaked([...LINES, added])).toEqual([added]);
  });

  test("an EDITED line is prefetched again — its clip no longer matches", () => {
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.")));
    const edited = { text: "Supply meets demand, roughly." };
    expect(baked.unbaked([edited])).toEqual([edited]);
  });

  test("a line baked in another voice is not treated as covered", () => {
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.")));
    const male: SpeakLine = { text: "Supply meets demand.", gender: "male" };
    expect(baked.unbaked([male])).toEqual([male]);
  });

  test("a fully baked drawcast prefetches nothing at all", () => {
    const baked = bakedAudioFor(inner(), playlist(trackFor("Supply meets demand.", "The price settles.")));
    expect(baked.unbaked(LINES)).toEqual([]);
  });
});
