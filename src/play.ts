// The player a drawcast page loads (standalone/page.ts): drawcast.app/play.js,
// a second entry of the app build (vite.config.ts) whose relative chunk URLs
// let it run from any site. It reads the cast out of the page — nothing to look up, nothing to
// fetch — and hands it to the same viewer a #gh= link opens.
//
// The viewer is imported dynamically, not statically: its stylesheet then
// rides in that chunk and Vite injects it, where a static import would
// leave the entry's CSS as a file only an index.html could link.

import { CAST_BLOCK_ID, readEmbeddedCast } from "./standalone/page";

/** The page writes one newline on each side of the cast; the cast is what is between. */
export function castFromBlock(raw: string): string {
  return readEmbeddedCast(raw.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
}

async function play(): Promise<void> {
  const block = document.getElementById(CAST_BLOCK_ID);
  const text = block ? castFromBlock(block.textContent ?? "") : "";
  const { ghRefFrom, runViewer, viewerOptions } = await import("./viewer");
  document.getElementById("boot")?.remove();
  if (!document.getElementById("app")) document.body.append(Object.assign(document.createElement("div"), { id: "app" }));
  if (!text.trim()) {
    document.body.classList.add("viewer-body");
    const p = document.createElement("p");
    p.className = "viewer-status error";
    p.textContent = `This page has no drawcast in it (no <script id="${CAST_BLOCK_ID}">).`;
    document.body.append(p);
    return;
  }
  const gh = ghRefFrom(block?.dataset.gh);
  // The page's own address may still carry playback options: page.html#mode=silent&speed=1.5.
  const options = viewerOptions(new URLSearchParams(location.hash.replace(/^#/, "")));
  await runViewer({ embedded: text, ...(gh ? { gh } : {}), ...options });
}

if (typeof document !== "undefined") void play();
