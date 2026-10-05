// The front page's one request (home-cards round, 2026-10-05): every listed
// item of the registry's catalogue plus the 30-day visit ranks, in one answer.
// The front page used to make four requests on every visit — three of them to
// the registry's /catalogue, which costs the registry a hundred table reads
// apiece — and a return to the front page is a fresh page load. Now the
// registry is asked here, at most once every FRESH_MS, the answer is kept in
// Blobs, and Netlify's CDN keeps this response.
//
// GET -> { built, items: CatalogueItem-shaped[], ranks: [{ name, visits }] }.
// Public: the same items and totals the front page shows anyway.
import { getStore } from "@netlify/blobs";
import { RANK_DAYS, RANK_MAX } from "./rank.mts";
import { dayString } from "../lib/view-key.mts";
import { foldDays, parseDayKey, rankScore, type RankScore } from "../lib/rank-score.mts";

const CATALOGUE = "https://drawcast.anvil.app/_/api/catalogue";
const STATS = "https://drawcast.anvil.app/_/api/catalogue/stats";
const DAY_MS = 24 * 60 * 60 * 1000;
/** A kept feed younger than this is served as it is; older, it is served and rebuilt behind. */
export const FRESH_MS = 5 * 60 * 1000;
/** Past any real catalogue: a guard against a registry whose `more` never ends. */
const MAX_PAGES = 40;

export interface Feed {
  built: number;
  items: unknown[];
  /** The 30-day visit totals, most visited first (the older Popular row's source). */
  ranks: Array<{ name: string; visits: number }>;
  /** Each listed name's ranking (netlify/lib/rank-score.mts). */
  scores?: Record<string, RankScore>;
  /** How many items the registry's stats covered: 0 means likes were ranked without their dates. */
  stats?: number;
}

/** One day's count under `v/` (visits) or `d/` (watched to the end). */
export interface DayEntry {
  kind: "v" | "d";
  name: string;
  day: string;
  count: number;
}

/** The registry's secret-gated GET /catalogue/stats, one listed item. */
export interface ItemStats {
  name: string;
  likes: number;
  dislikes: number;
  like_days: Record<string, number>;
  created: string | null;
}

export interface FeedDeps {
  /** One catalogue page's body, or null on any failure. */
  page(kind: "cast" | "course", page: number): Promise<{ items?: unknown; more?: unknown } | null>;
  /** Every day count of the last RANK_DAYS days. */
  days(): Promise<DayEntry[]>;
  /** The registry's ranking stats, or null when it gave none. */
  stats(): Promise<ItemStats[] | null>;
  load(): Promise<Feed | null>;
  save(feed: Feed): Promise<void>;
  defer?(work: Promise<unknown>): void;
  now(): number;
}

/** Every listed item, casts then courses, each page in turn. Null when the
 *  registry did not answer the first page of either kind — a feed missing
 *  half the catalogue must never replace a whole one. */
export async function buildFeed(deps: FeedDeps): Promise<Feed | null> {
  const all = async (kind: "cast" | "course"): Promise<unknown[] | null> => {
    const out: unknown[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      const body = await deps.page(kind, p);
      if (!body || !Array.isArray(body.items)) return p === 0 ? null : out;
      out.push(...body.items);
      if (body.more !== true) break;
    }
    return out;
  };
  const [casts, courses, days, stats] = await Promise.all([all("cast"), all("course"), deps.days().catch(() => []), deps.stats().catch(() => null)]);
  if (casts === null || courses === null) return null;
  const items = [...casts, ...courses];
  const now = deps.now();
  return { built: now, items, ranks: visitRanks(days), scores: scoresFor(items, days, stats, now), stats: stats?.length ?? 0 };
}

/** The older Popular row's list: visits per name (lectures apart) over the days given, most first. */
export function visitRanks(days: DayEntry[]): Array<{ name: string; visits: number }> {
  const totals = new Map<string, number>();
  for (const d of days) if (d.kind === "v") totals.set(d.name, (totals.get(d.name) ?? 0) + d.count);
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, RANK_MAX)
    .map(([name, visits]) => ({ name, visits }));
}

