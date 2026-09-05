// Standalone viewer mode: loads a spec or a playlist (a multi-document YAML
// stream) from a link-shared Google Doc, a published Google Drive file, a
// public GitHub repo, or the drawcast server (a private cast, gated by the
// signed-in account), and shows just a player — no editor, no AI, no key.
// Extra hash params: &style=sketchy &mode=silent &speed=1.5 &advance=auto
// (kiosk: never wait for clicks).
//   https://…/drawcast/#gdoc=1AbC…xyz
//   https://…/drawcast/#gdrive=1AbC…xyz
//   https://…/drawcast/#gh=hmelberg/kurs/courses/causal/did.yaml
//   https://…/drawcast/#anvil=spanish1/01-intro.yaml

import "./styles.css";
import { type RenderStyle } from "./render";
import { CloudSpeech } from "./export/tts";
import { bakeClipStore } from "./export/bake-cache";
import { h } from "./ui/dom";
import { attachParamsTray } from "./ui/tray";
import { castKeyFor, countingEnabled, firstViewInSession, readViewCount, recordView } from "./views";
import { getToken } from "./account";
import { apiBase, DEFAULT_ENROLL_API, firstOpenInSession, sendEvent } from "./learn";
import { anvilHashFor, nameInHash, resolveName } from "./names";
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
  /** A link-shared Google Doc. Exactly one of docId/driveId/gh/anvil is set. */
  docId?: string;
  /** A published Google Drive file (yaml, "Anyone with the link can view"). */
  driveId?: string;
  /** A file in a public GitHub repo. */
  gh?: GhRef;
  /**
   * A cast on the drawcast server. `cast` is the server's own key,
   * `anvil/<slug>/<file>` — the same three-segment shape as a GitHub key, so
   * view counting, learner events and the dashboard take it unchanged.
   */
  anvil?: { cast: string; api: string };
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
 * The attributes of the box the giscus widget mounts into. The class is the
 * point: giscus's client.js takes the page URL, DELETES THE FRAGMENT
 * (`b.hash = ""`), and sends the login there — but a cast lives ONLY in the
 * fragment, so a login used to come back to a bare drawcast.app, which boots
 * the editor. The one fragment giscus does keep is the id of the element it
 * finds by class `.giscus`, appended as `#<id>`; hand it this page's own hash
 * and the login returns to the lecture the reader left. No hash (a dev
 * localhost, an embed) means no id — an empty one would be worse than none.
 */
