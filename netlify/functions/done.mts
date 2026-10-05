// "Watched to the end" (ranking round, 2026-10-05): the watch page sends one
// beacon when a drawcast plays to its end, and the front page's ranking
// (netlify/lib/rank-score.mts) counts it above a visit, which may be a glance.
//
// POST /api/done {name} -> 204. Kept like the visits (netlify/lib/
// name-visits.mts): a count per name per day at `d/<name>/<day>` in the same
// store, with no IP, cookie or visitor id. Only a name the front page's feed
// lists is counted, so the store never fills with made-up names.
import { getStore } from "@netlify/blobs";
import { dayString } from "../lib/view-key.mts";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function doneKey(name: string, day: string): string {
  return `d/${name}/${day}`;
}

export interface DoneDeps {
  /** The names the feed lists, or null when there is no feed yet. */
  listed(): Promise<Set<string> | null>;
  read(key: string): Promise<number>;
  write(key: string, count: number): Promise<void>;
  now(): number;
}

const HEADERS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function handleDoneRequest(req: Request, deps: DoneDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: HEADERS });
  let raw: unknown;
  try {
    raw = ((await req.json()) as { name?: unknown }).name;
  } catch {
    return new Response(null, { status: 400, headers: HEADERS });
  }
  // A course lecture (`spanish/3`) counts for its course.
  const name = typeof raw === "string" ? raw.split("/", 1)[0].trim().toLowerCase() : "";
  if (!NAME_RE.test(name)) return new Response(null, { status: 400, headers: HEADERS });
  const listed = await deps.listed().catch(() => null);
  if (!listed?.has(name)) return new Response(null, { status: 204, headers: HEADERS });
  const key = doneKey(name, dayString(deps.now()));
  await deps.write(key, (await deps.read(key).catch(() => 0)) + 1);
  return new Response(null, { status: 204, headers: HEADERS });
}

export default async (req: Request): Promise<Response> => {
  const store = getStore({ name: "name-visits", consistency: "strong" });
  const feeds = getStore({ name: "feed" });
  return handleDoneRequest(req, {
    listed: async () => {
      const feed = (await feeds.get("feed.json", { type: "json" })) as { items?: Array<{ name?: unknown }> } | null;
      return feed?.items ? new Set(feed.items.map((i) => (typeof i.name === "string" ? i.name : "")).filter(Boolean)) : null;
    },
    read: async (key) => {
      const rec = (await store.get(key, { type: "json" })) as { count?: unknown } | null;
      return typeof rec?.count === "number" ? rec.count : 0;
    },
    write: async (key, count) => {
      await store.setJSON(key, { count });
    },
    now: () => Date.now(),
  });
};

export const config = { path: "/api/done" };
