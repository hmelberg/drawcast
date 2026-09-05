// Every way a drawcast leaves the app, behind one verb. The options that used
// to sit in the toolbar next to Publish live here instead, beside the
// destination they actually belong to — the "Translate to" chips are
// YouTube's, and burning captions into the picture is asked about only where
// it can be true (the DOWNLOADED file; a YouTube upload carries its subtitle
// track, spec §2 ruling 4). The two embed choices belong to EVERY publish
// destination (GitHub, Drive and the drawcast server), so buildEmbedChoices
// below builds them once and each panel instantiates its own copy (spec §7).
//
// Everything that touches the DOM lives inside build(), called lazily from
// openShare() — never at module scope. vitest runs this suite with no DOM
// (environment: "node"), so a top-level `h(...)` call would crash the import
// of this file's pure exports (shareDestinations included) the moment any
// test so much as imports them.

import { googleConfigured, requireScope, YOUTUBE_SCOPE } from "../google/auth";
import { uploadCaptions, uploadVideo, type UploadMeta } from "../google/youtube";
import { describeApiError } from "../llm/client";
import { translateSpec, translateText } from "../llm/translate";
import { lintCommands } from "../lint/lint";
import { toVtt } from "../export/captions";
import { LANGUAGES, languageLabel } from "../export/tts";
import type { ExportResult } from "../export/video";
import { exportSequence, formatPlaylist, isSingle, itemsOf, playlistWithSpecs, sourceLanguage, type Playlist } from "../playlist/playlist";
import { scenes } from "../scenes/registry";
import type { Spec } from "../spec/types";
import { downloadBlob, getApiKey, getGithubToken, getTtsKey, saveDrawing, type Settings, type ShareTo } from "../store";
import { DEFAULT_ENROLL_API } from "../learn";
import { getToken } from "../account";
import { checkName, checkNote } from "../names";
import { parseRepo, slugify } from "../publish/github";
import type { ServerAccess } from "../publish/server";
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
  /** Whether the last GitHub publish carried comments (C1) — seeds the checkbox. */
  publishedComments?: boolean;
  /** Whether the last GitHub publish counted views — seeds the checkbox. */
  publishedViews?: boolean;
  /** "123k characters ≈ $19.70" — what Embed narration would spend, priced by
   *  the caller with the live voice picks (export/tts-cost.ts). Upper bound:
   *  a republish pays only for lines not already published. */
  narrationCost?: string;
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
  /**
   * Whether the course document carries an `enroll:` line, i.e. whether the
   * published course page shows the join box (learners round). Seeds the
   * "Allow sign-up" checkbox; course only — undefined for a drawcast.
   */
  joinBox?: boolean;
  /**
   * The `enroll:` URL the course document currently carries, when it is not
   * the default app — shown so an author with their own Anvil backend can
   * see what unchecking would delete (F2). Course only.
   */
  enrollUrl?: string;
}

export interface ShareDeps {
  subject: "drawcast" | "course";
  /** The open document/course, read fresh each time — never cached. */
  doc: () => ShareDoc;
  /** The live settings object; Share writes `shareTo` and `burnCaptions` onto
   *  it, same as the controls it replaces did. */
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
   *
   * `allowSignup` is the course-only join-box choice (teachers round): true
   * writes `enroll: <default app>` into the course document before
   * publishing, false removes the line; undefined for `subject: "drawcast"`.
   */
  publish: (choices: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean; allowSignup?: boolean }) => Promise<void>;
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
   * Publish this document to the drawcast server (round 0 spec §4): the SAME
   * prepared copy again, stored under the author's account as two objects
   * (spec and narration) at `anvil/<name>/<file>`. `bake` and `embedImages`
   * mean what they mean above; `name` is the server panel's name field — a
   * slug like Link's, the key's first segment and the name registered after
   * the publish — undefined when left empty; `access` is the "Who can watch"
   * choice, two of spec §5's three values in this round.
   *
   * Required for the same reason `publishDrive` is: the server is never
   * offered to a course here (`courses: false`), so course.ts passes a stub
   * it had to write rather than a field a future caller can forget.
   */
  publishServer: (choices: { bake: boolean; embedImages: boolean; name?: string; access: ServerAccess }) => Promise<void>;
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
  // The drawcast server (round 0 spec §4, §9): the app's own storage, per
  // account — the one destination that can keep a cast behind sign-in. Its
  // only credential is the session token, and Settings → Publishing is where
  // that comes from; but the row is always offered and always ready, so a
  // signed-out author still opens the PANEL and reads what this destination
  // is for. The panel's Publish button is what says "Sign in to publish
  // here" (refreshServerSignIn), not the rail. Courses stay GitHub-only in
  // this round: one cast per key, and a course is many files.
  { id: "server", label: "drawcast server", action: "Publish", offered: () => true, ready: () => true, reason: "", courses: false },
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
 * Which of the five panels should be visible: exactly the selected one, and
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