export function giscusContainerAttrs(hash: string): Record<string, string> {
  const id = hash.replace(/^#/, "");
  return id ? { class: "viewer-comments giscus", id } : { class: "viewer-comments" };
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
const ANVIL_RE = /[#&]anvil[=-]([\w.-]+)\/([^&\s]+)/;
/** Documents only, and never a path that climbs out of the repo. */
const DOC_PATH_RE = /^(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
/** One plain segment for the server slug — dots inside are fine, `.` and `..`
 *  are not. ANVIL_RE alone would let `#anvil=../x.yaml` through as
 *  `anvil/../x.yaml`, a key DOC_PATH_RE never sees and CAST_KEY_RE accepts. */
const ANVIL_SLUG_RE = /^[\w-]+(?:\.[\w-]+)*$/;

/** A malformed percent-escape is not a path, not a crash — nameInHash's rule.
 *  entry.ts runs boot() uncaught, so a throw here is a blank page, no message. */
function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Accepts #gdoc=<id> / #gdoc-<id>, #gdrive=<id> / #gdrive-<id>,
 * #gh=<owner>/<repo>/<path> / #gh-…, and #anvil=<slug>/<file> / #anvil-…,
 * with optional &style= &mode= &speed= &advance=.
 */
export function parseViewerHash(hash: string): ViewerRequest | null {
  const gh = GH_RE.exec(hash);
  const doc = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  const drive = GDRIVE_RE.exec(hash);
  const anv = ANVIL_RE.exec(hash);
  if (!gh && !doc && !drive && !anv) return null;

  const params = new URLSearchParams(
    hash
      .replace(/^#/, "")
      .replace(/gdrive-([A-Za-z0-9_-]+)/, "gdrive=$1")
      .replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1")
      .replace(/gh-/, "gh=")
      // Anchored to the segment start: a FILE called anvil-intro.yaml must
      // not be rewritten (the path itself comes from ANVIL_RE, not from here,
      // but the parameters after it should still parse cleanly).
      .replace(/(^|&)anvil-/, "$1anvil="),
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

  if (anv) {
    const path = decodePath(anv[2]);
    if (path === null || !ANVIL_SLUG_RE.test(anv[1]) || !DOC_PATH_RE.test(path)) return null;
    return { anvil: { cast: `anvil/${anv[1]}/${path}`, api: DEFAULT_ENROLL_API }, ...common };
  }
  if (gh) {
    const path = decodePath(gh[3]);
    if (path === null || !DOC_PATH_RE.test(path)) return null;
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

/** What the audio endpoint must answer with to be appended: the document
 *  formatPublished writes, a mapping whose first key is `audio`. A 200 that
 *  is anything else — an HTML shell, a captive portal — is not narration. */
const AUDIO_DOC_RE = /^\s*audio\s*:/;
/** …and ONE document: a `---` line inside the body would carry a further
 *  document past the check above and into the parser. */
const ANOTHER_DOC_RE = /\n---[ \t]*(?:\r?\n|$)/;

/**
 * A cast stored on the drawcast server arrives as two objects (spec §4) and
 * is handed to the parser as one document — so `parsePlaylistText`,
 * `speech.prefetch` and mount order never learn about the split. The join is
 * the one `formatPublished` writes for a GitHub cast: the spec, a single
 * newline, a `---` line, the `audio:` document.
 *
 * The narration is optional and must never cost the lecture. A 404 on the
 * second request means the cast has none, and is silent. Every OTHER way of
 * not getting it — a server error, the network, a 200 that is not an audio
 * document — still plays the spec but is reported once through
 * `onAudioProblem`, because a baked voice that has quietly become a
 * synthesiser looks exactly like one that was never baked, and nobody would
 * ever report it. Appending an unchecked 200 would be worse than dropping
 * it: classifyDocs makes an unrecognised mapping a spec, validateSpec fails
 * it, and the whole drawcast dies over an optional resource.
 *
 * The session token travels as the `key=` query parameter — unlike every
 * other server call, which POSTs it in a body — so it can land in access
 * logs. Signed out it is empty, and the server's 401 becomes the message
 * that says what to do about it.
 */
export async function fetchAnvilText(
  ref: { cast: string; api: string },
  fetchImpl: typeof fetch = fetch,
  onAudioProblem?: (why: string) => void,
): Promise<string> {
  const q = `cast=${encodeURIComponent(ref.cast)}&key=${encodeURIComponent(getToken())}`;
  // Both requests leave together. They are independent — the audio's address
  // is the cast key, not anything the spec carries — and each costs a ~0.25 s
  // round trip to a single region with no CDN in front of it, so running them
  // in sequence spent one of those waiting for nothing (measured 2026-09-05:
  // spec 0.25 s, audio 0.39 s, ~0.7 s before a line was drawn).
  //
  // The catch is attached HERE, not at the await below: a spec that answers
  // 401 throws out of this function while the audio request is still in
  // flight, and a rejected promise nobody is waiting on is an unhandled
  // rejection. The cost of the parallel form is that one request: a denied
  // reader now asks for audio it will also be denied, instead of not asking.
  const audioPending = fetchImpl(`${apiBase(ref.api)}/_/api/cast/audio?${q}`).catch(() => null);
  const res = await fetchImpl(`${apiBase(ref.api)}/_/api/cast?${q}`);
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? "This drawcast is private. Sign in with the account it belongs to — Settings → Publishing → Sign in."
        : res.status === 404
          ? "That drawcast is not on the drawcast server (it may have been removed)."
          : `Could not fetch the drawcast (HTTP ${res.status}).`,
    );
  }
  const spec = await res.text();
  const audio = await audioPending;
  if (!audio) {
    onAudioProblem?.("network");
    return spec;
  }
  if (audio.status === 404) return spec;
  if (!audio.ok) {
    onAudioProblem?.(`HTTP ${audio.status}`);
    return spec;
  }
  const track = await audio.text().catch(() => null);
  if (track === null || !AUDIO_DOC_RE.test(track) || ANOTHER_DOC_RE.test(track)) {
    onAudioProblem?.("not an audio document");
    return spec;
  }
  return `${spec.replace(/\n*$/, "\n")}---\n${track}`;
}

/**
 * A hash the router recognised but parseViewerHash refused — a climbing
 * path, a bad slug, a broken percent-escape, a file that is not a document.
 * entry.ts used to drop that null on the floor, and the page was blank with
 * no message: the very failure a guarded decode was meant to end. Same
 * centering and status element runNamed uses before the viewer exists.
 */
export function showUnplayable(): void {
  document.body.classList.add("viewer-body");
  const status = h("p", { class: "viewer-status error" }, "This link points at something this viewer cannot play — the address may be incomplete or altered.");
  document.body.append(status);
}

/**
 * A named link (spec §7): ask the registry what the name points at, then
 * carry on exactly as if the target had been in the hash. The address bar
 * keeps the name — replaceState would not fire hashchange, but there is
 * nothing to gain from rewriting it either.
 */
export async function runNamed(hash: string): Promise<void> {
  const name = nameInHash(hash);
  // Same centering runViewer gets, before we know whether we'll ever reach it.
  document.body.classList.add("viewer-body");
  const status = h("p", { class: "viewer-status" }, "Looking up the name…");
  document.body.append(status);
  const resolved = name ? await resolveName(DEFAULT_ENROLL_API, name) : null;
  if (!resolved) {
    status.textContent = `No drawcast called "${name ?? hash}".`;
    status.classList.add("error");
    return;
  }
  if (resolved.kind === "course") {
    if (resolved.page) location.replace(resolved.page);
    else {
      status.textContent = "This course has no page to open.";
      status.classList.add("error");
    }
    return;
  }
  // Parse BEFORE clearing the lookup status: a malformed registry entry
  // must still leave a message on screen, not a blank page. names.ts picks
  // the door — the server for an anvil/ key, GitHub for the rest.
  const req = parseViewerHash(anvilHashFor(hash, resolved.target));
  if (!req) {
    status.textContent = `The name "${name}" points at something this viewer cannot play.`;
    status.classList.add("error");
    return;
  }
  status.remove();
  await runViewer(req);
}

export async function runViewer(req: ViewerRequest): Promise<void> {
  document.body.classList.add("viewer-body");
  const app = document.getElementById("app")!;
  const titleEl = h("h1", { class: "viewer-title" }, "drawcast");
  const status = h(
    "div",
    { class: "viewer-status" },
    req.anvil
      ? "Loading drawing from the drawcast server…"
      : req.gh
        ? "Loading drawing from GitHub…"
        : req.driveId
          ? "Loading drawing from Google Drive…"
          : "Loading drawing from Google Doc…",
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
  // The count lives under the figure, where a viewer expects it — and where
  // the title is heading in the player round, so the row is built once.
  const viewsEl = h("span", { class: "viewer-views" });
  // The one line a lost narration gets (server casts): the same row as the
  // count, so it is said once and never blocks the drawing.
  const noteEl = h("span", { class: "viewer-note" });
  const metaEl = h("div", { class: "viewer-meta" }, viewsEl, noteEl);
  const footer = h(
    "div",
    { class: "viewer-footer" },
    shareBtn,
    h("a", { href: location.pathname, title: "Open the drawcast app" }, "Made with drawcast"),
  );
  app.append(h("div", { class: "viewer-wrap" }, titleEl, status, figureHost, metaEl, footer));

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
    let audioNote = "";
    const text = req.anvil
      ? await fetchAnvilText(req.anvil, fetch, (why) => {
          audioNote = `Recorded narration unavailable (${why}); narration falls back to a synthesised voice.`;
        })
      : req.gh
        ? await fetchGhText(req.gh)
        : req.driveId
          ? await fetchGdriveText(req.driveId)
          : await fetchGdocText(req.docId!);
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
    if (audioNote) noteEl.textContent = audioNote;
    // Counting: after the playlist is parsed, because the flag travels in the
    // file, and BEFORE mountPlaylist, which takes seconds a visitor may not
    // stay for. Never awaited — a counting outage must not delay a drawing.
    //
    // GitHub casts ONLY, and not by oversight: the counter is public and
    // lists every key under an owner to anyone who asks, so an anvil/ key
    // there would publish a private course's lecture list. A private cast's
    // view count is the teacher's business and belongs in the dashboard,
    // not in a public counter. (src/views.ts and the function refuse such a
    // key too; this is the intent, those are the guards.)
    if (countingEnabled(playlist.meta) && req.gh) {
      const viewKey = castKeyFor(req.gh);
      const session = (() => {
        try {
          return sessionStorage;
        } catch {
          return null; // Private mode can throw on access, not just on use.
        }
      })();
      const pending = firstViewInSession(viewKey, session) ? recordView(viewKey) : readViewCount(viewKey);
      void pending.then((count) => {
        if (typeof count === "number") viewsEl.textContent = `${count.toLocaleString()} ${count === 1 ? "view" : "views"}`;
      });
    }
    // Learners (spec §1, §3): the signed-in account reports, or nothing does.
    // The identity reported under is the cast key — a GitHub key or the
    // server's own, both `a/b/<path>`, so the learner client takes either.
    // meta.enroll says the course tracks learners and WHICH server it
    // reports to; a cast without it belongs to no course anyone joined, and
    // a signed-in author previewing it should not fire `opened` at a server
    // that can only answer 403. The token belongs to the app that issued
    // it, so it goes to that app and nowhere else: a YAML naming another
    // server gets neither a report nor a credential (this browser holds none
    // for it), rather than becoming a way to collect session tokens.
    const castKey = req.anvil ? req.anvil.cast : req.gh ? castKeyFor(req.gh) : null;
    const enroll = playlist.meta.enroll ? apiBase(playlist.meta.enroll) : null;
    const key = getToken();
    const reporter = castKey !== null && enroll === DEFAULT_ENROLL_API && key !== "" ? { api: enroll, key, cast: castKey } : null;
    if (reporter) {
      const session = (() => {
        try {
          return sessionStorage;
        } catch {
          return null;
        }
      })();
      if (firstOpenInSession(reporter.cast, session)) void sendEvent(reporter.api, { kind: "opened", cast: reporter.cast }, reporter.key);
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
      onAnswer: reporter
        ? (a, _item, index) => {
            // (item, step) together: a.index counts steps inside ONE playlist
            // item, and a generated lecture is one item per part (spec §4).
            void sendEvent(reporter.api, { kind: "answer", cast: reporter.cast, item: index, step: a.index, question: a.question, given: a.given, expected: a.expected, correct: a.correct }, reporter.key);
          }
        : undefined,
      onDone: reporter
        ? () => {
            void sendEvent(reporter.api, { kind: "completed", cast: reporter.cast }, reporter.key);
          }
        : undefined,
      advanceOverride: req.advance,
    });
    status.remove();
    // Comments (C1): only when the published file asked for them, and only on
    // a GitHub-published cast — data-repo comes from this page's own URL.
    if (playlist.meta.comments && req.gh) {
      const castHash = location.hash;
      const box = h("div", giscusContainerAttrs(castHash));
      const script = document.createElement("script");
      script.src = "https://giscus.app/client.js";
      script.async = true;
      for (const [k, v] of Object.entries(giscusAttributes(req.gh, playlist.meta.comments))) script.setAttribute(k, v);
      // Coming back FROM a login, client.js swallows its own ?giscus= token
      // with a replaceState — to a URL it built with the fragment stripped.
      // The page is already playing; put the cast back in the address bar so
      // a reload or a copied link still opens the lecture, not the editor.
      script.addEventListener("load", () => {
        if (castHash && location.hash !== castHash) history.replaceState(null, "", `${location.pathname}${location.search}${castHash}`);
      });
      box.appendChild(script);
      footer.insertAdjacentElement("beforebegin", box);
    }
  } catch (err) {
    status.textContent = (err as Error).message;
    status.classList.add("error");
  }
}
