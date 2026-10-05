// netlify/functions/card.mts
// drawcast.app/c/<name> and /card/<name>.png (spec 2026-10-02-share-design
// §§3–5). A person asking for /c/ is redirected at once to the # link that
// plays — no lookup, no visit (their own lookup after the redirect counts
// it, with the Referer the browser keeps across a 302). A link-preview
// crawler gets a card page: the cast's title and subtitle and the poster
// published beside it. Every failure is the generic card, status 200 — a
// broken preview in someone's feed is worse than a plain one.
import { cardHtml, cardPathFor, castCardText, courseCardText, GENERIC, GENERIC_SIZE, hashForShare, isPreviewBot, parseSharePath, POSTER_SIZE, sharePathFor, type CastCardText, type ShareTarget } from "../lib/share-card.mts";
import { isPlain, kidsByTags, planThumb, thumbTitle, type ThumbPlan } from "../lib/thumb.mts";
import { renderThumb } from "../lib/thumb-render.mts";
import { getStore } from "@netlify/blobs";

const ANVIL_BASE = "https://drawcast.anvil.app";
const RAW = "https://raw.githubusercontent.com";
/** One deadline for the whole request, shared by every fetch in it: the
 *  lookups are sequential (name → text → lecture → picture), and a crawler
 *  gives up long before 4 s apiece would add up. */
const DEADLINE_MS = 6000;

/** Every call gets the request's one deadline signal; the live deps pass it
 *  to fetch, injected ones may ignore it. */
export interface CardDeps {
  /** The listing picture drawn over the poster (thumbnail round, netlify/lib/thumb-render.mts); absent, the poster as it is. */
  draw?(plan: ThumbPlan, poster: Uint8Array): Uint8Array;
  resolve(name: string, signal?: AbortSignal): Promise<{ kind: "cast" | "course"; target: string } | null>;
  fetchText(url: string, signal?: AbortSignal): Promise<string | null>;
  fetchImage(url: string, signal?: AbortSignal): Promise<Response | null>;
  /** Whether a picture is there, without its bytes (a HEAD). Absent, fetchImage is asked. */
  exists?(url: string, signal?: AbortSignal): Promise<boolean>;
  /** Built card pictures kept across deploys (Netlify Blobs); absent, every request builds. */
  cache?: CardCache;
  /** Work to finish after the answer has gone (Netlify's context.waitUntil); absent, it runs unawaited. */
  defer?(work: Promise<unknown>): void;
  now?(): number;
  /** The request's deadline, ms (tests shorten it); absent, DEADLINE_MS. */
  deadlineMs?: number;
}

