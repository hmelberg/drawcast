// Recording and counting views. Driven entirely through an injected fake
// store, the same way tests/rate-limit.test.ts drives the failure budget.
//
// HONEST LIMIT: this fake store does `.filter(k => k.startsWith(prefix))` on
// plain JS strings — it cannot reproduce the real Netlify Blobs HTTP API,
// where `set`'s key travels in the request PATH and `list`'s prefix travels
// as a URL QUERY parameter that the SDK independently re-encodes. That gap
// is exactly what let the production view-counter bug ship (see
// netlify/lib/view-key.mts's module comment): every test here passed while
// every real POST silently failed to be counted. tests/view-key.test.ts pins
// the necessary condition testable without a platform — that constructed
// keys/prefixes never contain a "%" — but only the live smoke test against
// the deployed function actually exercises the real wire encoding.
import { describe, expect, test, vi } from "vitest";
import { countCast, countRepo, defaultStore, recordAndCount, recordHit, type ViewStore } from "../netlify/lib/view-store.mts";
import { getStore } from "@netlify/blobs";

vi.mock("@netlify/blobs", () => ({ getStore: vi.fn(() => ({})) }));

function fakeStore() {
  const data = new Map<string, unknown>();
  const store: ViewStore = {
    get: async (key) => (data.has(key) ? data.get(key) : null),
    set: async (key, value) => { data.set(key, value); },
    setJSON: async (key, value) => { data.set(key, value); },
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    delete: async (key) => { data.delete(key); },
  };
  return { store: () => store, data };
}

const KEY = "hmelberg/kurs/casts/did.yaml";
const DAY2 = Date.UTC(2026, 8, 4, 12);
const DAY3 = Date.UTC(2026, 8, 5, 12);

function opts(store: () => ViewStore, ms: number, seq = { n: 0 }) {
  return { store, now: () => ms, uuid: () => `id${seq.n++}` };
}

describe("recordHit", () => {
  test("writes one key per view and never reads first", async () => {
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    await recordHit(KEY, opts(store, DAY2, seq));
    await recordHit(KEY, opts(store, DAY2, seq));
    expect([...data.keys()]).toEqual([
      "h/hmelberg/kurs/casts/did.yaml/2026-09-04/id0",
      "h/hmelberg/kurs/casts/did.yaml/2026-09-04/id1",
    ]);
  });

  test("an invalid key is refused rather than written", async () => {
    const { store, data } = fakeStore();
    await expect(recordHit("nope", opts(store, DAY2))).rejects.toThrow();
    expect(data.size).toBe(0);
  });
});

describe("recordAndCount", () => {
  test("counts the hit it just wrote, even when the listing has not caught up", async () => {
    // Blobs `list` is eventually consistent and offers no strong option, so
    // this is the normal case moments after a write — not an exotic one.
    const { store } = fakeStore();
    const blind: ViewStore = { ...store(), list: async () => ({ blobs: [] }) };
    expect(await recordAndCount(KEY, { store: () => blind, now: () => DAY2, uuid: () => "id0" })).toBe(1);
  });

  test("does not double-count once the listing does catch up", async () => {
    const { store } = fakeStore();
    expect(await recordAndCount(KEY, opts(store, DAY2))).toBe(1);
    expect(await recordAndCount(KEY, opts(store, DAY2, { n: 1 }))).toBe(2);
  });
});

