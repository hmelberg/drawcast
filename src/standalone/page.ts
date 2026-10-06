// A drawcast as a web page of its own (2026-10-03): `<name>.html`, the
// player loaded from drawcast.app/play.js. Two kinds (CastPageArgs): a DOOR
// to the .cast beside it — what a GitHub publish writes, so the .cast stays
// the one copy and the page always plays what it says — and a COPY with the
// cast inside — Export → Web page, one file that plays wherever it is put.
// Either way there is no name lookup, and the cast's download starts with
// the page rather than after the player.
//
// A copy's cast sits in a <script> block the browser never runs. Its text is
// kept verbatim — readable, editable in place — except for the three
// sequences that could end or confuse a script block; `embedCastText`
// escapes them and `readEmbeddedCast` (play.ts) undoes it exactly.
//
// Both kinds carry the spoken lines as a Transcript section: crawlers do not
// read script blocks, and most run no JavaScript (standalone/transcript.ts).

import type { GhRef } from "../viewer";

/** Where a page loads the player from: stable name, the newest player. */
export const PLAYER_URL = "https://www.drawcast.app/play.js";
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

/**
 * The page comes in two kinds, one player for both:
 *
 * - `text` — the cast INSIDE the page (Export → Web page): one file that
 *   plays on its own wherever it is put or sent. A copy: it never changes.
 * - `src` — a DOOR to the .cast beside it (what a GitHub publish writes):
 *   the page is a few KB, the cast is stored once, and an edit to the .cast
 *   shows at once. The browser is told to fetch the .cast the moment the
 *   page arrives (a preload), alongside the player, so the extra request
 *   costs almost nothing.
 *
 * Exactly one of `text` / `src` is given.
 */
export type CastPageArgs = CastPageCommon & ({ text: string; src?: never } | { src: string; text?: never });

interface CastPageCommon {
  title: string;
  subtitle?: string;
  /** Absolute URL of the link-card picture (the poster beside the cast). */
  image?: string;
  /** The page's own absolute URL, for the link card. */
  url?: string;
  /** The published cast this page belongs to: its views, comments and
   *  relative links are that cast's. */
  from?: GhRef;
  /** The spoken lines, as the Transcript section (standalone/transcript.ts):
   *  what crawlers, screen readers and no-JavaScript readers get. */
  transcript?: string[];
  /** The words that introduce it (the cast's subtitle or founding question):
   *  shown under the page's heading, and its search description. */
  intro?: string;
  /** The narration's language — the page's lang, which search engines use
   *  to decide which searchers it is for. */
  lang?: string;
  level?: "basic" | "advanced";
  /** Who published it (the repo owner) and when (YYYY-MM-DD) — structured data. */
  author?: string;
  published?: string;
  /** Override for testing against a local build. */
  playerUrl?: string;
}

/** The Transcript section's element id: play.ts refreshes it from the cast it plays. */
export const TRANSCRIPT_ID = "drawcast-transcript";
/** The heading, introduction and transcript under the player. */
export const ABOUT_ID = "drawcast-about";

