// Key vending: exchanges the shared password for the real API keys.
// Secrets live ONLY in Netlify env vars (no VITE_ prefix — never bundled):
//   DRAWCAST_PASSWORD  — the shared password
//   ANTHROPIC_API_KEY  — vended to the client on success
//   GOOGLE_API_KEY     — vended to the client on success (TTS)
// Uniform 401 for wrong password AND malformed requests (no oracle).
// CORS: same-origin Netlify deploys need none of this, but the GitHub Pages
// deploy calls cross-origin, so allow the known origins explicitly.

import { createHash, timingSafeEqual } from "node:crypto";
import { checkFailureBudget, recordFailure } from "../lib/rate-limit.mts";

/** Injected so the vending logic and the limiter can be tested apart. */
export interface KeysDeps {
  checkBudget: (id: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  recordFailure: (id: string) => Promise<void>;
  clientIp: (req: Request) => string;
}

/**
 * Netlify sets x-nf-client-connection-ip itself and a client cannot forge it.
 * x-forwarded-for CAN be forged, so it is deliberately not a fallback —
 * honouring it would let one attacker rotate through fake IPs to dodge the
 * budget entirely.
 */
export function defaultClientIp(req: Request): string {
  return req.headers.get("x-nf-client-connection-ip") ?? "";
}

const ALLOWED_ORIGINS = ["https://hmelberg.github.io", "http://localhost:5173", "http://localhost:8888"];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

/** Constant-time equality via digest comparison (also hides length). */
function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash("sha256").update(supplied, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function handleKeysRequest(req: Request, deps: KeysDeps): Promise<Response> {
  const headers = { ...corsHeaders(req), "content-type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });

  const expected = process.env.DRAWCAST_PASSWORD;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!expected || !anthropicKey) {
    return new Response(JSON.stringify({ error: "vending disabled" }), { status: 503, headers });
  }

  // Budget check first: a throttled caller never reaches the comparison.
  const ip = deps.clientIp(req);
  const budget = await deps.checkBudget(ip);
  if (!budget.allowed) {
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) },
    });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    /* uniform 401 below */
  }

  if (!password || !passwordMatches(password, expected)) {
    // Only failures are charged, so knowing the password never locks you out.
    await deps.recordFailure(ip);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ anthropicKey, googleKey: googleKey ?? "" }), { status: 200, headers });
}

export default async (req: Request): Promise<Response> =>
  handleKeysRequest(req, {
    checkBudget: (id) => checkFailureBudget(id),
    recordFailure: (id) => recordFailure(id),
    clientIp: defaultClientIp,
  });

/**
 * No `config` export at all: src/keys.ts posts to the default
 * /.netlify/functions/keys URL, and setting a `path` would move the endpoint.
 *
 * Netlify's built-in `config.rateLimit` was tried here first. It is in the
 * type definitions but does nothing on these sites — measured 2026-08-24
 * against xplainer, 75 consecutive wrong passwords all returned 401 and never
 * 429 — so the limit lives in the handler instead, backed by Blobs.
 */
