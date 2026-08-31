// Every way a drawcast leaves the app, behind one verb. The options that used
// to sit in the toolbar next to Publish live here instead, beside the
// destination they actually belong to — baking is Link's, the language
// checkboxes are YouTube's, and burn-captions differs between the downloaded
// file and the upload on purpose (spec §2).
//
// Everything that touches the DOM lives inside build(), called lazily from
// openShare() — never at module scope. vitest runs this suite with no DOM
// (environment: "node"), so a top-level `h(...)` call would crash the import
// of this file's pure exports (shareDestinations included) the moment any
// test so much as imports them.

import { googleConfigured, requireScope, YOUTUBE_SCOPE } from "../google/auth";
import { uploadCaptions, uploadVideo, type UploadMeta } from "../google/youtube";
import { describeApiError } from "../llm/client";
import { translateSpec } from "../llm/translate";
import { lintCommands } from "../lint/lint";
import { toVtt } from "../export/captions";
import { LANGUAGES, languageLabel } from "../export/tts";
import { narrationLanguage, type ExportResult } from "../export/video";
import { exportSequence, formatPlaylist, isSingle, itemsOf, type Playlist } from "../playlist/playlist";
import { scenes } from "../scenes/registry";
import type { Spec } from "../spec/types";
import type { SpecFormat } from "../spec/text";
import { downloadBlob, downloadText, getApiKey, getGithubToken, getTtsKey, saveDrawing, type Settings, type ShareTo } from "../store";
import { parseRepo } from "../publish/github";
import { h } from "./dom";
import { createModal, type Modal } from "./modal";

export type { ShareTo };

export interface ShareCaps {
  /** A GitHub repo AND token are set. */
  github: boolean;
  /** Google is configured (client id present). */
  google: boolean;
  /** A Google Cloud TTS key is set — recording needs a voice it can capture. */
  tts: boolean;
}

export interface ShareDest {
  id: ShareTo;
  label: string;
  /** The primary button's word. A button says what it does. */
  action: string;
}

/** What Share publishes/exports/downloads. A subset of main.ts's `Doc` —
 *  only the fields this module reads are named here, so the caller can hand
 *  over its own document type as-is. */
export interface ShareDoc {
  title: string;
  playlist: Playlist;
  prompt?: string;
}

export interface ShareDeps {
  subject: "drawcast" | "course";
  /** The open document/course, read fresh each time — never cached. */
  doc: () => ShareDoc;
  /** The live settings object; Share writes `shareTo`, `burnCaptions`,
   *  `burnCaptionsOnUpload` and `specFormat` onto it, same as the controls it replaces did. */
  settings: Settings;
  persist: () => void;
  setStatus: (text: string, kind?: "info" | "error" | "ok") => void;
  setStatusAction: (text: string, label: string, onClick: () => void, kind?: "info" | "error" | "ok") => void;
  refreshLibrary: () => void;
  refreshAccountRow: () => void;
  openSettings: () => void;
  /**
   * Publish this document to its GitHub Pages home — `publishDrawcast()` or
   * `publishCourse()` depending on `subject`. `bake` is Link's narration
   * checkbox's answer; the function itself is unchanged, Share just moves
   * where it is called from.
   */
  publish: (bake: boolean) => Promise<void>;
  /**
   * The existing render path (export/video.ts's `exportVideo`, wrapped with
   * the offscreen canvas and the keep-alive worker that survive a hidden tab).
   * Null means the TTS key is missing, the render failed, or it was
   * cancelled — every case already reported through `setStatus`.
   */
  renderVideo: (specs: Spec[], burnCaptions: boolean, of?: string) => Promise<ExportResult | null>;
  /** Shows the export-progress chip and freezes the Share entry point. */
  beginExport: (status: string) => void;
  /** Updates the chip's text while an export/upload it started is running. */
  setProgress: (status: string) => void;
  /** Hides the chip and unfreezes Share. */
  endExport: () => void;
  /** The chip's cancel button aborts whichever controller this names. */
  setAbort: (c: AbortController | null) => void;
}

const DESTS: (ShareDest & { needs: (c: ShareCaps) => boolean; courses: boolean })[] = [
  { id: "link", label: "Link", action: "Publish", needs: (c) => c.github, courses: true },
  { id: "youtube", label: "YouTube", action: "Upload", needs: (c) => c.google && c.tts, courses: false },
  { id: "video", label: "Video file", action: "Export", needs: (c) => c.tts, courses: false },
  { id: "spec", label: "Spec file", action: "Download", needs: () => true, courses: false },
];

