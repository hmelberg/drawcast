// Pictures drawn by the script (spec 2026-10-02-share-design §7.1): the
// pure parts of drawPictures — order kept, failures are nulls, a launcher
// that cannot start is one note and no pictures, never a throw.
import { describe, expect, test } from "vitest";
import { decodePicture, drawPictures } from "../scripts/pictures.mjs";

const PNG = Buffer.from([137, 80, 78, 71]).toString("base64");

function fakeLaunch(answers: Record<string, string | null | "throw" | "hang">) {
  return async () => ({
    newPage: async () => ({
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
  test("nothing to draw starts nothing", async () => {
    let started = false;
    const out = await drawPictures([], { launch: async () => { started = true; throw new Error("x"); }, serve: async () => { started = true; throw new Error("x"); } });
    expect(out).toEqual({ pictures: [], note: null });
    expect(started).toBe(false);
  });
});
