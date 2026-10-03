// The player a drawcast page loads (standalone/page.ts): drawcast.app/play.js,
// a second entry of the app build (vite.config.ts) whose relative chunk URLs
// let it run from any site. It takes the cast from the page — inside it (a
// copy) or beside it (a door, data-src) — with nothing to look up, and hands
// it to the same viewer a #gh= link opens.
//
// The viewer is imported dynamically, not statically: its stylesheet then
// rides in that chunk and Vite injects it, where a static import would
// leave the entry's CSS as a file only an index.html could link.

import { CAST_BLOCK_ID, TRANSCRIPT_ID, readEmbeddedCast } from "./standalone/page";

/** The page writes one newline on each side of the cast; the cast is what is between. */
export function castFromBlock(raw: string): string {
  return readEmbeddedCast(raw.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
}

/** The message a page shows instead of a drawing — never a blank page. */
function showProblem(text: string): void {
  document.body.classList.add("viewer-body");
  const p = document.createElement("p");
  p.className = "viewer-status error";
  p.textContent = text;
  document.body.append(p);
}

/** A door's cast (data-src), fetched at once: the page's preload is already
 *  under way, and this same request picks it up rather than starting over. */
function fetchDoor(src: string): Promise<string> {
  return fetch(new URL(src, location.href)).then((res) => {
    if (!res.ok) throw new Error(`Could not load ${src} (HTTP ${res.status}) — a just-published file can take a minute to appear.`);
    return res.text();
  });
}

async function play(): Promise<void> {
  const block = document.getElementById(CAST_BLOCK_ID);
  const src = block?.dataset.src;
  // Started before the viewer import, so the two downloads overlap.
  const door = src ? fetchDoor(src) : null;
  const viewer = import("./viewer");
  let text = "";
  try {
    text = door ? await door : block ? castFromBlock(block.textContent ?? "") : "";
  } catch (err) {
    document.getElementById("boot")?.remove();
    showProblem((err as Error).message);
    return;
  }
  const { ghRefFrom, runViewer, viewerOptions } = await viewer;
  document.getElementById("boot")?.remove();
  if (!document.getElementById("app")) document.body.append(Object.assign(document.createElement("div"), { id: "app" }));
  if (!text.trim()) {
    showProblem(`This page has no drawcast in it (no <script id="${CAST_BLOCK_ID}">).`);
    return;
  }
  // A door plays the .cast as it is NOW, which may be newer than the page:
  // its transcript follows, for the people reading it (crawlers keep the
  // published one until the next publish).
  if (door) void refreshTranscript(text);
  const gh = ghRefFrom(block?.dataset.gh);
  // The page's own address may still carry playback options: page.html#mode=silent&speed=1.5.
  const options = viewerOptions(new URLSearchParams(location.hash.replace(/^#/, "")));
  await runViewer({ embedded: text, ...(gh ? { gh } : {}), ...options });
}

async function refreshTranscript(text: string): Promise<void> {
  const section = document.getElementById(TRANSCRIPT_ID);
  if (!section) return;
  try {
    const { transcriptLines, transcriptHtml } = await import("./standalone/transcript");
    const lines = transcriptLines(text);
    if (lines.length === 0) return;
    const summary = section.querySelector("summary");
    section.innerHTML = transcriptHtml(lines);
    if (summary) section.prepend(summary);
  } catch {
    /* the published transcript stays */
  }
}

if (typeof document !== "undefined") void play();
