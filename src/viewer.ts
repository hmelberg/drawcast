// Standalone viewer mode: loads a spec or a playlist (a multi-document YAML
// stream) from a link-shared Google Doc, a published Google Drive file, or a
// public GitHub repo, and shows just a player — no editor, no AI, no key.
// Extra hash params: &style=sketchy &mode=silent &speed=1.5 &advance=auto
// (kiosk: never wait for clicks).
//   https://…/drawcast/#gdoc=1AbC…xyz
//   https://…/drawcast/#gdrive=1AbC…xyz
//   https://…/drawcast/#gh=hmelberg/kurs/courses/causal/did.yaml

import "./styles.css";
import { type RenderStyle } from "./render";
import { CloudSpeech } from "./export/tts";
import { bakeClipStore } from "./export/bake-cache";
import { h } from "./ui/dom";
import { attachParamsTray } from "./ui/tray";
import { parsePlaylistText, itemsOf } from "./playlist/playlist";
import { mountPlaylist, playlistSpeakLines } from "./playlist/session";
import { bakedAudioFor } from "./playlist/audio";
import { validateSpec } from "./spec/schema";
import { getTtsKey, loadSettings, saveSettings } from "./store";
import { ensureEnabledPacks, PACK_DEFS } from "./scenes/packs";
import { scenes } from "./scenes/registry";
import { pickerKey } from "./google/auth";

export interface GhRef {
  owner: string;
  repo: string;
  path: string;
}

export interface ViewerRequest {
  /** A link-shared Google Doc. Exactly one of docId/driveId/gh is set. */
  docId?: string;
  /** A published Google Drive file (yaml, "Anyone with the link can view"). */
  driveId?: string;
  /** A file in a public GitHub repo. */
  gh?: GhRef;
  style: RenderStyle;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  /** Override of the playlist's advance mode (kiosk/loop playback). */
  advance?: "click" | "auto";
}

/**
 * The giscus client attributes for one published cast (C1). Pure and
 * exported for the node suite. data-repo comes from the viewer's own URL;
 * the ids come from the published file (playlist.meta.comments) — together
 * they are everything the widget needs, and the discussion is keyed to the
 * FILE path (mapping "specific"), so every lecture of a course gets its own
 * thread for free. Comments live in the AUTHOR's GitHub Discussions.
 */
export function giscusAttributes(gh: GhRef, comments: { repoId: string; category: string; categoryId: string }): Record<string, string> {
  return {
    "data-repo": `${gh.owner}/${gh.repo}`,
    "data-repo-id": comments.repoId,
    ...(comments.category ? { "data-category": comments.category } : {}),
    "data-category-id": comments.categoryId,
    "data-mapping": "specific",
    "data-term": gh.path,
    "data-reactions-enabled": "1",
    "data-emit-metadata": "0",
    "data-input-position": "bottom",
    "data-theme": "preferred_color_scheme",
    "data-lang": "en",
    crossorigin: "anonymous",
  };
}

/**
 * HEAD rather than a branch name: a published link must survive the repo's
 * default branch being renamed.
 */
