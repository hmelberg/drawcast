// Where the drawcast on screen came from — what its links' relative
// targets (`./x.yaml`, `lecture:N`) are read against. One document plays at
// a time on a page (the viewer, the app's player), so this is page state:
// whoever opens a document sets it (viewer.ts for #gh=, main.ts for the dev
// ?open= and for a course lecture), and a document with no folder — a
// pasted cast, a Drive file, a new drawing — clears it.

import type { LinkBase } from "./resolve";

let current: LinkBase | null = null;
let base: string | null = null;

export function setLinkBase(b: LinkBase | null): void {
  current = b;
}

export function linkBase(): LinkBase | null {
  return current;
}

/** The player a link opens in: set by the app (Settings' viewer base), else
 *  this very page — the viewer and the app are one page, routed by hash. */
export function setViewerBase(url: string | null): void {
  base = url;
}

export function viewerBase(): string {
  if (base) return base;
  if (typeof location === "undefined") return "https://www.drawcast.app";
  return `${location.origin}${location.pathname.replace(/index\.html$/, "")}`.replace(/\/+$/, "");
}

/** How the app opens one of its own drawings (a local course's lecture) —
 *  registered by main.ts; the viewer has none, and such links do not arise
 *  there (a published course resolves to files, not drawing ids). */
let drawingOpener: ((id: string) => void) | null = null;

export function setDrawingOpener(fn: ((id: string) => void) | null): void {
  drawingOpener = fn;
}

export function openDrawingLink(id: string): void {
  drawingOpener?.(id);
}
