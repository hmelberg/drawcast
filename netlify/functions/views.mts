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

export interface ViewsDeps {
  /** Records one view and answers with the resulting count. */
  record: (key: string) => Promise<number>;
  readCast: (key: string) => Promise<CastCount>;
  readRepo: (owner: string, repo: string) => Promise<RepoCounts>;
}

/**
 * Writes are origin-checked; reads are not. This is a speed bump, not a
 * boundary — anyone can forge an Origin header — but it costs nothing and
 * stops idle curl inflation. drawcast.app is listed even though it is
 * same-origin, because the check reads the header rather than trusting CORS.
 */
const ALLOWED_ORIGINS = [
  "https://drawcast.app",
  "https://hmelberg.github.io",
  "http://localhost:5173",
  "http://localhost:8888",
];

const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });

export async function handleViewsRequest(req: Request, deps: ViewsDeps): Promise<Response> {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (req.method === "POST") {
    const origin = req.headers.get("origin") ?? "";
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, headers);
    const key = (await req.text()).trim();
    if (!isValidCastKey(key)) return json({ error: "key" }, 400, headers);
    try {
      return json({ count: await deps.record(key) }, 200, headers);
    } catch {
      // A counting outage is not the player's problem: answer 200 with no
      // number so the badge simply stays hidden.
      return json({ count: null }, 200, headers);
    }
  }

  if (req.method !== "GET") return json({ error: "method" }, 405, headers);

  const url = new URL(req.url);
  const cast = url.searchParams.get("cast");
  const repo = url.searchParams.get("repo");

  if (cast) {
    if (!isValidCastKey(cast)) return json({ error: "key" }, 400, headers);
    try {
      return json({ count: (await deps.readCast(cast)).total }, 200, headers);
    } catch {
      return json({ count: null }, 200, headers);
    }
  }

  if (repo) {
    const m = REPO_RE.exec(repo);
    if (!m) return json({ error: "repo" }, 400, headers);
    const counts = await deps.readRepo(m[1], m[2]);
    return json(counts, 200, { ...headers, "Cache-Control": "public, max-age=60" });
  }

  return json({ error: "ask for ?cast= or ?repo=" }, 400, headers);
}

export default async (req: Request): Promise<Response> =>
  handleViewsRequest(req, {
    record: (key) => recordAndCount(key),
    readCast: (key) => countCast(key),
    readRepo: (owner, repo) => countRepo(owner, repo),
  });
