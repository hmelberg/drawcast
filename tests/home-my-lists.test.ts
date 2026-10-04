// The viewer's lists (save round, 2026-10-04): History in this browser, Saved/Liked from Anvil.
import { describe, expect, test } from "vitest";
import { HISTORY_MAX, clearHistory, fetchMyList, parseMyList, readHistory, recordWatch } from "../src/home/my-lists";

function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("history", () => {
  test("newest first, once each, a lecture counts as its course, capped", () => {
    const s = mem();
    recordWatch("moon", 1, s);
    recordWatch("qaly/2", 2, s);
    recordWatch("moon", 3, s);
    expect(readHistory(s).map((e) => e.name)).toEqual(["moon", "qaly"]);
    for (let i = 0; i < HISTORY_MAX + 5; i++) recordWatch(`n${i}`, 10 + i, s);
    expect(readHistory(s)).toHaveLength(HISTORY_MAX);
    clearHistory(s);
    expect(readHistory(s)).toEqual([]);
  });
  test("a broken store reads as empty", () => {
    const s = mem();
    s.setItem("drawcast.history", "{nope");
    expect(readHistory(s)).toEqual([]);
  });
});

describe("saved and liked", () => {
  const API = "https://drawcast.anvil.app";
  const fake = (status: number, body: unknown, seen: unknown[] = []): typeof fetch =>
    (async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  test("posts the list; answers catalogue items; 401 is sign in", async () => {
    const seen: unknown[] = [];
    const item = { kind: "cast", title: "Moon", name: "moon", page: null, owner: "ann", lectures: 1, updated: null, private: false, format: null, tags: [], likes: 2 };
    const out = await fetchMyList("saved", "k1", fake(200, { items: [item, { junk: 1 }] }, seen), API);
    expect(Array.isArray(out) && out.map((i) => i.name)).toEqual(["moon"]);
    expect(seen[0]).toEqual({ url: `${API}/_/api/my/list`, body: { key: "k1", list: "saved" } });
    expect(await fetchMyList("liked", "k1", fake(401, {}), API)).toBe("signin");
    expect(await fetchMyList("liked", "k1", fake(500, {}), API)).toBe("error");
  });
  test("the list names", () => {
    expect(parseMyList("saved")).toBe("saved");
    expect(parseMyList("history")).toBe("history");
    expect(parseMyList("x")).toBeNull();
  });
});
