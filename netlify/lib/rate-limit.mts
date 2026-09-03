// Per-IP failure budget for the key-vending endpoint, backed by Netlify Blobs.
//
// This lives in netlify/lib rather than netlify/functions on purpose: every
// module in the functions directory is published as its own public endpoint.
//
// Why not Netlify's built-in `config.rateLimit`? It is in the type
// definitions, but measured against the live site on 2026-08-24 it never
// fired — 75 consecutive wrong passwords all returned 401, never 429. A limit
// that silently does nothing is worse than none, because it looks handled.
//
// Only FAILED attempts are counted. Somebody who knows the password can save
// the settings dialog as often as they like; somebody guessing it cannot.
import { getStore } from "@netlify/blobs";

const STORE_NAME = "rate-limits";
const KEY_PREFIX = "keys";

/** The slice of the Blobs API this needs — swapped for a fake in tests. */
export interface RateStore {
  get(key: string, opts: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

export interface LimiterOptions {
  store?: () => RateStore;
  windowMs?: number;
  maxFailures?: number;
  now?: () => number;
}

interface FailureRecord {
  failures: number[];
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 30;

/**
 * Exported so the one call that reaches the real Blobs API is testable.
 *
 * `consistency: "strong"` is load-bearing, not decoration. Blobs reads are
 * eventually consistent by default, so a caller guessing passwords rapidly
 * would keep reading a budget that has not caught up with its own failures,
 * and the limit would never fire — a guard that looks handled and is not.
 * (Note that `list()` has no consistency option at all; only get does.)
 */
export function defaultStore(): RateStore {
  return getStore({ name: STORE_NAME, consistency: "strong" }) as unknown as RateStore;
}

function settings(o: LimiterOptions) {
  return {
    store: o.store ?? defaultStore,
    windowMs: o.windowMs ?? DEFAULT_WINDOW_MS,
    maxFailures: o.maxFailures ?? DEFAULT_MAX_FAILURES,
    now: o.now ?? Date.now,
  };
}

async function readRecent(
  store: RateStore,
  key: string,
  now: number,
  windowMs: number,
): Promise<number[]> {
  const record = ((await store.get(key, { type: "json" })) as FailureRecord | null) ?? { failures: [] };
  const failures = Array.isArray(record.failures) ? record.failures : [];
  return failures.filter((t) => typeof t === "number" && now - t < windowMs);
}

/**
 * Whether `id` (a client IP) may make another attempt. Read-only: the caller
 * records a failure afterwards only if the attempt actually fails.
 *
 * An empty id is always allowed. The alternative — one shared bucket for every
 * unidentifiable caller — would let a single attacker lock out everyone else.
 */
export async function checkFailureBudget(
  id: string,
  options: LimiterOptions = {},
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (!id) return { allowed: true, retryAfterSeconds: 0 };
  const { store, windowMs, maxFailures, now } = settings(options);
  try {
    const t = now();
    const recent = await readRecent(store(), `${KEY_PREFIX}:${id}`, t, windowMs);
    if (recent.length >= maxFailures) {
      const oldest = recent[0];
      return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (t - oldest)) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (e) {
    // Fail open: a Blobs outage must not take the whole feature down.
    console.warn("rate-limit read failed (allowing):", e);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Append one failed attempt for `id`. Never throws. */
export async function recordFailure(id: string, options: LimiterOptions = {}): Promise<void> {
  if (!id) return;
  const { store, windowMs, now } = settings(options);
  try {
    const t = now();
    const key = `${KEY_PREFIX}:${id}`;
    const s = store();
    // Read-modify-write is not atomic — Blobs has no compare-and-set, so two
    // simultaneous requests can undercount by one. Acceptable for a coarse
    // abuse guard; a locking layer would cost more than it buys.
    const recent = await readRecent(s, key, t, windowMs);
    recent.push(t);
    await s.setJSON(key, { failures: recent });
  } catch (e) {
    console.warn("rate-limit write failed (ignoring):", e);
  }
}
