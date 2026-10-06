// The name-lookup endpoint. Storage and Anvil are injected, so this suite is
// about HTTP: caching, CORS, visit recording, and the stats door — not Blobs
// or Anvil's own rules.
import { describe, expect, test } from "vitest";
import { defaultResolve, handleNameRequest, type CacheEntry, type NameDeps } from "../netlify/functions/name.mts";
import type { DayRecord } from "../netlify/lib/name-visits.mts";

function deps(over: Partial<NameDeps> = {}): NameDeps & { writes: Array<{ key: string; rec: DayRecord }> } {
  const writes: Array<{ key: string; rec: DayRecord }> = [];
  const days = new Map<string, DayRecord>();
  return {
    writes,
    resolve: async () => ({ status: 200, body: { kind: "cast", target: "o/r/p.yaml", page: null } }),
    readDay: async (key) => days.get(key) ?? null,
    writeDay: async (key, rec) => {
      writes.push({ key, rec });
      days.set(key, rec);
    },
    country: () => "NO",
    now: () => Date.parse("2026-09-29T12:00:00.000Z"),
    statsSecret: "s3cr3t",
    readRange: async () => [],
    cache: new Map<string, CacheEntry>(),
    ...over,
  };
}

const get = (query: string, headers: Record<string, string> = {}) =>
  new Request(`https://www.drawcast.app/.netlify/functions/name${query}`, { headers });

describe("a lookup", () => {
  test("a 200 answer is passed through, with the right headers, and recorded once with country/source/ref", async () => {
    const d = deps();
    const res = await handleNameRequest(get("?n=learn-russian&src=lecture&ref=https%3A%2F%2Fwww.google.com%2Fsearch"), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "cast", target: "o/r/p.yaml", page: null });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(d.writes.length).toBe(1);
    expect(d.writes[0].key).toBe("v/learn-russian/2026-09-29");
    expect(d.writes[0].rec).toEqual({
      count: 1,
      country: { NO: 1 },
      source: { lecture: 1 },
      ref: { "www.google.com": 1 },
    });
  });

  test("with defer, the answer does not wait for the visit — the visit is handed over and still recorded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deferred: Promise<unknown>[] = [];
    const d = deps({ readDay: async () => { await gate; return null; }, defer: (work) => deferred.push(work) });
    const res = await handleNameRequest(get("?n=learn-russian"), d);
    expect(res.status).toBe(200);
    expect(d.writes.length).toBe(0); // answered while the Blobs read is still blocked
    expect(deferred.length).toBe(1);
    release();
    await Promise.all(deferred);
    expect(d.writes.length).toBe(1);
  });

  test("with defer, a Blobs failure is swallowed inside the deferred work", async () => {
    const deferred: Promise<unknown>[] = [];
    const d = deps({ writeDay: async () => { throw new Error("blobs down"); }, defer: (work) => deferred.push(work) });
    const res = await handleNameRequest(get("?n=learn-russian"), d);
    expect(res.status).toBe(200);
    await expect(Promise.all(deferred)).resolves.toBeDefined();
  });

  test("no src given defaults to 'name'; an unrecognised src also defaults to 'name'", async () => {
    const d1 = deps();
    await handleNameRequest(get("?n=learn-russian"), d1);
    expect(d1.writes[0].rec.source).toEqual({ name: 1 });

    const d2 = deps();
    await handleNameRequest(get("?n=learn-russian&src=bogus"), d2);
    expect(d2.writes[0].rec.source).toEqual({ name: 1 });
  });

  test("a 404 is passed through and not recorded", async () => {
    const d = deps({ resolve: async () => ({ status: 404, body: { error: "unknown" } }) });
    const res = await handleNameRequest(get("?n=nope"), d);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown" });
    expect(d.writes).toEqual([]);
  });

  test("a writeDay throw still answers 200 — a Blobs failure never changes the answer", async () => {
    const d = deps({ writeDay: async () => { throw new Error("blobs down"); } });
    const res = await handleNameRequest(get("?n=learn-russian"), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "cast", target: "o/r/p.yaml", page: null });
  });

  test("a readDay throw also still answers 200", async () => {
    const d = deps({ readDay: async () => { throw new Error("blobs down"); } });
    const res = await handleNameRequest(get("?n=learn-russian"), d);
    expect(res.status).toBe(200);
  });

  test("no ?n= is a 400 and resolve is never called", async () => {
    const d = deps({ resolve: async () => { throw new Error("must not be called"); } });
    const res = await handleNameRequest(get(""), d);
    expect(res.status).toBe(400);
  });

  test("only GET is accepted", async () => {
    const res = await handleNameRequest(
      new Request("https://www.drawcast.app/.netlify/functions/name?n=x", { method: "POST" }),
      deps(),
    );
    expect(res.status).toBe(405);
  });
});

