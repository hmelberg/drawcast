// The front page's "You" pages: the client half (src/home/you.ts).
import { describe, expect, test } from "vitest";
import { modelName, fetchCourses, fetchItemKey, fetchItems, fetchVisits, leaveCourse, parseItems, parseYou, setCourseAccess, visibility, type MyItem } from "../src/home/you";

const API = "https://drawcast.anvil.app";
function fake(status: number, body: unknown, seen: { url?: string; body?: unknown }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}
const ITEM = { key: "hmelberg/kurs/moon", kind: "cast", title: "Moon", link: "https://drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01", proven: true };

describe("you pages", () => {
  test("only the three pages parse", () => {
    expect(parseYou("content")).toBe("content");
    expect(parseYou("credit")).toBe("credit");
    expect(parseYou("history")).toBeNull();
    expect(parseYou(null)).toBeNull();
  });

  test("items: the server's rows, a title even when blank, junk rows dropped", () => {
    expect(parseItems({ items: [ITEM, { nope: 1 }, { ...ITEM, key: "k2", title: "" }] })).toEqual([
      { key: "hmelberg/kurs/moon", kind: "cast", title: "Moon", link: "https://drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01" },
      { key: "k2", kind: "cast", title: "k2", link: "https://drawcast.app/#moon", names: [{ name: "moon", free: true }], private: false, listed: true, updated: "2026-10-01" },
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
});
