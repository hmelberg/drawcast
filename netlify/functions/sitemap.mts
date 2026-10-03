// drawcast.app/sitemap.xml (2026-10-03, delivery 3): the front page and every
// listed drawcast's and course's watch page (/w/<name>), from the registry's
// public catalogue, a page at a time. CDN-cached for a day.
import { sitemapXml } from "../lib/watch-page.mts";

const CATALOGUE = "https://drawcast.anvil.app/_/api/catalogue";
const MAX_PAGES = 20; // 1000 items; the catalogue is far smaller today

export async function listedNames(fetchImpl: typeof fetch = fetch): Promise<Array<{ name: string; updated: string | null }>> {
  const out: Array<{ name: string; updated: string | null }> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchImpl(`${CATALOGUE}?page=${page}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) break;
    const body = (await res.json()) as { items?: Array<Record<string, unknown>>; more?: unknown };
    for (const i of body.items ?? []) {
      if (typeof i.name === "string" && i.private !== true) out.push({ name: i.name, updated: typeof i.updated === "string" ? i.updated : null });
    }
    if (body.more !== true) break;
  }
  return out;
}

export default async (): Promise<Response> => {
  let names: Array<{ name: string; updated: string | null }> = [];
  try {
    names = await listedNames();
  } catch {
    /* the front page alone is still a valid sitemap */
  }
  return new Response(sitemapXml(names), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "netlify-cdn-cache-control": names.length ? "public, durable, max-age=86400, stale-while-revalidate=86400" : "no-store",
    },
  });
};

export const config = { path: "/sitemap.xml" };
