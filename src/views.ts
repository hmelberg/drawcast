// View counting, client side. Nothing here may ever throw into playback: a
// counter that breaks a drawcast is worse than no counter, so every failure
// path returns null and the badge simply stays hidden.

/** Mirrors the cast-key rule in netlify/lib/view-key.mts. Checked here too so
 *  a malformed key never becomes a pointless request. */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
/** The same list as PRIVATE_OWNERS in netlify/lib/view-key.mts — one policy,
 *  two layers, pinned to each other by tests/views-client.test.ts so a second
 *  private owner can never land on one side only. `anvil/<slug>/<file>` is
 *  the drawcast server's own store, and a cast on it may be private to a
 *  course; the counter is public and lists an owner's every key, so such a
 *  key must never reach it — a private cast's views are the teacher's
 *  business, in the dashboard. Refused HERE, not only in the viewer's wiring,
 *  so the request is never made whatever a caller passes. Exact owner:
 *  `anvil-courses/…` is a GitHub key like any other. */
export const PRIVATE_OWNERS: readonly string[] = ["anvil"];

function countable(key: string): boolean {
  return CAST_KEY_RE.test(key) && !PRIVATE_OWNERS.includes(key.split("/", 1)[0]);
}

/**
 * Endpoints tried in order, the same shape as VENDING_ENDPOINTS in
 * src/keys.ts: same-origin first for the Netlify deploy and `netlify dev`,
 * then the absolute URL for the GitHub Pages deploy, which calls the
 * drawcast.app function cross-origin.
 */
export const VIEW_ENDPOINTS = [
  "/.netlify/functions/views",
  "https://drawcast.app/.netlify/functions/views",
];

const SESSION_PREFIX = "drawcast.viewed:";

/**
 * A missing flag counts. Everything published before this feature existed has
 * no `meta.views`, and those drawcasts should start counting when this
 * deploys rather than needing a republish.
 */
export function countingEnabled(meta: { views?: boolean }): boolean {
  return meta.views !== false;
}

export function castKeyFor(gh: { owner: string; repo: string; path: string }): string {
  return `${gh.owner}/${gh.repo}/${gh.path}`;
}

/**
 * True the first time this browser session sees a cast. A reload in the same
 * tab reads the count instead of adding one; a fresh visit counts again.
 * Storage can be absent or throw (private mode), and then the view counts —
 * under-counting is the wrong way to fail for something this trivial.
 */
export function firstViewInSession(key: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  try {
    const marker = SESSION_PREFIX + key;
    if (storage.getItem(marker)) return false;
    storage.setItem(marker, "1");
    return true;
  } catch {
    return true;
  }
}

function countOf(body: unknown): number | null {
  const n = (body as { count?: unknown }).count;
  return typeof n === "number" ? n : null;
}

export async function recordView(
  key: string,
  endpoints: string[] = VIEW_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!countable(key)) return null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        // text/plain is CORS-safelisted, so this stays a simple request and
        // costs no preflight on the path that runs for every view.
        headers: { "content-type": "text/plain" },
        body: key,
        keepalive: true,
      });
      // Unlike readViewCount below, a retry here is not free: on drawcast.app
      // POST and GET are the SAME function, so a 5xx or timeout arriving
      // AFTER the write already landed would fall through to the next
      // endpoint and write a second hit key for one play. 404/405 are the
      // exception — that is the genuine "wrong endpoint" case (the GitHub
      // Pages relative URL has nothing to POST to) and must still fall
      // through, or that deploy never counts a view at all.
      if (res.status === 404 || res.status === 405) continue;
      if (!res.ok) return null;
      return countOf(await res.json());
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

export async function readViewCount(
  key: string,
  endpoints: string[] = VIEW_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!countable(key)) return null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(`${url}?cast=${encodeURIComponent(key)}`);
      if (!res.ok) continue;
      return countOf(await res.json());
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

/**
 * Return the playlist a publish should send. Counting on writes nothing —
 * absent already means counting, and writing `views: true` would push every
 * single-drawcast file from a bare spec into a `playlist:` header for a value
 * that is the default.
 *
 * Exported and called by BOTH publishers on purpose. `meta.comments` was set
 * independently in main.ts and course.ts, and the course path silently
 * dropped the checkbox until someone noticed; one rule cannot drift.
 *
 * Never mutates: publish prepares a COPY, and the author's open document must
 * come out unchanged (P §3.4).
 */
export function applyViewsFlag<T extends { meta: { views?: boolean } }>(playlist: T, countViews: boolean): T {
  if (countViews) return playlist;
  return { ...playlist, meta: { ...playlist.meta, views: false } };
}
