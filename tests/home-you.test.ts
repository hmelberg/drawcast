// The front page's "You" pages: the client half (src/home/you.ts).
import { describe, expect, test } from "vitest";
import { countLine, matchesQuery, cachedItems, browserName, parseSessions, firstDir, sortBy, modelName, fetchCourses, fetchItemKey, fetchItems, fetchVisits, leaveCourse, parseItems, parseYou, setCourseAccess, visibility, type MyItem } from "../src/home/you";

const API = "https://drawcast.anvil.app";
function fake(status: number, body: unknown, seen: { url?: string; body?: unknown }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}
const ITEM = { key: "hmelberg/kurs/moon", kind: "cast", title: "Moon", link: "https://www.drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01", proven: true };

describe("you pages", () => {
  test("only the three pages parse", () => {
    expect(parseYou("content")).toBe("content");
    expect(parseYou("credit")).toBe("credit");
    expect(parseYou("history")).toBeNull();
    expect(parseYou(null)).toBeNull();
  });

  test("items: the server's rows, a title even when blank, junk rows dropped", () => {
    expect(parseItems({ items: [ITEM, { nope: 1 }, { ...ITEM, key: "k2", title: "" }] })).toEqual([
      { key: "hmelberg/kurs/moon", kind: "cast", title: "Moon", link: "https://www.drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01" },
      { key: "k2", kind: "cast", title: "k2", link: "https://www.drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01" },
    ]);
    expect(parseItems({})).toBeNull();
  });

  test("visibility is YouTube's three words", () => {
    const i = parseItems({ items: [ITEM] })![0] as MyItem;
    expect(visibility(i)).toBe("Public");
    expect(visibility({ ...i, listed: false })).toBe("Unlisted");
    expect(visibility({ ...i, private: true, listed: true })).toBe("Private");
  });

  test("each call posts the key to its /my path; 401 = sign in again", async () => {
    const seen: { url?: string; body?: unknown }[] = [];
    expect(await fetchItems("k1", fake(200, { items: [ITEM] }, seen))).toHaveLength(1);
    expect(seen[0]).toEqual({ url: `${API}/_/api/my/items`, body: { key: "k1" } });
    expect(await fetchItems("k1", fake(401, { error: "key" }))).toBe("signin");
    expect(await fetchItems("k1", fake(500, {}))).toBe("error");
  });

  test("visits: a number, or null when there is none to show", async () => {
    expect(await fetchVisits("k", "moon", fake(200, { total: 42, days: 9 }))).toBe(42);
    expect(await fetchVisits("k", "moon", fake(200, { total: null, days: 0 }))).toBeNull();
    expect(await fetchVisits("k", "moon", fake(500, {}))).toBeNull();
  });

  test("a private key, or null when it is not yours or not private", async () => {
    const seen: { url?: string; body?: unknown }[] = [];
    expect(await fetchItemKey("k", "a/b/c", fake(200, { item_key: "s3cret" }, seen))).toBe("s3cret");
    expect(seen[0].body).toEqual({ key: "k", item: "a/b/c" });
    expect(await fetchItemKey("k", "a/b/c", fake(404, { error: "none" }))).toBeNull();
  });

  test("courses: following and teaching, can_manage read as canManage", async () => {
    const out = await fetchCourses(
      "k",
      fake(200, {
        following: [{ id: "e1", title: "Econ", link: "L", run: "default", state: "active", joined: "2026-09-01", lectures: [{ title: "1", opened: true, completed: true }] }],
        teaching: [{ key: "c1", title: "Econ", link: "L", access: "open", can_manage: true, runs: [{ id: "r1", title: "Spring", open: true, default: true, learners: 3, pending: 1 }] }],
      }),
    );
    expect(out).not.toBe("error");
    if (typeof out !== "object") return;
    expect(out.following[0].lectures).toHaveLength(1);
    expect(out.teaching[0].canManage).toBe(true);
    expect(out.teaching[0].runs[0].pending).toBe(1);
  });

  test("leave and who-can-watch post what they change; anything but 200 is an error", async () => {
    const seen: { url?: string; body?: unknown }[] = [];
    expect(await leaveCourse("k", "e1", fake(200, { left: true }, seen))).toBe(true);
    expect(seen[0]).toEqual({ url: `${API}/_/api/my/leave`, body: { key: "k", id: "e1" } });
    expect(await leaveCourse("k", "e1", fake(404, { error: "none" }))).toBe("error");
    expect(await setCourseAccess("k", "c1", "open", fake(200, { access: "open" }, seen))).toBe(true);
    expect(seen[1].body).toEqual({ key: "k", course: "c1", access: "open" });
    expect(await setCourseAccess("k", "c1", "open", fake(403, { error: "owner" }))).toBe("error");
  });

  test("model ids read as names in the statement", () => {
    expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelName("gpt-x")).toBe("gpt-x");
  });

  test("sorting: text A→Z ignoring case, numbers by size, stable, reversible", () => {
    const rows = [{ t: "bayes", v: 3 }, { t: "Moon", v: 10 }, { t: "apple", v: 3 }];
    expect(sortBy(rows, (r) => r.t, 1).map((r) => r.t)).toEqual(["apple", "bayes", "Moon"]);
    expect(sortBy(rows, (r) => r.v, -1).map((r) => r.t)).toEqual(["Moon", "bayes", "apple"]);
    expect(sortBy(rows, (r) => r.v, 1).map((r) => r.t)).toEqual(["bayes", "apple", "Moon"]);
  });
  test("a first click sorts text A→Z, dates and numbers biggest first", () => {
    expect(firstDir("Moon")).toBe(1);
    expect(firstDir("2026-10-04")).toBe(-1);
    expect(firstDir(12)).toBe(-1);
  });

  test("sessions: the asking browser marked, nothing else read", () => {
    expect(parseSessions({ email: "a@b", sessions: [{ label: "x", last_used: "2026-10-06", current: true, secret: "never" }] })).toEqual({
      email: "a@b",
      sessions: [{ label: "x", lastUsed: "2026-10-06", current: true }],
    });
    expect(parseSessions({ sessions: [] })).toBeNull();
  });
  test("a browser label reads as a browser and a system", () => {
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18 Safari/605")).toBe("Safari on Mac");
    // cut at 60 characters, as the server keeps it: only the system is known
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit")).toBe("A browser on Mac");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130")).toBe("Chrome on Windows");
    expect(browserName("a browser")).toBe("a browser");
  });

  test("search: every word in the title or a name, any case", () => {
    const i = parseItems({ items: [ITEM] })![0];
    expect(matchesQuery(i, "moon")).toBe(true);
    expect(matchesQuery(i, "MOON never")).toBe(false); // "never" is in neither
    expect(matchesQuery({ ...i, title: "Why the Moon never lands" }, "moon never")).toBe(true);
    expect(matchesQuery(i, "#moon".slice(1))).toBe(true);
  });
  test("the count line", () => {
    const i = parseItems({ items: [ITEM] })![0];
    expect(countLine([i, i, { ...i, kind: "course", private: true }])).toBe("2 drawcasts · 1 course · 1 private");
    expect(countLine([i])).toBe("1 drawcast · 0 courses");
  });
  test("the kept list belongs to the token that kept it", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    store.set("drawcast.my-items", JSON.stringify({ tag: "12345678", items: [ITEM] }));
    expect(cachedItems("tok-12345678")).toHaveLength(1);
    expect(cachedItems("someone-else")).toBeNull();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
