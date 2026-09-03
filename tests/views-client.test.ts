// The counting client. Every network call is injected, exactly as
// tests/keys.test.ts drives redeemPassword.
import { describe, expect, test, vi } from "vitest";
import { castKeyFor, countingEnabled, firstViewInSession, readViewCount, recordView } from "../src/views";

const KEY = "hmelberg/kurs/casts/did.yaml";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("countingEnabled", () => {
  test("a missing flag counts, so everything already published starts on deploy", () => {
    expect(countingEnabled({})).toBe(true);
    expect(countingEnabled({ views: true })).toBe(true);
  });

  test("an explicit false is the one thing that switches it off", () => {
    expect(countingEnabled({ views: false })).toBe(false);
  });
});

describe("castKeyFor", () => {
  test("is the same identity the published link already uses", () => {
    expect(castKeyFor({ owner: "hmelberg", repo: "kurs", path: "casts/did.yaml" })).toBe(KEY);
  });
});

describe("firstViewInSession", () => {
  function memoryStorage() {
    const data: Record<string, string> = {};
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
  }

  test("the first view counts and a reload in the same tab does not", () => {
    const s = memoryStorage();
    expect(firstViewInSession(KEY, s)).toBe(true);
    expect(firstViewInSession(KEY, s)).toBe(false);
  });

  test("different casts are tracked separately", () => {
    const s = memoryStorage();
    expect(firstViewInSession(KEY, s)).toBe(true);
    expect(firstViewInSession("hmelberg/kurs/casts/rdd.yaml", s)).toBe(true);
  });

  test("no storage at all (private mode, or it throws) still counts the view", () => {
    expect(firstViewInSession(KEY, null)).toBe(true);
  });
});

describe("recordView", () => {
  test("posts the key as text/plain and returns the count", async () => {
    const f = fetchReturning(200, { count: 12 });
    expect(await recordView(KEY, ["/x"], f)).toBe(12);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(KEY);
    // text/plain keeps this a simple request: no preflight on every view.
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.keepalive).toBe(true);
  });

  test("falls through to the next endpoint, like key vending does", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/a") return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ count: 3 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await recordView(KEY, ["/a", "/b"], f)).toBe(3);
    expect(calls).toEqual(["/a", "/b"]);
  });

  test("a network error is silent — counting must never break playback", async () => {
    const f = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await recordView(KEY, ["/x"], f)).toBeNull();
  });

  test("a null count from a storage outage is not mistaken for zero", async () => {
    expect(await recordView(KEY, ["/x"], fetchReturning(200, { count: null }))).toBeNull();
  });

  test("an invalid key never leaves the browser", async () => {
    const f = fetchReturning(200, { count: 1 });
    expect(await recordView("nope", ["/x"], f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("readViewCount", () => {
  test("asks for one cast without recording anything", async () => {
    const f = fetchReturning(200, { count: 9 });
    expect(await readViewCount(KEY, ["/x"], f)).toBe(9);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe(`/x?cast=${encodeURIComponent(KEY)}`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  test("failure is null, never a thrown error", async () => {
    expect(await readViewCount(KEY, ["/x"], fetchReturning(500, {}))).toBeNull();
  });
});