describe("the 60 s resolution cache", () => {
  test("the second lookup inside 60 s does not call resolve again", async () => {
    let calls = 0;
    const cache = new Map<string, CacheEntry>();
    let now = Date.parse("2026-09-29T12:00:00.000Z");
    const d = deps({
      cache,
      now: () => now,
      resolve: async () => {
        calls++;
        return { status: 200, body: { kind: "cast", target: "o/r/p.yaml", page: null } };
      },
    });
    await handleNameRequest(get("?n=learn-russian"), d);
    now += 30_000; // still inside the 60 s window
    await handleNameRequest(get("?n=learn-russian"), d);
    expect(calls).toBe(1);
    // but each lookup still records its own visit
    expect(d.writes.length).toBe(2);
  });

  test("a lookup after 60 s calls resolve again", async () => {
    let calls = 0;
    let now = Date.parse("2026-09-29T12:00:00.000Z");
    const d = deps({
      now: () => now,
      resolve: async () => {
        calls++;
        return { status: 200, body: { kind: "cast", target: "o/r/p.yaml", page: null } };
      },
    });
    await handleNameRequest(get("?n=learn-russian"), d);
    now += 60_001;
    await handleNameRequest(get("?n=learn-russian"), d);
    expect(calls).toBe(2);
  });

  test("only 200 answers are cached — a 404 is re-resolved every time", async () => {
    let calls = 0;
    const d = deps({
      resolve: async () => {
        calls++;
        return { status: 404, body: { error: "unknown" } };
      },
    });
    await handleNameRequest(get("?n=nope"), d);
    await handleNameRequest(get("?n=nope"), d);
    expect(calls).toBe(2);
  });

  test("the cache holds at most 500 entries, dropping the oldest when full", async () => {
    const cache = new Map<string, CacheEntry>();
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    let calls = 0;
    const d = deps({
      cache,
      now: () => now,
      resolve: async () => {
        calls++;
        return { status: 200, body: { kind: "cast", target: "o/r/p.yaml", page: null } };
      },
    });
    for (let i = 0; i < 500; i++) await handleNameRequest(get(`?n=name${i}`), d);
    expect(cache.size).toBe(500);
    expect(cache.has("name0")).toBe(true);
    await handleNameRequest(get("?n=name500"), d);
    expect(cache.size).toBe(500);
    expect(cache.has("name0")).toBe(false); // the oldest was dropped
    expect(cache.has("name500")).toBe(true);

    // name0 was evicted, so looking it up again calls resolve — proof the
    // cap is real, not just an accounting error.
    const callsBefore = calls;
    await handleNameRequest(get("?n=name0"), d);
    expect(calls).toBe(callsBefore + 1);
  });
});

describe("?stats=", () => {
  const RECORD: DayRecord = { count: 3, country: { NO: 3 }, source: { name: 3 }, ref: {} };

  test("the wrong secret is a 403 and no visit is recorded", async () => {
    const d = deps({ readRange: async () => [{ day: "2026-09-28", ...RECORD }] });
    const res = await handleNameRequest(get("?stats=learn-russian", { "x-drawcast-stats": "wrong" }), d);
    expect(res.status).toBe(403);
    expect(d.writes).toEqual([]);
  });

  test("a missing secret header is a 403", async () => {
    const d = deps();
    const res = await handleNameRequest(get("?stats=learn-russian"), d);
    expect(res.status).toBe(403);
  });

  test("an unset NAME_STATS_SECRET refuses even an empty header", async () => {
    const d = deps({ statsSecret: "" });
    const res = await handleNameRequest(get("?stats=learn-russian", { "x-drawcast-stats": "" }), d);
    expect(res.status).toBe(403);
  });

  test("the right secret returns the range and records nothing", async () => {
    const d = deps({ readRange: async (name, days) => {
      expect(name).toBe("learn-russian");
      expect(days).toBe(30);
      return [{ day: "2026-09-28", ...RECORD }];
    } });
    const res = await handleNameRequest(get("?stats=learn-russian", { "x-drawcast-stats": "s3cr3t" }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ day: "2026-09-28", ...RECORD }]);
    expect(d.writes).toEqual([]);
  });

  test("stats never touches resolve", async () => {
    const d = deps({ resolve: async () => { throw new Error("must not be called"); } });
    const res = await handleNameRequest(get("?stats=learn-russian", { "x-drawcast-stats": "s3cr3t" }), d);
    expect(res.status).toBe(200);
  });
});

// Final review I4: the dashboard reads ?stats=<base name>, so a lecture
// lookup (`name/3`) is counted under the course's base name, still as a
// "lecture" visit.
describe("a lecture lookup", () => {
  test("is recorded under the BASE name, source lecture", async () => {
    const d = deps();
    const res = await handleNameRequest(get("?n=learn-russian%2F3&src=lecture"), d);
    expect(res.status).toBe(200);
    expect(d.writes.length).toBe(1);
    expect(d.writes[0].key).toBe("v/learn-russian/2026-09-29");
    expect(d.writes[0].rec.source).toEqual({ lecture: 1 });
  });
});

// Final review I2: a slow Anvil costs five seconds, not the whole function.
describe("defaultResolve", () => {
  test("bounds the Anvil fetch with a timeout signal", async () => {
    let signal: AbortSignal | undefined;
    const f = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ kind: "cast", target: "o/r/p.yaml", page: null }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await defaultResolve("x", f)).status).toBe(200);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test("a hung Anvil is a 5xx once the timeout fires (the client then tries the next door)", async () => {
    const f = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const answer = await defaultResolve("x", f, 20);
    expect(answer.status).toBeGreaterThanOrEqual(500);
  });
});
