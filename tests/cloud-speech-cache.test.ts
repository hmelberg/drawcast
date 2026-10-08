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
const calls: Array<{ url: string; body: string }> = [];
vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
  apiCalls++;
  calls.push({ url: String(url), body: init?.body ?? "" });
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

describe("a line stopped while it is still being synthesized", () => {
  test("ends at the stop, not when the clip arrives (Hans 2026-10-04: the verdict waited on it)", async () => {
    // A clip store that never answers: the line is still on its way.
    const never = { get: () => new Promise<string | null>(() => {}), put: async () => {} };
    const speech = new CloudSpeech(() => "KEY", () => ({}), never);
    const ac = new AbortController();
    let ended = false;
    const said = speech.speak("A question still being read.", 1, ac.signal).then(() => (ended = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(ended).toBe(false);
    ac.abort();
    await said;
    expect(ended).toBe(true);
  });
});

describe("live playback never calls Gemini (2026-10-08)", () => {
  const GEM = { "@a": "gemini:Charon | dry historian" };
  beforeEach(() => {
    apiCalls = 0;
    calls.length = 0;
  });

  test("a Gemini line with no recorded clip is spoken in the Studio default, under its own key", async () => {
    const s = store();
    const speech = new CloudSpeech(() => "KEY", () => GEM, s);
    speech.setLangHint("en");
    await speech.speak(LINE, 1);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("texttospeech.googleapis.com");
    expect(calls.some((c) => c.url.includes("generativelanguage"))).toBe(false);
    expect(JSON.parse(calls[0].body).voice.name).toBe("en-US-Studio-Q");
    const geminiKey = clipCacheKey(1, GEM, { text: LINE }, "en");
    const studioKey = clipCacheKey(1, {}, { text: LINE }, "en");
    expect(geminiKey).not.toBe(studioKey);
    // The stand-in sits under the Studio key, never under the Gemini one.
    expect([...s.mem.keys()]).toEqual([studioKey]);
  });

  test("once the line is recorded in Gemini (the publish puts it in the store), the next play is that clip, free", async () => {
    const s = store();
    const speech = new CloudSpeech(() => "KEY", () => GEM, s);
    speech.setLangHint("en");
    await speech.speak(LINE, 1); // Studio stand-in
    expect(apiCalls).toBe(1);
    await s.put(clipCacheKey(1, GEM, { text: LINE }, "en"), btoa("gemini mp3"));
    let heard = 0;
    await speech.speak(LINE, 1, undefined, { onStart: (ms) => (heard = ms ?? 0) });
    expect(apiCalls).toBe(1);
    expect(heard).toBe("gemini mp3".length * 1000); // the fake decoder: a byte a second
  });

  test("a Cloud voice line is unchanged — its own key, its own voice", async () => {
    const s = store();
    const speech = new CloudSpeech(() => "KEY", () => ({ "@a": "en-US-Studio-O" }), s);
    speech.setLangHint("en");
    await speech.speak(LINE, 1);
    expect(JSON.parse(calls[0].body).voice.name).toBe("en-US-Studio-O");
    expect([...s.mem.keys()]).toEqual([clipCacheKey(1, { "@a": "en-US-Studio-O" }, { text: LINE }, "en")]);
  });
});
