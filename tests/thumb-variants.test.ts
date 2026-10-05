// Several thumbnails per cast (2026-10-06): choosing which to show
// (src/card/choose.ts), counting (netlify/functions/thumbs.mts), and the
// counts in the feed (netlify/functions/feed.mts thumbStats).
import { describe, expect, test } from "vitest";
import { beta, chooseVariant, FLOOR, hash32, seeded } from "../src/card/choose";
import { handleThumbsRequest, parseShown, parseThumbKey, thumbKey, type ThumbCount, type ThumbsDeps } from "../netlify/functions/thumbs.mts";
import { thumbStats } from "../netlify/functions/feed.mts";
import { thumbnailItemsOf, parsePlaylistText } from "../src/playlist/playlist";

describe("choosing a variant", () => {
  test("the same seed gives the same choice; one variant is always 0", () => {
    const seed = hash32("viewer|cast|2026-10-06");
    expect(chooseVariant(3, undefined, seeded(seed))).toBe(chooseVariant(3, undefined, seeded(seed)));
    expect(chooseVariant(1, [[100, 50]], seeded(1))).toBe(0);
  });
  test("with no data every variant gets its turn, roughly evenly", () => {
    const hits = [0, 0, 0];
    for (let i = 0; i < 3000; i++) hits[chooseVariant(3, undefined, seeded(i))]++;
    for (const h of hits) expect(h).toBeGreaterThan(800);
  });
  test("a clearly better variant is shown most, never only it (the floor)", () => {
    const counts: [number, number][] = [[1000, 20], [1000, 80], [1000, 30]];
    const hits = [0, 0, 0];
    for (let i = 0; i < 4000; i++) hits[chooseVariant(3, counts, seeded(i + 7))]++;
    expect(hits[1]).toBeGreaterThan(3200);
    expect(hits[0]).toBeGreaterThan(0);
    expect(hits[2]).toBeGreaterThan(0);
    expect(FLOOR).toBeGreaterThan(0);
  });
  test("a beta draw lies in 0..1 and centres where it should", () => {
    const r = seeded(3);
    const xs = Array.from({ length: 2000 }, () => beta(31, 71, r));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean).toBeGreaterThan(0.27);
    expect(mean).toBeLessThan(0.34);
  });
});

describe("counting", () => {
  function deps(listed: string[] | null = ["moon", "sharks"]): ThumbsDeps & { store: Map<string, ThumbCount> } {
    const store = new Map<string, ThumbCount>();
    return {
      store,
      listed: async () => (listed ? new Set(listed) : null),
      read: async (k) => store.get(k) ?? null,
      write: async (k, c) => void store.set(k, c),
      now: () => Date.parse("2026-10-06T12:00:00Z"),
    };
  }
  const post = (body: unknown) => new Request("https://drawcast.app/api/thumbs", { method: "POST", body: JSON.stringify(body) });
  test("what was seen counts once per beacon; a click counts; unlisted names and bad entries are ignored", async () => {
    const d = deps();
    await handleThumbsRequest(post({ seen: ["moon:0", "moon:0", "sharks:2", "nobody:0", "moon:9", 42] }), d);
    await handleThumbsRequest(post({ click: "sharks:2" }), d);
    expect(Object.fromEntries(d.store)).toEqual({
      [thumbKey("moon", 0, "all", "2026-10-06")]: { shown: 1, clicks: 0 },
      [thumbKey("sharks", 2, "all", "2026-10-06")]: { shown: 1, clicks: 1 },
    });
  });
  test("no feed yet, nothing counted; a GET refused", async () => {
    const d = deps(null);
    await handleThumbsRequest(post({ seen: ["moon:0"] }), d);
    expect(d.store.size).toBe(0);
    expect((await handleThumbsRequest(new Request("https://drawcast.app/api/thumbs"), d)).status).toBe(405);
  });
  test("keys and entries parse", () => {
    expect(parseThumbKey("t/moon/1/all/2026-10-06")).toEqual({ name: "moon", variant: 1, seg: "all", day: "2026-10-06" });
    expect(parseShown("moon:1")).toEqual({ name: "moon", variant: 1 });
    expect(parseShown("Moon:1")).toBeNull();
  });
});

test("the feed's counts: [shown, clicks] per variant, summed over days", () => {
  expect(thumbStats([
    { name: "moon", variant: 0, shown: 10, clicks: 1 },
    { name: "moon", variant: 2, shown: 5, clicks: 2 },
    { name: "moon", variant: 0, shown: 3, clicks: 0 },
  ])).toEqual({ moon: [[13, 1], [0, 0], [5, 2]] });
});

test("every thumbnail page, in order", () => {
  const p = parsePlaylistText(`# T

## Main
    text t1 "x" x 100 y 100

Hello.
    draw t1

## Thumbnail
role: thumbnail
    text a "A" x 500 y 500

## Thumbnail
role: thumbnail
    text b "B" x 500 y 500
`);
  expect(thumbnailItemsOf(p).map((i) => i.spec.elements?.[0].id)).toEqual(["a", "b"]);
});
