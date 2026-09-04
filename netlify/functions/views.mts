// View counting: one endpoint, no secrets, no auth.
//
//   POST  body = the cast key (text/plain)  → record one view, answer {count}
//   GET   ?cast=<key>                        → {count}, no write
//   GET   ?repo=<owner>/<name>               → every cast in that repo
//
// Reads are deliberately PUBLIC but KEYED: you must name a repo. drawcast.app
// is a shared viewer, so a "list everything" endpoint would expose other
// people's publishing; scoping to a named repo leaks nothing that is not
// already public on GitHub.
//
// text/plain for the POST body is not laziness: it is CORS-safelisted, so the
// GitHub Pages deploy's cross-origin POST is a simple request with no
// preflight — one round trip on the path that runs for every view.
import { countCast, countRepo, recordAndCount, type CastCount, type RepoCounts } from "../lib/view-store.mts";
import { isValidCastKey } from "../lib/view-key.mts";
import { checkFailureBudget, recordFailure } from "../lib/rate-limit.mts";

export interface ViewsDeps {
  /** Records one view and answers with the resulting count. */
  record: (key: string) => Promise<number>;
  readCast: (key: string) => Promise<CastCount>;
  readRepo: (owner: string, repo: string) => Promise<RepoCounts>;
  /** Read-only: may a POST from this IP proceed? See "the per-IP write budget" below. */
  checkWriteBudget: (ip: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  /** Charges the budget. Called only once a write has actually landed. */
  recordWrite: (ip: string) => Promise<void>;
  clientIp: (req: Request) => string;
}

/**
 * Writes are origin-checked; reads are not. This is a speed bump, not a
 * boundary — anyone can forge an Origin header — but it costs nothing and
 * stops idle curl inflation. drawcast.app is listed even though it is
 * same-origin, because the check reads the header rather than trusting CORS.
 *
 * The two localhost origins are a dev convenience ONLY: without gating them,
 * a local build pointed at the live function (easy to do by accident — the
 * env var that would stop it is the exception, not the rule locally) writes
 * straight into the production store. Netlify sets `CONTEXT` itself on every
 * deploy ("production" | "deploy-preview" | "branch-deploy" | "dev"), so this
 * reads that rather than trusting anything the request supplies. Fails OPEN
 * (localhost allowed) when CONTEXT is unset, so a runtime this file did not
 * anticipate degrades to today's behaviour rather than silently switching
 * counting off for everyone.
 */
function allowedOrigins(): string[] {
  const base = ["https://drawcast.app", "https://hmelberg.github.io"];
  if (process.env.CONTEXT === "production") return base;
  return [...base, "http://localhost:5173", "http://localhost:8888"];
}

const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Netlify sets x-nf-client-connection-ip itself and a client cannot forge
 * it — identical rule and reasoning to defaultClientIp in
 * netlify/functions/keys.mts; x-forwarded-for is deliberately not a
 * fallback, since honouring it would let one caller dodge the budget by
 * rotating through fake IPs.
 */
export function defaultClientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? "";
}

/**
 * A per-IP cap on POST, since allowedOrigins() above is only a speed bump —
 * a forged or script-driven Origin from an allowed host sails past it. This
 * reuses netlify/lib/rate-limit.mts, the same sliding-window limiter
 * keys.mts guards the password endpoint with. Despite that module's
 * password-flavoured naming (checkFailureBudget/recordFailure), the
 * mechanism is a generic "at most N events per window" counter; here it
 * counts successful writes, never failures — a bad request is refused by
 * validation below and never reaches recordWrite.
 *
 * "views:" prefixes the id passed to the limiter so this budget's Blobs keys
 * never collide with keys.mts's password-failure keys, even though both run
 * through the very same rate-limits store under the very same client IPs.
 *
 * This exists to bound per-IP KEY GROWTH in Blobs — one address hammering
 * the store, not the accuracy of anyone's count — because the actual defence
 * against that cost tail is the parallelised compaction drain (view-store's
 * DELETE_CONCURRENCY / DEFAULT_DELETE_BUDGET): this cap is defence in depth
 * behind it, not the primary bound.
 *
 * That is also why it is set this high rather than tuned tight: drawcast's
 * primary use case is university lecture views, and a lecture hall or campus
 * behind one shared NAT can legitimately produce thousands of real views an
 * hour across a handful of lectures. Undercounting real views by throttling
 * them is the one failure this feature cannot have — the whole point of a
 * view count is that it can be trusted — so this errs generous and exists
 * only to stop pathological abuse (a curl loop hammering one cast), never to
 * throttle real classroom use.
 */
