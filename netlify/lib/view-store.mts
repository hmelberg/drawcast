// View counting on Netlify Blobs.
//
// Blobs has no compare-and-set (see netlify/lib/rate-limit.mts), so a
// read-modify-write counter loses hits exactly when they arrive together —
// a class opening a lecture at the same moment. Every view is therefore its
// own key and totals are derived by counting keys: the write path never
// reads, so nothing can be lost.
//
// Reads would then grow with lifetime views, which is what compaction fixes:
// a day that is over gets folded into one rollup number and its raw keys are
// deleted, so a read only ever lists today.
import { getStore } from "@netlify/blobs";
import {
  castKeyOfHitKey,
  castKeyOfRollup,
  courseFolderOf,
  dayOfHitKey,
  dayString,
  encodeCastKey,
  hitKey,
  hitPrefix,
  isValidCastKey,
  repoHitPrefix,
  repoRollupPrefix,
  rollupKey,
} from "./view-key.mts";

const STORE_NAME = "views";

/** The slice of the Blobs API this needs — swapped for a fake in tests. */
export interface ViewStore {
  get(key: string, opts: { type: "json"; consistency: "strong" }): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  delete(key: string): Promise<unknown>;
}

export interface ViewOptions {
  store?: () => ViewStore;
  now?: () => number;
  uuid?: () => string;
  /** Deletes attempted per compaction pass; the rest wait for the next read. */
  deleteBudget?: number;
}

export interface CastCount {
  total: number;
  days: Record<string, number>;
}

// Serial deletes could never drain a popular (or curl-inflated) cast: every
// read pays the full listing cost, and the drain removes at most this many
// raws per request. Deleting in parallel chunks lets the same wall-clock
// budget (one Netlify Functions invocation) clear far more of the backlog,
// so the budget can rise well past what a strictly serial pass could ever
// attempt inside a function timeout.
const DEFAULT_DELETE_BUDGET = 2000;

// How many `store.delete()` calls are in flight at once. Bounded so one
// compaction pass cannot fire thousands of concurrent requests at Blobs;
// wide enough that the round-trip latency of one chunk, not per-key latency,
// dominates the wall-clock cost of draining `deleteBudget` keys.
const DELETE_CONCURRENCY = 25;

/**
 * Strong consistency is load-bearing: compaction writes a rollup and then
 * deletes the raw keys it replaces, so a stale rollup read next to
 * already-deleted raws would silently lose those views. (`list` has no
 * consistency option at all — only `get` does — which is why the counting
 * rule below never trusts a listing to be complete.)
 */
export function defaultStore(): ViewStore {
  return getStore({ name: STORE_NAME, consistency: "strong" }) as unknown as ViewStore;
}

function settings(o: ViewOptions) {
  return {
    store: o.store ?? defaultStore,
    now: o.now ?? Date.now,
    uuid: o.uuid ?? (() => crypto.randomUUID()),
    deleteBudget: o.deleteBudget ?? DEFAULT_DELETE_BUDGET,
  };
}

/**
 * Record one view; returns the key written. No read first, so concurrent
 * views cannot overwrite each other.
 */
export async function recordHit(castKey: string, o: ViewOptions = {}): Promise<string> {
  if (!isValidCastKey(castKey)) throw new Error("invalid cast key");
  const { store, now, uuid } = settings(o);
  const enc = encodeCastKey(castKey);
  const key = hitKey(enc, dayString(now()), uuid());
  await store().set(key, "");
  return key;
}

async function readRollup(store: ViewStore, enc: string): Promise<Record<string, number>> {
  const raw = (await store.get(rollupKey(enc), { type: "json", consistency: "strong" })) as Record<string, number> | null;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [day, n] of Object.entries(raw)) if (typeof n === "number") out[day] = n;
  return out;
}

/** Raw hit keys for one cast, grouped by day. */
function groupByDay(blobs: { key: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of blobs) {
    const day = dayOfHitKey(b.key);
    if (day) (out[day] ??= []).push(b.key);
  }
  return out;
}

