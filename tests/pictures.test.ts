// Pictures drawn by the script (spec 2026-10-02-share-design §7.1): the
// pure parts of drawPictures — order kept, failures are nulls, a launcher
// that cannot start is one note and no pictures, never a throw.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { decodePicture, defaultServe, drawPictures } from "../scripts/pictures.mjs";

const PNG = Buffer.from([137, 80, 78, 71]).toString("base64");

function fakeLaunch(answers: Record<string, string | null | "throw" | "hang">, counter = { pages: 0 }) {
  return async () => ({
    newPage: async () => (counter.pages++, {
      goto: async () => undefined,
      waitForFunction: async () => undefined,
      evaluate: async (_fn: unknown, text: string) => {
        const a = answers[text];
        if (a === "throw") throw new Error("boom");
        if (a === "hang") return new Promise(() => undefined);
        return a ?? null;
      },
    }),
    close: async () => undefined,
  });
}
const okServe = async () => ({ url: "http://x/", close: async () => undefined });

describe("decodePicture", () => {
  test("base64 to bytes; null and empty are null", () => {
    expect(decodePicture(PNG)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(decodePicture(null)).toBeNull();
    expect(decodePicture("")).toBeNull();
  });
});

describe("drawPictures", () => {
  test("one picture per text, in order; a failed or empty drawing is null", async () => {
    const out = await drawPictures(["a", "b", "c"], { launch: fakeLaunch({ a: PNG, b: "throw", c: null }), serve: okServe });
    expect(out.pictures).toEqual([new Uint8Array([137, 80, 78, 71]), null, null]);
    expect(out.note).toBeNull();
  });
  test("a drawing that hangs is cut off and null; the next still draws", async () => {
    const out = await drawPictures(["slow", "a"], { launch: fakeLaunch({ slow: "hang", a: PNG }), perCastMs: 50, serve: okServe });
    expect(out.pictures[0]).toBeNull();
    expect(out.pictures[1]).toEqual(new Uint8Array([137, 80, 78, 71]));
  });
  test("after a timeout a fresh page is opened for the next cast", async () => {
    const counter = { pages: 0 };
    await drawPictures(["slow", "a"], { launch: fakeLaunch({ slow: "hang", a: PNG }, counter), perCastMs: 50, serve: okServe });
    expect(counter.pages).toBe(2);
    const fine = { pages: 0 };
    await drawPictures(["a", "a"], { launch: fakeLaunch({ a: PNG }, fine), serve: okServe });
    expect(fine.pages).toBe(1);
  });
  test("a fast drawing leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      const out = await drawPictures(["a"], { launch: fakeLaunch({ a: PNG }), perCastMs: 60000, serve: okServe });
      expect(out.pictures[0]).toEqual(new Uint8Array([137, 80, 78, 71]));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  test("no browser: every picture null, one note, no throw", async () => {
    const out = await drawPictures(["a", "b"], { launch: async () => { throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell"); }, serve: okServe });
    expect(out.pictures).toEqual([null, null]);
    expect(out.note).toMatch(/^no headless Chromium/);
  });
  test("no server: the same", async () => {
    const out = await drawPictures(["a"], { launch: fakeLaunch({ a: PNG }), serve: async () => { throw new Error("vite missing"); } });
    expect(out.pictures).toEqual([null]);
    expect(out.note).toBe("vite missing");
  });
  test("the page's \"poster: …\" lines are said out loud (a missing font is not a quiet null)", async () => {
    const lines: string[] = [];
    const launch = async () => ({
      newPage: async () => {
        let hear: ((m: { text(): string }) => void) | null = null;
        return {
          on: (ev: string, f: (m: { text(): string }) => void) => { if (ev === "console") hear = f; },
          goto: async () => undefined,
          waitForFunction: async () => undefined,
          evaluate: async () => {
            hear?.({ text: () => "[vite] connected." });
            hear?.({ text: () => "poster: the sketch font (Patrick Hand) could not be embedded — no poster drawn" });
            return null;
          },
        };
      },
      close: async () => undefined,
    });
    const out = await drawPictures(["a"], { launch, serve: okServe, log: (l) => lines.push(l) });
    expect(out.pictures).toEqual([null]);
    expect(lines).toEqual(["poster: the sketch font (Patrick Hand) could not be embedded — no poster drawn"]);
  });
  test("nothing to draw starts nothing", async () => {
    let started = false;
    const out = await drawPictures([], { launch: async () => { started = true; throw new Error("x"); }, serve: async () => { started = true; throw new Error("x"); } });
    expect(out).toEqual({ pictures: [], note: null });
    expect(started).toBe(false);
  });
});

test("push draws pictures only for public casts and courses", () => {
  const src = readFileSync("scripts/cast.mjs", "utf8");
  const calls = [...src.matchAll(/drawAll\(/g)].length;
  expect(calls).toBeGreaterThanOrEqual(2);
  // cast branch: guarded inline; course branch: inside `if (!origin.private) {`
  expect(src).toMatch(/origin\.private \? null : \(await drawAll\(\[text\]\)\)/);
  expect(src).toMatch(/if \(!origin\.private\) \{\s*const \{ lecturePosters \}[\s\S]{0,400}drawAll\(lectureTexts\)/);
});

describe("defaultServe", () => {
  test("a listen that throws closes the server it created, then rejects", async () => {
    const close = vi.fn(async () => {});
    const make = async () => ({ listen: async () => { throw new Error("port taken"); }, close });
    await expect(defaultServe("/x", make)()).rejects.toThrow("port taken");
    expect(close).toHaveBeenCalledTimes(1);
  });
  test("a good listen returns the url and a close", async () => {
    const close = vi.fn(async () => {});
    const s = await defaultServe("/x", async () => ({ listen: async () => {}, close }))();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await s.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
