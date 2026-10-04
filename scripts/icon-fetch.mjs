// Iconify lookups for the scripts (cast.mjs check and frames, pictures.mjs):
// one on-disk cache shared by every run, and a polite retry. Many frames runs
// at once used to ask Iconify for the same icons together; it answered 429,
// the icons drew blank and `check` said "no icon for X" for a keyword that
// has one. Every answer worth keeping (a 200, or a 404 — "no such icon" is an
// answer too) is written under dev-casts/.icon-cache/, one file per URL, so a
// second run asks nothing; a 429 or a 5xx is retried with backoff (its
// Retry-After when it gives one) and never cached.
//
// The app's own resolver (src/render/icon.ts) is unchanged: check hands it a
// fetch built here (nodeFetch), frames and pictures route the page's Iconify
// requests through it (routePage).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const ICONIFY = "https://api.iconify.design/";

/** Iconify refuses some default client headers (Python's urllib got a 403
 *  where curl got a 200): say who is asking. */
const HEADERS = { "user-agent": "drawcast-scripts/1 (+https://drawcast.app)", accept: "*/*" };

const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const sleepMs = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * A cached, retrying GET for Iconify URLs: `(url) => {status, body,
 * contentType}`. `dir` is the cache folder; `fetchImpl`, `sleep` and `now`
 * are seams for the tests. At most `parallel` requests are in flight per
 * process. A network error that outlasts the retries is thrown, as fetch's.
 */
export function iconFetcher({ dir, fetchImpl = fetch, sleep = sleepMs, now = Date.now, tries = 6, baseMs = 500, parallel = 4 }) {
  let active = 0;
  const waiting = [];
  const slot = async () => {
    if (active >= parallel) await new Promise((ok) => waiting.push(ok));
    active++;
  };
  const free = () => {
    active--;
    waiting.shift()?.();
  };
  const fileOf = (url) => resolve(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
  const read = (url) => {
    try {
      const rec = JSON.parse(readFileSync(fileOf(url), "utf8"));
      return rec.url === url && now() - rec.at < MAX_AGE_MS ? rec : null;
    } catch {
      return null;
    }
  };
  const write = (rec) => {
    // Written whole, then renamed: a parallel run never reads half a file.
    const file = fileOf(rec.url), tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(rec));
      renameSync(tmp, file);
    } catch {
      /* a cache that cannot be written only costs a refetch */
    }
  };
  return async (url) => {
    const hit = read(url);
    if (hit) return hit;
    await slot();
    try {
      let last = null;
      for (let i = 0; i < tries; i++) {
        if (i > 0) await sleep(last?.wait ?? Math.min(30000, baseMs * 2 ** (i - 1) * (1 + Math.random() / 2)));
        let res;
        try {
          res = await fetchImpl(url, { headers: HEADERS });
        } catch (err) {
          last = { err };
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          const after = Number(res.headers.get("retry-after"));
          last = { status: res.status, wait: Number.isFinite(after) && after > 0 ? Math.min(60000, after * 1000) : undefined };
          continue;
        }
        const rec = { url, at: now(), status: res.status, contentType: res.headers.get("content-type") ?? "", body: await res.text() };
        if (res.status === 200 || res.status === 404) write(rec);
        return rec;
      }
      if (last?.err) throw last.err;
      return { url, at: now(), status: last.status, contentType: "text/plain", body: "" };
    } finally {
      free();
    }
  };
}

/** The default cache folder under the repo (dev-casts/ is never committed). */
export const iconCacheDir = (root) => resolve(root, "dev-casts/.icon-cache");

/** A fetch for Node code (the app's icon resolver in `check`): Iconify through `get`, everything else as is. */
export function nodeFetch(get, fetchImpl = fetch) {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (!url.startsWith(ICONIFY)) return fetchImpl(input, init);
    const rec = await get(url);
    return new Response(rec.body, { status: rec.status, headers: { "content-type": rec.contentType } });
  };
}

/** Route a Playwright page's Iconify requests through `get` (frames, pictures). */
export async function routePage(page, get) {
  await page.route?.(`${ICONIFY}**`, async (route) => {
    try {
      const rec = await get(route.request().url());
      await route.fulfill({ status: rec.status, contentType: rec.contentType || undefined, body: rec.body, headers: { "access-control-allow-origin": "*" } });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
}
