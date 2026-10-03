// A #gh= cast's download starts in entry.ts, before the viewer loads. The
// entry reads the hash on its own; these pin that it names the same file the
// viewer's own parse does, or nothing.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { ghRawUrlInHash, startGhFetch } from "../src/links/early-fetch";
import { parseViewerHash, rawUrlFor } from "../src/viewer";

const hashes = [
  "#gh=hmelberg/kurs/casts/did.cast",
  "#gh-hmelberg/kurs/casts/did.yaml&mode=silent",
  "#gh=a.b/c-d/deep/folder/x.yml&speed=1.5",
  "#gh=a/b/with%20space.cast",
  "#gh=a/b/../escape.cast",
  "#gh=a/b/not-a-doc.exe",
  "#gh=a/b/%E0%A4%A.cast",
];

describe("ghRawUrlInHash", () => {
  test.each(hashes)("agrees with the viewer on %s", (hash) => {
    const req = parseViewerHash(hash);
    expect(ghRawUrlInHash(hash)).toBe(req?.gh ? rawUrlFor(req.gh) : null);
  });
  test("is null for every other source", () => {
    for (const h of ["#vaccines", "#cast=abc", "#anvil=s/x.cast", "#gdrive=1234567890ab", ""]) expect(ghRawUrlInHash(h)).toBeNull();
  });
});

describe("startGhFetch", () => {
  test("starts the request at once, and a failure is never an unhandled rejection", async () => {
    const urls: string[] = [];
    const early = startGhFetch("#gh=a/b/x.cast", ((u: string) => { urls.push(u); return Promise.reject(new Error("offline")); }) as unknown as typeof fetch);
    expect(urls).toEqual(["https://raw.githubusercontent.com/a/b/HEAD/x.cast"]);
    await expect(early!.res).rejects.toThrow("offline");
  });
  test("starts nothing for a hash that names no GitHub cast", () => {
    let called = false;
    expect(startGhFetch("#vaccines", (() => { called = true; return Promise.resolve(new Response("")); }) as typeof fetch)).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe("wiring", () => {
  const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
  const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
  test("entry starts it before importing the viewer, and hands it over only for a GitHub cast", () => {
    expect(entry.indexOf("const early = startGhFetch(hash);")).toBeGreaterThan(0);
    expect(entry.indexOf("const early = startGhFetch(hash);")).toBeLessThan(entry.indexOf('const { parseViewerHash, runViewer, showUnplayable } = await import("./viewer");'));
    expect(entry).toContain("await runViewer(req.gh && early ? { ...req, early } : req);");
  });
  test("the viewer uses it only when it names the same URL, and retries a failed one", () => {
    expect(viewer).toContain("const res = early && early.url === url ? await early.res.catch(() => fetch(url)) : await fetch(url);");
  });
});