/** A meta description: one paragraph, cut at a word near 300 characters. */
function describe(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= 300) return one;
  const cut = one.slice(0, 300);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 200))}…`;
}

/**
 * schema.org's LearningResource, as JSON-LD: what search engines read to know
 * what the page IS. `<` is escaped so no value can end the script block.
 */
function structuredData(a: CastPageArgs, title: string, desc: string): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: title,
    description: desc,
    ...(a.lang ? { inLanguage: a.lang } : {}),
    ...(a.level ? { educationalLevel: a.level === "basic" ? "Beginner" : "Advanced" } : {}),
    learningResourceType: "Narrated drawing",
    isAccessibleForFree: true,
    ...(a.url ? { url: a.url } : {}),
    ...(a.image ? { image: a.image } : {}),
    ...(a.author ? { author: { "@type": "Person", name: a.author } } : {}),
    ...(a.published ? { datePublished: a.published, dateModified: a.published } : {}),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function castPageHtml(a: CastPageArgs): string {
  const title = a.title.trim() || "drawcast";
  const desc = describe(a.subtitle?.trim() || a.intro || a.transcript?.[0] || "A drawn explanation you can watch and play with");
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(a.lang ?? "") ? a.lang! : "en";
  const meta = [
    `<meta name="description" content="${esc(desc)}">`,
    ...(a.url ? [`<link rel="canonical" href="${esc(a.url)}">`] : []),
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="drawcast">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    ...(a.url ? [`<meta property="og:url" content="${esc(a.url)}">`] : []),
    ...(a.image ? [`<meta property="og:image" content="${esc(a.image)}">`, `<meta name="twitter:card" content="summary_large_image">`] : []),
    `<script type="application/ld+json">${structuredData(a, title, desc)}</script>`,
  ].join("\n");
  const from = a.from ? ` data-gh="${esc(`${a.from.owner}/${a.from.repo}/${a.from.path}`)}"` : "";
  const player = a.playerUrl ?? PLAYER_URL;
  // The door's fetch starts with the page, not after the player: same mode
  // and credentials as play.ts's fetch(), so the browser hands it over.
  const preload = a.src !== undefined ? `\n<link rel="preload" href="${esc(a.src)}" as="fetch" crossorigin>` : "";
  const block =
    a.src !== undefined
      ? `<!-- The drawcast is the .cast file beside this page; the page plays it. -->
<script type="text/x-drawcast" id="${CAST_BLOCK_ID}" data-src="${esc(a.src)}"${from}></script>`
      : `<!-- The drawcast itself (.cast). The page plays whatever is here. -->
<script type="text/x-drawcast" id="${CAST_BLOCK_ID}"${from}>
${embedCastText(a.text)}
</script>`;
  // The finished drawing while the player loads: something real on screen
  // at once, and the page's image for image search.
  const poster = a.image ? `<img src="${esc(a.image)}" alt="${esc(title)}">` : "";
  const transcript = a.transcript?.length
    ? `\n<details id="${TRANSCRIPT_ID}">
<summary>Transcript</summary>
${a.transcript.map((l) => `<p>${esc(l)}</p>`).join("\n")}
</details>`
    : "";
  // The heading and introduction search engines read first; under the
  // player, where the reader looks for more.
  const about = `<section id="${ABOUT_ID}">
<h1>${esc(title)}</h1>${a.intro ? `\n<p class="drawcast-intro">${esc(a.intro)}</p>` : ""}${transcript}
</section>`;
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${meta}
<link rel="icon" href="https://www.drawcast.app/mark.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">${preload}
<script type="module" src="${esc(player)}" crossorigin></script>
</head>
<body>
<style>
#boot { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; gap: 0.6rem; align-items: center; justify-content: center; color: #6f685c; font: 1.2rem "Patrick Hand", system-ui, sans-serif; background: #efe9da; }
#boot img { max-width: min(720px, 90vw); max-height: 70vh; opacity: 0.45; }
@media (prefers-color-scheme: dark) { #boot { color: #a49b8b; background: #1c1a17; } }
/* The viewer lays the body out as one centred row (styles.css .viewer-body):
   wrap it, and give this section a row of its own at the player's width. */
body.viewer-body { flex-wrap: wrap; align-content: flex-start; }
/* One heading: this page's own, with its introduction, replaces the
   viewer's title line under the player. */
body.viewer-body .player-meta .player-title { display: none; }
#${ABOUT_ID} { flex: 0 0 min(960px, 96vw); box-sizing: border-box; margin: -1.6rem auto 3rem; padding: 0 0.2rem; font: 1rem/1.55 system-ui, sans-serif; color: inherit; }
#${ABOUT_ID} h1 { font: 1.5rem "Patrick Hand", system-ui, sans-serif; margin: 0.5rem 0 0.3rem; }
#${ABOUT_ID} p { max-width: 46rem; }
#${TRANSCRIPT_ID} summary { cursor: pointer; opacity: 0.75; }
</style>
<div id="boot" role="status">${poster}<span>Loading…</span></div>
<div id="app"></div>
<noscript><style>#boot { display: none; }</style><p>This drawcast needs JavaScript to play; its transcript is below.</p></noscript>
${about}
${block}
</body>
</html>
`;
}
