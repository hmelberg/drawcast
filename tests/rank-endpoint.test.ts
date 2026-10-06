// Popularity: the names most visited over the last 30 days (netlify/functions/rank.mts).
import { describe, expect, test } from "vitest";
import { computeRanks, handleRankRequest, parseVisitKey, type RankDeps } from "../netlify/functions/rank.mts";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const deps = (records: Record<string, number>): RankDeps => ({
  listKeys: async () => Object.keys(records),
  readCount: async (k) => records[k] ?? 0,
  now: () => NOW,
});

describe("rank", () => {
  test("sums each name's last 30 days, most visited first; older days and empty names left out", async () => {
    const out = await computeRanks(deps({
      "v/moon/2026-10-03": 5, "v/moon/2026-09-20": 7,
      "v/quiz/2026-10-01": 20,
      "v/old/2026-08-01": 99, // older than 30 days
      "v/none/2026-10-02": 0,
      "s/other/2026-10-03": 50, // not a visit record
    }));
    expect(out).toEqual([{ name: "quiz", visits: 20 }, { name: "moon", visits: 12 }]);
  });
  test("day 30 counts, day 31 does not", async () => {
    expect(await computeRanks(deps({ "v/a/2026-09-04": 1, "v/b/2026-09-03": 1 }))).toEqual([{ name: "a", visits: 1 }]);
  });
  test("ties by name; at most `max`", async () => {
    expect((await computeRanks(deps({ "v/b/2026-10-03": 3, "v/a/2026-10-03": 3, "v/c/2026-10-03": 1 }), 30, 2)).map((r) => r.name)).toEqual(["a", "b"]);
  });
  test("?all=1 answers every visited name, not only the top 50, cached apart", async () => {
    const records: Record<string, number> = {};
    for (let i = 0; i < 60; i++) records[`v/n${i}/2026-10-03`] = 1;
    const top = await handleRankRequest(new Request("https://drawcast.app/.netlify/functions/rank"), deps(records));
    expect(((await top.json()) as { ranks: unknown[] }).ranks).toHaveLength(50);
    const all = await handleRankRequest(new Request("https://drawcast.app/.netlify/functions/rank?all=1"), deps(records));
    expect(((await all.json()) as { ranks: unknown[] }).ranks).toHaveLength(60);
    expect(all.headers.get("netlify-vary")).toBe("query=all");
  });
  test("?all=1 adds each name's all-time total; a name with only old visits is kept", async () => {
    const all = await handleRankRequest(
      new Request("https://drawcast.app/.netlify/functions/rank?all=1"),
      deps({ "v/moon/2026-10-03": 5, "v/moon/2026-08-01": 7, "v/old/2026-08-01": 4 }),
    );
    expect(((await all.json()) as { ranks: unknown[] }).ranks).toEqual([
      { name: "moon", visits: 5, total: 12 },
      { name: "old", visits: 0, total: 4 },
    ]);
  });
  test("a lecture name keeps its slash; malformed keys are ignored", () => {
    expect(parseVisitKey("v/spanish/2026-10-03")).toEqual({ name: "spanish", day: "2026-10-03" });
    expect(parseVisitKey("v/x")).toBeNull();
  });
  test("the response is public and CDN-cached for an hour; a failure is an empty list, not cached", async () => {
    const ok = await handleRankRequest(new Request("https://drawcast.app/.netlify/functions/rank"), deps({ "v/a/2026-10-03": 2 }));
    expect(await ok.json()).toEqual({ days: 30, ranks: [{ name: "a", visits: 2 }] });
    expect(ok.headers.get("netlify-cdn-cache-control")).toContain("max-age=3600");
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const bad = await handleRankRequest(new Request("https://drawcast.app/.netlify/functions/rank"), { ...deps({}), listKeys: async () => { throw new Error("blobs down"); } });
    expect(await bad.json()).toEqual({ days: 30, ranks: [] });
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });
});
