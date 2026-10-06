// Name lookups through Netlify (spec §7): resolves drawcast.app/#<name>
// against Anvil's registry (GET https://drawcast.anvil.app/_/api/name?n=…)
// and passes the answer through unchanged — status and body — so the client
// never has to know it went through a proxy. Two things ride along:
//
//   - A warm-instance cache: a successful (200) answer is kept for 60 s, so a
//     burst of viewers opening the same name in the same minute costs Anvil
//     one request, not one per viewer. It is NOT persisted (Blobs would add
//     latency to the fast path for a number this short-lived) — a cold
//     instance simply re-resolves, same as today.
//   - A visit, once per LOOKUP (cache hit or miss, as long as the answer is
//     200): country + source ("name" vs "lecture", from the client, since
//     only the client knows why it is looking the name up) + referring
//     domain, folded into a per-day, per-name record in Netlify Blobs via
//     netlify/lib/name-visits.mts. Never an IP, cookie or visitor id — see
//     that module's header for why.
//
// Anvil itself stays reachable directly: src/names.ts falls back to it when
// this function (or both its Netlify deploys) cannot be reached, so this
// endpoint is an accelerator with a side channel, never a single point of
// failure for name resolution.
//
// GET ?n=<name>&src=name|lecture&ref=<url>
//   -> Anvil's answer, passed through (Access-Control-Allow-Origin: *,
//      Cache-Control: no-store).
// GET ?stats=<name>, header x-drawcast-stats: <NAME_STATS_SECRET>
//   -> the last 30 days' records for that name (days with no record
//      omitted); wrong or missing secret -> 403. Never records a visit.
import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { addVisit, refDomain, visitKey, type DayRecord } from "../lib/name-visits.mts";
import { dayString } from "../lib/view-key.mts";

const ANVIL_BASE = "https://drawcast.anvil.app";
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const STATS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CacheEntry {
  status: number;
  body: unknown;
  expiresAt: number;
}

/**
 * Everything the handler needs from the outside world, injected so it is
 * testable without Blobs, Anvil or a real clock — same shape as
 * netlify/functions/views.mts's ViewsDeps.
 *
 * The cache is deps too, not hidden module state: a test needs to hand in a
 * fresh Map (or inspect one) without reaching into this module's internals,
 * and `now` rides alongside it so a test can move the clock without the
 * cache's TTL math ever calling the real Date.now().
 */
export interface NameDeps {
  resolve: (name: string) => Promise<{ status: number; body: unknown }>;
  readDay: (key: string) => Promise<DayRecord | null>;
  writeDay: (key: string, rec: DayRecord) => Promise<void>;
  country: (req: Request) => string;
  now: () => number;
  statsSecret: string;
  readRange: (name: string, days: number) => Promise<Array<{ day: string } & DayRecord>>;
  cache: Map<string, CacheEntry>;
  /**
   * Keep the function alive for work done after the answer is sent
   * (Netlify's context.waitUntil). With it, the visit is recorded AFTER the
   * reply instead of before: the Blobs read + write used to sit between
   * Anvil's answer and the viewer, adding a few hundred ms to every name
   * link. Without it (tests, older runtimes) the visit is awaited as before.
   */
  defer?: (work: Promise<unknown>) => void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "content-type": "application/json",
    },
  });
}

/**
 * Constant-time compare via digest, exactly like passwordMatches in
 * the retired keys.mts: hides both the difference and the length of the two strings. An
 * empty expected secret always refuses — "wrong or missing secret" must
 * include "no secret configured at all", not turn into "anything goes".
 */
