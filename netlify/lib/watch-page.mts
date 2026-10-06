// drawcast.app/w/<name> (2026-10-03, delivery 3): a real address for a
// drawcast on drawcast.app — what the front page links, the sitemap lists and
// a crawler or a link preview reads. The page is the app's own index.html
// (netlify.toml rewrites /w/* to it); the edge function
// (netlify/edge-functions/watch-page.mts) puts this drawcast's title, card
// and canonical in its head, and a <base href="/"> so the app's relative
// assets (Vite base "./") load from the root, not from /w/.
//
// Canonical: the author's own door page when the registry knows one (it holds
// the transcript, so it is the richer page to rank) — else this address.
// The app itself then plays the name as it plays #name (src/entry.ts).
//
// Pure: no fetch, no Netlify — tests/watch-page.test.ts.

import { NAME_LABEL_RE, RESERVED_LABELS } from "./name-host.mts";

export const APEX_ORIGIN = "https://www.drawcast.app";

/** `/w/<name>` or `/w/<name>/<lecture>` → the name (`spanish/3`); null otherwise. */
export function watchName(pathname: string): string | null {
  const m = /^\/w\/([^/]+)(?:\/(\d{1,3}))?\/?$/.exec(pathname);
  if (!m) return null;
  const base = m[1].toLowerCase();
  if (!NAME_LABEL_RE.test(base) || (RESERVED_LABELS as readonly string[]).includes(base)) return null;
  return m[2] ? `${base}/${Number(m[2])}` : base;
}

/** The address of a name's watch page. */
export function watchUrl(name: string): string {
  return `${APEX_ORIGIN}/w/${name}`;
}

export interface WatchMeta {
  title: string;
  owner?: string;
  /** The author's door page (registry `page`), https only. */
  page?: string | null;
  kind?: "cast" | "course";
  lectures?: number;
  tags?: string[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** One line for search results and link cards, from what the registry has. */
export function watchDescription(meta: WatchMeta): string {
  const by = meta.owner ? ` by ${meta.owner}` : "";
  const what = meta.kind === "course"
    ? `A drawcast course${by}${meta.lectures && meta.lectures > 1 ? ` in ${meta.lectures} lectures` : ""}: drawn explanations you can watch and play with.`
    : `A drawcast${by}: a drawn explanation you can watch and play with.`;
  const about = meta.tags?.length ? ` About ${meta.tags.slice(0, 4).join(", ")}.` : "";
  return `${what}${about}`;
}

/**
 * index.html with this drawcast's head: <base>, title, description, the link
 * card (og/twitter) and canonical. `meta` null (registry unreachable, name
 * unknown or private) still gets the <base> — the page must load — and the
 * name as its title, with canonical to itself.
 */
export function watchHead(html: string, name: string, meta: WatchMeta | null): string {
  const base = name.split("/", 1)[0];
  const self = watchUrl(name);
  // Only a specific page (`…/casts/moon.html`) is a door page: the registry
  // also holds folder and index pages (`…/casts/`), which are a listing.
  const door = meta?.page && /^https:\/\/.+\/(?!index\.html$)[^/]+\.html$/.test(meta.page) ? meta.page : null;
  const canonical = door && !name.includes("/") ? door : self;
  const title = meta?.title?.trim() || base;
  const description = meta ? watchDescription(meta) : "A drawcast — a drawn explanation you can watch and play with.";
  const image = `${APEX_ORIGIN}/card/${base}.png`;
  let out = html;
  const set = (re: RegExp, tag: string): void => {
    out = re.test(out) ? out.replace(re, tag) : out.replace("</head>", `    ${tag}\n  </head>`);
  };
  out = out.replace(/<head>/i, `<head>\n    <base href="/" />`);
  set(/<title>[^<]*<\/title>/i, `<title>${esc(title)} · drawcast</title>`);
  set(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(description)}" />`);
  set(/<meta property="og:type"[^>]*>/i, `<meta property="og:type" content="video.other" />`);
  set(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(title)}" />`);
  set(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(description)}" />`);
  set(/<meta property="og:image" [^>]*>/i, `<meta property="og:image" content="${esc(image)}" />`);
  set(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(self)}" />`);
  set(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(canonical)}" />`);
  return out;
}

/** The catalogue row for one name, as the edge reads it (registry `/catalogue?names=`). */
export function metaFromCatalogue(body: unknown, name: string): WatchMeta | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const base = name.split("/", 1)[0];
  const row = items.find((i) => i && typeof i === "object" && (i as { name?: unknown }).name === base) as Record<string, unknown> | undefined;
  if (!row || typeof row.title !== "string" || row.private === true) return null;
  return {
    title: row.title,
    ...(typeof row.owner === "string" ? { owner: row.owner } : {}),
    page: typeof row.page === "string" ? row.page : null,
    kind: row.kind === "course" ? "course" : "cast",
    ...(typeof row.lectures === "number" ? { lectures: row.lectures } : {}),
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

/** sitemap.xml for the front page and every listed name's watch page. */
export function sitemapXml(names: Array<{ name: string; updated?: string | null }>): string {
  const url = (loc: string, lastmod?: string | null): string =>
    `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : ""}</url>`;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    url(`${APEX_ORIGIN}/`),
    ...names.map((n) => url(watchUrl(n.name), n.updated)),
    `</urlset>`,
    "",
  ].join("\n");
}
