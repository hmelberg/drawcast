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

/** Hrefs already handed to the decoder. A data URI is a long string, so the
 *  set is dropped whole once it grows past this — a cleared set costs at
 *  most one redundant decode (the browser's own image cache still has the
 *  bytes), an uncleared one would hold every figure a session ever ran. */
const MAX_REMEMBERED = 256;
const decoded = new Set<string>();

/** Decode every figure in one code-result envelope. A no-op outside the
 *  browser (node has no `Image`), on an envelope that will not parse, and on
 *  hrefs this session has already decoded. */
export async function decodeFigures(result: string | undefined): Promise<void> {
  if (typeof Image === "undefined") return;
  const figures = decodeCodeResult(result)?.figures ?? [];
  if (figures.length === 0) return;
  const pending: Promise<unknown>[] = [];
  for (const f of figures) {
    const href = f?.href;
    if (!href || decoded.has(href)) continue;
    if (decoded.size >= MAX_REMEMBERED) decoded.clear();
    decoded.add(href);
    try {
      const img = new Image();
      img.src = href;
      if (typeof img.decode === "function") pending.push(img.decode().catch(() => {}));
    } catch {
      /* an Image that cannot even be built: let the <image> element try */
    }
  }
  await Promise.all(pending);
}