const VIEW_WRITE_BUDGET = { windowMs: 60 * 60 * 1000, maxFailures: 2000 };

export function viewBudgetId(ip: string): string {
  return `views:${ip}`;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(allowedOrigins().includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });

export async function handleViewsRequest(req: Request, deps: ViewsDeps): Promise<Response> {
  let headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (req.method === "POST") {
    const origin = req.headers.get("origin") ?? "";
    if (!allowedOrigins().includes(origin)) return json({ error: "origin" }, 403, headers);

    // Checked before touching the body, exactly like keys.mts checks its
    // password-failure budget before comparing the password: a throttled
    // caller never reaches storage.
    const ip = deps.clientIp(req);
    const budget = await deps.checkWriteBudget(ip);
    if (!budget.allowed) {
      return json({ error: "rate limited" }, 429, { ...headers, "Retry-After": String(budget.retryAfterSeconds) });
    }

    const key = (await req.text()).trim();
    if (!isValidCastKey(key)) return json({ error: "key" }, 400, headers);
    try {
      const count = await deps.record(key);
      await deps.recordWrite(ip); // charged only once the write actually landed
      return json({ count }, 200, headers);
    } catch (e) {
      // A counting outage is not the player's problem: answer 200 with no
      // number so the badge simply stays hidden.
      console.warn(`record ${key} failed (allowing):`, e instanceof Error ? e.message : String(e));
      return json({ count: null }, 200, headers);
    }
  }

  if (req.method !== "GET") return json({ error: "method" }, 405, headers);

  // GET exposes nothing private — see the module comment: reads are public
  // but keyed. So unlike POST above, it gets a wildcard rather than the
  // origin allowlist, which is what lets a browser-based dashboard hosted
  // anywhere (the spec anticipates an Anvil client of ?repo=) actually read
  // the response instead of having it silently blocked by CORS.
  headers = { ...headers, "Access-Control-Allow-Origin": "*" };

  const url = new URL(req.url);
  const cast = url.searchParams.get("cast");
  const repo = url.searchParams.get("repo");

  if (cast) {
    if (!isValidCastKey(cast)) return json({ error: "key" }, 400, headers);
    try {
      return json({ count: (await deps.readCast(cast)).total }, 200, headers);
    } catch (e) {
      console.warn(`readCast ${cast} failed (allowing):`, e instanceof Error ? e.message : String(e));
      return json({ count: null }, 200, headers);
    }
  }

  if (repo) {
    const m = REPO_RE.exec(repo);
    if (!m) return json({ error: "repo" }, 400, headers);
    try {
      const counts = await deps.readRepo(m[1], m[2]);
      return json(counts, 200, { ...headers, "Cache-Control": "public, max-age=60" });
    } catch (e) {
      // The POST and ?cast= paths degrade silently: they serve the player, where a null
      // count simply hides the badge and playback continues. This path serves the author
      // reading their numbers, so a silent success-but-empty response would
      // indistinguishably report zero views during an outage—worse than an error.
      console.warn(`readRepo ${repo} failed (rejecting):`, e instanceof Error ? e.message : String(e));
      return json({ error: "unavailable" }, 503, headers);
    }
  }

  return json({ error: "ask for ?cast= or ?repo=" }, 400, headers);
}

export default async (req: Request): Promise<Response> =>
  handleViewsRequest(req, {
    record: (key) => recordAndCount(key),
    readCast: (key) => countCast(key),
    readRepo: (owner, repo) => countRepo(owner, repo),
    checkWriteBudget: (ip) => checkFailureBudget(viewBudgetId(ip), VIEW_WRITE_BUDGET),
    recordWrite: (ip) => recordFailure(viewBudgetId(ip), VIEW_WRITE_BUDGET),
    clientIp: defaultClientIp,
  });
