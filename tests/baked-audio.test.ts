// Wiring baked narration into a mount: which manager plays, and what is still
// worth paying a TTS call for.
import { describe, expect, test } from "vitest";
import { bakedAudioFor } from "../src/playlist/audio";
import { PublishedSpeech } from "../src/render/published-speech";
import { SpeechManager } from "../src/render/speech";
import { speechKey } from "../src/render/delivery";
import { parsePlaylistText, formatPublished } from "../src/playlist/playlist";
import type { Playlist } from "../src/playlist/playlist";
import type { SpeakLine } from "../src/render/delivery";
import type { Spec } from "../src/spec/types";

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

test("a clip's recorded pause survives the file (2026-10-08)", () => {
  const spec = { title: "T", elements: [], commands: [] } as unknown as Spec;
  const playlist = { meta: { title: "T", advance: "click" as const, gap: 1, transitions: "auto" as const }, entries: [{ kind: "item" as const, spec }], warnings: [] };
  const audio = { lang: "en", lines: { "|a||Hi.": { mp3: "AAAA", ms: 500, voice: "gemini:Puck", pause: 0.6 } } };
  const text = formatPublished(playlist, audio);
  const p = parsePlaylistText(text);
  expect(p.audio?.lines["|a||Hi."]).toEqual({ mp3: "AAAA", ms: 500, voice: "gemini:Puck", pause: 0.6 });
  expect(parsePlaylistText(formatPublished(p, p.audio!, "script")).audio?.lines["|a||Hi."].pause).toBe(0.6);
});