/** A built picture, by its card path (`vaccines.png`, `gh/o/r/x.png`). */
export interface CardCache {
  get(key: string): Promise<{ bytes: Uint8Array; at: number; thumb: string } | null>;
  set(key: string, bytes: Uint8Array, meta: { at: number; thumb: string }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A kept picture older than this is checked again, in the background. */
const REVALIDATE_MS = 10 * 60 * 1000;
/** A build no visitor is waiting for may take longer than the request's deadline. */
const BACKGROUND_MS = 20000;

/** src/publish/cast.ts posterPathFor's rule, at a raw GitHub URL (that file
 *  pulls in the app; tests/card-endpoint.test.ts pins the two together). */
export function posterUrlFor(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path.replace(/\.(cast|ya?ml)$/i, "")}.png`;
}

function rawUrl(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path}`;
}

/** A GitHub key `owner/repo/rest`, or null. */
function splitKey(target: string): { owner: string; repo: string; path: string } | null {
  const m = /^([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(target);
  return m ? { owner: m[1], repo: m[2], path: m[3] } : null;
}

const LOCKED_RE = /^drawcast-encrypted:/;

/** The first lecture file a course.md names: the `file:` part of a lecture's
 *  `status:` line (src/course/document.ts parseStatus, read through
 *  src/course/load.ts lectureFilesOf; netlify/ must not import src/). Only a
 *  plain relative path, segment by segment — never `..` out of the course. */
function firstLectureFile(md: string): string | null {
  let inLecture = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      if (heading[1].length === 2) inLecture = true;
      continue;
    }
    if (!inLecture) continue;
    const status = /^status\s*:\s*(.+)$/.exec(line);
    if (!status) continue;
    for (const part of status[1].split("·")) {
      const m = /^file\s*:\s*(.+)$/.exec(part.trim());
      if (!m) continue;
      const file = m[1].trim();
      return file.split("/").every((s) => /^[\w.-]+$/.test(s) && s !== "." && s !== "..") ? file : null;
    }
  }
  return null;
}

interface Found {
  /** undefined: the text could not be read — maybe private, so nothing of it shows. */
  text?: CastCardText;
  /** Absolute poster URL at the source, when the cast has one. */
  poster?: string;
}

/** A cast's card text from its source; "locked" for a private cast's
 *  envelope — which must leave no trace on a card, not even "A drawcast". */
async function castText(url: string, deps: CardDeps, signal: AbortSignal): Promise<CastCardText | "locked" | undefined> {
  const text = await deps.fetchText(url, signal);
  if (text === null) return undefined;
  if (LOCKED_RE.test(text)) return "locked";
  return castCardText(text);
}

async function find(t: ShareTarget, deps: CardDeps, signal: AbortSignal): Promise<Found | null> {
  if (t.kind === "gh") {
    const text = await castText(rawUrl(t.owner, t.repo, t.path), deps, signal);
    return text === "locked" ? null : { text, poster: posterUrlFor(t.owner, t.repo, t.path) };
  }
  const r = await deps.resolve(t.name, signal);
  if (!r) return null;
  if (r.kind === "course") {
    const k = splitKey(r.target);
    if (!k) return null;
    const md = await deps.fetchText(rawUrl(k.owner, k.repo, `${k.path}/course.md`), signal);
    // No title (a private course gives {}) is the generic card, not "A drawcast".
    const text = md === null ? undefined : courseCardText(md);
    if (!text?.title) return { text: undefined };
    // A course made private before its course.md said so has locked
    // lectures (src/course/load.ts: any locked lecture means private).
    const file = firstLectureFile(md!);
    if (file) {
      const lecture = await deps.fetchText(rawUrl(k.owner, k.repo, `${k.path}/${file}`), signal);
      if (lecture !== null && LOCKED_RE.test(lecture)) return null;
      // The course's own picture is its first lecture's (spec 2026-10-02-
      // share-design §7) — only once that lecture's text was read and is not
      // locked, the same rule a cast's picture follows.
      if (lecture !== null) return { text, poster: posterUrlFor(k.owner, k.repo, `${k.path}/${file}`) };
    }
    return { text };
  }
  if (r.target.startsWith("gdrive/")) return null;
  if (r.target.startsWith("anvil/")) {
    const text = await castText(`${ANVIL_BASE}/_/api/cast?cast=${encodeURIComponent(r.target)}&key=`, deps, signal);
    return text === "locked" ? null : { text };
  }
  const k = splitKey(r.target);
  if (!k || !/\.(cast|ya?ml)$/i.test(k.path)) return null;
  const text = await castText(rawUrl(k.owner, k.repo, k.path), deps, signal);
  return text === "locked" ? null : { text, poster: posterUrlFor(k.owner, k.repo, k.path) };
}

function isImage(res: Response | null): res is Response {
  return !!res && res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
}

async function posterExists(url: string, deps: CardDeps, signal: AbortSignal): Promise<boolean> {
  if (deps.exists) return deps.exists(url, signal);
  const res = await deps.fetchImage(url, signal);
  void res?.body?.cancel().catch(() => undefined);
  return isImage(res);
}

/** Who asked decides what /c/ answers (a redirect or a card), and Netlify's
 *  CDN does not key on User-Agent by itself — so both say they vary on it. */
function varies(res: Response): Response {
  res.headers.set("netlify-vary", "header=User-Agent");
  res.headers.set("vary", "User-Agent");
  return res;
}

function html(body: string): Response {
  return varies(new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" } }));
}

function redirect(location: string, cache = "no-store"): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": cache } });
}

/** What building a card picture came to: the picture (with how it was drawn,
 *  for x-thumb), "none" when the cast has no picture to show (unknown,
 *  private, no poster — the generic card), or "timeout" when the deadline
 *  ran out first, which says nothing about the cast. */
type Built = { bytes: Uint8Array; thumb: string } | "none" | "timeout";

async function buildCard(t: ShareTarget, deps: CardDeps, signal: AbortSignal): Promise<Built> {
  try {
    const found = await find(t, deps, signal);
    // Only a cast whose text was read (and was not locked — find() is null
    // then) shows its poster: text that could not be read may be private.
    if (found?.poster && found.text !== undefined) {
      const img = await deps.fetchImage(found.poster, signal);
      if (isImage(img)) {
        // Read whole inside the deadline: a stream still open when the
        // request's signal fires would be cut off mid-picture.
        let bytes: Uint8Array = new Uint8Array(await img.arrayBuffer());
        // The cast's listing style (thumbnail round, 2026-10-04): drawn
        // here, so the front page and every link preview show the same.
        // Anything that goes wrong serves the poster as published.
        const plan = planThumb(found.text.thumb, { title: found.text.title, format: found.text.format, kids: kidsByTags(found.text.tags) });
        // What happened, for anyone reading the headers (x-thumb): drawn, plain, or why not.
        let thumb = "plain";
        if (!isPlain(plan) && deps.draw) {
          try {
            bytes = deps.draw(plan, bytes);
            thumb = "drawn";
          } catch (err) {
            thumb = `error: ${String((err as Error)?.message ?? err).slice(0, 120).replace(/[^\x20-\x7e]/g, "?")}`;
            console.error("card: thumb drawing failed", err);
          }
        }
        return { bytes, thumb };
      }
    }
  } catch {
    /* a lookup that threw: timed out, or the generic picture */
  }
  // Every lookup returns null when its fetch fails, so a run out of time
  // looks like "not there" — the deadline's own signal tells them apart.
  return signal.aborted ? "timeout" : "none";
}

/** Netlify-CDN-Cache-Control (2026-10-03): the front page shows a grid of
 *  these, so Netlify's CDN keeps each for an hour (durable: shared across
 *  edge nodes); browsers follow cache-control. A picture whose drawing
 *  failed is the poster as published, kept only a few minutes. */
function png(bytes: Uint8Array, thumb: string, source: "stored" | "built"): Response {
  const short = thumb.startsWith("error");
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": short ? "public, max-age=300" : "public, max-age=3600",
      "netlify-cdn-cache-control": short ? "public, max-age=300" : "public, durable, max-age=3600, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
      "x-thumb": thumb,
      "x-card": source,
    },
  });
}

