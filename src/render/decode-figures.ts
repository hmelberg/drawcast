// Decoding a run's figures BEFORE they are put on screen.
//
// Why this exists: a preview repaint rebuilds every node (swapGeometry in
// render/svg-backend.ts), so the output pane gets a BRAND NEW <image> whose
// href is a fresh data URI — and a fresh <image> paints nothing at all until
// the browser has decoded the PNG. On a sweep that is one white flash per
// step; on a knob drag, one per run. Decoding the PNG first (the image is
// then in the decoded-image cache, and the same data URI on a later node is
// served from it) means the new node has something to paint on its first
// frame.
//
// Pure side effect, no return value, every error swallowed: a figure that
// will not decode is not a reason to hold up the frame — the <image> will
// simply do what it did before.
import { decodeCodeResult } from "../code/envelope";
import { stableHash } from "./sweep";

/** Figures already handed to the decoder, by a SHORT key (length + hash of
 *  the data URI, never the URI itself — holding those would keep every PNG a
 *  session ever ran alive in memory). The value is the decode itself, so a
 *  second caller for the same figure awaits the SAME work instead of
 *  returning early on a decode that has not finished yet. Dropped whole once
 *  it grows past the cap; a cleared memo costs at most one redundant decode,
 *  since the browser's own image cache still holds the bytes. */
const MAX_REMEMBERED = 256;
const decoded = new Map<string, Promise<void>>();
const keyOf = (href: string): string => `${href.length}:${stableHash(href)}`;

/** Decode every figure in one code-result envelope. A no-op outside the
 *  browser (node has no `Image`), on an envelope that will not parse, and on
 *  hrefs this session has already decoded. */
export async function decodeFigures(result: string | undefined): Promise<void> {
  if (typeof Image === "undefined") return;
  const figures = decodeCodeResult(result)?.figures ?? [];
  if (figures.length === 0) return;
  const pending: Promise<void>[] = [];
  for (const f of figures) {
    const href = f?.href;
    if (!href) continue;
    const key = keyOf(href);
    const already = decoded.get(key);
    if (already) {
      pending.push(already);
      continue;
    }
    if (decoded.size >= MAX_REMEMBERED) decoded.clear();
    let work = Promise.resolve();
    try {
      const img = new Image();
      img.src = href;
      if (typeof img.decode === "function") work = img.decode().then(() => {}, () => {});
    } catch {
      /* an Image that cannot even be built: let the <image> element try */
    }
    decoded.set(key, work);
    pending.push(work);
  }
  await Promise.all(pending);
}