export function rawUrlFor(gh: GhRef): string {
  return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/HEAD/${gh.path}`;
}

const GH_RE = /[#&]gh[=-]([\w.-]+)\/([\w.-]+)\/([^&\s]+)/;
const GDRIVE_RE = /[#&]gdrive[=-]([A-Za-z0-9_-]{10,})/;
/** Documents only, and never a path that climbs out of the repo. */
const DOC_PATH_RE = /^(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;

/**
 * Accepts #gdoc=<id> / #gdoc-<id>, #gdrive=<id> / #gdrive-<id>, and
 * #gh=<owner>/<repo>/<path> / #gh-…, with optional &style= &mode= &speed=
 * &advance=.
 */
export function parseViewerHash(hash: string): ViewerRequest | null {
  const gh = GH_RE.exec(hash);
  const doc = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  const drive = GDRIVE_RE.exec(hash);
  if (!gh && !doc && !drive) return null;

  const params = new URLSearchParams(
    hash
      .replace(/^#/, "")
      .replace(/gdrive-([A-Za-z0-9_-]+)/, "gdrive=$1")
      .replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1")
      .replace(/gh-/, "gh="),
  );
  const mode = params.get("mode");
  // Legacy draw links used &backend=custom-svg / clean-svg; map them.
  const styleParam = params.get("style") ?? params.get("backend");
  const advance = params.get("advance");
  const common = {
    style: (styleParam === "sketchy" || styleParam === "custom-svg" ? "sketchy" : "clean") as RenderStyle,
    mode: (mode === "silent" || mode === "instant" ? mode : "narrated") as ViewerRequest["mode"],
    speed: parseFloat(params.get("speed") ?? "") || loadSettings().speed || 1,
    advance: (advance === "auto" || advance === "click" ? advance : undefined) as ViewerRequest["advance"],
  };

  if (gh) {
    const path = decodeURIComponent(gh[3]);
    if (!DOC_PATH_RE.test(path)) return null;
    return { gh: { owner: gh[1], repo: gh[2], path }, ...common };
  }
  if (drive) {
    return { driveId: drive[1], ...common };
  }
  return { docId: doc![1], ...common };
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

/**
 * Fetch a published Drive file via the public-file read endpoint (the file
 * must be link-shared: "Anyone with the link can view"). Uses the app's
 * build-time picker key rather than a signed-in token — the same key the
 * file picker already needs, so a viewer-only build with no key fails with
 * a build problem, not a sharing problem.
 */
async function fetchGdriveText(fileId: string): Promise<string> {
  const key = pickerKey();
  if (!key) {
    throw new Error("This viewer build has no Google API key, so Drive files cannot be fetched.");
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${key}`);
  if (res.ok) return await res.text();
  throw new Error(
    `Could not fetch the Drive file (HTTP ${res.status}). Make sure sharing is set to "Anyone with the link can view" (Share in Google Drive).`,
  );
}

/** Fetch the playlist from a public repo. Private repos are not served here. */
async function fetchGhText(gh: GhRef): Promise<string> {
  const res = await fetch(rawUrlFor(gh));
  if (res.ok) return await res.text();
  throw new Error(
    res.status === 404
      ? `Could not find ${gh.path} in ${gh.owner}/${gh.repo}. The repository must be public and the path must be right — and a just-published file can take a few minutes to appear.`
      : `Could not fetch the drawcast (HTTP ${res.status}).`,
  );
}