/** Every listed item's score: the registry's stats when it gave them, else the catalogue's like count. */
export function scoresFor(items: unknown[], days: DayEntry[], stats: ItemStats[] | null, now: number): Record<string, RankScore> {
  const visits = foldDays(days.filter((d) => d.kind === "v"));
  const done = foldDays(days.filter((d) => d.kind === "d"));
  const byName = new Map((stats ?? []).map((s) => [s.name, s]));
  const out: Record<string, RankScore> = {};
  for (const raw of items) {
    const i = raw as { name?: unknown; likes?: unknown; created?: unknown };
    if (typeof i.name !== "string") continue;
    const st = byName.get(i.name);
    out[i.name] = rankScore(
      {
        likes: st ? st.likes : typeof i.likes === "number" ? i.likes : 0,
        dislikes: st?.dislikes ?? 0,
        likeDays: st ? st.like_days : undefined,
        visits: visits.get(i.name),
        done: done.get(i.name),
        created: st?.created ?? (typeof i.created === "string" ? i.created : null),
      },
      now,
    );
  }
  return out;
}

const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
  "netlify-cdn-cache-control": "public, durable, max-age=300, stale-while-revalidate=3600",
};

export async function handleFeedRequest(req: Request, deps: FeedDeps): Promise<Response> {
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: HEADERS });
  const kept = await deps.load().catch(() => null);
  const rebuild = async (): Promise<Feed | null> => {
    const feed = await buildFeed(deps);
    if (feed) await deps.save(feed);
    return feed;
  };
  if (kept) {
    if (deps.now() - kept.built > FRESH_MS) {
      const work = rebuild().catch((e) => console.warn("feed: rebuild failed", e));
      if (deps.defer) deps.defer(work);
    }
    return new Response(JSON.stringify(kept), { status: 200, headers: HEADERS });
  }
  const fresh = await rebuild().catch(() => null);
  if (fresh) return new Response(JSON.stringify(fresh), { status: 200, headers: HEADERS });
  // No feed at all: the front page falls back to asking the registry itself.
  return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { ...HEADERS, "cache-control": "no-store", "netlify-cdn-cache-control": "no-store" } });
}

async function json(url: string): Promise<{ items?: unknown; more?: unknown } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.ok ? ((await res.json()) as { items?: unknown; more?: unknown }) : null;
  } catch {
    return null;
  }
}

export default async (req: Request, context?: { waitUntil?: (work: Promise<unknown>) => void }): Promise<Response> => {
  const feeds = getStore({ name: "feed" });
  const visits = getStore({ name: "name-visits" });
  return handleFeedRequest(req, {
    page: (kind, page) => json(`${CATALOGUE}?kind=${kind}${page ? `&page=${page}` : ""}`),
    days: async () => {
      const cutoff = dayString(Date.now() - (RANK_DAYS - 1) * DAY_MS);
      const keys = [...(await visits.list({ prefix: "v/" })).blobs, ...(await visits.list({ prefix: "d/" })).blobs]
        .map((b) => ({ key: b.key, p: parseDayKey(b.key) }))
        .filter((x) => x.p && x.p.day >= cutoff);
      const out: DayEntry[] = [];
      // In parallel batches: a few thousand small reads at most, a few times an hour.
      for (let i = 0; i < keys.length; i += 50) {
        const batch = keys.slice(i, i + 50);
        const counts = await Promise.all(
          batch.map(async (x) => {
            const rec = (await visits.get(x.key, { type: "json" }).catch(() => null)) as { count?: unknown } | null;
            return typeof rec?.count === "number" ? rec.count : 0;
          }),
        );
        batch.forEach((x, j) => out.push({ ...x.p!, count: counts[j] }));
      }
      return out;
    },
    stats: async () => {
      const secret = process.env.NAME_STATS_SECRET ?? "";
      if (!secret) return null;
      try {
        const res = await fetch(STATS, { headers: { "x-drawcast-stats": secret }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const body = (await res.json()) as { items?: unknown };
        return Array.isArray(body.items) ? (body.items as ItemStats[]) : null;
      } catch {
        return null;
      }
    },
    load: async () => (await feeds.get("feed.json", { type: "json" })) as Feed | null,
    save: async (feed) => {
      await feeds.setJSON("feed.json", feed);
    },
    defer: context?.waitUntil ? (w) => context.waitUntil!(w) : undefined,
    now: () => Date.now(),
  });
};

export const config = { path: "/api/feed" };
