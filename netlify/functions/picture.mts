// The picture proxy: GET ?url=<https picture> -> that picture's bytes, served
// from drawcast's own origin with a CORS header, so the app can READ the
// pixels of a picture whose host sends no CORS header (src/render/image.ts
// tries it after a direct read fails, before falling back to a link).
//
// An open URL fetcher on a server is an SSRF door, so this is deliberately
// narrow:
//   - https only, no credentials, default port only;
//   - the host must be public (netlify/lib/public-host.mts): no local names,
//     no private/loopback/link-local/CGNAT/unique-local IP literals, and
//     every address a name resolves to must be public — checked up front
//     (403) and again AT CONNECT TIME by the real fetch (publicOnlyFetch pins
//     the socket to the checked addresses, closing the DNS-rebinding gap);
//   - never itself (drawcast.app, or the host it is served from): a nested
//     ?url= chain would turn one request into many;
//   - redirects are followed by hand, at most 3, each Location re-checked by
//     the same rules;
//   - the answer must say `image/*` (and not SVG, which is a document that
//     can run script on this origin), and is at most 8 MB, counted as it
//     streams and abandoned past the limit;
//   - 8 s for the whole exchange;
//   - 300 requests an hour per client IP, every request counted.
//
// GET ?url=<https url>
//   -> 200 the bytes, upstream content-type, Cache-Control public 1 day,
//      CORS for the allow-list (+ Vary: Origin)
//   -> JSON {error} with 400 bad url, 403 not public, 405 not GET,
//      413 too big, 415 not an image, 429 (+ Retry-After), 502 upstream.
import { checkFailureBudget, defaultStore, recordFailure, type RateStore } from "../lib/rate-limit.mts";
import { checkPublicHost, publicOnlyFetch, type ResolveAll } from "../lib/public-host.mts";
import { lookup as dnsLookup } from "node:dns/promises";

export const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const BUDGET = { windowMs: 60 * 60 * 1000, maxFailures: 300 };
const ALLOWED_ORIGINS = ["https://drawcast.app", "https://hmelberg.github.io", "http://localhost:5173", "http://localhost:8888"];

export interface PictureDeps {
  /** Must not follow redirects on its own (it is called with redirect: "manual"). */
  fetch: typeof fetch;
  lookup: ResolveAll;
  rateStore: () => RateStore;
  now: () => number;
  clientIp: (req: Request) => string;
}

/** Netlify sets x-nf-client-connection-ip and a client cannot forge it; x-forwarded-for can be, so it is not a fallback (as keys.mts). */
export function defaultClientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? "";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(req: Request, body: { error: string }, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Cache-Control": "no-store", "content-type": "application/json", ...extra },
  });
}

/** The URL if it is one this proxy may fetch by shape (https, no credentials, default port); else null. The host is judged separately. */
function httpsUrl(raw: string, base?: URL): URL | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  return u;
}

class Refusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The body, at most MAX_BYTES, read chunk by chunk; past the limit the read is cancelled and a 413 thrown. */
async function readCapped(res: Response): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new Refusal(413, "too large");
  }
  if (!res.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Refusal(413, "too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The proxy never fetches from itself: a nested ?url= chain would multiply one request into many. */
function isSelf(u: URL, req: Request): boolean {
  const h = u.hostname.toLowerCase().replace(/\.+$/, "");
  const own = new URL(req.url).hostname.toLowerCase();
  return h === own || h === "drawcast.app" || h.endsWith(".drawcast.app");
}

function isImageType(type: string): boolean {
  const t = type.split(";")[0].trim().toLowerCase();
  return t.startsWith("image/") && !t.includes("svg") && !t.includes("xml");
}

export async function handlePictureRequest(req: Request, deps: PictureDeps): Promise<Response> {
  if (req.method !== "GET") return json(req, { error: "method" }, 405, { Allow: "GET" });

  // Every request counts, good or bad: the budget bounds what one address can make this server fetch.
  const id = `picture:${deps.clientIp(req)}`;
  const limiter = { ...BUDGET, store: deps.rateStore, now: deps.now };
  const budget = await checkFailureBudget(id, limiter);
  if (!budget.allowed) return json(req, { error: "rate limited" }, 429, { "Retry-After": String(budget.retryAfterSeconds) });
  await recordFailure(id, limiter);

  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let target = httpsUrl(raw);
  if (!target) return json(req, { error: "url must be https" }, 400);
  if (isSelf(target, req) || !(await checkPublicHost(target.hostname, deps.lookup))) return json(req, { error: "host is not public" }, 403);

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await deps.fetch(target.href, {
        redirect: "manual",
        signal,
        headers: { accept: "image/*", "user-agent": "drawcast-picture-proxy (+https://drawcast.app)" },
      });
      if (res.status < 300 || res.status > 399) break;
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      if (!location) throw new Refusal(502, "redirect without a location");
      if (hop >= MAX_REDIRECTS) throw new Refusal(502, "too many redirects");
      const next = httpsUrl(location, target);
      if (!next) throw new Refusal(403, "redirect is not to an https url");
      if (isSelf(next, req) || !(await checkPublicHost(next.hostname, deps.lookup))) throw new Refusal(403, "redirect host is not public");
      target = next;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Refusal(502, `upstream ${res.status}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!isImageType(type)) {
      await res.body?.cancel().catch(() => {});
      throw new Refusal(415, "not an image");
    }
    const bytes = await readCapped(res);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders(req),
        "content-type": type,
        "Cache-Control": "public, max-age=86400",
        // Opened directly, the answer is inert: no script, no plugins, a unique origin.
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof Refusal) return json(req, { error: e.message }, e.status);
    return json(req, { error: "upstream unreachable" }, 502);
  }
}

export default async (req: Request): Promise<Response> => {
  const lookup: ResolveAll = (hostname, options) => dnsLookup(hostname, options);
  return handlePictureRequest(req, {
    fetch: publicOnlyFetch(lookup),
    lookup,
    rateStore: defaultStore,
    now: () => Date.now(),
    clientIp: defaultClientIp,
  });
};

/**
 * No `config` export: src/render/image.ts calls the default
 * /.netlify/functions/picture URL (PICTURE_ENDPOINTS), and a `path` would move it.
 */