/** The /card/ picture (home-cards round, 2026-10-05). A deploy empties the
 *  CDN, and building a picture is four lookups in a row (name, text,
 *  poster, drawing) — a cold front page asking for forty at once ran out of
 *  time and showed the logo on another computer. So a built picture is kept
 *  in Blobs, which outlive deploys: served from there at once, checked
 *  again in the background once it is REVALIDATE_MS old. A build that runs
 *  out of time is a 503 the front page retries (finished in the background
 *  meanwhile), never the logo — the logo means the cast has no picture.
 *  `?refresh` builds anew (a publish asks for that). */
async function cardImage(req: Request, url: URL, deps: CardDeps, signal: AbortSignal): Promise<Response> {
  const genericImage = `${url.origin}${GENERIC.image}`;
  const t = parseSharePath(url.pathname, "/card/");
  const key = t ? cardPathFor(t).slice("/card/".length) : null;
  const cache = key ? deps.cache : undefined;
  const now = deps.now?.() ?? Date.now();
  const later = (work: Promise<unknown>): void => {
    const quiet = work.catch((e) => console.warn("card: background work failed", e));
    if (deps.defer) deps.defer(quiet);
  };
  // Keep (or forget) what a build came to; a timeout changes nothing.
  const keep = async (built: Built): Promise<void> => {
    if (!cache || !key || built === "timeout") return;
    if (built === "none") await cache.delete(key);
    else if (!built.thumb.startsWith("error")) await cache.set(key, built.bytes, { at: now, thumb: built.thumb });
  };

  if (t && cache && !url.searchParams.has("refresh")) {
    const stored = await cache.get(key!).catch(() => null);
    if (stored) {
      if (now - stored.at > REVALIDATE_MS) later(buildCard(t, deps, AbortSignal.timeout(BACKGROUND_MS)).then(keep));
      return png(stored.bytes, stored.thumb, "stored");
    }
  }

  const built: Built = t ? await buildCard(t, deps, signal) : "none";
  if (typeof built === "object") {
    later(keep(built));
    return png(built.bytes, built.thumb, "built");
  }
  if (built === "timeout" && !isPreviewBot(req.headers.get("user-agent"))) {
    // Finish it in the background, so the retry finds it kept.
    if (t) later(buildCard(t, deps, AbortSignal.timeout(BACKGROUND_MS)).then(keep));
    return new Response(null, {
      status: 503,
      headers: { "retry-after": "2", "cache-control": "no-store", "netlify-cdn-cache-control": "no-store", "access-control-allow-origin": "*" },
    });
  }
  if (built === "none") later(keep(built));
  // Public picture: the share box fetches it from other origins (previews).
  // Short-lived and never kept by the CDN (2026-10-04), so a cast that gains
  // a poster shows it soon.
  const generic = redirect(genericImage, "public, max-age=60");
  generic.headers.set("netlify-cdn-cache-control", "no-store");
  generic.headers.set("access-control-allow-origin", "*");
  return generic;
}

