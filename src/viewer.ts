// Standalone viewer mode: #gdoc=<google-doc-id> loads a spec from a
// link-shared Google Doc and shows just a single player — no editor, no AI,
// no key. Extra hash params: &style=sketchy &mode=silent &speed=1.5.
// Example: https://…/drawcast/#gdoc=1AbC…xyz

import "./styles.css";
import { render, type RenderStyle } from "./render";
import { SpeechManager } from "./render/speech";
import { h } from "./ui/dom";
import { attachPlayerControls } from "./ui/controls";
import { desmartenJson, extractJson } from "./spec/extract";
import { validateSpec } from "./spec/schema";
import type { Spec } from "./spec/types";
import { loadSettings } from "./store";

export interface ViewerRequest {
  docId: string;
  style: RenderStyle;
  mode: "narrated" | "silent" | "instant";
  speed: number;
}

/** Accepts #gdoc=<id> and #gdoc-<id>, with optional &style= &mode= &speed=. */
export function parseViewerHash(hash: string): ViewerRequest | null {
  const m = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(hash.replace(/^#/, "").replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1"));
  const mode = params.get("mode");
  // Legacy draw links used &backend=custom-svg / clean-svg; map them.
  const styleParam = params.get("style") ?? params.get("backend");
  return {
    docId: m[1],
    style: styleParam === "sketchy" || styleParam === "custom-svg" ? "sketchy" : "clean",
    mode: mode === "silent" || mode === "instant" ? mode : "narrated",
    speed: parseFloat(params.get("speed") ?? "") || loadSettings().speed || 1,
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
    const spec = extractJson(desmartenJson(text)) as Spec;
    const validation = validateSpec(spec);
    if (!validation.ok) {
      throw new Error(`The document's spec is invalid: ${validation.errors[0]}${validation.errors.length > 1 ? ` (+${validation.errors.length - 1} more)` : ""}`);
    }
    if (spec.title) {
      titleEl.textContent = spec.title;
      document.title = `${spec.title} — drawcast`;
    }
    const settings = loadSettings();
    const speech = new SpeechManager();
    speech.setVoice(settings.voiceURI);
    speech.setRate(settings.rate);
    const handle = await render(spec, figureHost, {
      style: req.style,
      mode: req.mode,
      speed: req.speed,
      speech,
    });
    attachPlayerControls(figureHost, handle, { mode: req.mode, speed: req.speed });
    status.remove();
  } catch (err) {
    status.textContent = (err as Error).message;
    status.classList.add("error");
  }
}