/**
 * THE COUNTING RULE: a day present in the rollup is counted from the rollup
 * and its raw keys are ignored entirely.
 *
 * That is what makes compaction safe to interrupt. Deletes can be
 * half-finished (budget ran out) or duplicated (two readers compacting at
 * once) and the total never moves. The cost is a hit that lands for a day
 * already rolled up — only possible within moments of UTC midnight — which is
 * dropped rather than counted twice.
 */
function mergeDays(rollup: Record<string, number>, raw: Record<string, string[]>): Record<string, number> {
  const days: Record<string, number> = { ...rollup };
  for (const [day, keys] of Object.entries(raw)) if (days[day] === undefined) days[day] = keys.length;
  return days;
}

function totalOf(days: Record<string, number>): number {
  return Object.values(days).reduce((a, b) => a + b, 0);
}

/**
 * Fold finished days into the rollup, then delete what the rollup now covers.
 *
 * Writing and deleting are deliberately separate passes over separate days: a
 * day is written to the rollup on one read and its raws are deleted only on a
 * later one — never in the same pass. So any reader that reaches the delete
 * loop below has, on that same call, already read a rollup that already
 * contained that day: deleting is gated on `fresh` being empty, i.e. every
 * past day already has a durable rollup value.
 *
 * That is what makes `countCast` reading the rollup AFTER listing the raws
 * (not before) race-safe. A reader's own rollup read then happens no earlier
 * than its own listing, so if this reader's listing raced a concurrent
 * delete and came back short, its rollup read — being no older — will still
 * see the rollup value that delete's writer already committed, and this
 * reader will use that value instead of recomputing a smaller one from its
 * own partial listing. Reading the rollup first would break exactly this: a
 * straggling reader could see an empty rollup, then a partial, post-delete
 * listing, and overwrite a correct rollup value with an undercount.
 */
/**
 * How long after UTC midnight compaction leaves "yesterday" alone. `list()`
 * is eventually consistent, so the first reads of a new day can still be
 * missing writes from the tail end of the day that just ended — exactly the
 * writes compaction is about to fold into a rollup and then delete the
 * evidence for. This window gives the listing time to catch up while that is
 * still reversible.
 */
const GRACE_MS = 15 * 60 * 1000;

async function compact(
  store: ViewStore,
  enc: string,
  rollup: Record<string, number>,
  raw: Record<string, string[]>,
  today: string,
  deleteBudget: number,
  nowMs: number,
): Promise<void> {
  // `today` is always `dayString(nowMs)`, so this is just "how far into
  // today are we" — see GRACE_MS above for why that matters here.
  const todayStartMs = Date.parse(`${today}T00:00:00.000Z`);
  if (nowMs - todayStartMs < GRACE_MS) return;

  const past = Object.keys(raw).filter((d) => d < today);
  const fresh = past.filter((d) => rollup[d] === undefined);
  if (fresh.length > 0) {
    // Re-read the rollup fresh, right before writing, instead of trusting the
    // copy `countCast` read earlier: two readers can race this same
    // compaction (most likely just as the grace window above ends) and each
    // compute a different, partial count for the same day from their own
    // listing. Taking the max against whatever is durable right now means
    // whichever of them writes last can only grow the stored total, never
    // shrink an already-committed larger one.
    const current = await readRollup(store, enc);
    const merged: Record<string, number> = { ...rollup, ...current };
    for (const d of fresh) merged[d] = Math.max(rollup[d] ?? 0, current[d] ?? 0, raw[d].length);
    await store.setJSON(rollupKey(enc), merged);
    return; // Deleting waits for the next read, once the rollup is durable.
  }
  // Flattened first so `deleteBudget` still means exactly what it always
  // has — "attempt at most this many deletes this pass" — while the deletes
  // themselves run in parallel chunks rather than one `await` at a time, so
  // a large backlog can actually drain inside one function invocation.
  const keys = past.flatMap((d) => raw[d]);
  const toDelete = keys.slice(0, deleteBudget);
  for (let i = 0; i < toDelete.length; i += DELETE_CONCURRENCY) {
    await Promise.all(toDelete.slice(i, i + DELETE_CONCURRENCY).map((key) => store.delete(key)));
  }
}

