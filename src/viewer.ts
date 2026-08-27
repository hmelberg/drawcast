// Standalone viewer mode: #gdoc=<google-doc-id> loads a spec or a playlist
// (a multi-document YAML stream) from a link-shared Google Doc and shows just
// a player — no editor, no AI, no key. Extra hash params: &style=sketchy
// &mode=silent &speed=1.5 &advance=auto (kiosk: never wait for clicks).
// Example: https://…/drawcast/#gdoc=1AbC…xyz

import "./styles.css";
import { type RenderStyle } from "./render";
import { CloudSpeech } from "./export/tts";
import { h } from "./ui/dom";
import { attachParamsTray } from "./ui/tray";
import { parsePlaylistText, itemsOf } from "./playlist/playlist";
import { mountPlaylist, playlistSpeakLines } from "./playlist/session";
import { validateSpec } from "./spec/schema";
import { getTtsKey, loadSettings } from "./store";

export interface ViewerRequest {
  docId: string;
  style: RenderStyle;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  /** Override of the playlist's advance mode (kiosk/loop playback). */
  advance?: "click" | "auto";
}

/** Accepts #gdoc=<id> and #gdoc-<id>, with optional &style= &mode= &speed= &advance=. */
export function parseViewerHash(hash: string): ViewerRequest | null {
  const m = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(hash.replace(/^#/, "").replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1"));
  const mode = params.get("mode");
  // Legacy draw links used &backend=custom-svg / clean-svg; map them.
  const styleParam = params.get("style") ?? params.get("backend");
  const advance = params.get("advance");
  return {
    docId: m[1],
    style: styleParam === "sketchy" || styleParam === "custom-svg" ? "sketchy" : "clean",
    mode: mode === "silent" || mode === "instant" ? mode : "narrated",
    speed: parseFloat(params.get("speed") ?? "") || loadSettings().speed || 1,
    advance: advance === "auto" || advance === "click" ? advance : undefined,
  };
}

/** Fetch the doc text via the public export endpoints (doc must be link-shared). */
async function fetchGdocText(docId: string): Promise<string> {
  const urls = [
    `https://docs.google.com/document/d/${docId}/export?format=txt`,
    `https://docs.google.com/feeds/download/documents/export/Export?id=${docId}&exportFormat=txt`,
  ];
  let lastError = "";
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  throw new Error(
    `Could not fetch the Google Doc (${lastError}). Make sure sharing is set to "Anyone with the link can view" (Share → General access).`,
  );
}

export async function runViewer(req: ViewerRequest): Promise<void> {
  document.body.classList.add("viewer-body");
  const app = document.getElementById("app")!;
  const titleEl = h("h1", { class: "viewer-title squiggle" }, "drawcast");
  const status = h("div", { class: "viewer-status" }, "Loading drawing from Google Doc…");
  const figureHost = h("div", { class: "viewer-figure" });
  const footer = h(
    "div",
    { class: "viewer-footer" },
    h("a", { href: location.pathname, title: "Open the drawcast app" }, "Made with drawcast ✏️"),
  );
  app.append(h("div", { class: "viewer-wrap" }, titleEl, status, figureHost, footer));

  try {
    const text = await fetchGdocText(req.docId);
    const playlist = parsePlaylistText(text);
    const items = itemsOf(playlist);
    if (items.length === 0) throw new Error("The document contains no drawable items.");
    for (const item of items) {
      const validation = validateSpec(item.spec);
      if (!validation.ok) {
        const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
        throw new Error(`The document's spec is invalid: ${where}${validation.errors[0]}${validation.errors.length > 1 ? ` (+${validation.errors.length - 1} more)` : ""}`);
      }
    }
    const title = playlist.meta.title ?? items[0].spec.title;
    if (title) {
      titleEl.textContent = title;
      document.title = `${title} — drawcast`;
    }
    const settings = loadSettings();
    const speech = new CloudSpeech(() => (settings.cloudPlayback ? getTtsKey() : ""));
    speech.setVoice(settings.voiceURI);
    speech.setRate(settings.rate);
    if (req.mode === "narrated") speech.prefetch(playlistSpeakLines(playlist), req.speed);
    await mountPlaylist(figureHost, playlist, {
      style: req.style,
      mode: req.mode,
      speed: req.speed,
      speech,
      prefs: { mode: req.mode, speed: req.speed },
      controls: { speech, fullscreenEl: figureHost },
      onItemMounted: (hd) => attachParamsTray(figureHost, hd),
      advanceOverride: req.advance,
    });
    status.remove();
  } catch (err) {
    status.textContent = (err as Error).message;
    status.classList.add("error");
  }
}
