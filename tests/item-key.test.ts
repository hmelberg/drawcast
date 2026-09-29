// The client for Anvil's /key (task 4) and the viewer's single unlock choke
// point (task 7). A fake fetch and a Map-backed storage stand in for the
// network and localStorage; tests/lecture-lock.test.ts already proves the
// crypto round-trips, so here the envelopes are just real enough to unlock
// or fail to.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { lockText } from "../src/crypto/lecture-lock";
import { fetchItemKey, itemKeyStorageKey, unlockForViewer, type KeyStorage } from "../src/item-key";

const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"; // 32 bytes 0..31
const OTHER = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA"; // 32 bytes 31..0
const ITEM = "ann/casts/qalys";
const API = "https://a.example";

function mapStorage(seed: Record<string, string> = {}): KeyStorage {
  const mem = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

function fetchStub(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  return { impl: f as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("fetchItemKey", () => {
  it("posts {key, item} to /_/api/key and, on 200, stores and returns the key", async () => {
    const { impl, calls } = fetchStub(() => json(200, { key: "kkk", item: ITEM }));
    const storage = mapStorage();
    const result = await fetchItemKey(API, "tok", ITEM, impl, storage);
    expect(result).toEqual({ key: "kkk" });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBe("kkk");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API}/_/api/key`);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ key: "tok", item: ITEM });
  });

  it("401 denies and deletes a kept key", async () => {
    const { impl } = fetchStub(() => json(401, { error: "key" }));
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "stale" });
    expect(await fetchItemKey(API, "", ITEM, impl, storage)).toEqual({ denied: 401 });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBeNull();
  });

  it("403 carries standing, title and page, and deletes a kept key", async () => {
    const { impl } = fetchStub(() => json(403, { error: "access", standing: "pending", title: "Spanish 1", page: "https://x.example" }));
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "stale" });
    expect(await fetchItemKey(API, "tok", ITEM, impl, storage)).toEqual({ denied: 403, standing: "pending", title: "Spanish 1", page: "https://x.example" });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBeNull();
  });

  it("403 with no recognised standing falls back to none, and a missing page is null", async () => {
    const { impl } = fetchStub(() => json(403, { error: "access", standing: "weird", title: "" }));
    expect(await fetchItemKey(API, "tok", ITEM, impl, null)).toEqual({ denied: 403, standing: "none", title: ITEM, page: null });
  });

  it("404 denies and deletes a kept key", async () => {
    const { impl } = fetchStub(() => json(404, { error: "not-private" }));
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "stale" });
    expect(await fetchItemKey(API, "tok", ITEM, impl, storage)).toEqual({ denied: 404 });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBeNull();
  });

  it("a network error falls back to the kept key, unTouched, if there is one", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "kept-key" });
    expect(await fetchItemKey(API, "tok", ITEM, f as unknown as typeof fetch, storage)).toEqual({ key: "kept-key" });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBe("kept-key"); // still there — a network failure never deletes it
  });

  it("a network error with nothing kept is a distinct 'offline' denial — never the 401 that would sign a valid session out", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await fetchItemKey(API, "tok", ITEM, f as unknown as typeof fetch, mapStorage())).toEqual({ denied: "offline" });
  });

  it("a malformed 200 body (no key field) is treated like the request never landed", async () => {
    const { impl } = fetchStub(() => json(200, { item: ITEM }));
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "kept-key" });
    expect(await fetchItemKey(API, "tok", ITEM, impl, storage)).toEqual({ key: "kept-key" });
  });

  it("a 5xx is Anvil's own trouble, not an answer about standing — same fallback as offline", async () => {
    const { impl } = fetchStub(() => new Response("oops", { status: 502 }));
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "kept-key" });
    expect(await fetchItemKey(API, "tok", ITEM, impl, storage)).toEqual({ key: "kept-key" });
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBe("kept-key");
    expect(await fetchItemKey(API, "tok", ITEM, impl, mapStorage())).toEqual({ denied: "offline" });
  });

  describe("a throwing storage never reaches a caller (quota errors, Safari private mode)", () => {
    function throwingStorage(): KeyStorage {
      return {
        getItem: () => {
          throw new Error("quota");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("quota");
        },
      };
    }

    it("a 200 whose setItem throws still returns the key", async () => {
      const { impl } = fetchStub(() => json(200, { key: "kkk", item: ITEM }));
      await expect(fetchItemKey(API, "tok", ITEM, impl, throwingStorage())).resolves.toEqual({ key: "kkk" });
    });

    it("a 401/403/404 whose removeItem throws still denies cleanly", async () => {
      await expect(fetchItemKey(API, "tok", ITEM, fetchStub(() => json(401, {})).impl, throwingStorage())).resolves.toEqual({ denied: 401 });
      await expect(fetchItemKey(API, "tok", ITEM, fetchStub(() => json(404, {})).impl, throwingStorage())).resolves.toEqual({ denied: 404 });
      await expect(
        fetchItemKey(API, "tok", ITEM, fetchStub(() => json(403, { standing: "none", title: "x" })).impl, throwingStorage()),
      ).resolves.toEqual({ denied: 403, standing: "none", title: "x", page: null });
    });

    it("a network error whose getItem throws falls back to offline, not a crash", async () => {
      const f = vi.fn(async () => {
        throw new Error("offline");
      });
      await expect(fetchItemKey(API, "tok", ITEM, f as unknown as typeof fetch, throwingStorage())).resolves.toEqual({ denied: "offline" });
    });
  });

  it("is bounded like every other registry call", () => {
    const src = readFileSync(new URL("../src/item-key.ts", import.meta.url), "utf8");
    expect(src).toContain("AbortSignal.timeout(10_000)");
  });
});

describe("unlockForViewer", () => {
  it("plain text passes straight through, no fetch made", async () => {
    const f = vi.fn();
    const out = await unlockForViewer("title: A\n", { token: () => "tok", fetchImpl: f as unknown as typeof fetch, storage: null });
    expect(out).toEqual({ text: "title: A\n" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a locked envelope unlocks with the key Anvil hands back", async () => {
    const env = await lockText("secret lecture\n", KEY, ITEM);
    const { impl } = fetchStub(() => json(200, { key: KEY, item: ITEM }));
    const out = await unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage: mapStorage() });
    expect(out).toEqual({ text: "secret lecture\n" });
  });

  it.each([
    [401, { denied: 401 } as const],
    [403, { denied: 403, standing: "none", title: "x", page: null } as const],
    [404, { denied: 404 } as const],
  ])("a %s denial becomes a door result carrying the envelope's item", async (status, denial) => {
    const env = await lockText("secret\n", KEY, ITEM);
    const { impl } = fetchStub(() => json(status, "standing" in denial ? { error: "access", ...denial } : { error: "x" }));
    const out = await unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage: mapStorage() });
    expect(out).toEqual({ door: { ...denial, item: ITEM } });
  });

  it("no clean answer and nothing kept becomes an 'offline' door — never the sign-in door", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    const out = await unlockForViewer(env, { token: () => "tok", fetchImpl: f as unknown as typeof fetch, storage: mapStorage() });
    expect(out).toEqual({ door: { denied: "offline", item: ITEM } });
  });

  it("a wrong (stale) kept key is dropped and asked for again, once — the retry succeeds", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    let call = 0;
    const { impl } = fetchStub(() => {
      call += 1;
      return json(200, { key: call === 1 ? OTHER : KEY, item: ITEM });
    });
    const storage = mapStorage({ [itemKeyStorageKey(ITEM)]: "irrelevant" });
    const out = await unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage });
    expect(out).toEqual({ text: "secret\n" });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("wrong twice is the 404-style 'locked' door, not the sign-in door — a session that is otherwise fine must not be dropped over a key mismatch", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    const { impl } = fetchStub(() => json(200, { key: OTHER, item: ITEM }));
    const storage = mapStorage();
    const out = await unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage });
    expect(out).toEqual({ door: { denied: 404, item: ITEM } });
    expect(impl).toHaveBeenCalledTimes(2);
    // The (wrong) key fetchItemKey stored along the way is cleaned up too.
    expect(storage.getItem(itemKeyStorageKey(ITEM))).toBeNull();
  });

  it("the wrong-key retry's own storage drop never throws, even with a throwing storage", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    const { impl } = fetchStub(() => json(200, { key: OTHER, item: ITEM }));
    const throwing: KeyStorage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    await expect(unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage: throwing })).resolves.toEqual({ door: { denied: 404, item: ITEM } });
  });

  it("omitting storage entirely falls back to the live store (unavailable in this test environment) without throwing", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(unlockForViewer(env, { token: () => "tok", fetchImpl: f as unknown as typeof fetch })).resolves.toEqual({ door: { denied: "offline", item: ITEM } });
  });

  it("security: the fetch always goes to deps.api, never the envelope's own (unauthenticated) enroll field", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    expect(env).toContain("enroll: https://drawcast.anvil.app");
    const rewritten = env.replace("enroll: https://drawcast.anvil.app", "enroll: https://evil.example");
    const { impl, calls } = fetchStub(() => json(200, { key: KEY, item: ITEM }));
    const out = await unlockForViewer(rewritten, { api: API, token: () => "tok", fetchImpl: impl, storage: mapStorage() });
    expect(out).toEqual({ text: "secret\n" });
    expect(calls[0].url).toBe(`${API}/_/api/key`);
  });

  it("defaults api to ENROLL_API when deps.api is not given", async () => {
    const env = await lockText("secret\n", KEY, ITEM);
    const { impl, calls } = fetchStub(() => json(200, { key: KEY, item: ITEM }));
    await unlockForViewer(env, { token: () => "tok", fetchImpl: impl, storage: mapStorage() });
    expect(calls[0].url).toBe("https://drawcast.anvil.app/_/api/key");
  });
});