export async function handleCardRequest(req: Request, deps: CardDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const origin = url.origin;
  const genericImage = `${origin}${GENERIC.image}`;
  const signal = AbortSignal.timeout(deps.deadlineMs ?? DEADLINE_MS);

  if (url.pathname.startsWith("/card/")) return cardImage(req, url, deps, signal);

  const t = parseSharePath(url.pathname, "/c/");
  if (!isPreviewBot(req.headers.get("user-agent"))) return varies(redirect(t ? `${origin}/${hashForShare(t)}` : `${origin}/`));

  // The generic card still names the /c/ link it was asked for, when that
  // parsed; the front page only when it did not.
  const generic = cardHtml({
    title: GENERIC.title,
    description: GENERIC.description,
    url: t ? `${origin}${sharePathFor(t)}` : `${origin}/`,
    image: genericImage,
    imageSize: GENERIC_SIZE,
    playUrl: t ? `${origin}/${hashForShare(t)}` : `${origin}/`,
  });
  if (!t) return html(generic);
  let found: Found | null = null;
  try {
    found = await find(t, deps, signal);
  } catch {
    found = null;
  }
  if (!found) return html(generic);
  // Text that could not be read at all (GitHub down) is the generic card; a
  // cast that was read but has no title keeps its own picture as "A drawcast".
  // A locked envelope never gets here: find() returns null for it.
  if (!found.text) return html(generic);
  // The poster is checked here, so a cast without one points straight at the
  // generic picture (with its own size) rather than through a /card/ redirect.
  let own = false;
  if (found.poster) {
    try {
      own = await posterExists(found.poster, deps, signal);
    } catch {
      own = false;
    }
  }
  return html(
    cardHtml({
      title: thumbTitle(found.text.thumb) ?? found.text.title ?? "A drawcast",
      description: found.text.subtitle,
      url: `${origin}${sharePathFor(t)}`,
      image: own ? `${origin}${cardPathFor(t)}` : genericImage,
      imageSize: own ? POSTER_SIZE : GENERIC_SIZE,
      playUrl: `${origin}/${hashForShare(t)}`,
    }),
  );
}

async function timed(url: string, signal?: AbortSignal, method = "GET"): Promise<Response | null> {
  try {
    const res = await fetch(url, { method, signal });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

const live: CardDeps = {
  // Anvil directly, not the name function: a crawler is not a visit.
  resolve: async (name, signal) => {
    const res = await timed(`${ANVIL_BASE}/_/api/name?n=${encodeURIComponent(name)}`, signal);
    if (!res) return null;
    const b = (await res.json().catch(() => null)) as { kind?: unknown; target?: unknown } | null;
    return b && (b.kind === "cast" || b.kind === "course") && typeof b.target === "string" ? { kind: b.kind, target: b.target } : null;
  },
  fetchText: async (url, signal) => {
    const res = await timed(url, signal);
    return res ? await res.text().catch(() => null) : null;
  },
  fetchImage: (url, signal) => timed(url, signal),
  exists: async (url, signal) => isImage(await timed(url, signal, "HEAD")),
  draw: renderThumb,
};

function blobCache(): CardCache {
  const store = getStore({ name: "cards" });
  return {
    get: async (key) => {
      const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
      if (!r) return null;
      const m = r.metadata as { at?: unknown; thumb?: unknown };
      return { bytes: new Uint8Array(r.data), at: typeof m.at === "number" ? m.at : 0, thumb: typeof m.thumb === "string" ? m.thumb : "plain" };
    },
    set: async (key, bytes, meta) => {
      await store.set(key, bytes.slice().buffer as ArrayBuffer, { metadata: meta });
    },
    delete: async (key) => {
      await store.delete(key);
    },
  };
}

export default (req: Request, context?: { waitUntil?: (work: Promise<unknown>) => void }): Promise<Response> => {
  let cache: CardCache | undefined;
  try {
    cache = blobCache();
  } catch {
    cache = undefined; // no Blobs here (a local run without them): build every time
  }
  return handleCardRequest(req, { ...live, cache, defer: context?.waitUntil ? (w) => context.waitUntil!(w) : undefined });
};

export const config = { path: ["/c/*", "/card/*"] };
