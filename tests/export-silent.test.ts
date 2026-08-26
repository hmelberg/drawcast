import { describe, expect, test } from "vitest";
import { BufferSpeech } from "../src/export/tts";

/** Minimal WebAudio stand-ins: connect() records where the audio flows. */
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
  return { connections, audioCtx, dest };
}

describe("BufferSpeech routing", () => {
  test("narration feeds only the recording destination — the export runs silently", async () => {
    const { connections, audioCtx, dest } = fakeGraph();
    const speech = new BufferSpeech(audioCtx as never, dest as never, new Map([["line", {} as AudioBuffer]]));
    await speech.speak("line", 1);
    expect(connections).toEqual([dest]);
  });
});