describe("countCast", () => {
  test("counts raw hits before anything has been compacted", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    const res = await countCast(KEY, opts(store, DAY2, seq));
    expect(res.total).toBe(3);
    expect(res.days).toEqual({ "2026-09-04": 3 });
  });

  test("a past day is rolled up on the next read, and today is left alone", async () => {
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await recordHit(KEY, opts(store, DAY3, seq));

    const first = await countCast(KEY, opts(store, DAY3, seq));
    expect(first.total).toBe(4);
    expect(data.get("r/hmelberg/kurs/casts/did.yaml")).toEqual({ "2026-09-04": 3 });
    // Yesterday's raw keys survive this pass; today's are untouched either way.
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(3);
    expect([...data.keys()].filter((k) => k.includes("2026-09-05")).length).toBe(1);

    // Second read deletes the rolled-up raws, and the total does not move.
    const second = await countCast(KEY, opts(store, DAY3, seq));
    expect(second.total).toBe(4);
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(0);

    const third = await countCast(KEY, opts(store, DAY3, seq));
    expect(third.total).toBe(4);
    expect(third.days).toEqual({ "2026-09-04": 3, "2026-09-05": 1 });
  });

  test("a rolled-up day is counted from the rollup even while its raws linger", async () => {
    // Half-finished deletion — a delete budget ran out, or a concurrent
    // request is midway. The total must not double.
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, { ...opts(store, DAY3, seq), deleteBudget: 0 });
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(3);
    expect((await countCast(KEY, { ...opts(store, DAY3, seq), deleteBudget: 0 })).total).toBe(3);
  });

  test("a hit landing for a day already rolled up is dropped, not added to the rollup total", async () => {
    // Pins THE COUNTING RULE directly: a future "simplification" that made
    // mergeDays add the raw count instead of ignoring it would inflate this
    // to 6, silently double-counting the straggler.
    const { store, data } = fakeStore();
    data.set("r/hmelberg/kurs/casts/did.yaml", { "2026-09-04": 5 });
    data.set("h/hmelberg/kurs/casts/did.yaml/2026-09-04/stray", "");
    const res = await countCast(KEY, opts(store, DAY3));
    expect(res.total).toBe(5);
    expect(res.days).toEqual({ "2026-09-04": 5 });
  });

  test("a delete budget smaller than the raw count leaves the remainder for next time", async () => {
    // deleteBudget: 0 (above) returns before the loop body ever runs. This
    // pins the boundary inside the loop — budget-- <= 0 firing partway
    // through a day's keys, not just before the first one.
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, opts(store, DAY3, seq)); // writes the rollup, deletes nothing yet
    const res = await countCast(KEY, { ...opts(store, DAY3, seq), deleteBudget: 2 });
    expect(res.total).toBe(3);
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(1);
  });

  test("an unseen cast is zero, not an error", async () => {
    const { store } = fakeStore();
    expect((await countCast(KEY, opts(store, DAY2))).total).toBe(0);
  });

  test("the delete pass runs deletes concurrently rather than one at a time — a serial pass could never drain a large backlog inside a function timeout", async () => {
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 40; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, opts(store, DAY3, seq)); // writes the rollup, deletes nothing yet

    const real = store();
    let inFlight = 0;
    let maxInFlight = 0;
    const tracking: ViewStore = {
      ...real,
      delete: async (key) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve(); // yield so overlapping deletes can stack up
        inFlight--;
        return real.delete(key);
      },
    };
    await countCast(KEY, { ...opts(store, DAY3, seq), store: () => tracking, deleteBudget: 40 });
    expect(maxInFlight).toBeGreaterThan(1);
    expect(data.size).toBe(1); // rollup only — all 40 raws drained in one pass
  });

  describe("the grace window after UTC midnight", () => {
    // Just past midnight on day 3 — inside the 15-minute grace period, so day
    // 2 (now "yesterday") must be left alone: eventual consistency has not
    // necessarily caught up on a listing taken this soon after the rollover.
    const JUST_AFTER_MIDNIGHT = Date.UTC(2026, 8, 5, 0, 5);

    test("a day is not folded into a rollup within the grace window", async () => {
      const { store, data } = fakeStore();
      const seq = { n: 0 };
      for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
      const res = await countCast(KEY, opts(store, JUST_AFTER_MIDNIGHT, seq));
      expect(res.total).toBe(3); // still counted, straight from the raw keys
      expect(data.get("r/hmelberg/kurs/casts/did.yaml")).toBeUndefined();
      expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(3);
    });

    test("compaction resumes once the grace window has passed", async () => {
      const { store, data } = fakeStore();
      const seq = { n: 0 };
      for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
      await countCast(KEY, opts(store, JUST_AFTER_MIDNIGHT, seq)); // skipped — still in the window
      expect(data.get("r/hmelberg/kurs/casts/did.yaml")).toBeUndefined();
      await countCast(KEY, opts(store, DAY3, seq)); // well past it now
      expect(data.get("r/hmelberg/kurs/casts/did.yaml")).toEqual({ "2026-09-04": 3 });
    });
  });

  test("a smaller read racing a concurrent compaction cannot shrink an already-committed larger rollup", async () => {
    // Simulates two readers folding the same day at once: this reader's OWN
    // rollup read (inside countCast, before compact runs) is stale — as if it
    // ran moments before a concurrent, fuller listing committed 5 for that
    // day. The re-read compact() does immediately before writing must see
    // that 5 and never let this reader's own smaller count (2) replace it.
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    await recordHit(KEY, opts(store, DAY2, seq));
    await recordHit(KEY, opts(store, DAY2, seq)); // this reader's own listing sees only 2

    const real = store();
    const rollupBlobKey = "r/hmelberg/kurs/casts/did.yaml";
    let getCalls = 0;
    const racing: ViewStore = {
      ...real,
      get: async (key, o) => {
        getCalls++;
        if (getCalls === 1) return null; // countCast's own pre-compact read: stale
        return key === rollupBlobKey ? { "2026-09-04": 5 } : real.get(key, o);
      },
    };
    await countCast(KEY, { ...opts(store, DAY3, seq), store: () => racing });
    expect(data.get(rollupBlobKey)).toEqual({ "2026-09-04": 5 });
  });
});

