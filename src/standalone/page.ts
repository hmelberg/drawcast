// A drawcast as its own web page (2026-10-03): `<name>.html`, the cast's text
// inside the page and the player loaded from drawcast.app/play.js. Opening it
// costs one page fetch plus the (cached) player — no name lookup, no second
// fetch for the cast — and the page can live anywhere: beside the .cast on
// GitHub Pages (publish/cast.ts writes one), on the author's own site, in a
// course platform.
//
// The cast sits in a <script> block the browser never runs. Its text is kept
// verbatim — readable, editable in place — except for the three sequences
// that could end or confuse a script block; `embedCastText` escapes them and
// `readEmbeddedCast` (play.ts) undoes it exactly.

import type { GhRef } from "../viewer";

/** Where a page loads the player from: stable name, the newest player. */
export const PLAYER_URL = "https://drawcast.app/play.js";
/** The element id the player looks for. */
export const CAST_BLOCK_ID = "drawcast-cast";

/**
 * `<\` → `<\\`, `</script` → `<\/script`, `<!--` → `<\!--`. The first rule
 * makes the other two reversible: an escaped `<\` never occurs in the output
 * except as one of these three, so `readEmbeddedCast` reads each back.
 */
export function embedCastText(text: string): string {
  return text.replace(/<\\/g, "<\\\\").replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

export function readEmbeddedCast(text: string): string {
  return text.replace(/<\\([\\/!])/g, "<$1");
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface CastPageArgs {
  /** The cast file's text, exactly as published (baked narration and all). */
  text: string;
  title: string;
  subtitle?: string;
  /** Absolute URL of the link-card picture (the poster beside the cast). */
  image?: string;
  /** The page's own absolute URL, for the link card. */
  url?: string;
  /** The published cast this page is a copy of: its views, comments and
   *  relative links stay those of the cast on GitHub. */
  from?: GhRef;
  /** Override for testing against a local build. */
  playerUrl?: string;
}

export function castPageHtml(a: CastPageArgs): string {
  const title = a.title.trim() || "drawcast";
  const desc = a.subtitle?.trim() || "A drawn explanation you can watch and play with";
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="drawcast">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta name="description" content="${esc(desc)}">`,
    ...(a.url ? [`<meta property="og:url" content="${esc(a.url)}">`] : []),
    ...(a.image ? [`<meta property="og:image" content="${esc(a.image)}">`, `<meta name="twitter:card" content="summary_large_image">`] : []),
  ].join("\n");
  const from = a.from ? ` data-gh="${esc(`${a.from.owner}/${a.from.repo}/${a.from.path}`)}"` : "";
  const player = a.playerUrl ?? PLAYER_URL;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta}
<link rel="icon" href="https://drawcast.app/mark.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">
<script type="module" src="${esc(player)}" crossorigin></script>
</head>
<body>
<style>
#boot { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; color: #6f685c; font: 1.2rem "Patrick Hand", system-ui, sans-serif; background: #efe9da; }
@media (prefers-color-scheme: dark) { #boot { color: #a49b8b; background: #1c1a17; } }
</style>
<div id="boot" role="status">Loading…</div>
<div id="app"></div>
<noscript>This drawcast needs JavaScript. The cast itself is in this page's source.</noscript>
<!-- The drawcast itself (.cast). The page plays whatever is here. -->
<script type="text/x-drawcast" id="${CAST_BLOCK_ID}"${from}>
${embedCastText(a.text)}
</script>
</body>
</html>
`;
}