export async function runViewer(req: ViewerRequest): Promise<void> {
  document.body.classList.add("viewer-body");
  const app = document.getElementById("app")!;
  const titleEl = h("h1", { class: "viewer-title" }, "drawcast");
  const status = h(
    "div",
    { class: "viewer-status" },
    req.gh ? "Loading drawing from GitHub…" : req.driveId ? "Loading drawing from Google Drive…" : "Loading drawing from Google Doc…",
  );
  // The same frame the app's player mounts into, by the same class: the
  // fullscreen rules are written against it, and a viewer-only copy of them
  // would be a copy nobody remembers to keep in step (it wasn't).
  const figureHost = h("div", { class: "player-figure" });
  // C3: the Web Share API where it exists (a phone), the clipboard elsewhere.
  const shareBtn = h("button", { class: "small viewer-share", title: "Share this drawcast" }, "↗ Share") as HTMLButtonElement;
  shareBtn.addEventListener("click", () => {
    const url = location.href;
    const title = document.title;
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {
        /* cancelled — not an error */
      });
      return;
    }
    void navigator.clipboard?.writeText(url).then(() => {
      shareBtn.textContent = "✓ Link copied";
      window.setTimeout(() => (shareBtn.textContent = "↗ Share"), 1600);
    });
  });
  const footer = h(
    "div",
    { class: "viewer-footer" },
    shareBtn,
    h("a", { href: location.pathname, title: "Open the drawcast app" }, "Made with drawcast"),
  );
  app.append(h("div", { class: "viewer-wrap" }, titleEl, status, figureHost, footer));

  try {
    // Pack templates register BEFORE anything lays out — the viewer was the
    // one entry point that skipped this (main.ts, compiler.ts and
    // engine-render.ts all do it), so a published cast on a pack template
    // (rd_plot, ppf, did_trends…) silently fell through to its loose
    // elements: voice and captions over a blank canvas (Hans's live bug,
    // 2026-09-02). ALL packs, not a settings list: the viewer renders other
    // people's content, and the AUTHOR's template choice must not depend on
    // what this browser happens to have enabled. Bundled yaml — no network.
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
    const text = req.gh ? await fetchGhText(req.gh) : req.driveId ? await fetchGdriveText(req.driveId) : await fetchGdocText(req.docId!);
    const playlist = parsePlaylistText(text);
    const items = itemsOf(playlist);
    if (items.length === 0) throw new Error("The document contains no drawable items.");
    for (const item of items) {
      const validation = validateSpec(item.spec);
      if (!validation.ok) {
        const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
        throw new Error(`The document's spec is invalid: ${where}${validation.errors[0]}${validation.errors.length > 1 ? ` (+${validation.errors.length - 1} more)` : ""}`);
      }
      // Second layer: an unknown template must be a visible error, never a
      // silent fall-through to a near-blank page (layoutSpec's warning is
      // returned but nothing in this path reads it).
      const tpl = item.spec.template;
      if (tpl && !scenes[tpl]) {
        throw new Error(`This drawcast uses the template "${tpl}", which this viewer does not know — it may come from a newer app or a remote pack.`);
      }
    }
    const title = playlist.meta.title ?? items[0].spec.title;
    if (title) {
      titleEl.textContent = title;
      document.title = `${title} — drawcast`;
    }
    const settings = loadSettings();
    const speech = new CloudSpeech(
      () => (settings.cloudPlayback ? getTtsKey() : ""),
      () => settings.cloudVoices,
      bakeClipStore,
    );
    speech.setVoice(settings.voiceURI);
    speech.setRate(settings.rate);
    // A declared language picks the narrator's voice. Without it the per-line
    // sniff stands, and detectLang only tells English from Norwegian — so a
    // published French drawcast was read aloud by an English voice. The app's
    // player has always done this; the viewer never did.
    speech.setLangHint(itemsOf(playlist).find((i) => i.spec.lang)?.spec.lang ?? null);
    // Narration baked into the document plays from there; anything it does not
    // cover falls through to this manager, and only THOSE lines are worth a
    // synthesis call. A fully baked drawcast needs no key at all.
    const baked = bakedAudioFor(speech, playlist);
    if (req.mode === "narrated") speech.prefetch(baked.unbaked(playlistSpeakLines(playlist)), req.speed);
    await mountPlaylist(figureHost, playlist, {
      style: req.style,
      text: { fontSize: settings.textSize, family: settings.textFamily },
      mode: req.mode,
      speed: req.speed,
      speech: baked.speech,
      prefs: { mode: req.mode, speed: req.speed },
      captions: {
        on: settings.captionsOn,
        lang: settings.captionLang,
        onChange: (next) => saveSettings({ ...loadSettings(), captionsOn: next.on, captionLang: next.lang }),
        hasCloudVoice: settings.cloudPlayback && getTtsKey() !== "",
      },
      controls: { speech, fullscreenEl: figureHost },
      onItemMounted: (hd) => attachParamsTray(figureHost, hd),
      advanceOverride: req.advance,
    });
    status.remove();
    // Comments (C1): only when the published file asked for them, and only on
    // a GitHub-published cast — data-repo comes from this page's own URL.
    if (playlist.meta.comments && req.gh) {
      const box = h("div", { class: "viewer-comments" });
      const script = document.createElement("script");
      script.src = "https://giscus.app/client.js";
      script.async = true;
      for (const [k, v] of Object.entries(giscusAttributes(req.gh, playlist.meta.comments))) script.setAttribute(k, v);
      box.appendChild(script);
      footer.insertAdjacentElement("beforebegin", box);
    }
  } catch (err) {
    status.textContent = (err as Error).message;
    status.classList.add("error");
  }
}
