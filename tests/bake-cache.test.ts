import { describe, expect, test } from "vitest";
import { cachingSynthesizer, clipCacheKey } from "../src/export/bake-cache";
import type { SpeakLine } from "../src/render/delivery";

// B15 (Hans hit his TTS quota mid-bake, 2026-09-02): every synthesized clip
// is written to a local cache the moment it exists, and the bake reads that
// cache before calling the API — so a failed publish's paid audio is never
// lost, and the retry resumes where the quota stopped it at zero cost.

const line = (text: string, extra: Partial<SpeakLine> = {}): SpeakLine => ({ text, ...extra });

describe("clipCacheKey — everything that determines the audio is in the key", () => {
  test("voice, language and rate are all part of it", () => {
    const a = clipCacheKey(1, undefined, line("The price settles here, in english words."));
    expect(a).toContain("en-US-Studio-Q"); // the undeclared-English default
    expect(clipCacheKey(1.25, undefined, line("The price settles here, in english words."))).not.toBe(a);
    expect(clipCacheKey(1, { en: "en-GB-Neural2-A" }, line("The price settles here, in english words."))).not.toBe(a);
    expect(clipCacheKey(1, undefined, line("The price settles here, in english words.", { gender: "male" }))).not.toBe(a);
  });
});

describe("cachingSynthesizer", () => {
  const store = () => {
    const mem = new Map<string, string>();
    return {
      mem,
      get: async (k: string) => mem.get(k) ?? null,
      put: async (k: string, v: string) => void mem.set(k, v),
    };
  };

  test("a hit never calls the API; a miss synthesizes and saves BEFORE resolving", async () => {
    const s = store();
    let calls = 0;
    const synth = cachingSynthesizer(s, () => "k1", async () => {
      calls++;
      return "MP3";
    });
    expect(await synth(line("a"))).toBe("MP3");
    expect(calls).toBe(1);
    expect(s.mem.get("k1")).toBe("MP3"); // saved the moment it existed
    expect(await synth(line("a"))).toBe("MP3");
    expect(calls).toBe(1); // the retry after a mid-bake failure is free
  });

  test("stats separate the free replays from the paid calls", async () => {
    const s = store();
    const stats = { cached: 0, synthesized: 0 };
    const synth = cachingSynthesizer(s, (l) => l.text, async () => "MP3", stats);
    await synth(line("a"));
    await synth(line("a"));
    await synth(line("b"));
    expect(stats).toEqual({ cached: 1, synthesized: 2 });
  });

  test("a failing cache write never fails the synthesis — the clip still returns", async () => {
    const synth = cachingSynthesizer(
      { get: async () => null, put: async () => Promise.reject(new Error("quota")) },
      () => "k",
      async () => "MP3",
    );
    expect(await synth(line("a"))).toBe("MP3");
  });

  test("a failing cache read falls through to the API", async () => {
    const synth = cachingSynthesizer(
      { get: async () => Promise.reject(new Error("idb gone")), put: async () => {} },
      () => "k",
      async () => "MP3",
    );
    expect(await synth(line("a"))).toBe("MP3");
  });
});

describe("both bake sites use the cache", () => {
  test("main.ts and course.ts wrap their synthesize in cachingSynthesizer", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../src/main.ts", "../src/ui/course.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).toContain("cachingSynthesizer(");
    }
  });
});
