import { describe, expect, test } from "vitest";
import { cachingSynthesizer, clipCacheKey, storedFirst } from "../src/export/bake-cache";
import { bakeNarration } from "../src/export/bake";
import { speechKey } from "../src/render/delivery";
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

describe("storedFirst — a batch job asks only for clips the store lacks (final review 3)", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
  };
  const keyOf = (l: SpeakLine) => clipCacheKey(1, { "@a": "gemini:Charon" }, l, "en");

  test("splits lines into stored clips (keyed by speechKey) and the rest", async () => {
    const s = mem();
    const a = line("Stored already.", { speaker: "a" });
    const b = line("Not yet.", { speaker: "a" });
    await s.put(keyOf(a), "AAA");
    const { stored, missing } = await storedFirst(s, keyOf, [a, b]);
    expect([...stored]).toEqual([[speechKey(a), { mp3: "AAA", ms: 0 }]]);
    expect(missing).toEqual([b]);
  });

  test("a store that cannot read counts as missing, never as a failure", async () => {
    const broken = { get: async () => Promise.reject(new Error("idb gone")), put: async () => {} };
    const a = line("Anything.");
    expect((await storedFirst(broken, keyOf, [a])).missing).toEqual([a]);
  });

  test("a second publish after one that failed after its batch submits nothing", async () => {
    const s = mem();
    const lines = [line("One.", { speaker: "a" }), line("Two.", { speaker: "a" })];
    const submitted: SpeakLine[][] = [];
    const many = async (todo: SpeakLine[]) => {
      const { stored, missing } = await storedFirst(s, keyOf, todo);
      if (!missing.length) return stored;
      submitted.push(missing);
      const map = new Map(missing.map((l) => [speechKey(l), { mp3: `mp3:${l.text}`, ms: 100 }]));
      for (const l of missing) await s.put(keyOf(l), `mp3:${l.text}`);
      for (const [k, c] of stored) map.set(k, c);
      return map;
    };
    const opts = {
      lang: "en",
      many: () => true,
      synthesizeMany: many,
      synthesize: async (): Promise<string> => {
        throw new Error("single-line path must not run");
      },
    };
    await bakeNarration(lines, opts, () => {}, new AbortController().signal);
    // ... the push then fails; the author publishes again:
    const again = await bakeNarration(lines, opts, () => {}, new AbortController().signal);
    expect(submitted).toHaveLength(1);
    expect(Object.values(again.lines).map((c) => c.mp3)).toEqual(["mp3:One.", "mp3:Two."]);
  });

  test("the app's publish batch looks in the store before it submits, and words its timeout for the app", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const synthesizeMany = async"), src.indexOf("const track = await bakeNarration("));
    expect(body.indexOf("storedFirst(bakeClipStore")).toBeGreaterThan(-1);
    expect(body.indexOf("storedFirst(bakeClipStore")).toBeLessThan(body.indexOf("batchLines("));
    expect(body).toContain("isTimedOutJob(err)");
    expect(src).not.toMatch(/keep waiting/);
  });
});
