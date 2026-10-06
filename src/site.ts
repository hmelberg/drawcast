// The site's address (2026-10-06: www.drawcast.app became the primary
// domain, for wildcard subdomains; drawcast.app redirects there). Links and
// absolute URLs use SITE.
//
// liveUrl: drawcast's own functions and files, fetched. On drawcast's own
// hosts they are asked for on the page's own origin — the apex and www both
// serve the same site, and a request to the other one would meet a redirect
// without the cross-site headers a fetch needs. Anywhere else (local dev,
// GitHub Pages) the live site is asked, absolutely.
export const SITE = "https://www.drawcast.app";

export function liveUrl(path: string, host: string = typeof location !== "undefined" ? location.hostname : ""): string {
  const own = host === "drawcast.app" || host.endsWith(".drawcast.app") || host.endsWith(".netlify.app");
  return own ? path : `${SITE}${path}`;
}
