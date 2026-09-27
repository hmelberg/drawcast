// The wildcard host's one job: send NAME.drawcast.app to drawcast.app/#name.
// Everything else — the apex, www, Netlify's own hosts — passes through.
// Setup outside the repo: `*.drawcast.app` added as a domain alias in
// Netlify (DNS is on Netlify, so the wildcard certificate is issued there).
//
// The view origin (security review 2026-09-28, step 2): when the site env
// sets VITE_VIEW_ORIGIN, that host is never taken for a name, and its pages
// may be framed (it holds no secrets) — docs/security/2026-09-28-viewer-origin.md.
import { APEX, bareHost, hostToHash, viewFramePolicy, viewHostOf } from "../lib/name-host.mts";

declare const Netlify: { env: { get(name: string): string | undefined } } | undefined;

function configuredViewHost(): string {
  try {
    return viewHostOf(typeof Netlify !== "undefined" ? Netlify.env.get("VITE_VIEW_ORIGIN") : undefined);
  } catch {
    return "";
  }
}

export default async function nameHost(request: Request, context: { next(): Promise<Response> }): Promise<Response> {
  const host = new URL(request.url).host;
  const viewHost = configuredViewHost();
  const target = hostToHash(host, APEX, viewHost);
  if (target !== null) return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
  if (viewHost === "" || bareHost(host) !== viewHost) return context.next();
  const res = await context.next();
  const csp = res.headers.get("content-security-policy");
  if (!csp) return res;
  const headers = new Headers(res.headers);
  headers.set("content-security-policy", viewFramePolicy(csp));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const config = { path: "/*" };
