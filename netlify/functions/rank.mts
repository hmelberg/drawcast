// Popularity (2026-10-03, the front page's "Popular" row): the names most
// visited over the last 30 days, from the per-name, per-day visit records the
// name lookup already keeps (netlify/lib/name-visits.mts — `v/<name>/<day>`,
// a count and no visitor identity). Counted here, cached by Netlify's CDN for
// an hour, so a busy front page costs one count an hour.
//
// GET -> { days: 30, ranks: [{ name, visits }] } — at most 50, most visited
// first, names with no visit left out. GET ?all=1 -> the same for EVERY name
// with a visit (the front page's Your content, 2026-10-06: views per item). Public: the totals are what the
// front page shows anyway; nothing per visitor is in them.
import { getStore } from "@netlify/blobs";
import { dayString } from "../lib/view-key.mts";

export const RANK_DAYS = 30;
export const RANK_MAX = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RankDeps {
  /** Every visit-record key (`v/<name>/<day>`). */
  listKeys: () => Promise<string[]>;
  /** One record's count, 0 when unreadable. */
  readCount: (key: string) => Promise<number>;
  now: () => number;
}

/** `v/<name>/<day>` → name and day; null for anything else. */
export function parseVisitKey(key: string): { name: string; day: string } | null {
  const m = /^v\/(.+)\/(\d{4}-\d\d-\d\d)$/.exec(key);
  return m ? { name: m[1], day: m[2] } : null;
}

export async function computeRanks(deps: RankDeps, days = RANK_DAYS, max = RANK_MAX, withTotal = false): Promise<Array<{ name: string; visits: number; total?: number }>> {
  const cutoff = dayString(deps.now() - (days - 1) * DAY_MS);
  // withTotal (?all=1): every day ever kept counts toward `total` — records
  // are never deleted, so that is since counting began (2026-09-29).
  const wanted = (await deps.listKeys()).map((k) => ({ k, p: parseVisitKey(k) })).filter((x) => x.p && (withTotal || x.p.day >= cutoff));
  const recent = new Map<string, number>();
  const total = new Map<string, number>();
  // In parallel batches: a few thousand small reads at most, once an hour.
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const counts = await Promise.all(batch.map((x) => deps.readCount(x.k).catch(() => 0)));
    batch.forEach((x, j) => {
      const name = x.p!.name;
      if (x.p!.day >= cutoff) recent.set(name, (recent.get(name) ?? 0) + counts[j]);
      total.set(name, (total.get(name) ?? 0) + counts[j]);
    });
  }
  const names = withTotal ? [...total.keys()] : [...recent.keys()];
  return names
    .map((name) => ({ name, visits: recent.get(name) ?? 0, ...(withTotal ? { total: total.get(name) ?? 0 } : {}) }))
    .filter((r) => r.visits > 0 || (r.total ?? 0) > 0)
    .sort((a, b) => b.visits - a.visits || (b.total ?? 0) - (a.total ?? 0) || a.name.localeCompare(b.name))
    .slice(0, max);
}

export async function handleRankRequest(req: Request, deps: RankDeps): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=600",
    "netlify-cdn-cache-control": "public, durable, max-age=3600, stale-while-revalidate=3600",
    // ?all=1 is its own answer: cached apart from the plain top 50.
    "netlify-vary": "query=all",
  };
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });
  try {
    const all = new URL(req.url).searchParams.get("all") === "1";
    return new Response(JSON.stringify({ days: RANK_DAYS, ranks: await computeRanks(deps, RANK_DAYS, all ? Infinity : RANK_MAX, all) }), { status: 200, headers });
  } catch (e) {
    console.warn("rank failed:", e instanceof Error ? e.message : String(e));
    // An empty list is a quiet front page, never a broken one; and not cached long.
    return new Response(JSON.stringify({ days: RANK_DAYS, ranks: [] }), { status: 200, headers: { ...headers, "cache-control": "no-store", "netlify-cdn-cache-control": "no-store" } });
  }
}

export default async (req: Request): Promise<Response> => {
  const store = getStore({ name: "name-visits" });
  return handleRankRequest(req, {
    listKeys: async () => (await store.list({ prefix: "v/" })).blobs.map((b) => b.key),
    readCount: async (key) => {
      const rec = (await store.get(key, { type: "json" })) as { count?: unknown } | null;
      return typeof rec?.count === "number" ? rec.count : 0;
    },
    now: () => Date.now(),
  });
};
