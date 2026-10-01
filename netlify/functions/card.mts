// netlify/functions/card.mts
// drawcast.app/c/<name> and /card/<name>.png (spec 2026-10-02-share-design
// §§3–5). A person asking for /c/ is redirected at once to the # link that
// plays — no lookup, no visit (their own lookup after the redirect counts
// it, with the Referer the browser keeps across a 302). A link-preview
// crawler gets a card page: the cast's title and subtitle and the poster
// published beside it. Every failure is the generic card, status 200 — a
// broken preview in someone's feed is worse than a plain one.
import { cardHtml, cardPathFor, castCardText, courseCardText, GENERIC, hashForShare, isPreviewBot, parseSharePath, sharePathFor, type ShareTarget } from "../lib/share-card.mts";

const ANVIL_BASE = "https://drawcast.anvil.app";
const RAW = "https://raw.githubusercontent.com";
const FETCH_MS = 4000;

export interface CardDeps {
  resolve(name: string): Promise<{ kind: "cast" | "course"; target: string } | null>;
  fetchText(url: string): Promise<string | null>;
  fetchImage(url: string): Promise<Response | null>;
}

/** src/publish/cast.ts posterPathFor's rule, at a raw GitHub URL (that file
 *  pulls in the app; tests/card-endpoint.test.ts pins the two together). */
export function posterUrlFor(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path.replace(/\.ya?ml$/i, "")}.png`;
}

function rawUrl(owner: string, repo: string, path: string): string {
  return `${RAW}/${owner}/${repo}/HEAD/${path}`;
}

/** A GitHub key `owner/repo/rest`, or null. */
function splitKey(target: string): { owner: string; repo: string; path: string } | null {
  const m = /^([\w.-]+)\/([\w.-]+)\/(.+)$/.exec(target);
  return m ? { owner: m[1], repo: m[2], path: m[3] } : null;
}

interface Found {
  text?: { title?: string; subtitle?: string };
  /** Absolute poster URL at the source, when the cast has one. */
  poster?: string;
}

/** A cast's card text from its source; "locked" for a private cast's
 *  envelope — which must leave no trace on a card, not even "A drawcast". */
async function castText(url: string, deps: CardDeps): Promise<{ title?: string; subtitle?: string } | "locked" | undefined> {
  const text = await deps.fetchText(url);
  if (text === null) return undefined;
  if (text.startsWith("drawcast-encrypted:")) return "locked";
  return castCardText(text);
}

async function find(t: ShareTarget, deps: CardDeps): Promise<Found | null> {
  if (t.kind === "gh") {
    const text = await castText(rawUrl(t.owner, t.repo, t.path), deps);
    return text === "locked" ? null : { text, poster: posterUrlFor(t.owner, t.repo, t.path) };
  }
  const r = await deps.resolve(t.name);
  if (!r) return null;
  if (r.kind === "course") {
    const k = splitKey(r.target);
    if (!k) return null;
    const md = await deps.fetchText(rawUrl(k.owner, k.repo, `${k.path}/course.md`));
    // No title (a private course gives {}) is the generic card, not "A drawcast".
    const text = md === null ? undefined : courseCardText(md);
    return { text: text?.title ? text : undefined };
  }
  if (r.target.startsWith("gdrive/")) return null;
  if (r.target.startsWith("anvil/")) {
    const text = await castText(`${ANVIL_BASE}/_/api/cast?cast=${encodeURIComponent(r.target)}&key=`, deps);
    return text === "locked" ? null : { text };
  }
  const k = splitKey(r.target);
  if (!k || !/\.ya?ml$/i.test(k.path)) return null;
  const text = await castText(rawUrl(k.owner, k.repo, k.path), deps);
  return text === "locked" ? null : { text, poster: posterUrlFor(k.owner, k.repo, k.path) };
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" } });
}

function redirect(location: string, cache = "no-store"): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": cache } });
}

export async function handleCardRequest(req: Request, deps: CardDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const origin = url.origin;
  const genericImage = `${origin}${GENERIC.image}`;

  if (url.pathname.startsWith("/card/")) {
    const t = parseSharePath(url.pathname, "/card/");
    try {
      const found = t ? await find(t, deps) : null;
      if (found?.poster) {
        const img = await deps.fetchImage(found.poster);
        if (img && img.ok && (img.headers.get("content-type") ?? "").startsWith("image/")) {
          return new Response(img.body, { status: 200, headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
        }
      }
    } catch {
      /* the generic picture below */
    }
    return redirect(genericImage, "public, max-age=600");
  }

  const t = parseSharePath(url.pathname, "/c/");
  if (!isPreviewBot(req.headers.get("user-agent"))) return redirect(t ? `${origin}/${hashForShare(t)}` : `${origin}/`);

  const generic = cardHtml({ title: GENERIC.title, description: GENERIC.description, url: `${origin}/`, image: genericImage, playUrl: `${origin}/` });
  if (!t) return html(generic);
  let found: Found | null = null;
  try {
    found = await find(t, deps);
  } catch {
    found = null;
  }
  if (!found) return html(generic);
  // Text that could not be read at all (GitHub down) is the generic card; a
  // cast that was read but has no title keeps its own picture as "A drawcast".
  // A locked envelope never gets here: find() returns null for it.
  if (!found.text) return html(generic);
  return html(
    cardHtml({
      title: found.text?.title ?? "A drawcast",
      description: found.text?.subtitle,
      url: `${origin}${sharePathFor(t)}`,
      image: found.poster ? `${origin}${cardPathFor(t)}` : genericImage,
      playUrl: `${origin}/${hashForShare(t)}`,
    }),
  );
}

async function timed(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

const live: CardDeps = {
  // Anvil directly, not the name function: a crawler is not a visit.
  resolve: async (name) => {
    const res = await timed(`${ANVIL_BASE}/_/api/name?n=${encodeURIComponent(name)}`);
    if (!res) return null;
    const b = (await res.json().catch(() => null)) as { kind?: unknown; target?: unknown } | null;
    return b && (b.kind === "cast" || b.kind === "course") && typeof b.target === "string" ? { kind: b.kind, target: b.target } : null;
  },
  fetchText: async (url) => {
    const res = await timed(url);
    return res ? await res.text() : null;
  },
  fetchImage: (url) => timed(url),
};

export default (req: Request): Promise<Response> => handleCardRequest(req, live);

export const config = { path: ["/c/*", "/card/*"] };