/**
 * Which languages an upload records, in which order: the chips the author has
 * added, deduped, with the SOURCE first whenever it is among them (spec §2
 * ruling 2). Order matters twice over — the original is what most viewers
 * want first, and phase 1 translates in this same order, so the queue's shape
 * is the run's shape.
 *
 * Removing the source chip is a real choice (upload the German version and
 * nothing else), which is why an empty source is simply absent rather than
 * forced back in. An empty queue is the Upload button's off switch. Pure and
 * exported so the ordering rule can be tested without a DOM.
 */
export function ytQueue(source: string, chips: string[]): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const code of chips) {
    if (!code || seen.has(code)) continue;
    seen.add(code);
    picked.push(code);
  }
  return picked.includes(source) ? [source, ...picked.filter((c) => c !== source)] : picked;
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
   * unit because EVERY publish destination — GitHub, Drive and the drawcast
   * server — offers exactly this pair, and the day they stop matching is the
   * day one of them starts lying about what it sent. Instantiated once per
   * panel; `key` is what keeps the checkbox ids apart, since a `<label for>`
   * resolves through document.getElementById and a duplicate id would let
   * one panel's label toggle another panel's box.
   *
   * Both default ON (P §3.6: what you publish should stand on its own) —
   * except narration on the server, where `bakeDefault` is false (round 0
   * spec §4): baked audio is megabytes the server streams on every first
   * play, where GitHub's CDN serves it for nothing. Neither is remembered
   * between opens — they are decisions about one publish, not a setting (see
   * the ledger). Neither touches the document the author has open:
   * publish/embed.ts resolves on clones, and baking builds its audio track
   * beside the playlist rather than in it.
   *
   * Each label is a two-column grid (box | words, hint under the words), so
   * every child has to BE an element — a stray " " text node between them
   * would become an anonymous grid item and take a column of its own. The
   * words themselves are left empty here and written by refresh(), which runs
   * on every open before the modal is shown: one statement of each sentence,
   * in the place that knows which of the two it is.
   */
  function buildEmbedChoices(key: string, bakeDefault = true): {
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
        bakeCb.checked = tts && bakeDefault;
        const speaks = "the published file speaks; viewers need no key";
        bakeHint.textContent = tts
          ? doc.narrationCost
            ? `${speaks} — up to ${doc.narrationCost} of TTS (lines already published are free again)`
            : speaks
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

  /**
   * The Check button beside a name field (round 0 spec §9): advice, not a
   * reservation — nothing is held, and the publish still decides. It fires
   * on the CLICK only, never on `input`: the name budget is 600/h per IP,
   * and check-as-you-type would spend it on one impatient author. Built
   * once per name field, like buildEmbedChoices: the GitHub panel's name and
   * the server panel's name are both registered after a publish, so both
   * can be asked about first. The button sits INSIDE the field's label so
   * the three stay on one line; a click on it is the button's own — a label
   * does not re-target a click on an interactive descendant.
   */
  function buildNameCheck(input: HTMLInputElement): { button: HTMLButtonElement; note: HTMLElement; reset: () => void } {
    const button = h("button", { class: "small", type: "button" }, "Check") as HTMLButtonElement;
    const note = h("div", { class: "hint" });
    button.addEventListener("click", () => {
      void (async () => {
        // What the field shows is what the publish will send: the blur
        // handler's normalization, applied here too, so a click that never
        // blurred the field (Safari does not focus buttons) still checks
        // the slug rather than the raw keystrokes.
        input.value = slugify(input.value);
        const name = input.value;
        button.disabled = true;
        note.textContent = "Checking…";
        try {
          note.textContent = checkNote(await checkName(DEFAULT_ENROLL_API, name, getToken()), name);
        } finally {
          button.disabled = false;
        }
      })();
    });
    return {
      button,
      note,
      reset: () => {
        note.textContent = "";
      },
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
  // The name is also what the publish registers (castRegistration), so it
  // can be asked about first (spec §9).
  const publishNameCheck = buildNameCheck(publishNameInput);
  const publishNameRow = h("div", {}, h("label", { class: "quiet-label" }, "Name ", publishNameInput, publishNameCheck.button), publishNameCheck.note, publishNameHint);
  // Key "share" so this panel's two boxes keep the exact ids they have always
  // had ("share-embed-images"/"share-embed-narration") — extracting the rows
  // into a builder must not be observable from outside this file.
  const linkChoices = buildEmbedChoices("share");
  // "Allow comments" (C1) is a GitHub-panel choice only: the viewer derives
  // data-repo from the cast link itself, which a Drive file does not have.
  // The setup step giscus needs (Discussions on, app installed, ids from
  // giscus.app) cannot be automated from here — so the box is disabled with
  // the route that fixes it, the same third state the rail uses (B1).
  const commentsCb = h("input", { type: "checkbox", id: "share-allow-comments" }) as HTMLInputElement;
  const commentsHint = h("div", { class: "hint" });
  const commentsLabel = h(
    "label",
    { class: "publish-choice", for: "share-allow-comments" },
    commentsCb,
    h("span", {}, "Allow comments"),
    commentsHint,
  );
  function refreshCommentsChoice(doc: ShareDoc): void {
    const ready = current.settings.giscusRepoId !== "" && current.settings.giscusCategoryId !== "";
    commentsCb.disabled = !ready;
    // Re-derived per document on every open, like the sibling checkboxes —
    // and seeded from the last publish, so a typo-fix republish keeps a live
    // page's comments instead of silently stripping them (final review).
    commentsCb.checked = ready && doc.publishedComments === true;
    commentsHint.textContent = ready
      ? "viewers comment and react via GitHub Discussions in YOUR repository"
      : "needs a one-time giscus setup — enable Discussions, install the giscus app, paste the ids in Settings → Publishing";
  }
  // "Count views": the published player reports plays to drawcast's counter.
  // Unlike comments this needs no setup, so it is never disabled — and it
  // defaults ON, with the last publish's answer winning when there is one, so
  // a republish cannot silently start counting a drawcast that opted out.
  const countViewsCb = h("input", { type: "checkbox", id: "share-count-views" }) as HTMLInputElement;
  const countViewsLabel = h(
    "label",
    { class: "publish-choice", for: "share-count-views" },
    countViewsCb,
    h("span", {}, "Count views"),
    h("div", { class: "hint" }, "the published page reports plays, so you can see how often it is watched"),
  );
  function refreshCountViewsChoice(doc: ShareDoc): void {
    countViewsCb.checked = doc.publishedViews !== false;
  }
  // "Allow sign-up on the course page" (teachers round, spec §5): a course
  // only. On, the publish writes `enroll: <default app>` into the course
  // document; off, it removes the line. An author running their own Anvil
  // app keeps whatever URL they typed — applyJoinBox only ever writes the
  // default. Seeded from the document itself, so a republish shows what the
  // page currently does, and a new course starts with it off.
  const signupCb = h("input", { type: "checkbox", id: "share-allow-signup" }) as HTMLInputElement;
  const signupHint = h("div", { class: "hint" });
  const signupLabel = h(
    "label",
    { class: "publish-choice", for: "share-allow-signup" },
    signupCb,
    h("span", {}, "Allow sign-up on the course page"),
    signupHint,
  );
  const SIGNUP_HINT_DEFAULT = "the course page gets a join box: learners get a course code, and you see their progress and answers in the teacher dashboard";
  function refreshSignupChoice(doc: ShareDoc, subject: "drawcast" | "course"): void {
    signupLabel.hidden = subject !== "course";
    signupCb.checked = doc.joinBox === true;
    // An author running their OWN Anvil backend needs to see that URL before
    // unchecking deletes it — the course document was the only record of it
    // (F2). The default app's own URL is not worth naming; it is what
    // checking the box writes back in either case.
    signupHint.textContent =
      doc.enrollUrl && doc.enrollUrl !== DEFAULT_ENROLL_API
        ? `your own app: ${doc.enrollUrl} — unchecking removes this line from the course document`
        : SIGNUP_HINT_DEFAULT;
  }
  const linkPanel = h("div", { class: "share-panel" }, linkSubjectLine, publishNameRow, ...linkChoices.rows, commentsLabel, countViewsLabel, signupLabel);
  const publishGo = h("button", { class: "primary" }, "Publish") as HTMLButtonElement;
  publishGo.addEventListener("click", () => {
    const deps = current;
    const choices = {
      ...linkChoices.choices(),
      slug: publishNameInput.value.trim() || undefined,
      allowComments: commentsCb.checked && !commentsCb.disabled,
      countViews: countViewsCb.checked,
      allowSignup: deps.subject === "course" ? signupCb.checked : undefined,
    };
    modal.dialog.close();
    void deps.publish(choices);
  });

  // ---- drawcast server panel — the same prepared copy, under the author's account ----

  // What this destination IS, in one line: the only one that can keep a cast
  // behind sign-in (round 0 spec §4) — the other two publish to places that
  // are public by construction.
  const serverHint = h(
    "div",
    { class: "hint" },
    "Stored by drawcast itself, under your account — the one destination that can keep a cast behind sign-in.",
  );
  // The publish NAME: the first segment of the server's key
  // (`anvil/<name>/<file>`) and, once registered, the address
  // drawcast.app/#<name>. A slug like Link's, normalized on blur for the same
  // reason (a mid-word slugify would fight the author's cursor). Prefilled
  // like Link's too, so a drawcast already on GitHub keeps one name across
  // both targets and registration simply moves the pointer.
  const serverNameInput = h("input", { type: "text", class: "yt-field", "aria-label": "Publish as" }) as HTMLInputElement;
  serverNameInput.addEventListener("blur", () => {
    serverNameInput.value = slugify(serverNameInput.value);
  });
  // "Replaces" only when the whole key is unchanged: the file half follows
  // the title until the drawcast has published to GitHub (publishedAs), so a
  // retitled, never-on-GitHub drawcast writes a NEW copy beside the old one,
  // which nothing can delete until round 1. Promise no more than that.
  const serverNameHint = h(
    "div",
    { class: "hint" },
    "Publishing again with the same name and title replaces the copy on the server; a changed title may write a new copy beside the old one.",
  );
  const serverNameCheck = buildNameCheck(serverNameInput);
  const serverNameRow = h("div", {}, h("label", { class: "quiet-label" }, "Name ", serverNameInput, serverNameCheck.button), serverNameCheck.note, serverNameHint);
  // "Who can watch" (spec §5, question 2) — two of its three values in this
  // round, because two are all the server enforces: `open` is public,
  // anything else is the owner's alone until enrolment lands. Defaults
  // CLOSED, unlike GitHub, where the files are public whatever is chosen.
  const serverAccess = h("select", { "aria-label": "Who can watch" }) as HTMLSelectElement;
  for (const [v, label] of [
    ["enrolled", "Only you, for now"],
    ["open", "Anyone with the link"],
  ]) {
    serverAccess.appendChild(h("option", { value: v }, label));
  }
  const serverAccessRow = h(
    "div",
    {},
    h("label", { class: "quiet-label" }, "Who can watch ", serverAccess),
    // Said before the click, like the narration: the choice is not remembered
    // and the server keeps only the last answer, so a republish left on
    // "Only you" closes a cast that was open — and every shared link with it.
    h(
      "div",
      { class: "hint" },
      "A closed cast plays only for you, signed in; enrolment comes next. Every publish sets this anew — publishing again on “Only you” closes a cast that was open.",
    ),
  );
  // Narration defaults OFF here (spec §4) — see buildEmbedChoices. Unticked
  // is not "leave it": every spec write clears the narration stored on the
  // server, so the consequence is said BEFORE the click as well as after.
  const serverChoices = buildEmbedChoices("server", false);
  const serverNarrationHint = h(
    "div",
    { class: "hint" },
    "Narration unticked: the copy on the server plays with a browser voice, and any narration stored there earlier is removed.",
  );
  // No "Count views" here, and a word on why: the public counter refuses
  // every anvil/ key (views.ts PRIVATE_OWNERS — a private cast's views are
  // not the public's), so a checkbox would promise something that cannot
  // happen. Enrolled learners' progress is the dashboard's, not a counter's.
  const serverViewsHint = h("div", { class: "hint" }, "Plays of a cast stored here are not counted publicly; enrolled learners' progress shows in the teacher dashboard.");
  const serverSignInHint = h("div", { class: "hint" }, "Publishing here needs your drawcast account — sign in from Settings → Publishing.");
  const serverPanel = h(
    "div",
    { class: "share-panel" },
    serverHint,
    serverNameRow,
    serverAccessRow,
    ...serverChoices.rows,
    serverNarrationHint,
    serverViewsHint,
    serverSignInHint,
  );
  const serverGo = h("button", { class: "primary" }, "Publish") as HTMLButtonElement;
  serverGo.addEventListener("click", () => {
    const deps = current;
    const access: ServerAccess = serverAccess.value === "open" ? "open" : "enrolled";
    // The blur handler's normalization, applied here too — Safari does not
    // move focus to a clicked button, so the field can reach Publish raw, and
    // a raw `learn-russian/3` would pass normalizeName as a sub-name and put
    // a slash into the key's first segment. Same as the Check button does.
    serverNameInput.value = slugify(serverNameInput.value);
    const choices = { ...serverChoices.choices(), name: serverNameInput.value || undefined, access };
    modal.dialog.close();
    void deps.publishServer(choices);
  });
  /** The server's button is the one place the sign-in state shows: the row
   *  is always offered (DESTS), so a signed-out author still sees the panel,
   *  and the button — not the rail — says what is missing. Re-read on every
   *  open: Settings can sign in or out while Share is closed. */
  function refreshServerSignIn(): void {
    const signedIn = getToken() !== "";
    serverGo.disabled = !signedIn;
    serverGo.textContent = signedIn ? "Publish" : "Sign in to publish here";
    serverSignInHint.hidden = signedIn;
  }

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

  // ---- YouTube panel — five rows, and one language per video ----
  //
  // What a language IS here (spec §1): a complete translation of everything —
  // drawn labels, narration, subtitles — uploaded as its OWN video, recorded
  // in real time in that language's voice. Subtitle-only translation is free
  // to viewers through YouTube's own CC auto-translate once the caption file
  // is attached, so nothing in this panel offers to do it a second time.
  // Adding a language costs nothing until Upload (ruling 1).

  const ytTitle = h("input", { type: "text", class: "yt-field", id: "yt-title", "aria-label": "Video title" }) as HTMLInputElement;
  const ytDesc = h("textarea", { class: "yt-field", id: "yt-desc", rows: "3", "aria-label": "Video description" }) as HTMLTextAreaElement;
  /** "Publishes in Norwegian" — a FACT about the document, not a choice, so it
   *  is text rather than a control. Written by prepPanels(). */
  const ytSourceLine = h("div", {});
  /** The queue as chips: the source first, then one per language to translate
   *  into. Rebuilt wholesale by renderYtLangs() from `ytChips`. */
  const ytChipRow = h("div", { class: "yt-chips" });
  /** Adds a chip and nothing else — no API call, no cost (spec §2 ruling 1).
   *  Its option list is rebuilt with the chips, so a language is never
   *  offered twice. */
  const ytAddLang = h("select", { class: "yt-add-lang", id: "yt-add-lang", "aria-label": "Add a language" }) as HTMLSelectElement;
  const ytLangHint = h("div", { class: "hint" }, "Each translation is a full extra video: drawn labels, narration and subtitles.");
  /** What the queue will cost in time and budget — shown only when there is a
   *  translation to pay for (ruling 3). */
  const ytCost = h("div", { class: "hint" });
  const ytSaveCopy = h("button", {}, "Save the translations as new drawcasts") as HTMLButtonElement;
  // Not `.yt-field`: a three-option dropdown stretched across the panel reads
  // as a text field. It starts at the same x as the rest, which is the point.
  const ytPrivacy = h("select", { id: "yt-privacy", "aria-label": "Visibility" }) as HTMLSelectElement;
  for (const [v, label] of [["private", "Private"], ["unlisted", "Unlisted"], ["public", "Public"]]) {
    ytPrivacy.appendChild(h("option", { value: v }, label));
  }
  const ytStatus = h("div", { class: "hint" });
  const youtubePanel = h(
    "div",
    { class: "share-panel" },
    // Label column, field column — every field starts at the same x, and the
    // language rows stop looking like a different kind of thing from the
    // title (spec §2). The two tall rows top-align their label; the rest centre.
    h(
      "div",
      { class: "yt-grid" },
      h("label", { class: "yt-label", for: "yt-title" }, "Title"),
      ytTitle,
      h("label", { class: "yt-label yt-label-top", for: "yt-desc" }, "Description"),
      ytDesc,
      h("div", { class: "yt-label" }, "Publishes in"),
      ytSourceLine,
      h("label", { class: "yt-label yt-label-top", for: "yt-add-lang" }, "Translate to"),
      h("div", {}, ytChipRow, ytAddLang, ytLangHint, ytCost),
      h("label", { class: "yt-label", for: "yt-privacy" }, "Visibility"),
      ytPrivacy,
    ),
    h(
      "div",
      { class: "hint" },
      "The subtitle file downloads with each upload — attach it with one click afterwards, " +
        "and YouTube auto-translates captions for viewers.",
    ),
    ytStatus,
  );
  const ytGo = h("button", { class: "primary" }, "Upload") as HTMLButtonElement;

  /**
   * The languages queued for upload, in the order they were added — the source
   * among them until the author removes its chip. The ORDER of the run comes
   * from ytQueue(), not from this array; this is just what the author picked.
   */
  const ytChips: string[] = [];

  /**
   * The value refreshYtButtons() last WROTE into the title field. Comparing
   * ytTitle.value against this IS the dirty flag — no `input` listener needed
   * (finding 1): as long as the field still reads what we last put there, the
   * author hasn't typed, and the next auto-write is safe; the moment it
   * diverges, something the author typed always wins.
   */
  let ytTitleAuto = "";

  /**
   * Translated COPIES waiting to be recorded, by language code, each with the
   * description translated alongside it (ruling 5) — a German video described
   * in English is half a translation. They exist only while the modal is open
   * on this document and are never written back to it: exportSequence hands
   * out the document's own spec objects, so translating into fresh playlists
   * is what keeps your drawcast in the language you wrote it in. Kept when a
   * chip is removed, so re-adding it is free.
   */
  const ytTranslations = new Map<string, { playlist: Playlist; description: string }>();

  /** What gets recorded for one language: the translation, or the document itself. */
  function playlistFor(code: string): Playlist {
    const doc = current.doc();
    return code === sourceLanguage(doc.playlist) ? doc.playlist : (ytTranslations.get(code)?.playlist ?? doc.playlist);
  }

  /** The description that video carries. The source language keeps whatever is
   *  in the field; a translation uses its own, falling back to the field
   *  rather than uploading nothing if the model returned a blank. */
  function descriptionFor(code: string): string {
    const doc = current.doc();
    if (code === sourceLanguage(doc.playlist)) return ytDesc.value;
    return ytTranslations.get(code)?.description || ytDesc.value;
  }

  /** The chips row and the add-select, from `ytChips`. One function so the two
   *  can never disagree about which languages are already queued. */
  function renderYtLangs(): void {
    const source = sourceLanguage(current.doc().playlist);
    const queue = ytQueue(source, ytChips);
    ytChipRow.replaceChildren(
      ...queue.map((code) => {
        // The original is a chip like any other — removable, for the author
        // who wants the German video and only the German video (ruling 2) —
        // but it is not a translation, so it says which one it is.
        const isSource = code === source;
        const text = isSource ? `${languageLabel(code)} (original)` : languageLabel(code);
        const remove = h("button", { class: "yt-chip-x", type: "button", "aria-label": `Remove ${text}` }, "×") as HTMLButtonElement;
        remove.addEventListener("click", () => {
          const at = ytChips.indexOf(code);
          if (at >= 0) ytChips.splice(at, 1);
          renderYtLangs();
          refreshYtButtons();
        });
        return h("span", { class: isSource ? "yt-chip yt-chip-source" : "yt-chip" }, remove, text);
      }),
    );
    ytAddLang.replaceChildren(
      h("option", { value: "" }, "＋ Add a language…"),
      // Whatever is not already queued — including the source, once its chip
      // has been removed, so that removal is recoverable without reopening.
      ...LANGUAGES.filter((l) => !queue.includes(l.code)).map((l) =>
        h("option", { value: l.code }, l.code === source ? `${l.label} (original)` : l.label),
      ),
    );
    ytAddLang.value = "";
  }

  ytAddLang.addEventListener("change", () => {
    const code = ytAddLang.value;
    if (!code) return;
    if (!ytChips.includes(code)) ytChips.push(code);
    renderYtLangs();
    refreshYtButtons();
  });

  /** Upload is ready as soon as there is something to upload. Nothing here
   *  waits for a translation any more — the Upload click pays for those
   *  (ruling 1). */
  function refreshYtButtons(): void {
    const doc = current.doc();
    const queue = ytQueue(sourceLanguage(doc.playlist), ytChips);
    const extras = queue.filter((c) => c !== sourceLanguage(doc.playlist)).length;
    ytGo.disabled = queue.length === 0;
    ytGo.textContent = queue.length > 1 ? `Upload ${queue.length} videos` : "Upload";
    ytSaveCopy.hidden = extras === 0;
    // One language: the field is the title, yours to edit. Several: each
    // video takes its own translated title, because one field cannot hold four.
    ytTitle.disabled = queue.length > 1;
    // Only overwrite what we ourselves last wrote — once the field has
    // diverged from ytTitleAuto, the author has typed a title, and a chip
    // add/remove or Save-the-translations must not clobber it (finding 1).
    if (ytTitle.value === ytTitleAuto) {
      ytTitleAuto = queue.length === 1 ? titleOf(playlistFor(queue[0]), doc.title) : doc.title;
      ytTitle.value = ytTitleAuto;
    }
    // Time first, money second: a language is minutes of real-time recording
    // and pennies of API (ruling 3).
    ytCost.hidden = extras === 0;
    ytCost.textContent =
      extras === 0
        ? ""
        : `${extras} extra video(s) will be recorded in real time — roughly ${extras} × the drawcast's length — ` +
          "and each translation spends a little Anthropic and TTS budget.";
  }

  /** How a translate run ended, in the words its caller should show. `ok`
   *  with a message means it finished but something was imperfect. */
  interface TranslateRun {
    ok: boolean;
    cancelled: boolean;
    message: string;
  }

  /**
   * Translate whatever `codes` still needs translating, in order, into the
   * per-session cache. The ONE translate routine: the Upload click runs it as
   * phase 1 with the export chip carrying progress, and "Save the translations"
   * runs it with the modal still open (ruling 6). Neither pays twice — an
   * entry already in the cache is skipped.
   *
   * Fails fast: the first language that cannot be translated stops the run, so
   * a bad key or a refusal surfaces in seconds rather than twenty minutes into
   * a queue of real-time recordings. `signal` is the caller's Cancel; the
   * source language is never translated.
   */
  async function ensureTranslations(
    codes: string[],
    signal: AbortSignal | undefined,
    progress: (text: string) => void,
  ): Promise<TranslateRun> {
    const playlist = current.doc().playlist;
    const source = sourceLanguage(playlist);
    const missing = codes.filter((c) => c !== source && !ytTranslations.has(c));
    if (missing.length === 0) return { ok: true, cancelled: false, message: "" };
    const apiKey = getApiKey();
    if (!apiKey) {
      return { ok: false, cancelled: false, message: "Translating needs your Anthropic API key — add it in Settings." };
    }
    const cfg = { apiKey, model: current.settings.model };
    const problems: string[] = [];
    for (const [i, code] of missing.entries()) {
      const target = LANGUAGES.find((l) => l.code === code);
      if (!target) continue;
      progress(`Translating into ${target.label} — ${i + 1} of ${missing.length}…`);
      try {
        const specs: Spec[] = [];
        for (const spec of itemsOf(playlist).map((it) => it.spec)) {
          const schema = spec.template ? scenes[spec.template]?.manifest.params_schema : undefined;
          const { spec: out, check } = await translateSpec(spec, target, cfg, schema, { signal });
          if (check.missing.length > 0) problems.push(`${check.missing.length} string(s) left in ${languageLabel(source)}`);
          // Cheap structural guard: ids and gotos are never sent to the model,
          // so a broken reference here means a bug in the extractor, not a bad
          // answer.
          const broken = lintCommands(out).filter((it) => it.severity === "error");
          if (broken.length > 0) problems.push(broken[0].message);
          specs.push(out);
        }
        const description = await translateText(ytDesc.value, target, cfg, { signal });
        ytTranslations.set(code, { playlist: playlistWithSpecs(playlist, specs), description });
      } catch (err) {
        if (signal?.aborted) return { ok: false, cancelled: true, message: "Cancelled while translating — nothing was uploaded." };
        return { ok: false, cancelled: false, message: `Could not translate into ${target.label}: ${describeApiError(err)}` };
      }
    }
    return { ok: true, cancelled: false, message: problems.length > 0 ? `Translated, with notes — ${problems.join("; ")}.` : "" };
  }

  ytSaveCopy.addEventListener("click", () => {
    void (async () => {
      const deps = current;
      const doc = deps.doc();
      const source = sourceLanguage(doc.playlist);
      const wanted = ytQueue(source, ytChips).filter((c) => c !== source);
      if (wanted.length === 0) return;
      // Its own verb, paying its own way: whatever is queued but not yet
      // translated is translated now, on this click (ruling 6). The modal is
      // open, so progress belongs in the panel rather than the export chip.
      ytSaveCopy.disabled = true;
      ytGo.disabled = true;
      try {
        const run = await ensureTranslations(wanted, undefined, (text) => (ytStatus.textContent = text));
        if (!run.ok) {
          ytStatus.textContent = run.message;
          return;
        }
        // NEW library entries with NEW ids. Never the open document's own id: a
        // translation is a sibling of the original, never a replacement for it.
        const saved: string[] = [];
        for (const code of wanted) {
          const playlist = ytTranslations.get(code)?.playlist;
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
        ytStatus.textContent =
          `Saved ${saved.length} drawcast(s) to your library: ${saved.join(", ")}. The original is untouched.` +
          (run.message ? ` ${run.message}` : "");
      } finally {
        ytSaveCopy.disabled = false;
        refreshYtButtons();
      }
    })();
  });

  async function runYoutubeUpload(): Promise<void> {
    const deps = current;
    const source = sourceLanguage(deps.doc().playlist);
    const targets = ytQueue(source, ytChips);
    if (targets.length === 0) return;
    const single = targets.length === 1;
    // Fail before consent, not after (finding 2): OAuth costs the author a
    // popup and a click, and dying only once phase 1 runs strands them with
    // the modal already closed and the chips gone. getApiKey() is the same
    // getter ensureTranslations spends its own key check on — ask it now,
    // while the modal is still open to fix it in Settings.
    if (targets.some((c) => c !== source) && !getApiKey()) {
      ytStatus.textContent = "Translating needs your Anthropic API key — add it in Settings.";
      return;
    }
    ytGo.disabled = true;
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
    // ONE controller for the whole run: phase 1's translations and every
    // upload answer to the same Cancel. It has to be re-registered after each
    // render, because renderVideo installs its own controller while it runs.
    const controller = new AbortController();
    deps.setAbort(controller);
    try {
      // Phase 1: translate everything queued that is not translated yet
      // (ruling 1). Seconds each, cancellable, and NOTHING is recorded until
      // they are all clean — a failure here costs a wait, not an hour of
      // real-time recording.
      const run = await ensureTranslations(targets, controller.signal, (text) => deps.setProgress(text));
      if (!run.ok) {
        deps.setStatus(run.message, run.cancelled ? "info" : "error");
        return;
      }
      for (const [i, code] of targets.entries()) {
        const label = languageLabel(code);
        const of = targets.length > 1 ? ` (${label}, ${i + 1} of ${targets.length})` : "";
        const playlist = playlistFor(code);
        // Single language, translated, field untouched: the field held the
        // SOURCE title when refreshYtButtons wrote it — phase 1 hadn't run
        // yet — so prefer the translated title, available now (finding 1).
        // An edited field always wins.
        const title =
          single && (code === source || ytTitle.value !== ytTitleAuto)
            ? ytTitle.value.trim() || deps.doc().title
            : titleOf(playlist, deps.doc().title);
        const base = `${fileSafe(title)}${single ? "" : `-${code}`}`;

        // Never burnt in (ruling 4): YouTube carries the subtitle track and
        // paints its own captions over the picture, so a burnt-in upload says
        // every sentence twice.
        const out = await deps.renderVideo(exportSequence(playlist), false, of);
        // Null means the key is missing, the render failed, or the user
        // pressed cancel — all three already said so, and all three end the
        // queue: the rest would fail the same way or was not wanted.
        if (!out) break;

        // renderVideo replaced the run's controller with its own; put the
        // run's back so Cancel aborts THIS upload.
        deps.setAbort(controller);
        deps.setProgress(`Uploading${of}…`);
        try {
          const res = await uploadVideo(
            out.blob,
            { title, description: descriptionFor(code), privacyStatus: ytPrivacy.value as UploadMeta["privacyStatus"], language: code },
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

  const panels: Record<ShareTo, HTMLElement> = { link: linkPanel, drive: drivePanel, server: serverPanel, youtube: youtubePanel, video: videoPanel };
  const actionBtns: Record<ShareTo, HTMLButtonElement> = { link: publishGo, drive: driveGo, server: serverGo, youtube: ytGo, video: videoGo };

  const rail = h("div", { class: "share-rail" });
  const panelHost = h("div", { class: "share-panel-host" }, linkPanel, drivePanel, serverPanel, youtubePanel, videoPanel);
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
  // A stray outside click must not be able to discard a typed title and
  // description, or the translations "Save the translations as new drawcasts"
  // just paid for: prepPanels() clears ytTranslations on the NEXT open, so
  // losing this one to an accidental backdrop click would mean paying for
  // those Anthropic calls a second time.
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
    // A verdict is about one name for one document — never carried into the
    // next open, where it would describe a name the field no longer shows.
    publishNameCheck.reset();
    linkChoices.refresh(doc, current.subject);
    refreshCommentsChoice(doc);
    refreshCountViewsChoice(doc);
    refreshSignupChoice(doc, current.subject);
    // The server panel: same prefill as Link (one name across both targets),
    // access back to closed — a decision about one publish, like the embed
    // boxes, not a setting — and the sign-in state as of this open.
    serverNameInput.value = doc.publishedAs ?? slugify(doc.title);
    serverNameCheck.reset();
    serverAccess.value = "enrolled";
    serverChoices.refresh(doc, current.subject);
    refreshServerSignIn();
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
    ytTranslations.clear();
    // A fresh open always resets the title, same as every other field here.
    // The modal is a reused singleton, so ytTitle.value still holds whatever
    // the LAST open left in it — clearing ytTitleAuto alone would leave it
    // unequal to that leftover value forever, and refreshYtButtons()'s
    // auto-write would never fire again (re-review finding). Reset both
    // together so the field is blank and matches its own auto-flag, which is
    // what makes the very next refreshYtButtons() call populate it.
    ytTitle.value = ytTitleAuto = "";
    // The document's own language is the given: it publishes in it, and its
    // chip is queued first. Everything else is a translation the author asks
    // for, one open at a time.
    ytSourceLine.textContent = languageLabel(sourceLanguage(playlist));
    ytChips.length = 0;
    ytChips.push(sourceLanguage(playlist));
    renderYtLangs();
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
