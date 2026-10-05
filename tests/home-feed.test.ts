// The front page's one request (home-cards round, 2026-10-05): the feed
// function (netlify/functions/feed.mts) and the client's reading of it
// (src/home/feed.ts).
import { describe, expect, test } from "vitest";
import { buildFeed, FRESH_MS, handleFeedRequest, type Feed, type FeedDeps } from "../netlify/functions/feed.mts";
import { feedQuery, parseFeed, sameFeed } from "../src/home/feed";
import type { CatalogueItem } from "../src/catalogue";

const item = (name: string, over: Partial<CatalogueItem> = {}) => ({ kind: "cast", title: name, name, owner: "ann", lectures: 1, updated: "2026-10-01", private: false, tags: [], likes: 0, ...over });

function deps(over: Partial<FeedDeps> = {}): FeedDeps & { saved: Feed[]; asked: string[] } {
  const saved: Feed[] = [];
  const asked: string[] = [];
  return {
    saved,
    asked,
    page: async (kind, page) => {
      asked.push(`${kind}${page}`);
      if (kind === "course") return { items: [item("qaly", { kind: "course", lectures: 3 })], more: false };
      return page === 0 ? { items: [item("a"), item("b")], more: true } : { items: [item("c")], more: false };
    },
    ranks: async () => [{ name: "a", visits: 3 }],
    load: async () => null,
    save: async (f) => void saved.push(f),
    now: () => 1_000_000,
    ...over,
  };
}

describe("the feed function", () => {
  test("builds every page of both kinds, with the ranks", async () => {
    const f = (await buildFeed(deps()))!;
    expect(f.items.map((i) => (i as { name: string }).name)).toEqual(["a", "b", "c", "qaly"]);
    expect(f.ranks).toEqual([{ name: "a", visits: 3 }]);
  });
  test("no feed when a kind's first page does not answer", async () => {
    expect(await buildFeed(deps({ page: async (k) => (k === "cast" ? null : { items: [], more: false }) }))).toBeNull();
  });
  test("a fresh kept feed is served with no registry call; a stale one is served and rebuilt behind", async () => {
    const kept: Feed = { built: 1_000_000 - 1000, items: [item("old")], ranks: [] };
    const d = deps({ load: async () => kept });
    const res = await handleFeedRequest(new Request("https://drawcast.app/api/feed"), d);
    expect((await res.json()).items[0].name).toBe("old");
    expect(res.headers.get("netlify-cdn-cache-control")).toContain("durable");
    expect(d.asked).toEqual([]);
    const later: Promise<unknown>[] = [];
    const s = deps({ load: async () => ({ ...kept, built: 1_000_000 - FRESH_MS - 1 }), defer: (w) => void later.push(w) });
    expect((await (await handleFeedRequest(new Request("https://drawcast.app/api/feed"), s)).json()).items[0].name).toBe("old");
    await Promise.all(later);
    expect(s.saved).toHaveLength(1);
  });
  test("nothing kept: built, saved and served; nothing buildable: a 503 the CDN does not keep", async () => {
    const d = deps();
    const res = await handleFeedRequest(new Request("https://drawcast.app/api/feed"), d);
    expect(res.status).toBe(200);
    expect(d.saved).toHaveLength(1);
    const down = await handleFeedRequest(new Request("https://drawcast.app/api/feed"), deps({ page: async () => null }));
    expect(down.status).toBe(503);
    expect(down.headers.get("netlify-cdn-cache-control")).toBe("no-store");
  });
});

describe("the client's feed", () => {
  const feed = parseFeed({
    built: 5,
    items: [
      item("old", { updated: "2026-09-01", tags: ["maths"], format: "quiz" }),
      item("new", { updated: "2026-10-04", title: "Bayes and tests" }),
      item("qaly", { kind: "course", updated: "2026-10-02" }),
      { bad: true },
    ],
    ranks: [{ name: "new", visits: 2 }, { name: 3 }],
  })!;
  test("parses, dropping bad rows", () => {
    expect(feed.items.map((i) => i.name)).toEqual(["old", "new", "qaly"]);
    expect(feed.ranks).toEqual([{ name: "new", visits: 2 }]);
    expect(parseFeed({ items: [] })).toBeNull();
  });
  test("answers the catalogue's filters: newest first, kind, format, q in title or tag, names in order", () => {
    expect(feedQuery(feed.items, {}).map((i) => i.name)).toEqual(["new", "qaly", "old"]);
    expect(feedQuery(feed.items, { kind: "cast" }).map((i) => i.name)).toEqual(["new", "old"]);
    expect(feedQuery(feed.items, { format: "quiz" }).map((i) => i.name)).toEqual(["old"]);
    expect(feedQuery(feed.items, { q: "MATH" }).map((i) => i.name)).toEqual(["old"]);
    expect(feedQuery(feed.items, { q: "bayes" }).map((i) => i.name)).toEqual(["new"]);
    expect(feedQuery(feed.items, { names: ["old", "nobody", "new", "old"] }).map((i) => i.name)).toEqual(["old", "new"]);
  });
  test("two feeds are the same page when only the build time differs", () => {
    expect(sameFeed(feed, { ...feed, built: 9 })).toBe(true);
    expect(sameFeed(feed, { ...feed, ranks: [] })).toBe(false);
  });
});
