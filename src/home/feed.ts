// The front page's one request (home-cards round, 2026-10-05): every listed
// item and the visit ranks, from netlify/functions/feed.mts. The last answer
// is kept in this browser, so a return to the front page (a fresh page load)
// draws at once from it and redraws only if the new answer differs. The
// catalogue's own filters are answered here, from the whole list.

import { parseCatalogueItem, type CatalogueFilterKind, type CatalogueItem } from "../catalogue";
import type { RankEntry } from "./model";

export const FEED_URL = "https://drawcast.app/api/feed";
const STORE_KEY = "drawcast:feed";

/** One drawcast's ranking (netlify/lib/rank-score.mts). */
export interface FeedScore {
  /** Trending: recent likes, finishes and visits, times quality, plus a new-drawcast boost. */
  score: number;
  /** Likes in the last 30 days, times quality. */
  month: number;
}

export interface HomeFeed {
  built: number;
  items: CatalogueItem[];
  ranks: RankEntry[];
  /** Absent from a feed built before the ranking round. */
  scores?: Record<string, FeedScore>;
}

/** The server's answer (or a kept copy), narrowed; null when it is not a feed. */
export function parseFeed(raw: unknown): HomeFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.built !== "number" || !Array.isArray(r.items)) return null;
  const items: CatalogueItem[] = [];
  for (const x of r.items) {
    const item = parseCatalogueItem(x);
    if (item) items.push(item);
  }
  const ranks = Array.isArray(r.ranks)
    ? r.ranks.filter((x): x is RankEntry => !!x && typeof (x as RankEntry).name === "string" && typeof (x as RankEntry).visits === "number")
    : [];
  let scores: Record<string, FeedScore> | undefined;
  if (r.scores && typeof r.scores === "object") {
    scores = {};
    for (const [name, v] of Object.entries(r.scores as Record<string, unknown>)) {
      const x = v as Partial<FeedScore> | null;
      if (x && typeof x.score === "number" && typeof x.month === "number") scores[name] = { score: x.score, month: x.month };
    }
  }
  return { built: r.built, items, ranks, ...(scores ? { scores } : {}) };
}

/** The copy kept from the last visit, or null (none, or storage refused). */
export function storedFeed(): HomeFeed | null {
  try {
    const s = localStorage.getItem(STORE_KEY);
    return s ? parseFeed(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

/** The feed from the server, kept for next time; null on any failure. */
export async function fetchFeed(fetchImpl: typeof fetch = fetch): Promise<HomeFeed | null> {
  try {
    const res = await fetchImpl(FEED_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const feed = parseFeed(await res.json());
    if (feed) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(feed));
      } catch {
        /* storage full or refused: next visit asks again */
      }
    }
    return feed;
  } catch {
    return null;
  }
}

/** Whether two feeds would draw the same page (the build time aside). */
export function sameFeed(a: HomeFeed | null, b: HomeFeed | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a.items) === JSON.stringify(b.items) && JSON.stringify(a.ranks) === JSON.stringify(b.ranks) && JSON.stringify(a.scores) === JSON.stringify(b.scores);
}

/**
 * What GET /catalogue would answer, from the whole list: `kind`, `format`
 * and `tag` keep exactly theirs; `q` is a case-insensitive part of the
 * title or of any one tag (server_code/registry.py catalogue_match); `names`
 * keeps exactly those, in that order. Otherwise newest `updated` first.
 */
export function feedQuery(
  items: readonly CatalogueItem[],
  query: { kind?: CatalogueFilterKind; q?: string; format?: CatalogueItem["format"]; tag?: string; names?: string[] },
): CatalogueItem[] {
  const needle = (query.q ?? "").trim().toLowerCase();
  const tag = (query.tag ?? "").trim().toLowerCase();
  const keep = (i: CatalogueItem): boolean =>
    (!query.kind || i.kind === query.kind) &&
    (!query.format || i.format === query.format) &&
    (!tag || i.tags.includes(tag)) &&
    (!needle || i.title.toLowerCase().includes(needle) || i.tags.some((t) => t.toLowerCase().includes(needle)));
  if (query.names) {
    const byName = new Map(items.map((i) => [i.name, i]));
    const out: CatalogueItem[] = [];
    for (const n of new Set(query.names)) {
      const i = byName.get(n);
      if (i && keep(i)) out.push(i);
    }
    return out;
  }
  return items.filter(keep).sort((a, b) => (b.updated > a.updated ? 1 : b.updated < a.updated ? -1 : 0));
}

/** Highest score first; ties newest first (`created`, else `updated`). */
export function byScore(items: readonly CatalogueItem[], scores: Record<string, FeedScore>, key: keyof FeedScore = "score"): CatalogueItem[] {
  const when = (i: CatalogueItem): string => i.created ?? i.updated;
  return [...items].sort((a, b) => (scores[b.name]?.[key] ?? 0) - (scores[a.name]?.[key] ?? 0) || (when(b) > when(a) ? 1 : when(b) < when(a) ? -1 : 0));
}

/** Newest first by when each was first registered (`created`, else `updated`). */
export function byNewest(items: readonly CatalogueItem[]): CatalogueItem[] {
  const when = (i: CatalogueItem): string => i.created ?? i.updated;
  return [...items].sort((a, b) => (when(b) > when(a) ? 1 : when(b) < when(a) ? -1 : 0));
}

/** The topic rows from the whole catalogue: every tag at least `min` items
 *  share, most shared first, at most `maxRows`, each row's items by score. */
export function topicRows(items: readonly CatalogueItem[], scores: Record<string, FeedScore>, min = 4, maxRows = 10): { tag: string; items: CatalogueItem[] }[] {
  const by = new Map<string, CatalogueItem[]>();
  for (const i of items) for (const t of new Set(i.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) by.set(t, [...(by.get(t) ?? []), i]);
  return [...by.entries()]
    .filter(([, list]) => list.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, maxRows)
    .map(([tag, list]) => ({ tag, items: byScore(list, scores) }));
}
