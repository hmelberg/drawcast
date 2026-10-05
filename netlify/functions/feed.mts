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
import { computeRanks, parseVisitKey } from "./rank.mts";

const CATALOGUE = "https://drawcast.anvil.app/_/api/catalogue";
/** A kept feed younger than this is served as it is; older, it is served and rebuilt behind. */
export const FRESH_MS = 5 * 60 * 1000;
/** Past any real catalogue: a guard against a registry whose `more` never ends. */
const MAX_PAGES = 40;

export interface Feed {
  built: number;
  items: unknown[];
  ranks: Array<{ name: string; visits: number }>;
}

export interface FeedDeps {
  /** One catalogue page's body, or null on any failure. */
  page(kind: "cast" | "course", page: number): Promise<{ items?: unknown; more?: unknown } | null>;
  ranks(): Promise<Array<{ name: string; visits: number }>>;
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
  const [casts, courses, ranks] = await Promise.all([all("cast"), all("course"), deps.ranks().catch(() => [])]);
  if (casts === null || courses === null) return null;
  return { built: deps.now(), items: [...casts, ...courses], ranks };
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
    ranks: () =>
      computeRanks({
        listKeys: async () => (await visits.list({ prefix: "v/" })).blobs.map((b) => b.key).filter((k) => parseVisitKey(k) !== null),
        readCount: async (key) => {
          const rec = (await visits.get(key, { type: "json" })) as { count?: unknown } | null;
          return typeof rec?.count === "number" ? rec.count : 0;
        },
        now: () => Date.now(),
      }),
    load: async () => (await feeds.get("feed.json", { type: "json" })) as Feed | null,
    save: async (feed) => {
      await feeds.setJSON("feed.json", feed);
    },
    defer: context?.waitUntil ? (w) => context.waitUntil!(w) : undefined,
    now: () => Date.now(),
  });
};

export const config = { path: "/api/feed" };
