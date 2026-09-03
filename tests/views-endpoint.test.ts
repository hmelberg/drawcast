// The view-counting endpoint. Storage is injected, so this suite is about
// HTTP: routing, CORS, validation, and the response shape.
import { describe, expect, test } from "vitest";
import { handleViewsRequest, type ViewsDeps } from "../netlify/functions/views.mts";

const KEY = "hmelberg/kurs/casts/did.yaml";

function deps(over: Partial<ViewsDeps> = {}): ViewsDeps & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    recorded,
    record: async (key) => { recorded.push(key); return 7; },
    readCast: async () => ({ total: 7, days: { "2026-09-04": 7 } }),
    readRepo: async () => ({ casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }], courses: { casts: 7 } }),
    ...over,
  };
}

function post(body: string, origin = "https://drawcast.app") {
  return new Request("https://drawcast.app/.netlify/functions/views", {
    method: "POST",
    headers: { "content-type": "text/plain", origin },
    body,
  });
}

const get = (query: string, origin = "https://drawcast.app") =>
  new Request(`https://drawcast.app/.netlify/functions/views${query}`, { headers: { origin } });

describe("recording a view", () => {
  test("records the key and answers with the new count", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([KEY]);
  });

  test("a malformed key is refused and never recorded", async () => {
    const d = deps();
    const res = await handleViewsRequest(post("../../etc/passwd"), d);
    expect(res.status).toBe(400);
    expect(d.recorded).toEqual([]);
  });

  test("an unknown origin is refused, so curl cannot pad the numbers for free", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY, "https://evil.example"), d);
    expect(res.status).toBe(403);
    expect(d.recorded).toEqual([]);
  });

  test("the GitHub Pages deploy is allowed and gets its CORS header back", async () => {
    const res = await handleViewsRequest(post(KEY, "https://hmelberg.github.io"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://hmelberg.github.io");
  });

  test("a preflight is answered without touching storage", async () => {
    const d = deps();
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "OPTIONS", headers: { origin: "https://hmelberg.github.io" } }),
      d,
    );
    expect(res.status).toBe(204);
    expect(d.recorded).toEqual([]);
  });

  test("a storage failure never becomes a 500 the player has to handle", async () => {
    const res = await handleViewsRequest(post(KEY), deps({ record: async () => { throw new Error("blobs down"); } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: null });
  });
});

describe("reading counts", () => {
  test("one cast, without recording anything", async () => {
    const d = deps();
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(KEY)}`), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([]);
  });

  test("a whole repo, cached briefly so repeat reads do not relist", async () => {
    const res = await handleViewsRequest(get("?repo=hmelberg/kurs"), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }],
      courses: { casts: 7 },
    });
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });

  test("reads are public: no origin at all is fine", async () => {
    const res = await handleViewsRequest(
      new Request(`https://drawcast.app/.netlify/functions/views?repo=hmelberg/kurs`),
      deps(),
    );
    expect(res.status).toBe(200);
  });

  test("a malformed repo is a 400", async () => {
    expect((await handleViewsRequest(get("?repo=nope"), deps())).status).toBe(400);
  });

  test("neither cast nor repo is a 400", async () => {
    expect((await handleViewsRequest(get(""), deps())).status).toBe(400);
  });

  test("other methods are refused", async () => {
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "DELETE" }),
      deps(),
    );
    expect(res.status).toBe(405);
  });
});
