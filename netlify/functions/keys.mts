// Key vending: exchanges the shared password for the real API keys.
// Secrets live ONLY in Netlify env vars (no VITE_ prefix — never bundled):
//   DRAWCAST_PASSWORD  — the shared password
//   ANTHROPIC_API_KEY  — vended to the client on success
//   GOOGLE_API_KEY     — vended to the client on success (TTS)
// Uniform 401 for wrong password AND malformed requests (no oracle).
// CORS: same-origin Netlify deploys need none of this, but the GitHub Pages
// deploy calls cross-origin, so allow the known origins explicitly.

import { createHash, timingSafeEqual } from "node:crypto";

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

export default async (req: Request): Promise<Response> => {
  const headers = { ...corsHeaders(req), "content-type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method" }), { status: 405, headers });

  const expected = process.env.DRAWCAST_PASSWORD;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  if (!expected || !anthropicKey) {
    return new Response(JSON.stringify({ error: "vending disabled" }), { status: 503, headers });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    /* uniform 401 below */
  }

  if (!password || !passwordMatches(password, expected)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ anthropicKey, googleKey: googleKey ?? "" }), { status: 200, headers });
};