describe("countRepo", () => {
  test("totals every cast and groups them by publish folder", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    const lecture = "hmelberg/kurs/courses/causal/did.yaml";
    const other = "hmelberg/kurs/courses/causal/rdd.yaml";
    await recordHit(KEY, opts(store, DAY2, seq));
    for (let i = 0; i < 2; i++) await recordHit(lecture, opts(store, DAY2, seq));
    await recordHit(other, opts(store, DAY2, seq));

    const res = await countRepo("hmelberg", "kurs", opts(store, DAY2, seq));
    expect(res.casts.map((c) => [c.key, c.total])).toEqual([
      [KEY, 1],
      [lecture, 2],
      [other, 1],
    ]);
    expect(res.courses).toEqual({ casts: 1, "courses/causal": 3 });
  });

  test("another repo's counts are not visible", async () => {
    const { store } = fakeStore();
    await recordHit(KEY, opts(store, DAY2));
    const res = await countRepo("someone", "else", opts(store, DAY2));
    expect(res.casts).toEqual([]);
    expect(res.courses).toEqual({});
  });

  test("rolled-up casts with no raw hits left still appear", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 2; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, opts(store, DAY3, seq));
    await countCast(KEY, opts(store, DAY3, seq)); // deletes the raws
    const res = await countRepo("hmelberg", "kurs", opts(store, DAY3, seq));
    expect(res.casts).toEqual([{ key: KEY, total: 2, days: { "2026-09-04": 2 } }]);
  });

  test("an unparseable key in the store is ignored rather than crashing the whole repo read", async () => {
    // castKeyOfHitKey/castKeyOfRollup can meet keys this module never wrote —
    // a stray blob under the same store, shaped like a hit/rollup key but
    // not a valid cast key — and must not throw.
    const { store, data } = fakeStore();
    await recordHit(KEY, opts(store, DAY2));
    data.set("h/hmelberg/kurs/broken/2026-09-04/id0", ""); // no valid extension
    data.set("r/hmelberg/kurs/also-broken", { "2026-09-04": 5 });
    const res = await countRepo("hmelberg", "kurs", opts(store, DAY2));
    expect(res.casts.map((c) => c.key)).toEqual([KEY]);
  });

  test("an orphan from the old percent-encoded key layout does not resurface", async () => {
    // Before the fix, every recorded view was written under a key like
    // h/<castKey percent-encoded into one segment>/<day>/<uuid> — see
    // view-key.mts's module comment for why that broke counting. Those old
    // writes are permanently invisible to the new h/<owner>/<repo>/ prefix
    // (they don't start with it), and even if one somehow did share the
    // prefix, castKeyOfHitKey/castKeyOfRollup reject a "%"-bearing candidate
    // (isValidCastKey never accepts one) rather than treating it as live.
    const { store, data } = fakeStore();
    await recordHit(KEY, opts(store, DAY2));
    data.set("h/hmelberg%2Fkurs%2Forphan.yaml/2026-09-04/id-old", "");
    data.set("r/hmelberg%2Fkurs%2Forphan.yaml", { "2026-09-04": 5 });
    const res = await countRepo("hmelberg", "kurs", opts(store, DAY2));
    expect(res.casts.map((c) => c.key)).toEqual([KEY]);
  });
});

describe("the live store", () => {
  test("is read with strong consistency, since a stale rollup would lose views", () => {
    defaultStore();
    expect(getStore).toHaveBeenCalledWith({ name: "views", consistency: "strong" });
  });
});