/**
 * Which destinations to offer. Unconfigured ones stay hidden — a capability
 * without its credential does not advertise itself (spec §6) — and a course
 * gets the link alone: batch video export is not written.
 */
export function shareDestinations(caps: ShareCaps, subject: "drawcast" | "course"): ShareDest[] {
  return DESTS
    .filter((d) => (subject === "course" ? d.courses : true) && d.needs(caps))
    .map(({ id, label, action }) => ({ id, label, action }));
}

/** Recomputed on every open — credentials can change while Share is closed. */
function currentCaps(settings: Settings): ShareCaps {
  return {
    github: Boolean(getGithubToken() && parseRepo(settings.githubRepo)),
    google: googleConfigured(),
    tts: Boolean(getTtsKey()),
  };
}

function fileSafe(name: string): string {
  return name.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
}

function titleOf(playlist: Playlist, fallback: string): string {
  return playlist.meta.title ?? itemsOf(playlist)[0]?.spec.title ?? fallback;
}

/** One language's outcome, for the YouTube summary and the follow-up actions. */
interface UploadOutcome {
  code: string;
  label: string;
  videoId?: string;
  vtt?: string;
  error?: string;
}

interface ShareSession {
  modal: Modal;
  refresh: (deps: ShareDeps) => void;
}

let session: ShareSession | null = null;

/**
 * Opens Share for the document/course `deps` describes. The modal is built
 * once and reused — safe to call again later with different deps (e.g. from
 * the course panel), since every field it shows is re-derived from whichever
 * `deps` was passed most recently.
 */
export function openShare(deps: ShareDeps): void {
  if (!session) session = build();
  session.refresh(deps);
  session.modal.open();
}

