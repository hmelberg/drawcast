// A lazily loaded part of the app (a code runtime, a template engine, a pack)
// that fails to load almost always means the app was redeployed while this
// page stayed open: the page still asks for the old hashed chunk names, which
// no longer exist. Browsers word it three ways; none of them tells a viewer
// what to do ("error loading dynamically imported module", Hans 2026-09-26).

const STALE = /error loading dynamically imported module|failed to fetch dynamically imported module|importing a module script failed|unable to preload/i;

export const STALE_CHUNK_MESSAGE = "drawcast was updated since this page was opened — reload the page to load this part.";

/** True when an error message is the browser's failed-dynamic-import error. */
export function isStaleChunkError(message: string | undefined): boolean {
  return STALE.test(message ?? "");
}
