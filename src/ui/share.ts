// Every way a drawcast leaves the app, behind one verb. The options that used
// to sit in the toolbar next to Publish live here instead, beside the
// destination they actually belong to — the language checkboxes are
// YouTube's, and burn-captions differs between the downloaded file and the
// upload on purpose (spec §2). The two embed choices belong to BOTH publish
// destinations (GitHub and Drive), so buildEmbedChoices below builds them
// once and each panel instantiates its own copy (spec §7).
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
import type { ExportResult } from "../export/video";
import { exportSequence, formatPlaylist, isSingle, itemsOf, playlistWithSpecs, sourceLanguage, type Playlist } from "../playlist/playlist";
import { scenes } from "../scenes/registry";
import type { Spec } from "../spec/types";
import { downloadBlob, getApiKey, getGithubToken, getTtsKey, saveDrawing, type Settings, type ShareTo } from "../store";
import { parseRepo, slugify } from "../publish/github";
import { h } from "./dom";
import { unembeddedImages } from "./insert";
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
  /**
   * How many lectures a course has. The one line of context Link's panel
   * shows for `subject: "course"` — otherwise Publish looks identical
   * whether it is about to send one drawcast or an entire course (spec §2).
   * Left undefined for `subject: "drawcast"`, which has no lectures to count.
   */
  lectureCount?: number;
  /**
   * The folder name this drawcast published under before, if it has. Read
   * once to prefill Link's name field (`publishedAs ?? slugify(title)`) —
   * never written here; `publishDrawcast` is the only place that records a
   * new one, after the commit lands (B3).
   */
  publishedAs?: string;
  /**
   * The Drive file this drawcast was published to before, if it has been.
   * Read only to decide whether the Drive panel's rename warning has anything
   * to warn about — before the first publish there is no file to rename.
   */
  drivePublishedId?: string;
  /**
   * What that Drive file is CALLED, without the .yaml. Prefills the Drive
   * panel's name field, so republishing keeps the name the author gave it
   * instead of renaming the file back to the document title (fix round 1).
   * Written only by `publishDriveCast`, after the file lands — never here.
   */
  drivePublishedName?: string;
}