export async function countCast(castKey: string, o: ViewOptions & { assumeHit?: string } = {}): Promise<CastCount> {
  if (!isValidCastKey(castKey)) throw new Error("invalid cast key");
  const { store, now, deleteBudget } = settings(o);
  const s = store();
  const enc = encodeCastKey(castKey);
  const listed = (await s.list({ prefix: hitPrefix(enc) })).blobs;
  const raw = groupByDay(listed);
  // `list` is eventually consistent and has no strong option, so a hit
  // written moments ago may be missing from it. Counting it anyway is what
  // keeps a badge from showing a number lower than the view that just
  // produced it.
  if (o.assumeHit && !listed.some((b) => b.key === o.assumeHit)) {
    const day = dayOfHitKey(o.assumeHit);
    if (day) (raw[day] ??= []).push(o.assumeHit);
  }
  // Read after listing, not before: see the comment on compact() for why
  // that ordering — not `consistency: "strong"` — is what keeps a reader
  // racing a concurrent compaction pass from overwriting a correct rollup.
  const rollup = await readRollup(s, enc);
  const days = mergeDays(rollup, raw);
  const nowMs = now();
  await compact(s, enc, rollup, raw, dayString(nowMs), deleteBudget, nowMs);
  return { total: totalOf(days), days };
}

/**
 * Record a view and answer with the resulting count — the one call the POST
 * path makes, so the write and the read agree about the hit just written.
 */
export async function recordAndCount(castKey: string, o: ViewOptions = {}): Promise<number> {
  const assumeHit = await recordHit(castKey, o);
  return (await countCast(castKey, { ...o, assumeHit })).total;
}

export interface RepoCounts {
  casts: { key: string; total: number; days: Record<string, number> }[];
  courses: Record<string, number>;
}

/**
 * Every cast in one repo. Read-only on purpose: compaction belongs to the
 * per-cast path, which runs on every view and therefore keeps the store tidy
 * without the dashboard ever writing. That also lets this response be cached.
 */
export async function countRepo(owner: string, repo: string, o: ViewOptions = {}): Promise<RepoCounts> {
  const { store } = settings(o);
  const s = store();
  const hits = (await s.list({ prefix: repoHitPrefix(owner, repo) })).blobs;
  const rollups = (await s.list({ prefix: repoRollupPrefix(owner, repo) })).blobs;

  const rawByCast = new Map<string, { key: string }[]>();
  for (const b of hits) {
    const castKey = castKeyOfHitKey(b.key);
    if (castKey) rawByCast.set(castKey, [...(rawByCast.get(castKey) ?? []), b]);
  }
  // Both parsers can meet a key this module never wrote — list() reflects
  // whatever is actually in the store — and return null rather than throw;
  // a key that does not parse is not a cast, so it is skipped, not crashed on.
  const castKeys = new Set<string>(rawByCast.keys());
  for (const b of rollups) {
    const castKey = castKeyOfRollup(b.key);
    if (castKey) castKeys.add(castKey);
  }

  const casts: RepoCounts["casts"] = [];
  for (const castKey of [...castKeys].sort()) {
    const rollup = await readRollup(s, encodeCastKey(castKey));
    const days = mergeDays(rollup, groupByDay(rawByCast.get(castKey) ?? []));
    casts.push({ key: castKey, total: totalOf(days), days });
  }

  const courses: Record<string, number> = {};
  for (const c of casts) {
    const folder = courseFolderOf(c.key);
    courses[folder] = (courses[folder] ?? 0) + c.total;
  }
  return { casts, courses };
}
