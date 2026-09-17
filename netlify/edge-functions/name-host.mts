// The wildcard host's one job: send NAME.drawcast.app to drawcast.app/#name.
// Everything else — the apex, www, Netlify's own hosts — passes through.
// Setup outside the repo: `*.drawcast.app` added as a domain alias in
// Netlify (DNS is on Netlify, so the wildcard certificate is issued there).
import { hostToHash } from "../lib/name-host.mts";

export default async function nameHost(request: Request, context: { next(): Promise<Response> }): Promise<Response> {
  const target = hostToHash(new URL(request.url).host);
  if (target === null) return context.next();
  return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
}

export const config = { path: "/*" };