export interface ShareDeps {
  subject: "drawcast" | "course";
  /** The open document/course, read fresh each time — never cached. */
  doc: () => ShareDoc;
  /** The live settings object; Share writes `shareTo`, `burnCaptions` and
   *  `burnCaptionsOnUpload` onto it, same as the controls it replaces did. */
  settings: Settings;
  persist: () => void;
  setStatus: (text: string, kind?: "info" | "error" | "ok") => void;
  setStatusAction: (text: string, label: string, onClick: () => void, kind?: "info" | "error" | "ok") => void;
  refreshLibrary: () => void;
  refreshAccountRow: () => void;
  openSettings: () => void;
  /**
   * Publish this document to its GitHub Pages home — `publishDrawcast()` or
   * `publishCourse()` depending on `subject`. The two checkboxes are Link's
   * `bake` (synthesizes the narration into the published copy) and
   * `embedImages` (resolves every portrait/source image into it) — both act
   * on the COPY, since publish/embed.ts clones before resolving, so neither
   * can rewrite the document the author has open (P §3.4). `slug` is Link's
   * name field, trimmed — undefined when it was left empty, which happens
   * only for `subject: "course"` (the field is hidden there; a course has no
   * single slug of its own). For a drawcast, editing the name mints a NEW
   * file at the new slug; the old one is never deleted (B3).
   */
  publish: (choices: { bake: boolean; embedImages: boolean; slug?: string }) => Promise<void>;
  /**
   * Publish this document to the author's own Google Drive — the SAME
   * prepared copy `publish` sends to GitHub, written as a plain `.yaml` file
   * into the app-created `drawcast` folder (spec §7). `bake` and
   * `embedImages` mean exactly what they mean above (both act on the copy);
   * `name` is the Drive panel's name field, a FILENAME (`fileSafe`, not a
   * slug), undefined when it was left empty. Republishing updates the same
   * file id rather than minting a second one, so the link already out there
   * keeps working — and republishing under an edited name RENAMES that file
   * rather than making a copy, which is what a file in a folder does.
   *
   * Required, not optional: Drive is never offered to a course (`courses:
   * false`), so course.ts's caller passes a stub — but a stub someone had to
   * write, rather than a field a future caller can silently forget.
   */
  publishDrive: (choices: { bake: boolean; embedImages: boolean; name?: string }) => Promise<void>;
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

interface DestRow extends ShareDest {
  /** Hidden entirely when false. Only an environment credential the author
   *  cannot supply from Settings (Google's client config) says no here — a
   *  capability like that must never advertise itself (spec §6). */
  offered: (c: ShareCaps) => boolean;
  /** Ready to use right now. */
  ready: (c: ShareCaps) => boolean;
  /** Why it's disabled, and the route that fixes it — shown when !ready(caps). */
  reason: string;
  courses: boolean;
}

const DESTS: DestRow[] = [
  { id: "link", label: "Publish to GitHub", action: "Publish", offered: () => true, ready: (c) => c.github, reason: "Set a repository and token in Settings", courses: true },
  // Drive's only credential is the build's Google client config — an env
  // credential, so it hides rather than showing a reason nobody can act on.
  // Once it IS configured there is nothing left to be ready FOR: sign-in
  // happens at the publish itself, exactly as Save → Drive already does, so
  // this row never shows the third (disabled) state. Courses stay GitHub-only
  // (spec §9) — a course is many files, and Drive publishing writes one.
  { id: "drive", label: "Google Drive", action: "Publish", offered: (c) => c.google, ready: () => true, reason: "", courses: false },
  { id: "youtube", label: "YouTube", action: "Upload", offered: (c) => c.google, ready: (c) => c.tts, reason: "Add a Google TTS key in Settings", courses: false },
  { id: "video", label: "Video file", action: "Export", offered: () => true, ready: (c) => c.tts, reason: "Add a Google TTS key in Settings", courses: false },
];

/** One destination as Share's rail offers it: shown, and either ready to
 *  select or shown disabled with the reason and route to fix it (spec §0.1's
 *  third state — distinct from `offered`, which decides whether a row shows
 *  at all). */
export interface DestOffer {
  id: ShareTo;
  label: string;
  action: string;
  enabled: boolean;
  reason?: string;
}

/**
 * Every destination the rail shows, in order — a course gets the link alone
 * (batch video export is not written). A credential the author can supply in
 * Settings (GitHub repo+token; the TTS key) always gets a row, disabled with
 * its reason when missing; an environment credential (Google) that the
 * author cannot supply stays hidden instead (spec §0.1).
 */
export function destinationOffers(caps: ShareCaps, subject: "drawcast" | "course"): DestOffer[] {
  return DESTS
    .filter((d) => (subject === "course" ? d.courses : true) && d.offered(caps))
    .map(({ id, label, action, ready, reason }) =>
      ready(caps) ? { id, label, action, enabled: true } : { id, label, action, enabled: false, reason },
    );
}

/**
 * The subset of `destinationOffers` that is actually ready to use.
 * `shareDestinations` predates the rail's third (disabled-with-reason) state
 * and several callers/tests still want "just the usable ones" — this keeps
 * that shape rather than making every caller filter for itself.
 */
export function shareDestinations(caps: ShareCaps, subject: "drawcast" | "course"): ShareDest[] {
  return destinationOffers(caps, subject)
    .filter((o) => o.enabled)
    .map(({ id, label, action }) => ({ id, label, action }));
}

/** Every destination id there is — panelVisibility's `all`, and the modal's fixed set of panels. */
const ALL_DESTS: ShareTo[] = DESTS.map((d) => d.id);

/**
 * Which of the four panels should be visible: exactly the selected one, and
 * ONLY if it is actually offered right now. A destination that is filtered
 * out of `available` (an unconfigured capability) must never show its panel
 * even if `selected` still names it — a stale/unavailable selection hides
 * everything rather than leaking that panel's content.
 */
export function panelVisibility(all: ShareTo[], available: ShareDest[], selected: ShareTo): Record<ShareTo, boolean> {
  const offered = new Set(available.map((d) => d.id));
  return Object.fromEntries(all.map((id) => [id, offered.has(id) && id === selected])) as Record<ShareTo, boolean>;
}

/** Recomputed on every open — credentials can change while Share is closed. */
function currentCaps(settings: Settings): ShareCaps {
  return {
    github: Boolean(getGithubToken() && parseRepo(settings.githubRepo)),
    google: googleConfigured(),
    tts: Boolean(getTtsKey()),
  };
}

/**
 * Strip a title down to characters safe in a filename, everywhere a
 * drawcast is saved or exported: disk, Drive, GitHub (main.ts's Save menu)
 * and every destination here. One rule, shared — main.ts used to carry a
 * third copy of this exact regex inlined at its disk-save call site, plus a
 * second standalone copy for the prompt-library export (its own `fallback`
 * covers that case; every save-destination call site keeps "drawcast").
 * Capped at 40 characters, cut at a word boundary — the fix for "the name is
 * a bit long" (P §8.1).
 */
export function fileSafe(name: string, fallback = "drawcast"): string {
  const MAX = 40;
  let safe = name.replace(/[^\wæøå -]+/gi, "").trim();
  if (safe.length > MAX) {
    const cut = safe.slice(0, MAX + 1);
    const boundary = cut.lastIndexOf(" ");
    safe = (boundary > MAX / 2 ? cut.slice(0, boundary) : safe.slice(0, MAX)).trim();
  }
  return safe || fallback;
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

  /**
   * The two things a Publish can put INTO the copy it sends. Built as one
   * unit because BOTH publish destinations — GitHub and Drive — offer exactly
   * this pair, and the day they stop matching is the day one of them starts
   * lying about what it sent. Instantiated once per panel; `key` is what
   * keeps the two checkbox ids apart, since a `<label for>` resolves through
   * document.getElementById and a duplicate id would let one panel's label
   * toggle the other panel's box.
   *
   * Both default ON (P §3.6: what you publish should stand on its own), and
   * neither is remembered between opens — they are decisions about one
   * publish, not a setting (see the ledger). Neither touches the document the
   * author has open: publish/embed.ts resolves on clones, and baking builds
   * its audio track beside the playlist rather than in it.
   *
   * Each label is a two-column grid (box | words, hint under the words), so
   * every child has to BE an element — a stray " " text node between them
   * would become an anonymous grid item and take a column of its own. The
   * words themselves are left empty here and written by refresh(), which runs
   * on every open before the modal is shown: one statement of each sentence,
   * in the place that knows which of the two it is.
   */
  function buildEmbedChoices(key: string): {
    rows: HTMLElement[];
    refresh: (doc: ShareDoc, subject: "drawcast" | "course") => void;
    choices: () => { bake: boolean; embedImages: boolean };
  } {
    const embedImagesCb = h("input", { type: "checkbox", id: `${key}-embed-images` }) as HTMLInputElement;
    const embedImagesText = h("span", {});
    const embedImagesHint = h("div", { class: "hint" });
    const embedImagesLabel = h(
      "label",
      { class: "publish-choice", for: `${key}-embed-images` },
      embedImagesCb,
      embedImagesText,
      embedImagesHint,
    );
    const bakeCb = h("input", { type: "checkbox", id: `${key}-embed-narration` }) as HTMLInputElement;
    const bakeHint = h("div", { class: "hint" });
    const bakeLabel = h(
      "label",
      { class: "publish-choice", for: `${key}-embed-narration` },
      bakeCb,
      h("span", {}, "Embed narration"),
      bakeHint,
    );
    return {
      rows: [embedImagesLabel, bakeLabel],
      refresh(doc, subject) {
        // A course has no playlist of its own to count (its lectures live in
        // the library — see course.ts's doc()), so it gets the choice without
        // a number rather than a confident, wrong "(0)".
        const embedCount = subject === "course" ? null : unembeddedImages(doc.playlist);
        embedImagesText.textContent = embedCount === null ? "Embed images" : `Embed images (${embedCount})`;
        embedImagesCb.disabled = embedCount === 0;
        embedImagesCb.checked = embedCount !== 0;
        embedImagesHint.textContent =
          embedCount === 0
            ? "all images are already in the file"
            : "the published file carries them; your document is unchanged";
        // Narration is the one choice that can't default on for everyone:
        // baking needs a Google TTS key, and publishTextFor throws without
        // one — an on-by-default box would make every publish fail for an
        // author who has no key. Same third state the rail uses: offered,
        // disabled, with the route that fixes it.
        const tts = Boolean(getTtsKey());
        bakeCb.disabled = !tts;
        bakeCb.checked = tts;
        bakeHint.textContent = tts
          ? "the published file speaks; viewers need no key"
          : "add a Google TTS key in Settings to publish the narration";
      },
      choices: () => ({
        bake: bakeCb.checked,
        // `!embedImagesCb.disabled` is the count-is-zero case: nothing to
        // embed, so the answer is no regardless of what the box looks like.
        embedImages: embedImagesCb.checked && !embedImagesCb.disabled,
      }),
    };
  }

  // ---- Link panel ----

  // The only line telling the author whether Publish is about to send one
  // drawcast or an entire course — Share serves both from this same panel.
  // Text and visibility come from prepPanels(); empty and hidden for a
  // drawcast, which has no lecture count to show.
  const linkSubjectLine = h("div", { class: "hint" });
  // The name a drawcast publishes under — prefilled from whatever it
  // published as before, or a fresh slug of the title on a first publish.
  // Normalized on blur (not on every keystroke — a mid-word slugify would
  // fight the author's cursor) so what the field shows is exactly what
  // `slug:` below will send. Hidden for a course: courses have no single
  // slug of their own (`publishCourse` derives each lecture's own path), so
  // the field would have nothing true to prefill or send (B3).
  const publishNameInput = h("input", { type: "text", class: "yt-field", "aria-label": "Publish as" }) as HTMLInputElement;
  publishNameInput.addEventListener("blur", () => {
    publishNameInput.value = slugify(publishNameInput.value);
  });
  const publishNameHint = h("div", { class: "hint" }, "Changing the name publishes a new copy; the old link keeps working.");
  const publishNameRow = h("div", {}, h("label", { class: "quiet-label" }, "Name ", publishNameInput), publishNameHint);
  // Key "share" so this panel's two boxes keep the exact ids they have always
  // had ("share-embed-images"/"share-embed-narration") — extracting the rows
  // into a builder must not be observable from outside this file.
  const linkChoices = buildEmbedChoices("share");
  const linkPanel = h("div", { class: "share-panel" }, linkSubjectLine, publishNameRow, ...linkChoices.rows);
  const publishGo = h("button", { class: "primary" }, "Publish") as HTMLButtonElement;
  publishGo.addEventListener("click", () => {
    const deps = current;
    const choices = { ...linkChoices.choices(), slug: publishNameInput.value.trim() || undefined };
    modal.dialog.close();
    void deps.publish(choices);
  });

  // ---- Drive panel — the same prepared copy, as a file instead of a page ----

  // What a Drive publish IS, in one line, because it is the one destination
  // whose result is not a link the app can hand you: the app never touches
  // permissions (spec §8), so until the author flips link-sharing in Drive
  // themselves the file is theirs alone — and sharing it as a FILE (in an
  // email, a folder, a class Drive) is the point, not a fallback.
  const driveHint = h(
    "div",
    { class: "hint" },
    "A finished file, not a link — share it from Drive with whoever should have it; they open it in drawcast.",
  );
  // A FILENAME, so `fileSafe` — never `slugify`. Normalized on blur (not on
  // every keystroke, which would fight the author's cursor) so the field
  // shows exactly the name Drive will hold; emptying it snaps back to the
  // title-derived default rather than leaving a blank that means something
  // invisible.
  const driveNameInput = h("input", { type: "text", class: "yt-field", "aria-label": "File name" }) as HTMLInputElement;
  driveNameInput.addEventListener("blur", () => {
    driveNameInput.value = fileSafe(driveNameInput.value, fileSafe(current.doc().title));
  });
  // Unlike Link's name field, which mints a NEW file at a new slug and leaves
  // the old link alive (B3), this one renames the file already published:
  // saveSpec's update carries the metadata part, and a file in a folder is
  // the same file whatever it is called. Say so, since the two sit two rail
  // rows apart and read identically otherwise — but only once there IS a file
  // to rename (prepPanels hides it before the first publish).
  const driveNameHint = h("div", { class: "hint" }, "Publishing again renames the same file in Drive; the link keeps working.");
  const driveNameRow = h("div", {}, h("label", { class: "quiet-label" }, "Name ", driveNameInput), driveNameHint);
  const driveChoices = buildEmbedChoices("drive");
  const drivePanel = h("div", { class: "share-panel" }, driveHint, driveNameRow, ...driveChoices.rows);
  const driveGo = h("button", { class: "primary" }, "Publish") as HTMLButtonElement;
  driveGo.addEventListener("click", () => {
    const deps = current;
    const choices = { ...driveChoices.choices(), name: driveNameInput.value.trim() || undefined };
    modal.dialog.close();
    void deps.publishDrive(choices);
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

  // Spec file panel — GONE. Downloading your own source is a save, not a
  // share (spec §1); it now lives in Save → To disk (main.ts's
  // openSaveToDisk), which reproduces this panel's picker, formatPlaylist
  // call and filename rule verbatim.

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

  /** Ticked languages, in catalog order, source first when it is among them. */
  function ytSelected(): string[] {
    const src = sourceLanguage(current.doc().playlist);
    const picked = LANGUAGES.filter((l) => ytLangCbs.get(l.code)?.checked).map((l) => l.code);
    return picked.includes(src) ? [src, ...picked.filter((c) => c !== src)] : picked;
  }

  /** What gets recorded for one language: the translation, or the document itself. */
  function playlistFor(code: string): Playlist {
    const doc = current.doc();
    return code === sourceLanguage(doc.playlist) ? doc.playlist : (ytTranslations.get(code) ?? doc.playlist);
  }

  /** Ready to upload once at least one language is ticked and translated. */
  function refreshYtButtons(): void {
    const doc = current.doc();
    const picked = ytSelected();
    const ready = picked.every((c) => c === sourceLanguage(doc.playlist) || ytTranslations.has(c));
    ytGo.disabled = picked.length === 0 || !ready;
    ytGo.textContent = picked.length > 1 ? `Upload ${picked.length} videos` : "Upload";
    ytSaveCopy.hidden = !picked.some((c) => ytTranslations.has(c));
    // One language: the field is the title, yours to edit. Several: each
    // video takes its own translated title, because one field cannot hold four.
    ytTitle.disabled = picked.length > 1;
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
    const playlist = current.doc().playlist;
    const specs: Spec[] = [];
    const problems: string[] = [];
    for (const spec of itemsOf(playlist).map((i) => i.spec)) {
      const schema = spec.template ? scenes[spec.template]?.manifest.params_schema : undefined;
      const { spec: out, check } = await translateSpec(spec, target, { apiKey, model: current.settings.model }, schema);
      if (check.missing.length > 0) problems.push(`${check.missing.length} string(s) left in ${languageLabel(sourceLanguage(playlist))}`);
      // Cheap structural guard: ids and gotos are never sent to the model, so
      // a broken reference here means a bug in the extractor, not a bad answer.
      const broken = lintCommands(out).filter((i) => i.severity === "error");
      if (broken.length > 0) problems.push(broken[0].message);
      specs.push(out);
    }
    ytTranslations.set(code, playlistWithSpecs(playlist, specs));
    ytStatus.textContent = problems.length > 0 ? `Translated into ${target.label} — ${problems.join("; ")}.` : `Translated into ${target.label}.`;
  }

  for (const [code, cb] of ytLangCbs) {
    cb.addEventListener("change", () => {
      if (!cb.checked || code === sourceLanguage(current.doc().playlist) || ytTranslations.has(code)) {
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
        parts: itemsOf(playlist).length, // what the library's ▤ marker reads
        sourcePath: null, // a new sibling drawing, never a saved GitHub source of its own
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

  const panels: Record<ShareTo, HTMLElement> = { link: linkPanel, drive: drivePanel, youtube: youtubePanel, video: videoPanel };
  const actionBtns: Record<ShareTo, HTMLButtonElement> = { link: publishGo, drive: driveGo, youtube: ytGo, video: videoGo };

  const rail = h("div", { class: "share-rail" });
  const panelHost = h("div", { class: "share-panel-host" }, linkPanel, drivePanel, youtubePanel, videoPanel);
  const layout = h("div", { class: "share-layout" }, rail, panelHost);
  const settingsBtn = h("button", { class: "small" }, "Open Settings");
  settingsBtn.addEventListener("click", () => {
    modal.dialog.close();
    current.openSettings();
  });
  const emptyHint = h(
    "div",
    { class: "hint" },
    "Publishing needs a destination — the rows above say what each one needs. ",
    settingsBtn,
  );

  // backdropCloses: false — carried over from the YouTube dialog this absorbed.
  // A stray outside click must not be able to discard queued translations:
  // prepPanels() clears ytTranslations on the NEXT open, so losing this one
  // to an accidental backdrop click would mean paying for those Anthropic
  // calls a second time.
  const modal = createModal("↗ Publish", { size: "m", class: "share-modal", backdropCloses: false });
  modal.body.append(layout, emptyHint);
  document.body.append(modal.dialog);

  let destinations: DestOffer[] = [];
  let railButtons: HTMLButtonElement[] = [];

  /** `selectDestination` only ever selects an ENABLED offer — a disabled
   *  row's rail button opens Settings instead (wired in refresh()), never
   *  this. */
  function selectDestination(id: ShareTo): void {
    // Only a drawcast's choice is worth remembering. A course offers Link
    // alone (destinationOffers filters to `courses: true` destinations only),
    // so refresh() calling this on every open would overwrite the editor's
    // remembered destination with "link" every time Share is opened from the
    // course panel — silently defeating "Share → Enter" repeat-publish for
    // an author whose drawcast destination was YouTube. `deps.settings` is
    // the app's one Settings object either way (course.ts's openCoursePanel
    // is handed the same `settings` main.ts passes for a drawcast), so this
    // is the one place that has to tell the two subjects apart.
    if (current.subject === "drawcast") {
      current.settings.shareTo = id;
      current.persist();
    }
    // Every panel, not just the enabled ones — a disabled/filtered-out
    // destination's panel has never had `.hidden` touched otherwise, and
    // stays visible by default (the bug this pure function pins).
    const enabled = destinations.filter((d) => d.enabled);
    const visible = panelVisibility(ALL_DESTS, enabled, id);
    for (const key of ALL_DESTS) panels[key].hidden = !visible[key];
    destinations.forEach((d, i) => railButtons[i].classList.toggle("current", d.enabled && d.id === id));
    const left = id === "youtube" ? [h("div", { class: "footer-left" }, ytSaveCopy)] : [];
    modal.footer.replaceChildren(...left, actionBtns[id]);
  }

  /** Field defaults for every panel, set once per Share open — not on every
   *  rail click, so glancing at another destination and back does not throw
   *  away a typed title or description. */
  function prepPanels(): void {
    const doc = current.doc();
    const playlist = doc.playlist;
    videoBurnCb.checked = current.settings.burnCaptions;
    videoLangHint.textContent = `Renders in ${languageLabel(sourceLanguage(playlist))}.`;
    const lectures = doc.lectureCount ?? 0;
    linkSubjectLine.textContent = current.subject === "course" ? `Course — ${lectures} lecture${lectures === 1 ? "" : "s"}` : "";
    linkSubjectLine.hidden = current.subject !== "course";
    // A course derives each lecture's own path (publishCourse), so it has no
    // single slug for this field to show or send — hidden rather than shown
    // disabled, since there is nothing here for a course author to decide.
    publishNameRow.hidden = current.subject === "course";
    publishNameInput.value = doc.publishedAs ?? slugify(doc.title);
    linkChoices.refresh(doc, current.subject);
    // A filename, not a slug — and the name the file ALREADY has wins over
    // the title, exactly as Link prefers `publishedAs`. Without that, an
    // author who renamed the file once would have it renamed back to the
    // document title by their next publish (fix round 1, finding 3).
    driveNameInput.value = doc.drivePublishedName ?? fileSafe(doc.title);
    // Nothing has been published yet — there is no file for "publishing again
    // renames the same file" to be about.
    driveNameHint.hidden = !doc.drivePublishedId;
    driveChoices.refresh(doc, current.subject);
    ytDesc.value = "Made with drawcast.";
    ytPrivacy.value = "private";
    ytBurnCb.checked = current.settings.burnCaptionsOnUpload;
    ytTranslations.clear();
    for (const [code, cb] of ytLangCbs) cb.checked = code === sourceLanguage(playlist);
    ytStatus.textContent = "";
    refreshYtButtons();
  }

  function refresh(deps: ShareDeps): void {
    current = deps;
    // Never empty: `link` (drawcast and course) and `video` (drawcast) are
    // always offered, disabled with a reason when their credential is
    // missing rather than hidden (spec §0.1) — only the two Google rows
    // (`drive`, `youtube`) can drop out entirely, since their credential is
    // the build's, not one Settings can supply.
    destinations = destinationOffers(currentCaps(deps.settings), deps.subject);
    prepPanels();
    railButtons = destinations.map((d) => {
      const b = h("button", { class: d.enabled ? "share-dest" : "share-dest dest-off" }, d.label) as HTMLButtonElement;
      if (!d.enabled && d.reason) b.append(h("div", { class: "hint" }, d.reason));
      b.addEventListener("click", () => {
        // A `disabled` button would swallow the click — this stays an
        // enabled button styled `.dest-off`, so it can still route the
        // author to Settings instead of trying to select an offer that
        // isn't ready.
        if (!d.enabled) {
          modal.dialog.close();
          current.openSettings();
          return;
        }
        selectDestination(d.id);
      });
      return b;
    });
    rail.replaceChildren(...railButtons);

    const enabled = destinations.filter((d) => d.enabled);
    panelHost.hidden = enabled.length === 0;
    emptyHint.hidden = enabled.length > 0;
    if (enabled.length === 0) {
      modal.footer.replaceChildren();
      return;
    }
    const remembered = deps.settings.shareTo;
    selectDestination(enabled.some((d) => d.id === remembered) ? remembered : enabled[0].id);
  }

  return { modal, refresh };
}
