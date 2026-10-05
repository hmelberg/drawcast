// Which thumbnail was shown, and which was clicked (2026-10-06): a cast may
// have several thumbnails (its thumbnail pages — src/card), and the front
// page shows them in turn. It sends one beacon per visit with the ones seen
// (half on screen for a second) and one per click; the counts steer which
// thumbnail it shows (src/card/choose.ts).
//
// POST /api/thumbs {seen?: ["name:variant", …], click?: "name:variant", seg?}
// -> 204. Kept like the visits (netlify/lib/name-visits.mts): counts per name
// per variant per segment per day at `t/<name>/<variant>/<seg>/<day>`, with no
// IP, cookie or visitor id. Only names the front page's feed lists count. The
// segment is "all" until viewers have one (version 2: what they watch).
import { getStore } from "@netlify/blobs";
import { dayString } from "../lib/view-key.mts";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SEGMENTS = new Set(["all"]);
export const MAX_SEEN = 120;
export const MAX_VARIANT = 4;

export interface ThumbCount {
  shown: number;
  clicks: number;
}

export function thumbKey(name: string, variant: number, seg: string, day: string): string {
  return `t/${name}/${variant}/${seg}/${day}`;
}

/** `t/<name>/<variant>/<seg>/<day>` → its parts; null for anything else. */
export function parseThumbKey(key: string): { name: string; variant: number; seg: string; day: string } | null {
  const m = /^t\/([a-z0-9-]+)\/(\d)\/([a-z]+)\/(\d{4}-\d\d-\d\d)$/.exec(key);
  return m ? { name: m[1], variant: Number(m[2]), seg: m[3], day: m[4] } : null;
}

/** "name:variant" → its parts, or null when it is not one. */
export function parseShown(s: unknown): { name: string; variant: number } | null {
  if (typeof s !== "string") return null;
  const m = /^([a-z0-9][a-z0-9-]{0,62}):(\d)$/.exec(s);
  if (!m || !NAME_RE.test(m[1]) || Number(m[2]) > MAX_VARIANT) return null;
  return { name: m[1], variant: Number(m[2]) };
}

export interface ThumbsDeps {
  listed(): Promise<Set<string> | null>;
  read(key: string): Promise<ThumbCount | null>;
  write(key: string, count: ThumbCount): Promise<void>;
  now(): number;
}

const HEADERS = { "access-control-allow-origin": "*", "cache-control": "no-store" };

export async function handleThumbsRequest(req: Request, deps: ThumbsDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: HEADERS });
  let body: { seen?: unknown; click?: unknown; seg?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(null, { status: 400, headers: HEADERS });
  }
  const seg = typeof body.seg === "string" && SEGMENTS.has(body.seg) ? body.seg : "all";
  // What to add, per key: one showing per name:variant per beacon (a page
  // showing a card twice counts it once), and the click.
  const add = new Map<string, ThumbCount>();
  const bump = (s: { name: string; variant: number }, field: keyof ThumbCount): void => {
    const day = dayString(deps.now());
    const key = thumbKey(s.name, s.variant, seg, day);
    const c = add.get(key) ?? { shown: 0, clicks: 0 };
    c[field] = 1;
    add.set(key, c);
  };
  const seen = Array.isArray(body.seen) ? body.seen.slice(0, MAX_SEEN).map(parseShown).filter((x): x is { name: string; variant: number } => x !== null) : [];
  for (const s of seen) bump(s, "shown");
  const click = parseShown(body.click);
  if (click) bump(click, "clicks");
  if (add.size === 0) return new Response(null, { status: 204, headers: HEADERS });
  const listed = await deps.listed().catch(() => null);
  if (!listed) return new Response(null, { status: 204, headers: HEADERS });
  await Promise.all(
    [...add].map(async ([key, inc]) => {
      const p = parseThumbKey(key);
      if (!p || !listed.has(p.name)) return;
      const cur = (await deps.read(key).catch(() => null)) ?? { shown: 0, clicks: 0 };
      await deps.write(key, { shown: cur.shown + inc.shown, clicks: cur.clicks + inc.clicks });
    }),
  );
  return new Response(null, { status: 204, headers: HEADERS });
}

export default async (req: Request): Promise<Response> => {
  const store = getStore({ name: "name-visits", consistency: "strong" });
  const feeds = getStore({ name: "feed" });
  return handleThumbsRequest(req, {
    listed: async () => {
      const feed = (await feeds.get("feed.json", { type: "json" })) as { items?: Array<{ name?: unknown }> } | null;
      return feed?.items ? new Set(feed.items.map((i) => (typeof i.name === "string" ? i.name : "")).filter(Boolean)) : null;
    },
    read: async (key) => {
      const rec = (await store.get(key, { type: "json" })) as Partial<ThumbCount> | null;
      return rec ? { shown: Number(rec.shown) || 0, clicks: Number(rec.clicks) || 0 } : null;
    },
    write: async (key, count) => {
      await store.setJSON(key, count);
    },
    now: () => Date.now(),
  });
};

export const config = { path: "/api/thumbs" };