function build(): ShareSession {
  // The deps for whichever document Share is currently open on. Reassigned by
  // refresh() on every openShare() call and read dynamically by every handler
  // below, rather than captured once — so a reopen never shares a stale document.
  let current: ShareDeps;

  // ---- Link panel ----

  const linkBakeCb = h("input", { type: "checkbox", id: "share-bake" }) as HTMLInputElement;
  const linkBakeLabel = h(
    "label",
    { class: "quiet-label", for: "share-bake", title: "Synthesize the narration once and publish it inside the drawcast, so viewers need no key" },
    linkBakeCb,
    "with narration",
  );
  const linkPanel = h("div", { class: "share-panel" }, linkBakeLabel);
  const publishGo = h("button", { class: "primary" }, "Publish") as HTMLButtonElement;
  publishGo.addEventListener("click", () => {
    const deps = current;
    const bake = linkBakeCb.checked;
    modal.dialog.close();
    void deps.publish(bake);
  });

  // ---- Video file panel ----

  const videoBurnCb = h("input", { type: "checkbox" }) as HTMLInputElement;
  const videoBurnLabel = h(
    "label",
    { class: "settings-check" },
    videoBurnCb,
    " Burn captions into the picture — a downloaded file has no separate subtitle layer.",
  );
  const videoLangHint = h("div", { class: "hint" });
  const videoPanel = h("div", { class: "share-panel" }, videoBurnLabel, videoLangHint);
  const videoGo = h("button", { class: "primary" }, "Export") as HTMLButtonElement;
  videoGo.addEventListener("click", () => {
    void (async () => {
      const deps = current;
      modal.dialog.close();
      deps.settings.burnCaptions = videoBurnCb.checked;
      deps.persist();
      deps.beginExport("Preparing…");
      try {
        const doc = deps.doc();
        const out = await deps.renderVideo(exportSequence(doc.playlist), videoBurnCb.checked);
        if (!out) return;
        const base = fileSafe(doc.title);
        downloadBlob(`${base}.webm`, out.blob);
        downloadBlob(`${base}.vtt`, new Blob([toVtt(out.cues)], { type: "text/vtt" }));
        deps.setStatus(`Done — "${base}.webm" and its subtitle file "${base}.vtt" were downloaded.`, "ok");
      } finally {
        deps.endExport();
      }
    })();
  });

  // ---- Spec file panel ----

  const specFormatSel = h("select", { "aria-label": "Spec format" }) as HTMLSelectElement;
  specFormatSel.append(h("option", { value: "yaml" }, "YAML"), h("option", { value: "json" }, "JSON"));
  const specPanel = h("div", { class: "share-panel" }, h("label", { class: "quiet-label" }, "Format ", specFormatSel));
  const specGo = h("button", { class: "primary" }, "Download") as HTMLButtonElement;
  specFormatSel.addEventListener("change", () => {
    const deps = current;
    const next = specFormatSel.value as SpecFormat;
    // Same guard the editor's own format toggle applies: a playlist is a
    // multi-document YAML stream and JSON cannot hold that, so a playlist
    // downloads as YAML regardless of what is picked here.
    if (next === "json" && !isSingle(deps.doc().playlist)) {
      deps.setStatus("Playlists are YAML-only (a JSON document cannot hold a multi-document stream).", "error");
      specFormatSel.value = "yaml";
      return;
    }
    deps.settings.specFormat = next;
    deps.persist();
  });
  specGo.addEventListener("click", () => {
    const deps = current;
    modal.dialog.close();
    const doc = deps.doc();
    const format: SpecFormat = isSingle(doc.playlist) ? deps.settings.specFormat : "yaml";
    downloadText(`${fileSafe(doc.title)}.${format}`, formatPlaylist(doc.playlist, format));
  });

  // ---- YouTube panel — lifted from the dialog it used to be its own modal ----

  const ytTitle = h("input", { type: "text", class: "yt-field", "aria-label": "Video title" }) as HTMLInputElement;
  const ytDesc = h("textarea", { class: "yt-field", rows: "3", "aria-label": "Video description" }) as HTMLTextAreaElement;
  /** One checkbox per language drawcast can narrate. Ticking a language that
   *  is not the source translates it there and then, so a failure shows up
   *  in seconds rather than twenty minutes into a queue of real-time
   *  recordings. */
  const ytLangBox = h("div", { class: "yt-langs" });
  const ytLangCbs = new Map<string, HTMLInputElement>();
  for (const l of LANGUAGES) {
    const cb = h("input", { type: "checkbox", value: l.code }) as HTMLInputElement;
    ytLangCbs.set(l.code, cb);
    ytLangBox.appendChild(h("label", { class: "yt-lang" }, cb, " " + l.label));
  }
  const ytSaveCopy = h("button", {}, "Save the translations as new drawcasts") as HTMLButtonElement;
  const ytBurnCb = h("input", { type: "checkbox" }) as HTMLInputElement;
  const ytPrivacy = h("select", { class: "yt-field", "aria-label": "Visibility" }) as HTMLSelectElement;
  for (const [v, label] of [["private", "Private"], ["unlisted", "Unlisted"], ["public", "Public"]]) {
    ytPrivacy.appendChild(h("option", { value: v }, label));
  }
  const ytStatus = h("div", { class: "hint" });
  const youtubePanel = h(
    "div",
    { class: "share-panel" },
    h("label", { class: "quiet-label" }, "Title ", ytTitle),
    h("label", { class: "quiet-label" }, "Description ", ytDesc),
    h("div", { class: "quiet-label" }, "Languages ", ytLangBox),
    h("label", { class: "quiet-label" }, "Visibility ", ytPrivacy),
    h(
      "label",
      { class: "settings-check" },
      ytBurnCb,
      " Burn captions into the picture. Off is usually right here: YouTube shows its own captions over the video, so a burnt-in upload says everything twice. On only for feeds that autoplay muted.",
    ),
    h(
      "div",
      { class: "yt-warning" },
      "The video is uploaded to your own channel with the visibility you chose. Its subtitle file is downloaded at the same time — " +
        "afterwards you can attach it with one click, or drag it in yourself in YouTube Studio. Either way, YouTube can then translate it for viewers in other languages.",
    ),
    ytStatus,
  );
  const ytGo = h("button", { class: "primary" }, "Upload") as HTMLButtonElement;

  /**
   * Translated COPIES waiting to be recorded, by language code. They exist
   * only while the modal is open on this document and are never written back
   * to it — exportSequence hands out the document's own spec objects, so
   * translating into fresh playlists is what keeps your drawcast in the
   * language you wrote it in. Kept even when a language is unticked, so
   * re-ticking is free.
   */
  const ytTranslations = new Map<string, Playlist>();

  function sourceLanguage(): string {
    return narrationLanguage(itemsOf(current.doc().playlist).map((i) => i.spec));
  }

  /** Ticked languages, in catalog order, source first when it is among them. */
  function ytSelected(): string[] {
    const src = sourceLanguage();
    const picked = LANGUAGES.filter((l) => ytLangCbs.get(l.code)?.checked).map((l) => l.code);
    return picked.includes(src) ? [src, ...picked.filter((c) => c !== src)] : picked;
  }

  /** The document's playlist with each item's spec swapped for its translation. */
  function playlistWithSpecs(specs: Spec[]): Playlist {
    const playlist = current.doc().playlist;
    let i = 0;
    return {
      ...playlist,
      entries: playlist.entries.map((e) => (e.kind === "item" ? { kind: "item" as const, spec: specs[i++] } : e)),
    };
  }

  /** What gets recorded for one language: the translation, or the document itself. */
  function playlistFor(code: string): Playlist {
    const doc = current.doc();
    return code === sourceLanguage() ? doc.playlist : (ytTranslations.get(code) ?? doc.playlist);
  }

  /** Ready to upload once at least one language is ticked and translated. */
  function refreshYtButtons(): void {
    const picked = ytSelected();
    const ready = picked.every((c) => c === sourceLanguage() || ytTranslations.has(c));
    ytGo.disabled = picked.length === 0 || !ready;
    ytGo.textContent = picked.length > 1 ? `Upload ${picked.length} videos` : "Upload";
    ytSaveCopy.hidden = !picked.some((c) => ytTranslations.has(c));
    // One language: the field is the title, yours to edit. Several: each
    // video takes its own translated title, because one field cannot hold four.
    ytTitle.disabled = picked.length > 1;
    const doc = current.doc();
    if (picked.length === 1) ytTitle.value = titleOf(playlistFor(picked[0]), doc.title);
    else ytTitle.value = doc.title;
  }

  async function translateInto(code: string): Promise<void> {
    const target = LANGUAGES.find((l) => l.code === code);
    const apiKey = getApiKey();
    if (!target || !apiKey) {
      ytStatus.textContent = "Translating needs your Anthropic API key — add it in Settings.";
      ytLangCbs.get(code)!.checked = false;
      return;
    }
    ytStatus.textContent = `Translating into ${target.label}…`;
    const specs: Spec[] = [];
    const problems: string[] = [];
    for (const spec of itemsOf(current.doc().playlist).map((i) => i.spec)) {
      const schema = spec.template ? scenes[spec.template]?.manifest.params_schema : undefined;
      const { spec: out, check } = await translateSpec(spec, target, { apiKey, model: current.settings.model }, schema);
      if (check.missing.length > 0) problems.push(`${check.missing.length} string(s) left in ${languageLabel(sourceLanguage())}`);
      // Cheap structural guard: ids and gotos are never sent to the model, so
      // a broken reference here means a bug in the extractor, not a bad answer.
      const broken = lintCommands(out).filter((i) => i.severity === "error");
      if (broken.length > 0) problems.push(broken[0].message);
      specs.push(out);
    }
    ytTranslations.set(code, playlistWithSpecs(specs));
    ytStatus.textContent = problems.length > 0 ? `Translated into ${target.label} — ${problems.join("; ")}.` : `Translated into ${target.label}.`;
  }

  for (const [code, cb] of ytLangCbs) {
    cb.addEventListener("change", () => {
      if (!cb.checked || code === sourceLanguage() || ytTranslations.has(code)) {
        refreshYtButtons();
        return;
      }
      void (async () => {
        ytGo.disabled = true;
        for (const other of ytLangCbs.values()) other.disabled = true;
        try {
          await translateInto(code);
        } catch (err) {
          cb.checked = false;
          ytStatus.textContent = `Could not translate: ${describeApiError(err)}`;
        } finally {
          for (const other of ytLangCbs.values()) other.disabled = false;
          refreshYtButtons();
        }
      })();
    });
  }

  ytSaveCopy.addEventListener("click", () => {
    const deps = current;
    const doc = deps.doc();
    // NEW library entries with NEW ids. Never the open document's own id: a
    // translation is a sibling of the original, never a replacement for it.
    const saved: string[] = [];
    for (const code of ytSelected()) {
      const playlist = ytTranslations.get(code);
      if (!playlist) continue;
      const title = titleOf(playlist, doc.title);
      saveDrawing({
        id: crypto.randomUUID(),
        title,
        prompt: doc.prompt,
        spec: itemsOf(playlist)[0]?.spec ?? { commands: [] },
        playlist: isSingle(playlist) ? undefined : formatPlaylist(playlist, "yaml"),
        ts: new Date().toISOString(),
      });
      saved.push(title);
    }
    deps.refreshLibrary();
    ytStatus.textContent = `Saved ${saved.length} drawcast(s) to your library: ${saved.join(", ")}. The original is untouched.`;
  });

  async function runYoutubeUpload(): Promise<void> {
    const deps = current;
    const targets = ytSelected();
    if (targets.length === 0) return;
    const single = targets.length === 1;
    ytGo.disabled = true;
    // The panel's answer becomes the standing one — the same channel usually
    // wants the same treatment every time.
    deps.settings.burnCaptionsOnUpload = ytBurnCb.checked;
    deps.persist();
    // Consent FIRST, while this click's transient user activation is still
    // alive. Rendering records each drawcast in real time — minutes apiece —
    // and activation lapses after about five seconds, so a popup opened on
    // the far side of the queue is blocked by the browser and the user is
    // told "sign-in was cancelled" after all that work. uploadVideo's own
    // requireScope then finds this token in the cache and prompts nobody.
    // (The session cannot be opened this early instead: starting a resumable
    // upload needs X-Upload-Content-Length, i.e. the finished blob's size.)
    const token = await requireScope(YOUTUBE_SCOPE);
    deps.refreshAccountRow();
    if (!token) {
      ytStatus.textContent = "YouTube sign-in was cancelled — nothing was uploaded.";
      refreshYtButtons();
      return;
    }
    // The queue runs in the background — close Share and let the export chip
    // carry progress from here.
    modal.dialog.close();
    deps.beginExport("Preparing…");
    const done: UploadOutcome[] = [];
    try {
      for (const [i, code] of targets.entries()) {
        const label = languageLabel(code);
        const of = targets.length > 1 ? ` (${label}, ${i + 1} of ${targets.length})` : "";
        const playlist = playlistFor(code);
        const title = single ? ytTitle.value.trim() || deps.doc().title : titleOf(playlist, deps.doc().title);
        const base = `${fileSafe(title)}${single ? "" : `-${code}`}`;

        const out = await deps.renderVideo(exportSequence(playlist), ytBurnCb.checked, of);
        // Null means the key is missing, the render failed, or the user
        // pressed cancel — all three already said so, and all three end the
        // queue: the rest would fail the same way or was not wanted.
        if (!out) break;

        const controller = new AbortController();
        deps.setAbort(controller);
        deps.setProgress(`Uploading${of}…`);
        try {
          const res = await uploadVideo(
            out.blob,
            { title, description: ytDesc.value, privacyStatus: ytPrivacy.value as UploadMeta["privacyStatus"], language: code },
            {
              onProgress: (f) => deps.setProgress(`Uploading${of}… ${Math.round(f * 100)}%`),
              signal: controller.signal,
            },
          );
          // The caption track is NOT sent with the video: captions.insert
          // needs the force-ssl scope, which also grants deleting the user's
          // videos and comments — too much to fold into an upload. The file
          // downloads either way (a re-render costs minutes), and the button
          // below asks for that scope only if this user wants the drag done
          // for them.
          const vtt = toVtt(out.cues);
          downloadBlob(`${base}.vtt`, new Blob([vtt], { type: "text/vtt" }));
          if (!res) done.push({ code, label, error: "sign-in expired" });
          else done.push({ code, label, videoId: res.videoId, vtt });
        } catch (err) {
          if (controller.signal.aborted) {
            deps.setStatus("YouTube upload cancelled.");
            return;
          }
          // One language failing must not cost the others their recordings.
          done.push({ code, label, error: (err as Error).message });
        }
      }
    } finally {
      deps.endExport();
      reportUploads(done);
    }
  }

  function reportUploads(done: UploadOutcome[]): void {
    const deps = current;
    const ok = done.filter((d) => d.videoId);
    if (done.length === 0) return;
    const lines = done.map((d) => (d.videoId ? `${d.label}: https://youtu.be/${d.videoId}` : `${d.label}: ${d.error}`));
    const text = `${ok.length} of ${done.length} uploaded. ${lines.join(" · ")} — subtitle files were downloaded.`;
    if (ok.length === 0) {
      deps.setStatus(text, "error");
      return;
    }
    deps.setStatusAction(
      text,
      ok.length > 1 ? `Add subtitles to all ${ok.length} videos` : "Add subtitles to the video",
      () => void addCaptionsToAll(ok),
      ok.length === done.length ? "ok" : "error",
    );
  }

  async function addCaptionsToAll(ok: UploadOutcome[]): Promise<void> {
    const deps = current;
    const fallback = "The .vtt files are downloaded — add them in YouTube Studio.";
    deps.setStatus(`Adding subtitles to ${ok.length} video(s)…`);
    let added = 0;
    try {
      for (const d of ok) {
        // The first call asks for the captions scope; the rest reuse the grant.
        if (!(await uploadCaptions({ videoId: d.videoId!, language: d.code, name: "drawcast" }, d.vtt!, AbortSignal.timeout(60_000)))) {
          deps.setStatus(`Subtitles were not added — YouTube's caption permission was declined. ${fallback}`, "error");
          return;
        }
        added++;
      }
      deps.setStatus(`Subtitles added to ${added} video(s).`, "ok");
    } catch (err) {
      deps.setStatus(`Added subtitles to ${added} of ${ok.length}: ${(err as Error).message} — ${fallback}`, "error");
    }
  }

  ytGo.addEventListener("click", () => void runYoutubeUpload());

  // ---- the modal shell: rail on the left, that destination's panel on the right ----

  const panels: Record<ShareTo, HTMLElement> = { link: linkPanel, youtube: youtubePanel, video: videoPanel, spec: specPanel };
  const actionBtns: Record<ShareTo, HTMLButtonElement> = { link: publishGo, youtube: ytGo, video: videoGo, spec: specGo };

  const rail = h("div", { class: "share-rail" });
  const panelHost = h("div", { class: "share-panel-host" }, linkPanel, youtubePanel, videoPanel, specPanel);
  const layout = h("div", { class: "share-layout" }, rail, panelHost);
  const settingsBtn = h("button", { class: "small" }, "Open Settings");
  settingsBtn.addEventListener("click", () => {
    modal.dialog.close();
    current.openSettings();
  });
  const emptyHint = h(
    "div",
    { class: "hint" },
    "Set your GitHub repository and token in Settings to publish. ",
    settingsBtn,
  );

  const modal = createModal("↗ Share", { size: "m", class: "share-modal" });
  modal.body.append(layout, emptyHint);
  document.body.append(modal.dialog);

  let destinations: ShareDest[] = [];
  let railButtons: HTMLButtonElement[] = [];

  function selectDestination(id: ShareTo): void {
    current.settings.shareTo = id;
    current.persist();
    destinations.forEach((d, i) => {
      panels[d.id].hidden = d.id !== id;
      railButtons[i].classList.toggle("current", d.id === id);
    });
    const left = id === "youtube" ? [h("div", { class: "footer-left" }, ytSaveCopy)] : [];
    modal.footer.replaceChildren(...left, actionBtns[id]);
  }

  /** Field defaults for every panel, set once per Share open — not on every
   *  rail click, so glancing at another destination and back does not throw
   *  away a typed title or description. */
  function prepPanels(): void {
    videoBurnCb.checked = current.settings.burnCaptions;
    videoLangHint.textContent = `Renders in ${languageLabel(sourceLanguage())}.`;
    specFormatSel.value = current.settings.specFormat;
    ytDesc.value = "Made with drawcast.";
    ytPrivacy.value = "private";
    ytBurnCb.checked = current.settings.burnCaptionsOnUpload;
    ytTranslations.clear();
    for (const [code, cb] of ytLangCbs) cb.checked = code === sourceLanguage();
    ytStatus.textContent = "";
    refreshYtButtons();
  }

  function refresh(deps: ShareDeps): void {
    current = deps;
    destinations = shareDestinations(currentCaps(deps.settings), deps.subject);
    layout.hidden = destinations.length === 0;
    emptyHint.hidden = destinations.length > 0;
    if (destinations.length === 0) {
      modal.footer.replaceChildren();
      return;
    }
    prepPanels();
    railButtons = destinations.map((d) => {
      const b = h("button", { class: "share-dest" }, d.label) as HTMLButtonElement;
      b.addEventListener("click", () => selectDestination(d.id));
      return b;
    });
    rail.replaceChildren(...railButtons);
    const remembered = deps.settings.shareTo;
    selectDestination(destinations.some((d) => d.id === remembered) ? remembered : destinations[0].id);
  }

  return { modal, refresh };
}
