import { describe, expect, test } from "vitest";
import { speechKey } from "../src/render/delivery";
import { BufferSpeech } from "../src/export/tts";
import { collectSpeakLines, wrapCaption } from "../src/export/video";

describe("collectSpeakLines", () => {
  test("collects distinct narration lines in storyboard order, with speaker/delivery/gender attached", () => {
    const lines = collectSpeakLines({
      voice: "male",
      commands: [
        { speak: "First line." },
        { draw: ["a"] },
        { speak: "Second line.", blocking: false, voice: "b", delivery: "soft" },
        { speak: "First line." }, // duplicate (same text/speaker/delivery/gender) synthesized once
        { pause: 1 },
      ],
    });
    expect(lines).toEqual([
      { text: "First line.", speaker: undefined, delivery: undefined, gender: "male" },
      { text: "Second line.", speaker: "b", delivery: "soft", gender: "male" },
    ]);
  });

  test("the same text spoken by two different voices stays distinct", () => {
    const lines = collectSpeakLines({
      voice: "female",
      commands: [{ speak: "Hi" }, { speak: "Hi", voice: "b" }],
    });
    expect(lines).toHaveLength(2);
  });

  test("ignores empty narration and specs without commands", () => {
    expect(collectSpeakLines({ commands: [{ speak: "  " }, { draw: ["a"] }] })).toEqual([]);
    expect(collectSpeakLines({})).toEqual([]);
  });
});

describe("BufferSpeech", () => {
  /** Minimal WebAudio stand-ins: connect() records where the audio flows, start() ends immediately. */
  function fakeGraph() {
    const connections: unknown[] = [];
    const src = {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: (node: unknown) => connections.push(node),
      start: () => src.onended?.(),
      stop: () => {},
    };
    const audioCtx = { createBufferSource: () => src, destination: { name: "speakers" } };
    const dest = { name: "recorder" };
    return { connections, audioCtx, src, dest };
  }

  test("resolves buffers by speechKey, so the same text in two voices stays distinct", async () => {
    const bufferA = { id: "a" } as unknown as AudioBuffer;
    const bufferB = { id: "b" } as unknown as AudioBuffer;
    const buffers = new Map<string, AudioBuffer>([
      [speechKey({ text: "Hi", speaker: "a" }), bufferA],
      [speechKey({ text: "Hi", speaker: "b" }), bufferB],
    ]);
    const { audioCtx, src, dest } = fakeGraph();
    const speech = new BufferSpeech(audioCtx as never, dest as never, buffers);

    await speech.speak("Hi", 1, undefined, { speaker: "b" });

    expect(src.buffer).toBe(bufferB);
  });
});

describe("wrapCaption", () => {
  const measure = (s: string) => s.length * 10; // 10px per character

  test("keeps short captions on one line", () => {
    expect(wrapCaption(measure, "short and sweet", 400)).toEqual(["short and sweet"]);
  });

  test("wraps greedily at the measured width", () => {
    expect(wrapCaption(measure, "aaaa bbbb cccc dddd", 100)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  test("a single overlong word still lands on its own line", () => {
    expect(wrapCaption(measure, "supercalifragilistic yes", 100)).toEqual(["supercalifragilistic", "yes"]);
  });
});