function secretMatches(supplied: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Map preserves insertion order, so the first key is the oldest one. */
function evictOldest(cache: Map<string, CacheEntry>): void {
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

export async function handleNameRequest(req: Request, deps: NameDeps): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method" }, 405);

  const url = new URL(req.url);
  const statsName = url.searchParams.get("stats");
  if (statsName !== null) {
    const supplied = req.headers.get("x-drawcast-stats") ?? "";
    if (!secretMatches(supplied, deps.statsSecret)) return json({ error: "forbidden" }, 403);
    const range = await deps.readRange(statsName, STATS_DAYS);
    return json(range, 200);
  }

  const name = url.searchParams.get("n") ?? "";
  if (!name) return json({ error: "name" }, 400);
  // The client sends src explicitly, but it is validated here regardless:
  // anything other than "lecture" collapses to "name".
  const source: "name" | "lecture" = url.searchParams.get("src") === "lecture" ? "lecture" : "name";
  const ref = url.searchParams.get("ref") ?? "";

  const now = deps.now();
  const cached = deps.cache.get(name);
  let status: number;
  let body: unknown;
  if (cached && cached.expiresAt > now) {
    status = cached.status;
    body = cached.body;
  } else {
    const answer = await deps.resolve(name);
    status = answer.status;
    body = answer.body;
    if (status === 200) {
      if (deps.cache.size >= CACHE_MAX_ENTRIES && !deps.cache.has(name)) evictOldest(deps.cache);
      deps.cache.set(name, { status, body, expiresAt: now + CACHE_TTL_MS });
    }
  }

  if (status === 200) {
    // The answer is already built above; a Blobs hiccup here must never
    // change what the caller gets back — swallow it, same as views.mts does
    // for its own storage failures.
    const record = async (): Promise<void> => {
      try {
        // Under the BASE name: a lecture (`name/3`) counts toward its course,
        // which is what the dashboard's ?stats=<name> reads (final review I4).
        const key = visitKey(name.split("/", 1)[0], dayString(now));
        const rec = await deps.readDay(key);
        const next = addVisit(rec, { country: deps.country(req), source, ref: refDomain(ref) });
        await deps.writeDay(key, next);
      } catch (e) {
        console.warn(`name visit for ${name} failed (allowing):`, e instanceof Error ? e.message : String(e));
      }
    };
    if (deps.defer) deps.defer(record());
    else await record();
  }

  return json(body, status);
}

// ---- real deps --------------------------------------------------------

/** The slice of the Blobs API this needs — swapped for a fake in tests. */
interface NameStore {
  get(key: string, opts: { type: "json"; consistency: "strong" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

/** Anvil's answer, bounded (final review I2): a slow Anvil costs five
 *  seconds and a 502 — the client then tries the next door — not the whole
 *  function's timeout. Exported for the tests. */
export async function defaultResolve(name: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetchImpl(`${ANVIL_BASE}/_/api/name?n=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(timeoutMs) });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { error: "bad upstream response" };
    }
    return { status: res.status, body };
  } catch {
    return { status: 502, body: { error: "unreachable" } };
  }
}

function defaultReadDay(store: NameStore): NameDeps["readDay"] {
  return async (key) => ((await store.get(key, { type: "json", consistency: "strong" })) as DayRecord | null) ?? null;
}

function defaultWriteDay(store: NameStore): NameDeps["writeDay"] {
  return async (key, rec) => {
    await store.setJSON(key, rec);
  };
}

/** Walks back `days` calendar days from "now" (real wall-clock time — this
 *  is the audit door, not something a cache test needs to move), reading
 *  each day's record directly; days with no record are left out. */
function defaultReadRange(store: NameStore): NameDeps["readRange"] {
  return async (name, days) => {
    const out: Array<{ day: string } & DayRecord> = [];
    const today = Date.now();
    for (let i = 0; i < days; i++) {
      const day = dayString(today - i * DAY_MS);
      const rec = ((await store.get(visitKey(name, day), { type: "json", consistency: "strong" })) as DayRecord | null) ?? null;
      if (rec) out.push({ day, ...rec });
    }
    return out;
  };
}

// The warm-instance cache: module-level so it survives across invocations on
// the same warm Netlify function instance (and only there — a cold instance
// starts with an empty Map, which is fine, since this is a speed-up, not a
// source of truth).
const warmCache = new Map<string, CacheEntry>();

interface NetlifyGeoContext {
  geo?: { country?: { code?: string } };
  waitUntil?: (work: Promise<unknown>) => void;
}

export default async (req: Request, context?: NetlifyGeoContext): Promise<Response> => {
  const store = getStore({ name: "name-visits", consistency: "strong" }) as unknown as NameStore;
  return handleNameRequest(req, {
    resolve: (name) => defaultResolve(name),
    readDay: defaultReadDay(store),
    writeDay: defaultWriteDay(store),
    country: () => context?.geo?.country?.code ?? "??",
    now: () => Date.now(),
    statsSecret: process.env.NAME_STATS_SECRET ?? "",
    readRange: defaultReadRange(store),
    cache: warmCache,
    defer: context?.waitUntil ? (work) => context.waitUntil!(work) : undefined,
  });
};

/**
 * No `config` export at all: src/names.ts posts to the default
 * /.netlify/functions/name URL (NAME_ENDPOINTS), and a `path` would move it.
 */
