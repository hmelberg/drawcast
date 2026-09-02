import { beforeEach, describe, expect, test, vi } from "vitest";

// Hans 2026-09-02: "Often I replay the same (or almost the same) drawcast.
// Would it be possible to cache the speech?" Live cloud playback kept its
// clips only in memory, so every reload paid Google for the whole cast
// again — about $1.82 per typical lecture on the Studio default. Now
// CloudSpeech reads and writes the same 30-day clip store the publish bake
// uses, keyed the same way, so a line previewed in the editor is free at
// publish time and a published line is free on replay.

// The usage ledger synthesizeBase64 writes to.
const ls = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
});

// Just enough WebAudio for prefetch and speak: decode, a gain node, and a
// source whose start() ends at once so speak() resolves.
class FakeAudioContext {
  state = "running";
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
  createBufferSource() {
    const src = {
      buffer: null as unknown,
      onended: null as null | (() => void),
      connect() {},
      start() {
        queueMicrotask(() => src.onended?.());
      },
      stop() {},
    };
    return src;
  }
  decodeAudioData(buf: ArrayBuffer) {
    return Promise.resolve({ duration: buf.byteLength });
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
}
vi.stubGlobal("AudioContext", FakeAudioContext);

/** The Google endpoint: counts the calls that would cost money. */
let apiCalls = 0;
vi.stubGlobal("fetch", async () => {
  apiCalls++;
  return { ok: true, status: 200, json: async () => ({ audioContent: btoa("mp3") }) };
});

import { CloudSpeech } from "../src/export/tts";
import { clipCacheKey, type ClipStore } from "../src/export/bake-cache";

const LINE = "The price settles here, in english words.";

const store = () => {
  const mem = new Map<string, string>();
  return {
    mem,
    get: async (k: string) => mem.get(k) ?? null,
    put: async (k: string, v: string) => void mem.set(k, v),
  };
};

describe("CloudSpeech shares the bake's clip store", () => {
  beforeEach(() => {
    apiCalls = 0;
  });

  test("a line spoken once is free for a fresh CloudSpeech — a reload, a new tab", async () => {
    const s = store();
    const first = new CloudSpeech(() => "KEY", () => ({}), s);
    await first.speak(LINE, 1);
    expect(apiCalls).toBe(1);
    const afterReload = new CloudSpeech(() => "KEY", () => ({}), s);
    await afterReload.speak(LINE, 1);
    expect(apiCalls).toBe(1);
  });

  test("the live key IS the bake's key, so a previewed line costs nothing at publish (and vice versa)", async () => {
    const s = store();
    const speech = new CloudSpeech(() => "KEY", () => ({}), s);
    speech.setRate(1.1);
    await speech.speak(LINE, 1);
    expect([...s.mem.keys()]).toEqual([clipCacheKey(1.1, {}, { text: LINE })]);
  });

  test("a store hit is served without the API even when the store cannot write", async () => {
    const seeded: ClipStore = { get: async () => btoa("mp3"), put: async () => Promise.reject(new Error("quota")) };
    const speech = new CloudSpeech(() => "KEY", () => ({}), seeded);
    await speech.speak(LINE, 1);
    expect(apiCalls).toBe(0);
  });

  test("a store that cannot read falls through to the API and still speaks", async () => {
    const broken: ClipStore = { get: async () => Promise.reject(new Error("idb gone")), put: async () => {} };
    const speech = new CloudSpeech(() => "KEY", () => ({}), broken);
    await speech.speak(LINE, 1);
    expect(apiCalls).toBe(1);
  });

  test("both live players hand CloudSpeech the bake's store", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../src/main.ts", "../src/viewer.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).toMatch(/new CloudSpeech\([^;]*?bakeClipStore/);
    }
  });
});
