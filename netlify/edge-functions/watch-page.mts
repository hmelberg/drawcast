// drawcast.app/w/<name>: the app's page with this drawcast's head
// (netlify/lib/watch-page.mts says why). The registry is asked for the title
// with a short timeout; a slow or failed answer still serves a working page.
import { metaFromCatalogue, watchHead, watchName, type WatchMeta } from "../lib/watch-page.mts";

const REGISTRY = "https://drawcast.anvil.app/_/api/catalogue";

async function lookup(name: string): Promise<WatchMeta | null> {
  try {
    const base = name.split("/", 1)[0];
    const res = await fetch(`${REGISTRY}?names=${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? metaFromCatalogue(await res.json(), name) : null;
  } catch {
    return null;
  }
}

export default async function watchPage(request: Request, context: { next(): Promise<Response> }): Promise<Response> {
  const name = watchName(new URL(request.url).pathname);
  if (name === null) return context.next();
  const [res, meta] = await Promise.all([context.next(), lookup(name)]);
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(watchHead(await res.text(), name, meta), { status: 200, headers });
}

export const config = { path: "/w/*" };
