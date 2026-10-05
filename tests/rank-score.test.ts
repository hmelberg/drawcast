// The front page's ranking (ranking round, 2026-10-05): netlify/lib/rank-score.mts
// and the feed's use of it (netlify/functions/feed.mts scoresFor, visitRanks).
import { describe, expect, test } from "vitest";
import { decayed, foldDays, parseDayKey, quality, rankScore } from "../netlify/lib/rank-score.mts";
import { scoresFor, visitRanks } from "../netlify/functions/feed.mts";

const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("rank score", () => {
  test("a count halves every half-life", () => {
    expect(decayed({ "2026-10-05": 4 }, 14, NOW)).toBeCloseTo(4);
    expect(decayed({ "2026-09-21": 4 }, 14, NOW)).toBeCloseTo(2);
    expect(decayed({ "2026-09-07": 4 }, 14, NOW)).toBeCloseTo(1);
    expect(decayed({ nonsense: 4 }, 14, NOW)).toBe(0);
  });
  test("quality starts at one half and moves slowly", () => {
    expect(quality(0, 0)).toBe(0.5);
    expect(quality(1, 0)).toBeCloseTo(0.6);
    expect(quality(0, 1)).toBeCloseTo(0.4);
    expect(quality(20, 0)).toBeGreaterThan(0.9);
  });
  test("recent likes beat the same number of old likes", () => {
    const fresh = rankScore({ likes: 5, likeDays: { "2026-10-04": 5 } }, NOW);
    const stale = rankScore({ likes: 5, likeDays: { "2026-07-01": 5 } }, NOW);
    expect(fresh.score).toBeGreaterThan(stale.score * 5);
    expect(fresh.month).toBeGreaterThan(0);
    expect(stale.month).toBe(0);
  });
  test("dislikes lower a drawcast without showing anywhere", () => {
    const liked = rankScore({ likes: 3, dislikes: 0, likeDays: { "2026-10-04": 3 } }, NOW);
    const disputed = rankScore({ likes: 3, dislikes: 6, likeDays: { "2026-10-04": 3 } }, NOW);
    expect(disputed.score).toBeLessThan(liked.score);
  });
  test("watching to the end counts more than a visit", () => {
    const visited = rankScore({ likes: 0, visits: { "2026-10-04": 10 } }, NOW);
    const finished = rankScore({ likes: 0, done: { "2026-10-04": 10 } }, NOW);
    expect(finished.score).toBeGreaterThan(visited.score * 5);
  });
  test("a new drawcast gets a boost that fades within days", () => {
    const today = rankScore({ likes: 0, created: "2026-10-05T08:00:00" }, NOW).score;
    const lastWeek = rankScore({ likes: 0, created: "2026-09-28T08:00:00" }, NOW).score;
    const old = rankScore({ likes: 0, created: "2026-06-01T08:00:00" }, NOW).score;
    expect(today).toBeGreaterThan(2.5);
    expect(lastWeek).toBeLessThan(today / 2);
    expect(old).toBeLessThan(0.01);
  });
  test("without the registry's dates a like counts as two weeks old", () => {
    expect(rankScore({ likes: 4 }, NOW).score).toBeCloseTo(4 * 0.5 * 0.75);
  });
});

describe("day keys", () => {
  test("parses visits and completions, folds lectures into their course", () => {
    expect(parseDayKey("v/spanish/3/2026-10-01")).toEqual({ kind: "v", name: "spanish/3", day: "2026-10-01" });
    expect(parseDayKey("d/moon/2026-10-01")).toEqual({ kind: "d", name: "moon", day: "2026-10-01" });
    expect(parseDayKey("x/moon/2026-10-01")).toBeNull();
    const folded = foldDays([{ name: "spanish/3", day: "2026-10-01", count: 2 }, { name: "spanish", day: "2026-10-01", count: 1 }, { name: "moon", day: "2026-10-02", count: 0 }]);
    expect(Object.fromEntries(folded)).toEqual({ spanish: { "2026-10-01": 3 } });
  });
});

describe("the feed's scores", () => {
  const items = [{ name: "moon", likes: 1 }, { name: "spanish", likes: 0, created: "2026-10-04T10:00:00" }, { bad: true }];
  test("the registry's stats when given, else the catalogue's likes", () => {
    const withStats = scoresFor(items, [], [{ name: "moon", likes: 9, dislikes: 0, like_days: { "2026-10-04": 9 }, created: null }], NOW);
    const without = scoresFor(items, [], null, NOW);
    expect(withStats.moon.score).toBeGreaterThan(without.moon.score);
    expect(without.spanish.score).toBeGreaterThan(2); // new: the boost from the catalogue's created
    expect(Object.keys(without)).toEqual(["moon", "spanish"]);
  });
  test("lecture visits and completions count for the course", () => {
    const s = scoresFor(items, [{ kind: "d", name: "spanish/2", day: "2026-10-05", count: 3 }], null, NOW);
    expect(s.spanish.score).toBeGreaterThan(scoresFor(items, [], null, NOW).spanish.score);
  });
  test("visit ranks keep lectures apart, most first, visits only", () => {
    expect(visitRanks([{ kind: "v", name: "a", day: "d", count: 1 }, { kind: "v", name: "b/2", day: "d", count: 5 }, { kind: "d", name: "a", day: "d", count: 9 }])).toEqual([
      { name: "b/2", visits: 5 },
      { name: "a", visits: 1 },
    ]);
  });
});
