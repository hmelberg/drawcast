// drawcast — two modes over one document:
//   Player: a YouTube-like screen that just plays the current drawcast.
//   Editor: create drawings with AI or by hand, load examples and saved work,
//           edit the spec JSON, and change/improve the compiler prompt.

import "./styles.css";
import { type RenderHandle, type RenderStyle } from "./render";
import { canRender, needsRender } from "./render/policy";
import { generateSpec, improvePrompt, promptVariants, type ImproveCase, type PromptVariant } from "./llm/compile";
import { generateParts } from "./llm/multi";
import { missingPlaceholders } from "./llm/prompt";
import { usableExemplars } from "./llm/exemplars";
import { buildBrief, parseTags, suggestTags, TAGS, type ParsedTags } from "./llm/tags";
import { MODELS, describeApiError } from "./llm/client";
import { generateTemplate, type AuthorImage, type AuthorOutcome } from "./llm/author";
import { reviseDocument, type ReviseOutcome } from "./llm/revise";
import { atNewest, currentVersion, emptyStack, pushManualEdit, pushVersion, restoreViewed, seedStack, viewAt, type Stack } from "./history";
import { registerMyTemplatesAtStartup, registerUserTemplateYaml, unregisterUserTemplate } from "./scenes/my-templates";
import { PACK_DEFS, ensureEnabledPacks, packTemplateIds, parsePack, unregisterPack } from "./scenes/packs";
import { looksLikeAnthropicKey, redeemPassword } from "./keys";
import {
  fetchOfficialIndex,
  fetchRemotePackYaml,
  isOfficialPackUrl,
  registerCachedRemotePacksAtStartup,
  registerRemotePackYaml,
  unregisterRemotePack,
  type RemoteIndexEntry,
} from "./scenes/remote-packs";
import { ensureEnginesForSpecs, ensureEnginesForTemplate } from "./scenes/engines";
import { isReadyTemplate } from "./scenes/catalog";
import { scenes } from "./scenes/registry";
import { openModel3d, qualifiesFor3d, setModel3dLabels, type Model3dViewer } from "./ui/model3d";
import { createModal, createTabs } from "./ui/modal";
import { createMenu } from "./ui/menu";
import { openDestinations, saveDestinations, OPEN_LABELS, SAVE_LABELS, type CredentialState } from "./ui/destinations";
import { SPEC_VERSION } from "./spec/schema";
import type { Spec } from "./spec/types";
import type { SpecFormat } from "./spec/text";
import { h } from "./ui/dom";
import { openCoursePanel } from "./ui/course";
import { referencedLectureIds } from "./course/document";
import { fileSafe, openShare } from "./ui/share";
import { checkSaveable } from "./ui/save-gate";
import { authorButtonLabel, authoringMode, promptPlaceholder } from "./ui/author-mode";
import { openEmbedDialog, openInsertPortrait, unembeddedImages } from "./ui/insert";
import { accordionOpenState, applySection, courseGroup, createSidebarSection, sidebarSections, type SectionInput, type SidebarSection } from "./ui/sidebar";
import { attachReview, type ReviewHandle } from "./ui/review";
import { type PlaybackPrefs } from "./ui/controls";
import { attachParamsTray } from "./ui/tray";
import { lintChipModel } from "./ui/lint-chip";
import {
  DEFAULT_META,
  formatPlaylist,
  formatPublished,
  isSingle,
  itemsOf,
  parsePlaylistText,
  playlistWithSpecs,
  singlePlaylist,
  sourceLanguage,
  type AudioTrack,
  type Playlist,
} from "./playlist/playlist";
import { mountPlaylist, playlistSpeakLines, type SessionHandle } from "./playlist/session";
import { exportVideo, narrationLanguage, type ExportResult } from "./export/video";
import { LANGUAGES, languageLabel } from "./export/tts";
import { subtitleLanguages } from "./spec/subtitles";
import { bakedAudioFor, type BakedAudio } from "./playlist/audio";
import { bakeNarration, bakeSize, linesToBake, voiceChanges } from "./export/bake";
import { listCloudVoices, stampedVoice, synthesizeBase64 } from "./export/tts";
import { bakeClipStore, cachingSynthesizer, clipCacheKey, type SynthStats } from "./export/bake-cache";
import { bakeCost, costLabel } from "./export/tts-cost";
import { publishCast } from "./publish/cast";
import { embeddedPlaylist } from "./publish/embed";
import { resolvePortraits } from "./render/portrait";
import { resolveSources } from "./render/source";
import { parseRepo, readFile, type RepoRef } from "./publish/github";
import { parseSourceManifest, saveSource, sourceIndexPath } from "./publish/source";
import { joinPath } from "./course/publish";
import { translateSubtitles, withSubtitles } from "./llm/subtitles";
import { ExportKeepAlive, startWorkerClock } from "./export/keepalive";
import { CloudSpeech } from "./export/tts";
import { detectLang } from "./render/speech";
import type { SpeakLine } from "./render/delivery";
import {
  addExemplar,
  appendLog,
  buildImprovementPacket,
  clearLogs,
  deleteDrawing,
  deleteExemplar,
  deleteMyTemplate,
  downloadJson,
  downloadBlob,
  downloadText,
  deleteStyle,
  deleteUserPrompt,
  getApiKey,
  getGithubToken,
  setGithubToken,
  getTtsKey,
  setTtsKey,
  isMultiPart,
  loadExemplars,
  loadLibrary,
  loadLogs,
  loadMyTemplates,
  loadRemotePacks,
  loadSettings,
  loadStyles,
  loadUserPrompts,
  migrateLegacyCustomPrompt,
  deleteRemotePack,
  saveDrawing,
  saveMyTemplate,
  saveRemotePack,
  saveSettings,
  saveStyle,
  saveUserPrompt,
  setApiKey,
  loadVendedFlags,
  setVendedFlags,
  usageSummary,
  anthropicBudgetError,
  updateLog,
  worstLoggedCases,
  type LogEntry,
  loadCourses,
  SETTINGS_TABS,
  type SavedDrawing,
  type StyleProfile,
  type UserPrompt,
} from "./store";
import { DRIVE_SCOPE, googleConfigured, pickerConfigured, requireScope, signOut, signedIn } from "./google/auth";
import { ensureFolder, isMissingFileError, openSpec, readFileText, saveSpec } from "./google/drive";
import fewshots from "./llm/prompts/fewshots.json";
import bundledExamples from "./examples.json";

const settings = loadSettings();
/**
 * Chrome appearance only — the figure never reads this (see
 * render/figure-style.ts). Applied here at startup, and again from the
 * settings dialog's change listener: a chosen theme must be visible before
 * Settings is ever opened, not only after.
 */
function applyTheme(): void {
  if (settings.theme === "dark" || settings.theme === "light") {
    document.documentElement.setAttribute("data-theme", settings.theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
applyTheme();
// Cloud voices for live playback when a TTS key is set (and the toggle is on);
// falls back to the browser's speechSynthesis otherwise, per line.
const speech = new CloudSpeech(
  () => (settings.cloudPlayback ? getTtsKey() : ""),
  () => settings.cloudVoices,
  bakeClipStore,
);
/** Baked narration for the document on screen; replaced on every mount. */
let bakedAudio: BakedAudio | null = null;
speech.setVoice(settings.voiceURI);
speech.setRate(settings.rate);
const variants: PromptVariant[] = promptVariants();
// The dropdown bundles the LLM fewshots PLUS curated offline examples that
// never enter the compiler prompt (src/examples.json — template showcases).
// A bundled example is either a single spec or a multi-part playlist (YAML
// text), and may declare packs it needs (enabled on load, like the panel).
interface BundledExample {
  request: string;
  title?: string;
  spec?: Spec;
  playlist?: string;
  packs?: string[];
}
const examples: BundledExample[] = [...(fewshots as { request: string; spec: Spec }[]), ...(bundledExamples as BundledExample[])];

/**
 * The curated bundled examples as exemplars — they fill the {{EXEMPLARS}}
 * slots a user's own reference library leaves empty (src/llm/exemplars.ts).
 * Recomputed per generation, never cached: which templates are ready changes
 * as packs load and user templates come and go, and an exemplar built on an
 * absent template must not reach the prompt. The fewshots are excluded on
 * purpose — they are already in the prompt via {{FEWSHOTS}}.
 */
function bundledExemplarPool(): { prompt: string; spec: Spec }[] {
  return usableExemplars(
    (bundledExamples as BundledExample[]).map((e) => ({ prompt: e.request, spec: e.spec })),
    isReadyTemplate,
  );
}

interface Doc {
  /** The library entry this document belongs to; null until the first change (copy-on-write). */
  id: string | null;
  /** The Drive file this document was saved to this session; null otherwise. In memory only. */
  driveFileId: string | null;
  /**
   * The folder name this drawcast was published under, once it has been.
   * Permanent from the first publish: retitling must never move the file a
   * shared link already points at.
   */
  publishedAs?: string;
  /** Whether the last GitHub publish carried the giscus wiring (C1). */
  publishedComments?: boolean;
  /**
   * The Drive file this document was PUBLISHED to, once it has been
   * (spec §7). Persisted with the library row, exactly like `publishedAs`
   * and for the same reason: a republish must update the file whose link is
   * already out there rather than mint a second one.
   *
   * DELIBERATELY distinct from `driveFileId` above, which is Save's working
   * file and lives only for this session. One drawcast can have both, and
   * they point at two different files: the source you keep editing, and the
   * finished copy your audience opens. Crossing them would make a Save
   * overwrite what your viewers are reading.
   */
  drivePublishedId?: string;
  /**
   * What that published file is CALLED in Drive, without the .yaml. Stored
   * beside the id because the Drive panel prefills its name field from it: a
   * republish otherwise renames the author's file back to the document title
   * every time, since `saveSpec`'s update carries the metadata part. Set and
   * cleared together with `drivePublishedId` — a name without a file is not a
   * state worth having.
   */
  drivePublishedName?: string;
  /**
   * The path this document's SOURCE was last saved to in the author's repo —
   * distinct from `publishedAs` (the rendered viewer page). Set by
   * saveSourceToGithub() on a successful save, the same way publishing sets
   * `publishedAs`; also set when opening a source FROM GitHub, so a later
   * save goes back to the same file instead of minting a second one.
   */
  sourcePath: string | null;
  title: string;
  prompt?: string;
  playlist: Playlist;
}

let doc: Doc = initialDoc();
let stack: Stack = emptyStack();
/** Set while an arrow step is being applied, so restoring a version does not record a manual edit. */
let restoring = false;
let session: SessionHandle | null = null;
let lastLogId: string | null = null;
/** Set once the current document has been promoted to a reference, so re-enabling the button never re-arms it. */
let promoted = false;

// Personal templates must be in the registry before anything renders.
for (const r of registerMyTemplatesAtStartup()) {
  if (!r.ok) console.warn(`My template "${r.id}" failed to load:`, r.errors.join("; "));
}

// Remote packs (M5): CACHED yaml only — this must NEVER fetch at startup (a
// slow or dead remote host must not block or flake app startup). A
// cached-registration failure is kept-and-warned rather than dropped from
// `enabled` — see registerCachedRemotePacksAtStartup's doc comment for the
// full ruling (symmetry with M3's retriable-failure rule, not a new one).
for (const r of registerCachedRemotePacksAtStartup()) {
  if (!r.ok) console.warn(`Remote pack "${r.url}" failed to register from cache:`, r.errors.join("; "));
}

/**
 * True when some cached remote-pack entry is enabled AND currently has live
 * template ids registered — i.e. a remote pack is genuinely occupying
 * registry space right now, not merely sitting enabled in the cache. Used
 * only by the startup collision guard directly below (final review,
 * important #2).
 */
function anyRemotePackTemplatesLive(): boolean {
  return loadRemotePacks().some((e) => e.enabled && packTemplateIds(e.id).length > 0);
}

// Domain packs the user previously enabled: load + register async, then
// refresh the toolbar picker and the Template packs panel (both are defined
// below — hoisted function declarations, so this early reference is safe;
// so is setStatus, called from inside the .then() below).
// Spec §8: "Pack fetch fails → toast; enabled set unchanged." A load()
// rejection (stale chunk after a deploy, offline, a network hiccup) is
// transient — the setting stays enabled so a later reload can retry; the
// Template packs panel reflects the not-yet-registered reality with a "toggle
// to retry" hint instead (refreshTemplatePacksPanel below). Only a
// deterministic registerPack failure (parse/compile/collision) — or an id no
// longer in PACK_DEFS — drops the setting: retrying that can't help, and an
// unusable pack would otherwise sit in settings forever.
//
// EXCEPT (final review, important #2): a deterministic failure must NOT drop
// a built-in from settings when it's caused by a template-id collision with
// a REMOTE pack. registerPack's collision error ("template id ... already
// exists in the registry") looks identical in EnsurePackResult whether the
// other claimant is a genuinely-broken built-in or a live remote pack's
// template that happens to share an id — `retriable` can't tell them apart
// because remote packs (registered from cache before this async block even
// starts — see registerCachedRemotePacksAtStartup above) aren't in
// registerPack's field of view at all. But the remote case IS retriable in
// spirit: disabling/removing the remote pack, or it losing that id on a
// later Refresh, clears the collision on the next reload — so dropping the
// built-in here would silently and PERMANENTLY erase it from settings over
// a condition that can resolve itself. The heuristic used —
// anyRemotePackTemplatesLive() — isn't a proof of causation (a built-in
// broken for an unrelated reason while some unrelated remote pack happens to
// be live also gets keep-and-warn); that accepted false-keep (loud retry
// hint via the Template packs panel's "toggle to retry", not a silent drop)
// is the deliberate trade against the false-drop this closes. No remote pack
// is live → falls through to the original drop-on-deterministic-failure
// rule unchanged.
void ensureEnabledPacks(settings.enabledPacks).then((rs) => {
  let changed = false;
  const failed: string[] = [];
  for (const r of rs) {
    if (r.ok) continue;
    console.warn(`pack "${r.id}" failed:`, r.errors.join("; "));
    failed.push(`"${r.id}" (${r.errors.join("; ")})`);
    if (!r.retriable && settings.enabledPacks.includes(r.id) && !anyRemotePackTemplatesLive()) {
      settings.enabledPacks = settings.enabledPacks.filter((id) => id !== r.id);
      settings.priorityPacks = settings.priorityPacks.filter((id) => id !== r.id);
      changed = true;
    }
  }
  if (changed) persist();
  if (failed.length > 0) setStatus(`Pack load failed at startup: ${failed.join("; ")}`, "error");
  refreshTemplatePicker();
  refreshTemplatePacksPanel();
});

/** First item's spec — the poster, the exemplar target, single-figure back-compat. */
function firstSpec(d: Doc): Spec {
  return itemsOf(d.playlist)[0]?.spec ?? { commands: [] };
}

function docFromSaved(saved: SavedDrawing): Doc {
  // `?? null` normalises a library entry stored before sourcePath existed
  // (plain `undefined` at runtime, despite the type) into the real default.
  const sourcePath = saved.sourcePath ?? null;
  if (saved.playlist) {
    try {
      const playlist = parsePlaylistText(saved.playlist);
      // The file's own founding prompt wins (B9); `saved.prompt` is what a
      // library entry written before B9 has instead — its only copy.
      return { id: saved.id, driveFileId: null, publishedAs: saved.publishedAs, publishedComments: saved.publishedComments, drivePublishedId: saved.drivePublishedId, drivePublishedName: saved.drivePublishedName, sourcePath, title: saved.title, prompt: playlist.meta.prompt ?? saved.prompt, playlist };
    } catch {
      /* fall through to the single spec */
    }
  }
  return { id: saved.id, driveFileId: null, publishedAs: saved.publishedAs, publishedComments: saved.publishedComments, drivePublishedId: saved.drivePublishedId, drivePublishedName: saved.drivePublishedName, sourcePath, title: saved.title, prompt: saved.prompt, playlist: singlePlaylist(saved.spec) };
}

function initialDoc(): Doc {
  const saved = loadLibrary()[0];
  if (saved) return docFromSaved(saved);
  // Fewshots come first in `examples` and always carry a spec.
  const ex = examples.find((e) => e.spec) as BundledExample & { spec: Spec };
  // An untouched bundled example is not yours until you change it (copy-on-write).
  return { id: null, driveFileId: null, sourcePath: null, title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) };
}

const app = document.getElementById("app")!;

// ---------- topbar ----------
// The topbar exists only in editor mode; player mode is chrome-free (the
// control bar's ✎ Edit button is the way back). The Player/Editor switch
// itself lives in the sidebar's ▶ Player row (A5) — the topbar holds only
// the wordmark. No mark beside it: Hans (2026-09-02) tried a sketched one,
// then a clean play square, and settled on the handwritten word alone. The
// play square lives on as the favicon (brand/mark.ts), where a tab needs an
// icon and a word cannot be one.

const menuBtn = h("button", { class: "icon-btn", title: "Show or hide the menu" }, "☰");

app.appendChild(
  h(
    "header",
    { class: "topbar" },
    h("div", { class: "topbar-left" }, menuBtn, h("div", { class: "wordmark" }, "drawcast")),
  ),
);

// ---------- player mode ----------

// Just the framed figure: the title renders inside it (cs-title), playback
// chrome is the control bar, so nothing else is needed on the page.
const playerHost = h("div", { class: "player-figure" });
const playerWrap = h("div", { class: "player-wrap" }, playerHost);

function applyTheater(): void {
  playerWrap.classList.toggle("theater", settings.theater);
}
applyTheater();

function toggleTheater(): void {
  settings.theater = !settings.theater;
  persist();
  applyTheater();
}

// ---------- editor mode ----------

const statusEl = h("div", { class: "editor-status hint" });

function setStatus(text: string, kind: "info" | "error" | "ok" = "info"): void {
  statusEl.textContent = text;
  statusEl.className = `editor-status hint ${kind === "info" ? "" : kind}`.trim();
}

/**
 * The status line with one inline button. The click matters: a consent popup
 * needs live transient user activation, and anything offered after a long
 * render has to be triggered by a fresh press rather than continue from the
 * one that started the work.
 */
function setStatusAction(text: string, label: string, onClick: () => void, kind: "info" | "error" | "ok" = "info"): void {
  setStatus(`${text} `, kind);
  const btn = h("button", { class: "small" }, label) as HTMLButtonElement;
  btn.addEventListener("click", onClick);
  statusEl.appendChild(btn);
}

// Create panel
const promptEl = h("textarea", {
  "aria-label": "Describe the drawing",
  placeholder: 'Describe the drawing… e.g. "Show the deadweight loss from a tax, with shaded regions"',
});
// ONE button for both verbs (B7/D3): its action, label and the prompt box's
// placeholder are derived from what the editor holds — see ui/author-mode.ts.
// Generate replaces the document and Revise edits it; two buttons reading the
// same prompt box and doing opposite things is how a drawcast got discarded.
const generateBtn = h("button", { class: "primary" }, "Generate with AI");
// Review mode: watch and collect notes, then apply them as one revision. A
// mode rather than a permanent fixture — a viewer should never see it.
const reviewBtn = h("button", { class: "small", title: "Watch and collect notes, then apply them as one revision" }, "✎ Review");
let review: ReviewHandle | null = null;
/** The sidebar's prompt-editor entry — developer-gated (B6), assigned where the sidebar is built. */
let instructionsRow: HTMLButtonElement | null = null;
const blankBtn = h("button", { class: "sidebar-new", title: "Start a new, empty drawcast" }, "＋ New drawcast");

// ---------- version history: the ◀ ▶ arrows and the viewing bar ----------
// Arrows navigate, Restore commits, neither ever deletes — see history.ts.

const histPrev = h("button", { class: "small", title: "Previous version" }, "◀");
const histCounter = h("button", { class: "small hist-counter" }, "1/1");
const histNext = h("button", { class: "small", title: "Next version" }, "▶");
const histNav = h("span", { class: "hist-nav", hidden: "" }, histPrev, histCounter, histNext);

const restoreBtn = h("button", { class: "small" }, "Restore");
const latestBtn = h("button", { class: "small" }, "Latest ▸");
const viewBar = h(
  "div",
  { class: "view-bar", hidden: "" },
  h("span", {}, "Viewing an older version"),
  h("span", { class: "pane-spacer" }),
  restoreBtn,
  latestBtn,
);

// ---------- hashtag directives: chips + autosuggest ----------
// One vocabulary (TAGS) drives parsing, the chips, and this popup. Tags only
// steer generation — playback stays in Settings and the control bar.

const tagHints = new Map(TAGS.map((t) => [t.tag, t.hint]));
const tagChips = h("div", { class: "tag-chips", hidden: "" });
const tagSuggest = h("div", { class: "tag-suggest", hidden: "" });
let suggestIndex = 0;

function refreshChips(): void {
  const parsed = parseTags(promptEl.value);
  tagChips.replaceChildren();
  const chips: HTMLElement[] = parsed.tags.map((t) =>
    h("span", { class: "chip", title: tagHints.get(t) ?? "" }, `#${t}`),
  );
  if (parsed.playlist) {
    chips.push(h("span", { class: "chip", title: tagHints.get("playlist") ?? "" }, parsed.parts ? `#parts=${parsed.parts}` : "#playlist"));
  }
  for (const u of parsed.unknown) {
    chips.push(h("span", { class: "chip chip-unknown", title: "Unknown tag — sent to the AI as plain text. Type # to see the vocabulary." }, `#${u}?`));
  }
  tagChips.append(...chips);
  tagChips.hidden = chips.length === 0;
}

function tagPrefixAtCaret(): { start: number; prefix: string } | null {
  const pos = promptEl.selectionStart ?? promptEl.value.length;
  const before = promptEl.value.slice(0, pos);
  const m = /(^|\s)#([a-zA-Zæøå]*)$/.exec(before);
  if (!m) return null;
  return { start: pos - m[2].length - 1, prefix: m[2] };
}

function hideSuggest(): void {
  tagSuggest.hidden = true;
}

function acceptSuggestion(tag: string): void {
  const cur = tagPrefixAtCaret();
  if (!cur) return;
  const pos = promptEl.selectionStart ?? promptEl.value.length;
  // parts=N and template=<id> keep the caret after the '=' so the value can
  // be typed immediately (both are display-only TAGS entries — the actual
  // #parts=N / #template=<id> parsing in tags.ts is a separate regex, not
  // keyed off this literal).
  const insert = tag === "parts=N" ? "#parts=" : tag === "template=<id>" ? "#template=" : `#${tag} `;
  promptEl.value = promptEl.value.slice(0, cur.start) + insert + promptEl.value.slice(pos);
  const caret = cur.start + insert.length;
  promptEl.setSelectionRange(caret, caret);
  promptEl.focus();
  hideSuggest();
  refreshChips();
}

function refreshSuggest(): void {
  const cur = tagPrefixAtCaret();
  if (!cur) return hideSuggest();
  const matches = suggestTags(cur.prefix);
  if (matches.length === 0) return hideSuggest();
  suggestIndex = Math.min(suggestIndex, matches.length - 1);
  tagSuggest.replaceChildren(
    ...matches.map((s, i) => {
      const row = h(
        "button",
        { class: `tag-suggest-row${i === suggestIndex ? " active" : ""}` },
        h("span", { class: "tag-suggest-tag" }, `#${s.tag}`),
        h("span", { class: "tag-suggest-hint" }, s.hint),
      );
      // mousedown, not click: it must beat the textarea's blur.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        acceptSuggestion(s.tag);
      });
      return row;
    }),
  );
  tagSuggest.hidden = false;
}

promptEl.addEventListener("input", () => {
  suggestIndex = 0;
  refreshChips();
  refreshSuggest();
});
promptEl.addEventListener("blur", () => window.setTimeout(hideSuggest, 150));
promptEl.addEventListener("keydown", (e) => {
  if (tagSuggest.hidden) return;
  const rows = tagSuggest.querySelectorAll<HTMLElement>(".tag-suggest-row");
  if (rows.length === 0) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    suggestIndex = (suggestIndex + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, i) => r.classList.toggle("active", i === suggestIndex));
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    const active = rows[suggestIndex];
    const tag = active?.querySelector(".tag-suggest-tag")?.textContent?.slice(1);
    if (tag) acceptSuggestion(tag);
  } else if (e.key === "Escape") {
    hideSuggest();
  }
});

// Two entries at the bottom of the Template and Instructions pickers open the
// matching manager instead of selecting anything. Template ids come from the
// registry and prompt values are "v1"-style names or "user:<uuid>", so these
// sentinels can never be a real choice.
const ACTION_NEW = "__new__";
const ACTION_MANAGE = "__manage__";
function isActionValue(v: string): boolean {
  return v === ACTION_NEW || v === ACTION_MANAGE;
}

// The model choice sits next to the send button: the speed/quality decision
// happens where generation starts. Repairs always run on a fast model.
const modelSel = h("select", { title: "Model for generation. Repair rounds always use a fast model." });
for (const m of MODELS) modelSel.appendChild(h("option", { value: m.id }, m.label));
modelSel.value = settings.model;
if (!modelSel.value) modelSel.value = MODELS[0].id;

const styleSel = h("select", { title: "Drawing style" });
styleSel.append(h("option", { value: "clean" }, "Clean lines"), h("option", { value: "sketchy" }, "Hand-drawn"));
styleSel.value = settings.style;

const themeSel = h("select", { title: "Appearance" });
themeSel.append(
  h("option", { value: "system" }, "Match system"),
  h("option", { value: "light" }, "Light"),
  h("option", { value: "dark" }, "Dark"),
);
themeSel.value = settings.theme;

// Toolbar template picker (M3): "Auto" lets the AI pick; a specific choice
// (or a #template= tag, which wins) forces it. Ready templates only — a
// stub can't render.
const templateSel = h("select", { title: "Force a template (Auto lets the AI choose; #template= in the request overrides this)" });
// The last real choice, restored when one of the two action entries is picked:
// a <select> would otherwise keep showing "✦ New template…" as the selection.
let templateChoice = "";
function refreshTemplatePicker(): void {
  const current = templateChoice;
  templateSel.replaceChildren(h("option", { value: "" }, "Auto"));
  for (const id of Object.keys(scenes).sort((a, b) => a.localeCompare(b))) {
    if (isReadyTemplate(id)) templateSel.appendChild(h("option", { value: id }, id));
  }
  templateSel.append(
    h("option", { value: ACTION_NEW }, "✦ New template…"),
    h("option", { value: ACTION_MANAGE }, "⚙ Manage templates…"),
  );
  templateChoice = [...templateSel.options].some((o) => o.value === current && !isActionValue(o.value)) ? current : "";
  templateSel.value = templateChoice;
}
refreshTemplatePicker();

templateSel.addEventListener("change", () => {
  const picked = templateSel.value;
  if (!isActionValue(picked)) {
    templateChoice = picked;
    return;
  }
  templateSel.value = templateChoice; // never leave an action entry showing as the choice
  openTemplatesModal(picked === ACTION_NEW ? "new" : "list");
});

// The sidebar's four uniform sections (ui/sidebar.ts): each a <details> with
// a caret, a count, and open state remembered per section in
// settings.sidebarSections. Built here, early, because refreshExamples()
// below needs examplesSection.list to exist the moment it first runs.
let sidebarFilter = "";

function matchesFilter(text: string): boolean {
  return sidebarFilter === "" || text.toLowerCase().includes(sidebarFilter);
}

function onSectionToggle(id: string): (open: boolean) => void {
  return (open) => {
    // sidebarSections() forces a section open whenever the filter has hits
    // for it, regardless of what is remembered (ui/sidebar.ts). A toggle
    // fired while that override is in effect reflects the filtered VIEW, not
    // the author's actual preference — persisting it would be the inverse
    // failure of spec §5's "a filter never closes one the author opened":
    // type a search, collapse a section that only looks open because of the
    // filter, clear the search, and find it stayed collapsed forever. So a
    // toggle is recorded only when the filter is not the reason this section
    // is currently open.
    const model = sidebarSections(sidebarInput(), sidebarFilter, settings.sidebarSections).find((m) => m.id === id);
    const filterForced = sidebarFilter !== "" && !!model && model.shown > 0;
    if (!filterForced) {
      settings.sidebarSections = accordionOpenState(settings.sidebarSections, id, open);
      persist();
    }
    refreshSidebarShell();
  };
}
const librarySection = createSidebarSection(onSectionToggle("library"));
const coursesSection = createSidebarSection(onSectionToggle("courses"));
const examplesSection = createSidebarSection(onSectionToggle("examples"));
const templatesSection = createSidebarSection(onSectionToggle("templates"));
const examplesList = examplesSection.list;
// "＋ New course" replaces the old "🎓 Course" tool row — same wiring
// (openCourse, defined with the other library/course refresh functions
// below), new home at the foot of the Courses section.
const newCourseRow = h("button", { class: "sidebar-row" }, "＋ New course");
newCourseRow.addEventListener("click", () => openCourse());
coursesSection.details.append(newCourseRow);
const manageTemplatesRow = h("button", { class: "sidebar-row" }, "Manage…");
manageTemplatesRow.addEventListener("click", () => openTemplatesModal("list"));
templatesSection.details.append(manageTemplatesRow);

// Examples list (sidebar): clicking an example loads it directly. Every
// sidebar section honours the one search box above them.
function refreshExamples(): void {
  examplesList.replaceChildren();
  let shown = 0;
  examples.forEach((ex, i) => {
    const label = ex.title ?? ex.spec?.title ?? ex.request;
    if (!matchesFilter(label)) return;
    shown++;
    const b = h("button", { class: "library-open", title: ex.request ?? "Load this example" }, label);
    b.addEventListener("click", () => void loadBundledExample(i));
    examplesList.appendChild(h("div", { class: "library-item" }, b));
  });
  if (shown === 0) examplesList.appendChild(h("div", { class: "hint" }, "No match."));
  refreshSidebarShell();
}
refreshExamples();
const importInput = h("input", { type: "file", accept: ".json,.yaml,.yml,.txt", style: "display:none" }) as HTMLInputElement;
// Both ways a drawing gains images, under one menu: insert an image, or
// embed every portrait/source already in the drawcast into the spec text for
// good. Used to be a "＋ Insert" menu (Portrait alone, so it rendered as a
// plain button per ui/menu.ts's one-item rule) plus a separate bare "📌" icon
// button whose only explanation was a hover title= — invisible on touch, and
// easy enough to forget that the person who wrote it had to ask what it did.
const applyPlaylist = (playlist: Playlist): void => {
  specArea.value = formatPlaylist(playlist, "yaml");
  ensureRendered();
};
const insertMenu = createMenu("Insert", [
  {
    label: "Image from disk…",
    onSelect: () =>
      openInsertPortrait({
        readPlaylist: () => readPlaylistText(specArea.value),
        viewedPart: () => previewedPart,
        applyPlaylist,
        setStatus,
      }),
  },
  {
    label: "Embed images in the file",
    onSelect: () =>
      openEmbedDialog({
        readPlaylist: () => readPlaylistText(specArea.value),
        applyPlaylist,
        contactEmail: () => settings.contactEmail,
        setStatus,
      }),
  },
], { title: "Add an image, or embed every image into the file" });
// ---- Save → To disk: the YAML/JSON spec download Share's Spec file panel
// used to do (share.ts's now-deleted specGo) — moved here because downloading
// your own source is a save, not a share (spec §1). Same formatPlaylist call,
// same filename rule; only the format choice's home changed. Built once, like
// the app's other small modals, and reused on every open.
const saveDiskFormatSel = h("select", { "aria-label": "Spec format" }) as HTMLSelectElement;
saveDiskFormatSel.append(h("option", { value: "yaml" }, "YAML"), h("option", { value: "json" }, "JSON"));
// The editable file name (B3) — prefilled from the doc title in
// openSaveToDisk() below, since `prepareSave()` (and so the real, possibly
// reparsed `save.title`) only runs once the Save button is clicked.
const saveDiskNameInput = h("input", { type: "text", "aria-label": "File name" }) as HTMLInputElement;
const saveDiskModal = createModal("Save to disk", { size: "s", class: "save-disk-modal" });
app.appendChild(saveDiskModal.dialog);
saveDiskModal.body.append(
  h("label", { class: "quiet-label" }, "Name ", saveDiskNameInput),
  h("label", { class: "quiet-label" }, "Format ", saveDiskFormatSel),
);
const saveDiskBtn = h("button", { class: "primary" }, "Save") as HTMLButtonElement;
saveDiskModal.footer.append(saveDiskBtn);
saveDiskFormatSel.addEventListener("change", () => {
  const next = saveDiskFormatSel.value as SpecFormat;
  // A playlist is a multi-document YAML stream and JSON cannot hold that —
  // same guard the Spec file panel had. Since B9 a single figure that carries
  // its founding prompt has a header too, so the message names the header
  // rather than the part count: "Playlists are YAML-only" read as a lie in
  // front of a one-figure document.
  if (next === "json" && !isSingle(doc.playlist)) {
    setStatus("This document has a playlist header, so it is YAML-only (a JSON document cannot hold a multi-document stream).", "error");
    saveDiskFormatSel.value = "yaml";
    settings.specFormat = "yaml";
  } else {
    settings.specFormat = next;
  }
  persist();
});
saveDiskBtn.addEventListener("click", () => {
  // What you see is what you save — re-derived from the editor's own text,
  // not doc.playlist (last render's GOOD text, stale the moment the editor
  // holds something that fails to parse). Refuses (and says why) rather than
  // shipping that stale version — see prepareSave()'s doc comment.
  const save = prepareSave();
  // Close first, unconditionally: prepareSave() already set the red status
  // itself on refusal (see its doc comment), but that status line lives
  // behind this modal + its backdrop. Closing only on success left a refused
  // save looking like a dead button — the dialog just sat there over the
  // very message explaining why (round-2 fix).
  saveDiskModal.dialog.close();
  if (!save) return;
  const format: SpecFormat = isSingle(save.playlist) ? (saveDiskFormatSel.value as SpecFormat) : "yaml";
  // YAML ships the editor's own text verbatim; JSON has to be derived (the
  // textarea is always YAML — see saveToDrive's note below).
  const content = format === "yaml" ? save.text : formatPlaylist(save.playlist, format);
  // The typed name still passes through fileSafe (B3) — illegal characters
  // must never reach downloadText just because the author typed them.
  // Falling back to `save.title` (not the stale prefill) covers the field
  // being cleared entirely; that fallback is itself run through fileSafe,
  // since a cleared field's fallback is exactly the case fileSafe exists for.
  downloadText(`${fileSafe(saveDiskNameInput.value, fileSafe(save.title))}.${format}`, content);
});
function openSaveToDisk(): void {
  // Catch the drawing up to the text on screen first — same reason every
  // other Save/Share entry point does this: a download must never ship a
  // document the author has edited past.
  ensureRendered();
  saveDiskFormatSel.value = settings.specFormat;
  // Prefilled from the OPEN document's title, not prepareSave()'s (possibly
  // reparsed) title — prepareSave() only runs once Save is clicked, after
  // this dialog is already showing the field.
  saveDiskNameInput.value = fileSafe(doc.title);
  saveDiskModal.open();
}

// Open ▾ and Save ▾ fold what used to be four buttons (⬆ import, ☁ Open,
// ☁ Save, plus the ⬇ download that used to live in Share) into one menu per
// verb (spec §4) — the ⬆ glyph no longer means two different things. A
// capability without its credential still does not advertise itself (spec
// §6); that rule now lives in each item's `hidden` flag instead of a
// button's own. The download (Share's old Spec file destination) is
// "To disk…" below: downloading your own source is a save, not a share.
//
// GitHub's credential gate looks like Drive's (pickerConfigured() /
// googleConfigured()) but ISN'T static per session: the repo and token are
// Settings values a user edits at runtime, not a build-time env var, so
// `githubConfigured()` can flip mid-session in a way Drive's checks never do.
// `createMenu` decides plain-button-vs-dropdown at construction and bakes
// `hidden` in then — making that dynamic is a menu.ts change, and a bigger
// one than this needs (ruling: Task 7 fix round 1). So instead each menu
// lives inside a stable host span, and refreshCredentialMenus() below swaps
// the host's one child for a freshly built menu. WHICH items each menu
// offers is decided by openDestinations()/saveDestinations()
// (ui/destinations.ts) — pure and tested there, since main.ts can't be
// (a module-scope h(...) call crashes vitest's node environment on import).
function githubConfigured(): boolean {
  return parseRepo(settings.githubRepo) !== null && getGithubToken() !== "";
}
function credentialState(): CredentialState {
  return { drivePicker: pickerConfigured(), driveSave: googleConfigured(), github: githubConfigured() };
}
function buildOpenMenu(): HTMLElement {
  const allowed = new Set(openDestinations(credentialState()));
  return createMenu(
    "Open",
    [
      { label: OPEN_LABELS.disk, onSelect: () => importInput.click() },
      { label: OPEN_LABELS.drive, onSelect: () => void openFromDrive(), hidden: !allowed.has(OPEN_LABELS.drive) },
      { label: OPEN_LABELS.github, onSelect: () => void openSourceFromGithub(), hidden: !allowed.has(OPEN_LABELS.github) },
    ],
    { title: "Open a drawcast" },
  );
}
function buildSaveMenu(): HTMLElement {
  const allowed = new Set(saveDestinations(credentialState()));
  return createMenu(
    "Save",
    [
      { label: SAVE_LABELS.disk, onSelect: () => openSaveToDisk() },
      { label: SAVE_LABELS.drive, onSelect: () => void saveToDrive(), hidden: !allowed.has(SAVE_LABELS.drive) },
      { label: SAVE_LABELS.github, onSelect: () => void saveSourceToGithub(), hidden: !allowed.has(SAVE_LABELS.github) },
    ],
    { title: "Save this drawcast" },
  );
}
const openMenuHost = h("span", {}, buildOpenMenu());
const saveMenuHost = h("span", {}, buildSaveMenu());
/**
 * Rebuilds both menus so a destination configured mid-session (today: only
 * GitHub's repo+token) appears without a reload. Called explicitly from both
 * credential fields' own listeners below (repo, token) — deliberately NOT
 * from persist(), the general "a setting changed" hook: persist() fires from
 * 37 call sites (mode switch, style change, rating…), and only these two
 * fields can ever gate a destination, so hanging this DOM rebuild off every
 * settings change would run it 35 times for nothing on the way to the two
 * that matter.
 */
function refreshCredentialMenus(): void {
  openMenuHost.replaceChildren(buildOpenMenu());
  saveMenuHost.replaceChildren(buildSaveMenu());
}
// One button for every way a drawcast leaves the app — replaces ⬇, ⬆ Publish,
// ☑ with narration, 🎬 Export video and ▶ YouTube (spec §2). Its modal picks
// which of those still applies; an unconfigured one just does not appear.
const shareBtn = h("button", { class: "small", title: "Publish to GitHub, upload to YouTube, or export a video" }, "↗ Publish");
// Background-export progress chip: the render/upload runs without a modal, so
// this chip in the pane bar is the only visible trace — status text + cancel.
// (Created here with its pane-bar siblings; wired in the video-export section.)
const exportChipText = h("span", { class: "export-chip-text" });
const exportChipCancel = h("button", { class: "chip-x", title: "Cancel the export", "aria-label": "Cancel the export" }, "✕");
const exportChip = h("span", { class: "export-chip", hidden: "" }, "🎬 ", exportChipText, exportChipCancel);
// openAuthorDialog is defined later (template-authoring section, ./llm/author) —
// a hoisted function declaration, so this early reference is safe.
const newTemplateBtn = h("button", { title: "Create a reusable template with AI (describe it, optionally paste an image)" }, "✦ New template");
newTemplateBtn.addEventListener("click", () => {
  templatesModal.dialog.close(); // hand over rather than stack (see openTemplatesModal)
  openAuthorDialog();
});
const libraryList = librarySection.list;
// My templates panel: the list host + import controls are created here so they
// can be placed in editorWrap below; refreshMyTemplates() itself lives with the
// rest of the wiring further down (same split as libraryList/refreshLibrary).
const myTemplatesList = h("div", { class: "library-list" });
const myTplImportBtn = h("button", { class: "small" }, "Import template…");
const myTplImportInput = h("input", { type: "file", accept: ".yaml,.yml", hidden: "" });

// Template packs panel (M3): the list host is created here so it can be
// placed in editorWrap below; refreshTemplatePacksPanel() lives with the
// rest of the wiring further down, next to My templates.
const templatePacksList = h("div", { class: "library-list" });

// Extra packs (M5): official-index browse results + loaded remote-pack rows,
// both hosted in the SAME "Template packs" details panel, below the built-in
// rows. Wiring lives further down next to refreshTemplatePacksPanel().
const browseOfficialBtn = h("button", { class: "small" }, "Browse official packs…");
const officialPacksList = h("div", { class: "library-list" });
const remoteUrlInput = h("input", { type: "url", placeholder: "https://…/pack.yaml", class: "remote-url-input" }) as HTMLInputElement;
const loadUrlBtn = h("button", { class: "small" }, "Load");
const remotePacksList = h("div", { class: "library-list" });

// Prompt library: named compiler-prompt variants (Loop 2's UI).
// The active prompt is what Generate uses; bundled prompts are read-only,
// user prompts support the full lifecycle (copy/edit/rename/delete/share).
const migrated = migrateLegacyCustomPrompt();
if (migrated && settings.variant === "custom") {
  settings.variant = `user:${migrated.id}`;
  saveSettings(settings);
}

const variantSel = h("select", { title: "The instructions the AI follows when it turns your request into a drawing" });

// ---------- style (B5): the author's teaching style as prose ----------
// A style profile is ADDED to the prompt, last, so it wins (llm/prompt.ts
// styleBlock) — unlike the prompt variants above, nothing in it can break
// generation, which is why it is the user-facing concept and the prompt
// editor is a developer feature (B6). Two axes, named: Style is how it
// draws; Templates/Packs are what it can draw (S §3).

const styleProfileSel = h("select", { title: "Your standing style — added to what the AI is told, last, so it wins where they disagree" });
const styleChoiceLabel = h("label", { class: "quiet-label" }, "Style ", styleProfileSel);
const instrChoiceLabel = h("label", { class: "quiet-label" }, "Instructions ", variantSel);

function activeStyleText(): string {
  const id = settings.activeStyleId;
  if (!id) return "";
  return loadStyles().find((sp) => sp.id === id)?.text ?? "";
}
const promptList = h("div", { class: "library-list" });
const promptSource = h("textarea", { class: "prompt-source", spellcheck: "false", "aria-label": "Prompt source" });
const promptSaveBtn = h("button", { class: "small" }, "Save");
const promptRenameBtn = h("button", { class: "small" }, "Rename");
const promptCopyBtn = h("button", { class: "small" }, "Copy");
const promptDeleteBtn = h("button", { class: "small" }, "Delete");
const promptDownloadBtn = h("button", { class: "small", title: "Download the prompt as a markdown file" }, "Download .md");
const promptUploadInput = h("input", { type: "file", accept: ".md,.txt", style: "display:none" }) as HTMLInputElement;
const promptUploadBtn = h("button", { class: "small" }, "Upload .md");
const promptImproveBtn = h(
  "button",
  { class: "small", title: "Ask the model to revise this prompt using your worst logged generations. The proposal is saved as a NEW prompt — nothing is overwritten." },
  "Improve with AI",
);
const promptHint = h("div", { class: "hint" });

function activeUserPrompt(): UserPrompt | undefined {
  if (!settings.variant.startsWith("user:")) return undefined;
  const id = settings.variant.slice(5);
  return loadUserPrompts().find((p) => p.id === id);
}

function currentVariant(): PromptVariant {
  const up = activeUserPrompt();
  if (up) return { name: `user:${up.name}`, source: up.source };
  return variants.find((v) => v.name === settings.variant) ?? variants[0];
}

function refreshPromptPanel(): void {
  variantSel.replaceChildren();
  for (const v of variants) variantSel.appendChild(h("option", { value: v.name }, `bundled ${v.name}`));
  for (const p of loadUserPrompts()) variantSel.appendChild(h("option", { value: `user:${p.id}` }, p.name));
  if (![...variantSel.options].some((o) => o.value === settings.variant)) {
    settings.variant = variants[0].name;
    persist();
  }
  variantSel.value = settings.variant;
  variantSel.append(
    h("option", { value: ACTION_NEW }, "✦ New instructions…"),
    h("option", { value: ACTION_MANAGE }, "⚙ Manage instructions…"),
  );

  // The modal's list mirrors the picker: clicking a row makes it active.
  promptList.replaceChildren();
  const rows: { value: string; label: string; note: string }[] = [
    ...variants.map((v) => ({ value: v.name, label: v.name, note: "bundled" })),
    ...loadUserPrompts().map((p) => ({ value: `user:${p.id}`, label: p.name, note: "yours" })),
  ];
  for (const r of rows) {
    const active = r.value === settings.variant;
    const open = h("button", { class: `library-open${active ? " current" : ""}` }, `${active ? "● " : ""}${r.label}`);
    open.addEventListener("click", () => {
      settings.variant = r.value;
      persist();
      refreshPromptPanel();
    });
    promptList.appendChild(h("div", { class: "library-item" }, open, h("span", { class: "row-note" }, r.note)));
  }

  const up = activeUserPrompt();
  promptSource.value = up ? up.source : currentVariant().source;
  promptSource.readOnly = !up;
  promptSaveBtn.disabled = !up;
  promptRenameBtn.disabled = !up;
  promptDeleteBtn.disabled = !up;
  promptCopyBtn.textContent = up ? "Copy" : "Copy to my prompts";
  promptHint.textContent = up
    ? "Edits apply after Save. {{SCHEMA}}, {{CATALOG}}, {{FEWSHOTS}} and {{EXEMPLARS}} are filled in at generation time and must stay in."
    : "Bundled prompts are read-only — use “Copy to my prompts” to make an editable version. The active prompt is what Generate uses.";
}
refreshPromptPanel();

// Data panel
const exemplarCount = h("span", { class: "count" });
const exportPacketBtn = h("button", { class: "small", title: "Worst cases + failure stats for a Claude Code session" }, "Export improvement packet");
const clearLogsBtn = h("button", { class: "small" }, "Clear logs");

function refreshCounts(): void {
  exemplarCount.textContent = `${loadExemplars().length} exemplars · ${loadLogs().length} logged generations`;
}
refreshCounts();

// Preview column
const previewHost = h("div", { class: "player-figure" });
const specArea = h("textarea", { class: "spec-json", spellcheck: "false", "aria-label": "Spec source" });
// State, not an action — filled with --muted rather than the accent (see the
// rust allowlist in tests/palette.test.ts). Lives in the PREVIEW bar because
// it describes the drawing, not the text.
const editedDot = h("span", { class: "edited-dot", hidden: "", title: "Edited — plays from the new text" });

const ratingBox = h("span", { class: "rating", hidden: "" });
const ratingButtons: HTMLButtonElement[] = [];
for (let n = 1; n <= 5; n++) {
  const b = h("button", { title: `${n}/5 — would use in teaching` }, "★");
  b.addEventListener("click", () => {
    ratingButtons.forEach((rb, i) => rb.classList.toggle("lit", i < n));
    if (lastLogId) updateLog(lastLogId, { rating: n });
  });
  ratingButtons.push(b);
  ratingBox.appendChild(b);
}
// The user-facing half of the feedback loop: promoted pairs are injected into
// every later generation, so this is "teach it my style", not bookkeeping.
const promoteBtn = h("button", { class: "small", title: "Use this drawing as a style reference for future generations" }, "👍 Learn from this");
// The lint chip: silent when the drawing is clean, a count when it is not.
const lintChip = h("button", { class: "lint-chip", hidden: "", title: "Layout warnings — click for details" });
const lintBox = h("div", { class: "lint-box", hidden: "" });
let lintOpen = false;
lintChip.addEventListener("click", () => {
  lintOpen = !lintOpen;
  lintBox.hidden = !lintOpen;
});

// Editor: the request block on top (textarea, then Generate with the three
// quiet choices folded away behind a "…" next to it), then spec and output
// side by side, each with its own bar of actions for that pane.
const genChoices = h(
  "div",
  { class: "row gen-choices", id: "gen-choices", hidden: "" },
  h("label", { class: "quiet-label" }, "Template ", templateSel),
  styleChoiceLabel,
  instrChoiceLabel,
  h("label", { class: "quiet-label" }, "Model ", modelSel),
);
const choicesBtn = h("button", {
  class: "choices-toggle",
  "aria-expanded": "false",
  "aria-controls": "gen-choices",
}, "…");

/**
 * Folded away, the three selects are invisible — so the button carries what
 * they say, and goes accented when the template is pinned (the one choice that
 * silently changes every generation).
 */
function refreshChoicesToggle(): void {
  const tpl = templateChoice === "" ? "Auto" : templateChoice;
  const model = MODELS.find((m) => m.id === modelSel.value)?.label ?? modelSel.value;
  const styleName = styleProfileSel.options[styleProfileSel.selectedIndex]?.textContent ?? "None";
  const prompt = variantSel.options[variantSel.selectedIndex]?.textContent ?? settings.variant;
  // The Instructions segment shows for developers — and for ANYONE whose
  // generations are driven by a non-default prompt fork: hiding the picker
  // (B6) must not hide the fact (final review 2026-09-02).
  const showVariant = settings.developerMode || settings.variant !== variants[0].name;
  const dev = showVariant ? ` · Instructions: ${prompt}` : "";
  choicesBtn.title = `Template: ${tpl} · Style: ${styleName}${dev} · Model: ${model}`;
  choicesBtn.classList.toggle("has-choice", templateChoice !== "" && genChoices.hidden);
}

function applyChoicesOpen(): void {
  genChoices.hidden = !settings.choicesOpen;
  choicesBtn.setAttribute("aria-expanded", String(settings.choicesOpen));
  refreshChoicesToggle();
}
choicesBtn.addEventListener("click", () => {
  settings.choicesOpen = !settings.choicesOpen;
  persist();
  applyChoicesOpen();
});
for (const sel of [templateSel, variantSel, modelSel]) {
  sel.addEventListener("change", refreshChoicesToggle);
}
applyChoicesOpen();

const editorWrap = h(
  "div",
  { class: "editor-wrap" },
  h(
    "div",
    { class: "panel editor-toolbar" },
    h("div", { class: "row prompt-row" }, promptEl, tagSuggest),
    tagChips,
    viewBar,
    h("div", { class: "row gen-row" }, choicesBtn, histNav, generateBtn),
    genChoices,
  ),
  statusEl,
  h(
    "div",
    { class: "editor-split" },
    h(
      "div",
      { class: "panel editor-code" },
      h(
        "div",
        { class: "pane-bar" },
        h("span", { class: "bar-group" }, openMenuHost, saveMenuHost, importInput),
        h("span", { class: "bar-group" }, insertMenu),
      ),
      specArea,
    ),
    h(
      "div",
      { class: "panel editor-preview" },
      h("div", { class: "pane-bar" }, lintChip, editedDot, h("span", { class: "pane-spacer" }), reviewBtn, shareBtn, ratingBox, promoteBtn, exportChip),
      previewHost,
      lintBox,
    ),
  ),
);

// ---------- left sidebar: the one menu ----------

const sidebarSearch = h("input", { type: "text", class: "sidebar-search", placeholder: "Search…", "aria-label": "Filter library, courses, examples and templates" }) as HTMLInputElement;
const dataRow = h("button", { class: "sidebar-row" }, "Data");
// Declared here, ABOVE the sidebar, not near refreshAccountRow(): the IIFE
// below that assigns it runs during module initialisation, before a `let`
// declared further down in the file would leave its temporal dead zone.
let accountRow: HTMLButtonElement | null = null;
const sidebar = h(
  "aside",
  { class: "sidebar" },
  blankBtn,
  sidebarSearch,
  librarySection.details,
  coursesSection.details,
  examplesSection.details,
  templatesSection.details,
  h(
    "div",
    { class: "sidebar-tools" },
    (() => {
      const b = h("button", { class: "sidebar-row" }, "Player");
      b.addEventListener("click", () => showMode("player"));
      return b;
    })(),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "Style");
      b.addEventListener("click", () => openStyleModal());
      return b;
    })(),
    (() => {
      // The prompt editor, unchanged but now an advanced feature (B6):
      // gated in applyDeveloperMode beside the rating and the Data panel.
      const b = h("button", { class: "sidebar-row" }, "Instructions");
      instructionsRow = b;
      b.addEventListener("click", () => openInstructionsModal());
      return b;
    })(),
    dataRow,
    h("a", { class: "sidebar-row", href: "./help.html", target: "_blank", rel: "noopener" }, "Help"),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "Sign in with Google");
      accountRow = b;
      b.addEventListener("click", () => void toggleAccount());
      b.hidden = !googleConfigured();
      return b;
    })(),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "Settings");
      b.addEventListener("click", () => openSettings());
      return b;
    })(),
  ),
);
const sidebarBackdrop = h("div", { class: "sidebar-backdrop" });

function applySidebar(): void {
  document.body.classList.toggle("sidebar-open", settings.sidebarOpen);
}
menuBtn.addEventListener("click", () => {
  settings.sidebarOpen = !settings.sidebarOpen;
  persist();
  applySidebar();
});
sidebarBackdrop.addEventListener("click", () => {
  settings.sidebarOpen = false;
  persist();
  applySidebar();
});
// Phones never boot with the overlay covering the editor (not persisted).
if (window.innerWidth < 940) settings.sidebarOpen = false;
applySidebar();

sidebarSearch.addEventListener("input", () => {
  sidebarFilter = sidebarSearch.value.trim().toLowerCase();
  refreshLibrary();
  refreshExamples();
  refreshTemplatesSection();
});

const main = h("main", {}, sidebar, playerWrap, editorWrap);
app.append(main, sidebarBackdrop);

// ---------- templates modal (create + my templates + packs) ----------

const templatesModal = createModal("✦ Templates", { size: "m" });
const templatesTabs = createTabs([
  {
    id: "mine",
    label: "My templates",
    panel: h(
      "div",
      { class: "tab-panel" },
      h("div", { class: "hint" }, "Templates you created with AI or imported. They are stored in this browser."),
      h("div", { class: "row" }, newTemplateBtn, myTplImportBtn, myTplImportInput),
      myTemplatesList,
    ),
  },
  {
    id: "packs",
    label: "Packs",
    panel: h(
      "div",
      { class: "tab-panel" },
      h("div", { class: "hint" }, "Enable a pack to make its templates available to the AI. Priority packs always get a full catalog entry."),
      templatePacksList,
      h(
        "div",
        { class: "extra-packs" },
        h("div", { class: "hint extra-packs-heading" }, "Extra packs"),
        h("div", { class: "row" }, browseOfficialBtn),
        officialPacksList,
        h("div", { class: "row" }, remoteUrlInput, loadUrlBtn),
        remotePacksList,
      ),
    ),
  },
]);
templatesModal.body.appendChild(templatesTabs.el);
app.appendChild(templatesModal.dialog);

/**
 * "new" goes straight to the authoring dialog rather than stacking it on top of
 * this modal: two open <dialog>s make ESC and backdrop clicks ambiguous, and
 * only the top one would actually close.
 */
function openTemplatesModal(view: "list" | "new"): void {
  if (view === "new") {
    openAuthorDialog();
    return;
  }
  templatesTabs.show("mine");
  templatesModal.open();
}

// ---------- instructions modal (compiler prompt + references) ----------

const referencesList = h("div", { class: "library-list" });
const instructionsModal = createModal("📝 Instructions", { size: "m" });
const instructionsTabs = createTabs([
  {
    id: "instructions",
    label: "Instructions",
    panel: h(
      "div",
      { class: "tab-panel" },
      h("div", { class: "hint" }, "What the AI is told before your request. The active one (●) is what Generate uses."),
      promptList,
      promptSource,
      // These act on the prompt currently selected in the list above, not on
      // the modal itself — a per-item verb like the per-template Delete, so
      // it stays with its row instead of moving to the footer.
      h("div", { class: "row" }, promptSaveBtn, promptRenameBtn, promptCopyBtn, promptDeleteBtn),
      h("div", { class: "row" }, promptDownloadBtn, promptUploadBtn, promptUploadInput, promptImproveBtn),
      promptHint,
    ),
  },
  {
    id: "references",
    label: "References",
    panel: h(
      "div",
      { class: "tab-panel" },
      h("div", { class: "hint" }, "Drawings you marked with “👍 Learn from this”. Each one is shown to the AI as an example of what you want."),
      referencesList,
    ),
  },
]);
instructionsModal.body.appendChild(instructionsTabs.el);
app.appendChild(instructionsModal.dialog);

function refreshReferences(): void {
  referencesList.replaceChildren();
  const all = loadExemplars();
  if (all.length === 0) {
    referencesList.appendChild(h("div", { class: "hint" }, "Nothing yet — press “👍 Learn from this” under a drawing you like."));
    return;
  }
  all.forEach((ex, i) => {
    const del = h("button", { class: "library-del", title: "Remove this reference" }, "✕");
    del.addEventListener("click", () => {
      deleteExemplar(i);
      refreshReferences();
      refreshCounts();
    });
    referencesList.appendChild(
      h("div", { class: "library-item" }, h("span", { class: "library-title" }, ex.spec.title ?? ex.prompt), del),
    );
  });
}

function openInstructionsModal(): void {
  refreshPromptPanel();
  refreshReferences();
  instructionsModal.open();
}

/** "✦ New instructions…" starts from a copy of the active one — the placeholders must survive. */
function newInstructionsFromActive(): void {
  instructionsTabs.show("instructions");
  copyActivePrompt();
}

// ---------- style modal (B5): list, New, Save, Delete, a textarea ----------
// Four controls where Instructions had seven — everything that existed
// because "your instruction IS the prompt" (Improve, Download, Upload,
// Rename, Copy, placeholder validation) has no job when the instruction is
// a paragraph added to the prompt (S §4's table).

const styleList = h("div", { class: "library-list" });
const styleNameInput = h("input", { type: "text", class: "style-name", "aria-label": "Style name", placeholder: "Name (e.g. My lectures)" }) as HTMLInputElement;
const styleTextArea = h("textarea", {
  class: "style-text",
  rows: "6",
  "aria-label": "Style text",
  placeholder: "How you want your drawcasts made — e.g. “Open with a question. Keep one idea per screen. Ground examples in Norwegian data.”",
}) as HTMLTextAreaElement;
const styleNewBtn = h("button", { class: "small" }, "New");
const styleSaveBtn = h("button", { class: "small" }, "Save");
const styleDeleteBtn = h("button", { class: "small" }, "Delete");
const styleModal = createModal("🖋 Style", { size: "m" });
styleModal.body.append(
  h("div", { class: "hint" }, "Your standing instructions for how drawcasts are made — added to what the AI is told, last, so they win where they disagree. The active one (●) rides on every Generate and Revise."),
  styleList,
  styleNameInput,
  styleTextArea,
  h("div", { class: "row" }, styleNewBtn, styleSaveBtn, styleDeleteBtn),
);
app.appendChild(styleModal.dialog);

/** The profile the editor fields show — follows the active one but survives
 *  "None" being active (you can edit a profile without using it). */
let editingStyleId: string | null = null;

/** Typed-but-unsaved text is committed before anything rewrites the fields
 *  (row clicks, the quick pick, New) — refreshStylePanel repaints them from
 *  storage, and repainting over an uncommitted paragraph destroyed it (final
 *  review 2026-09-02). A style is a paragraph; silently keeping it beats a
 *  warning dialog. Save remains as the explicit verb. */
function commitStyleEdits(): void {
  const editing = loadStyles().find((sp) => sp.id === editingStyleId);
  if (!editing || styleTextArea.disabled) return;
  const name = styleNameInput.value.trim() || editing.name;
  if (name === editing.name && styleTextArea.value === editing.text) return;
  saveStyle({ ...editing, name, text: styleTextArea.value, ts: new Date().toISOString() });
}

function refreshStylePanel(): void {
  const all = loadStyles();
  if (editingStyleId && !all.some((sp) => sp.id === editingStyleId)) editingStyleId = null;
  editingStyleId ??= settings.activeStyleId ?? all[0]?.id ?? null;

  // The quick pick under Generate mirrors the modal's list.
  styleProfileSel.replaceChildren(h("option", { value: "" }, "None"));
  for (const sp of all) styleProfileSel.appendChild(h("option", { value: sp.id }, sp.name));
  styleProfileSel.append(
    h("option", { value: ACTION_NEW }, "✦ New style…"),
    h("option", { value: ACTION_MANAGE }, "⚙ Manage styles…"),
  );
  styleProfileSel.value = settings.activeStyleId ?? "";
  if (styleProfileSel.selectedIndex < 0) styleProfileSel.value = "";

  styleList.replaceChildren();
  const rows: { id: string | null; label: string }[] = [{ id: null, label: "None" }, ...all.map((sp) => ({ id: sp.id as string | null, label: sp.name }))];
  for (const r of rows) {
    const active = r.id === settings.activeStyleId;
    const open = h("button", { class: `library-open${active ? " current" : ""}` }, `${active ? "● " : ""}${r.label}`);
    open.addEventListener("click", () => {
      commitStyleEdits();
      settings.activeStyleId = r.id;
      persist();
      if (r.id) editingStyleId = r.id;
      refreshStylePanel();
    });
    styleList.appendChild(h("div", { class: "library-item" }, open));
  }

  const editing = all.find((sp) => sp.id === editingStyleId);
  styleNameInput.value = editing?.name ?? "";
  styleTextArea.value = editing?.text ?? "";
  styleNameInput.disabled = !editing;
  styleTextArea.disabled = !editing;
  styleSaveBtn.disabled = !editing;
  styleDeleteBtn.disabled = !editing;
  refreshChoicesToggle();
}

styleNewBtn.addEventListener("click", () => {
  commitStyleEdits();
  const sp: StyleProfile = { id: crypto.randomUUID(), name: "My style", text: "", ts: new Date().toISOString() };
  saveStyle(sp);
  // A new style is meant to be used: it becomes the active one at once.
  settings.activeStyleId = sp.id;
  persist();
  editingStyleId = sp.id;
  refreshStylePanel();
  styleNameInput.focus();
  styleNameInput.select();
});
styleSaveBtn.addEventListener("click", () => {
  const editing = loadStyles().find((sp) => sp.id === editingStyleId);
  if (!editing) return;
  const name = styleNameInput.value.trim() || "My style";
  saveStyle({ ...editing, name, text: styleTextArea.value, ts: new Date().toISOString() });
  refreshStylePanel();
  setStatus(`Saved "${name}".`, "ok");
});
styleDeleteBtn.addEventListener("click", () => {
  const editing = loadStyles().find((sp) => sp.id === editingStyleId);
  if (!editing) return;
  deleteStyle(editing.id);
  if (settings.activeStyleId === editing.id) {
    settings.activeStyleId = null;
    persist();
  }
  editingStyleId = null;
  refreshStylePanel();
  setStatus(`Deleted "${editing.name}".`, "ok");
});

function openStyleModal(): void {
  refreshStylePanel();
  styleModal.open();
}

styleProfileSel.addEventListener("change", () => {
  commitStyleEdits();
  const picked = styleProfileSel.value;
  if (isActionValue(picked)) {
    styleProfileSel.value = settings.activeStyleId ?? "";
    if (picked === ACTION_NEW) styleNewBtn.click();
    openStyleModal();
    return;
  }
  settings.activeStyleId = picked === "" ? null : picked;
  persist();
  if (picked) editingStyleId = picked;
  refreshStylePanel();
});

// ---------- data modal (developer mode only) ----------

const dataModal = createModal("📊 Data");
dataModal.body.append(
  h("div", { class: "hint" }, "The authoring loop's raw material: logged generations and the packet used to improve the bundled instructions."),
  h("div", { class: "row" }, exemplarCount),
  h("div", { class: "row" }, exportPacketBtn, clearLogsBtn),
);
app.appendChild(dataModal.dialog);
dataRow.addEventListener("click", () => {
  refreshCounts();
  dataModal.open();
});

// ---------- settings dialog ----------

const keyInput = h("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off" }) as HTMLInputElement;
keyInput.value = getApiKey();
const clearKeyBtn = h("button", { class: "small" }, "Clear key");
const usageNote = h("div", { class: "settings-note" });
const ttsKeyInput = h("input", { type: "password", placeholder: "AIza…", autocomplete: "off" }) as HTMLInputElement;
ttsKeyInput.value = getTtsKey();
const clearTtsKeyBtn = h("button", { class: "small" }, "Clear key");
const cloudPlaybackCb = h("input", { type: "checkbox" }) as HTMLInputElement;
cloudPlaybackCb.checked = settings.cloudPlayback;

// The durable layer of the per-language cloud voice (B12). The voice list
// needs a key and a network call, so it fills on Settings open (and again
// when the catalog arrives); "Default" empties the preference.
const cloudVoiceLangSel = h("select", { title: "Which language this voice choice applies to" }) as HTMLSelectElement;
for (const l of LANGUAGES) cloudVoiceLangSel.appendChild(h("option", { value: l.code }, l.label));
cloudVoiceLangSel.value = "en";
const cloudVoiceSel = h("select", { title: "The Google voice that narrates this language" }) as HTMLSelectElement;
const cloudVoiceListenBtn = h("button", { class: "small", title: "Speak a sample line in the selected voice" }, "▶ Listen");

function refreshCloudVoiceField(): void {
  const lang = cloudVoiceLangSel.value;
  const catalog = cloudCatalog.get(lang) ?? [];
  ensureCloudCatalog([lang], refreshCloudVoiceField);
  cloudVoiceSel.replaceChildren(h("option", { value: "" }, "Default"));
  for (const v of catalog) cloudVoiceSel.appendChild(h("option", { value: v.name }, v.name));
  // The stored preference stays visible (and clearable) even while the
  // catalog hasn't arrived — otherwise the select reads "Default" while the
  // hidden pick keeps driving playback and publishes (final review).
  const stored = settings.cloudVoices[lang] ?? "";
  if (stored && !catalog.some((v) => v.name === stored)) cloudVoiceSel.appendChild(h("option", { value: stored }, stored));
  cloudVoiceSel.value = stored;
  if (cloudVoiceSel.selectedIndex < 0) cloudVoiceSel.value = "";
  const noKey = getTtsKey() === "";
  cloudVoiceSel.disabled = noKey;
  cloudVoiceListenBtn.disabled = noKey || cloudVoiceSel.value === "" && catalog.length === 0;
}
cloudVoiceLangSel.addEventListener("change", refreshCloudVoiceField);
cloudVoiceSel.addEventListener("change", () => {
  const lang = cloudVoiceLangSel.value;
  const next = { ...settings.cloudVoices };
  if (cloudVoiceSel.value === "") delete next[lang];
  else next[lang] = cloudVoiceSel.value;
  settings.cloudVoices = next;
  persist();
  if (cloudVoiceSel.value !== "") speakVoiceSample(lang, cloudVoiceSel.value);
});
cloudVoiceListenBtn.addEventListener("click", () => {
  const lang = cloudVoiceLangSel.value;
  const name = cloudVoiceSel.value || settings.cloudVoices[lang] || "";
  if (name) speakVoiceSample(lang, name);
  else setStatus("Pick a voice first — Default lets Google choose.", "info");
});
const skipQuestionsCb = h("input", { type: "checkbox" }) as HTMLInputElement;
skipQuestionsCb.checked = settings.skipQuestions;
const burnCaptionsCb = h("input", { type: "checkbox" }) as HTMLInputElement;
burnCaptionsCb.checked = settings.burnCaptions;
const developerCb = h("input", { type: "checkbox" }) as HTMLInputElement;
developerCb.checked = settings.developerMode;
const contactEmailInput = h("input", { type: "email", placeholder: "you@example.org", autocomplete: "off" }) as HTMLInputElement;
contactEmailInput.value = settings.contactEmail;
contactEmailInput.addEventListener("change", () => {
  settings.contactEmail = contactEmailInput.value.trim();
  persist();
});
// ---- Publishing (courses -> the user's own public GitHub repo) ----
const githubRepoInput = h("input", { type: "text", placeholder: "hmelberg/kurs", autocomplete: "off" }) as HTMLInputElement;
githubRepoInput.value = settings.githubRepo;
githubRepoInput.addEventListener("change", () => {
  settings.githubRepo = githubRepoInput.value.trim();
  persist();
  // Same explicit refresh as the token field just below — see
  // refreshCredentialMenus()'s doc comment for why this isn't persist()'s job.
  refreshCredentialMenus();
});
const githubTokenInput = h("input", { type: "password", placeholder: "github_pat_…", autocomplete: "off" }) as HTMLInputElement;
githubTokenInput.value = getGithubToken();
githubTokenInput.addEventListener("change", () => {
  setGithubToken(githubTokenInput.value.trim());
  // The token lives outside `settings` (its own localStorage key, per BYOK
  // convention), so it never goes through persist() — refresh explicitly.
  refreshCredentialMenus();
});
const coursesDirInput = h("input", { type: "text", placeholder: "(repository root)", autocomplete: "off" }) as HTMLInputElement;
coursesDirInput.value = settings.coursesDir;

// giscus wiring for "Allow comments" (C1). Plain text fields: the ids are
// opaque strings the giscus.app config page hands the author — validating
// their shape here would just be a second place to be wrong about it.
const giscusRepoIdInput = h("input", { type: "text", placeholder: "R_kgDO…", autocomplete: "off" }) as HTMLInputElement;
const giscusCategoryInput = h("input", { type: "text", placeholder: "Announcements", autocomplete: "off" }) as HTMLInputElement;
const giscusCategoryIdInput = h("input", { type: "text", placeholder: "DIC_kwDO…", autocomplete: "off" }) as HTMLInputElement;
giscusRepoIdInput.value = settings.giscusRepoId;
giscusCategoryInput.value = settings.giscusCategory;
giscusCategoryIdInput.value = settings.giscusCategoryId;
for (const [input, write] of [
  [giscusRepoIdInput, (v: string) => (settings.giscusRepoId = v)],
  [giscusCategoryInput, (v: string) => (settings.giscusCategory = v)],
  [giscusCategoryIdInput, (v: string) => (settings.giscusCategoryId = v)],
] as const) {
  input.addEventListener("change", () => {
    write(input.value.trim());
    persist();
  });
}
coursesDirInput.addEventListener("change", () => {
  settings.coursesDir = coursesDirInput.value.trim().replace(/^\/+|\/+$/g, "");
  coursesDirInput.value = settings.coursesDir;
  persist();
});

const voiceSel = h("select", {});
const rateSel = h("select", {});
for (const r of ["0.8", "0.9", "1", "1.1", "1.25"]) rateSel.appendChild(h("option", { value: r }, `${r}×`));
rateSel.value = String(settings.rate);

// Backup: an app-global "download everything" button. It used to live in the
// course panel's button bar, but it backs up drawcasts as much as courses —
// Settings is where it belongs.
const backupBtn = h("button", { class: "small", title: "Download every course and drawcast as one file" }, "⬇ Backup");
backupBtn.addEventListener("click", () => {
  // Everything localStorage holds for courses, in one file. Generated
  // lectures cost real money, and until a course is published to GitHub the
  // only copy is one browser away from being gone.
  const courses = loadCourses();
  const library = loadLibrary();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJson(`drawcast-backup-${stamp}.json`, { savedAt: new Date().toISOString(), courses, library });
  setStatus(`Backed up ${courses.length} course${courses.length === 1 ? "" : "s"} and ${library.length} drawcast${library.length === 1 ? "" : "s"}.`, "ok");
});

// Every id in SETTINGS_TABS (src/store.ts) must resolve to exactly one of
// these blocks — that mapping is what lets a tab list settings.ts owns
// determine where each field's markup actually lands.
const settingsBlocks = new Map<string, HTMLElement>([
  ["style", h("div", { class: "settings-field" }, h("label", {}, "Drawing style"), styleSel)],
  ["theme", h("div", { class: "settings-field" }, h("label", {}, "Appearance"), themeSel)],
  [
    "apiKey",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Anthropic API key (bring your own)"),
      keyInput,
      h("div", {}, clearKeyBtn),
      h("div", { class: "settings-note" }, "Stored in this browser's localStorage only. It never leaves the browser except in requests to api.anthropic.com."),
      usageNote,
    ),
  ],
  [
    "ttsKey",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Google Cloud Text-to-Speech key (for video export)"),
      ttsKeyInput,
      h("div", {}, clearTtsKeyBtn),
      h(
        "div",
        { class: "settings-note" },
        "Video export narrates with Google's neural voices (browser speech cannot be recorded). Stored in localStorage only; sent only to texttospeech.googleapis.com. Costs are per character and per voice family — the default narrator (Studio) bills at Google's premium rate, and the Publish dialog's Embed-narration box shows the estimate before you spend.",
      ),
    ),
  ],
  [
    "cloudPlayback",
    h(
      "div",
      { class: "settings-field" },
      h("label", { class: "settings-check" }, cloudPlaybackCb, " Also use these voices for normal playback (falls back to the browser voice if a call fails)"),
    ),
  ],
  [
    "cloudVoice",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Cloud narration voice"),
      h("div", { class: "row cloud-voice-row" }, cloudVoiceLangSel, cloudVoiceSel, cloudVoiceListenBtn),
      h(
        "div",
        { class: "settings-note" },
        "Per language — a voice belongs to a language. Applies to cloud narration (export, publish-with-narration, and live playback when the box above is on); dialogue's second speaker keeps its contrasting default. Changing it re-synthesizes affected lines on the next publish.",
      ),
    ),
  ],
  [
    "skipQuestions",
    h("div", { class: "settings-field" }, h("label", { class: "settings-check" }, skipQuestionsCb, " Skip questions (quiz and typed ask) in playback and exports")),
  ],
  [
    "burnCaptions",
    h(
      "div",
      { class: "settings-field" },
      h(
        "label",
        { class: "settings-check" },
        burnCaptionsCb,
        " Burn captions into the DOWNLOADED video (a file has no subtitle layer). A YouTube upload never burns them in: YouTube carries the subtitle track itself.",
      ),
    ),
  ],
  [
    "githubRepo",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Publishing — GitHub repository"),
      githubRepoInput,
      h(
        "div",
        { class: "settings-note" },
        "owner/repo. It must be PUBLIC: published lectures are fetched from raw.githubusercontent.com, which does not serve private repositories, and GitHub Pages on a private repo needs a paid plan. One repo holds any number of courses, one folder each.",
      ),
    ),
  ],
  [
    "githubToken",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "GitHub token"),
      githubTokenInput,
      h(
        "div",
        { class: "settings-note" },
        "A fine-grained personal access token scoped to that ONE repository, with Contents: read and write and nothing else, and an expiry date. Stored in this browser's localStorage only and sent only to api.github.com — and localStorage is per site, so a token entered here does not exist on the other drawcast deploy.",
      ),
    ),
  ],
  [
    "coursesDir",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Subfolder (optional)"),
      coursesDirInput,
      h(
        "div",
        { class: "settings-note" },
        "Leave empty when the repository is only for courses — each course then gets its own folder at the root, and the course list becomes the site's front page. Set a folder only if the repository holds other things too; note that the list is written as index.html at that level. Nothing needs creating on GitHub first: git has no empty directories, so the folders appear with the files.",
      ),
    ),
  ],
  [
    "giscus",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Comments (giscus) — repository ID, category, category ID"),
      giscusRepoIdInput,
      giscusCategoryInput,
      giscusCategoryIdInput,
      h(
        "div",
        { class: "settings-note" },
        "One-time setup for “Allow comments” on published drawcasts: in YOUR repository enable Discussions and install the giscus app, then paste the two IDs from giscus.app here. Comments and reactions live in your repository's Discussions — this app hosts none of it.",
      ),
    ),
  ],
  ["voice", h("div", { class: "settings-field" }, h("label", {}, "Browser narration voice (used when no cloud voices)"), voiceSel)],
  ["rate", h("div", { class: "settings-field" }, h("label", {}, "Narration rate"), rateSel)],
  [
    "contactEmail",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "Contact email (optional)"),
      contactEmailInput,
      h(
        "div",
        { class: "settings-note" },
        "Only for source elements that carry a DOI: when OpenAlex knows no open-access PDF, Unpaywall is asked next, and its free API requires a contact address. Sent to api.unpaywall.org and nowhere else; leave it empty to skip that step.",
      ),
    ),
  ],
  [
    "developerMode",
    h(
      "div",
      { class: "settings-field" },
      h("label", { class: "settings-check" }, developerCb, " Developer mode — show the 1–5 rating, all lint warnings and the Data panel"),
    ),
  ],
  ["backup", h("div", { class: "settings-field" }, backupBtn)],
]);

const settingsModal = createModal("Settings", { size: "m" });
const dialog = settingsModal.dialog;
const settingsTabs = createTabs(
  SETTINGS_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    panel: h(
      "div",
      { class: "tab-panel" },
      ...t.fields.map((f) => {
        const block = settingsBlocks.get(f);
        if (!block) throw new Error(`SETTINGS_TABS field "${f}" has no matching settings block`);
        return block;
      }),
    ),
  })),
);
settingsModal.body.appendChild(settingsTabs.el);
app.appendChild(dialog);

function openSettings(): void {
  // These four are set once at construction and otherwise read-only from the
  // dialog's own "change" listeners — but Share's Video panel now writes
  // settings.burnCaptions from outside this dialog, so the checkbox must be
  // re-read on every open or it shows construction-time state forever. The
  // other three have no such external writer today, but the pattern is
  // identical, so they get the same treatment rather than leaving a landmine
  // for the next setting that grows one.
  cloudPlaybackCb.checked = settings.cloudPlayback;
  refreshCloudVoiceField();
  skipQuestionsCb.checked = settings.skipQuestions;
  burnCaptionsCb.checked = settings.burnCaptions;
  developerCb.checked = settings.developerMode;
  usageNote.textContent = usageSummary();
  usageNote.hidden = usageNote.textContent === "";
  dialog.showModal();
}

/** Developer mode hides the instruments that only feed the authoring loop. */
function applyDeveloperMode(): void {
  const on = settings.developerMode;
  ratingBox.hidden = !on;
  dataRow.hidden = !on;
  promoteBtn.hidden = !on;
  // The References tab only makes sense once "Learn from this" is reachable —
  // gate it the same way, and if it's the one currently showing when the
  // setting turns off, fall back to Instructions rather than leave an empty
  // pane behind a hidden button.
  instructionsTabs.setHidden("references", !on);
  if (!on) instructionsTabs.show("instructions");
  // The prompt editor is an advanced feature (B6): its sidebar row and its
  // quick pick under Generate go with the same flag. Style replaces them as
  // the user-facing concept (B5).
  if (instructionsRow) instructionsRow.hidden = !on;
  instrChoiceLabel.hidden = !on;
  document.body.classList.toggle("dev-mode", on);
}
developerCb.addEventListener("change", () => {
  settings.developerMode = developerCb.checked;
  persist();
  applyDeveloperMode();
  if (session) setLintFromSession();
  // Turning the flag off hides the prompt picker but not its effect: say so
  // when a non-default variant stays live, rather than letting a custom
  // compiler prompt drive every generation invisibly.
  if (!settings.developerMode && settings.variant !== variants[0].name) {
    setStatus(`Custom instructions "${currentVariant().name}" still drive generation — developer mode shows the picker.`, "info");
  }
});
applyDeveloperMode();

function populateVoices(): void {
  const voices = speech.voices();
  voiceSel.replaceChildren(h("option", { value: "" }, "(browser default)"));
  const score = (v: SpeechSynthesisVoice) => (v.lang.startsWith("no") || v.lang.startsWith("nb") || v.lang.startsWith("nn") ? 0 : v.lang.startsWith("en") ? 1 : 2);
  for (const v of [...voices].sort((a, b) => score(a) - score(b) || a.lang.localeCompare(b.lang))) {
    voiceSel.appendChild(h("option", { value: v.voiceURI }, `${v.name} (${v.lang})`));
  }
  if (settings.voiceURI) voiceSel.value = settings.voiceURI;
}
populateVoices();
speech.onVoicesChanged(populateVoices);

// ---------- template authoring (M2) ----------

const authorDescEl = h("textarea", { placeholder: 'Describe the reusable figure… e.g. "A titration setup: burette, flask, stand — with adjustable labels"' });
const authorImgThumb = h("img", { class: "author-thumb", hidden: "", alt: "Reference image" });
const authorImgClear = h("button", { class: "small", hidden: "" }, "Remove image");
const authorDrop = h("div", { class: "author-drop" }, "Paste or drop a reference image here (optional) — or ", h("button", { class: "small author-pick" }, "choose a file"));
const authorImgInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: "" });
const authorGenBtn = h("button", { class: "primary" }, "Generate template");
const authorStatus = h("div", { class: "hint" });
const authorPreviewHost = h("div", { class: "player-figure author-preview" });
const authorRefineEl = h("textarea", { placeholder: "Refine it… e.g. \"make the flask bigger and add an indicator-color param\"", hidden: "" });
const authorRefineBtn = h("button", { hidden: "" }, "Refine");
const authorSaveBtn = h("button", { class: "primary", hidden: "" }, "Save to My templates");

const authorModal = createModal("✦ New template", { size: "m" });
const authorDialog = authorModal.dialog;
authorModal.body.append(
  authorDescEl,
  h("div", { class: "row" }, authorDrop, authorImgInput, authorImgThumb, authorImgClear),
  authorStatus,
  authorPreviewHost,
  authorRefineEl,
);
authorModal.footer.append(authorGenBtn, authorRefineBtn, authorSaveBtn);
app.appendChild(authorDialog);

let authorImage: AuthorImage | null = null;
let authorOutcome: AuthorOutcome | null = null;
let authorImproveId: string | null = null;
let authorMount: { destroy(): void } | null = null;
/** Bumped at the start of every runAuthor() call and in the close handler; an
 * async continuation that finds it stale on resume (dialog closed or a newer
 * generation started meanwhile) must not touch the registry, mounts, or status. */
let authorSeq = 0;
/** In-flight authoring call, so closing the dialog stops paying for it. */
let authorAbort: AbortController | null = null;
/** Every template id this dialog session registered a preview under — reverted
 * or unregistered as a batch when the dialog closes. */
const draftIds = new Set<string>();

function setAuthorImage(img: AuthorImage | null): void {
  authorImage = img;
  authorImgThumb.hidden = !img;
  authorImgClear.hidden = !img;
  authorDrop.hidden = !!img;
  if (img) authorImgThumb.src = `data:${img.mediaType};base64,${img.dataBase64}`;
  else authorImgThumb.removeAttribute("src");
}

function readImageFile(file: File): Promise<AuthorImage | null> {
  const ok = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!ok.includes(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      const comma = url.indexOf(",");
      resolve({ mediaType: file.type as AuthorImage["mediaType"], dataBase64: url.slice(comma + 1) });
    };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

/** Read + accept a candidate image, or surface why it was rejected instead of doing nothing. */
function handleImageFile(file: File): void {
  void readImageFile(file).then((img) => {
    if (img) setAuthorImage(img);
    else authorStatus.textContent = "Couldn't read that image — use PNG, JPEG, WEBP, or GIF.";
  });
}

authorDialog.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.files ?? [])][0];
  if (file) handleImageFile(file);
});
authorDrop.addEventListener("dragover", (e) => e.preventDefault());
authorDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) handleImageFile(file);
});
authorDrop.querySelector(".author-pick")!.addEventListener("click", () => authorImgInput.click());
authorImgInput.addEventListener("change", () => {
  const file = authorImgInput.files?.[0];
  if (file) handleImageFile(file);
  authorImgInput.value = "";
});
authorImgClear.addEventListener("click", () => setAuthorImage(null));

async function renderAuthorPreview(seq: number): Promise<void> {
  authorMount?.destroy();
  authorMount = null;
  authorPreviewHost.replaceChildren();
  const outcomeDoc = authorOutcome?.doc;
  if (!outcomeDoc || !authorOutcome?.yaml) return;
  // Preview through the real pipeline: registered under its id for real (the
  // preview player re-renders on replay, so a temporary registration cannot be
  // restored early). draftIds tracks it so the close handler can revert it.
  const reg = registerUserTemplateYaml(authorOutcome.yaml);
  if (!reg.ok) {
    authorStatus.textContent = `Preview failed: ${reg.errors.join("; ")}`;
    return;
  }
  draftIds.add(outcomeDoc.template);
  const spec = { title: outcomeDoc.title ?? outcomeDoc.template, template: outcomeDoc.template, params: outcomeDoc.examples[0]?.params ?? {} } as unknown as Spec;
  try {
    await ensureEnginesForTemplate(outcomeDoc.template);
    const mount = await mountPlaylist(authorPreviewHost, singlePlaylist(spec), {
      style: settings.style,
      mode: "instant",
      speed: settings.speed,
      speech,
      prefs: playbackPrefs(),
    });
    if (seq !== authorSeq) {
      // Superseded mid-mount (dialog closed, or a newer generation started) —
      // never resurrect authorMount for a session that's no longer current.
      mount.destroy();
      return;
    }
    authorMount = mount;
  } catch (err) {
    if (seq === authorSeq) authorStatus.textContent = `Preview render failed: ${(err as Error).message}`;
  }
}

async function runAuthor(description: string, refine: boolean): Promise<void> {
  const apiKey = requireKey();
  if (!apiKey) return;
  if (!description.trim()) return;
  const seq = ++authorSeq;
  // Generate stays live as this dialog's Cancel, the same as the editor's.
  // Refine goes down: it would continue a conversation that is still being written.
  authorRefineBtn.disabled = true;
  authorGenBtn.textContent = "Cancel";
  authorGenBtn.classList.add("cancelling");
  authorStatus.textContent = "Generating template…";
  authorAbort?.abort(); // a second Generate replaces the first, it does not race it
  const controller = new AbortController();
  authorAbort = controller;
  try {
    const existing = authorImproveId && !refine ? loadMyTemplates().find((t) => t.id === authorImproveId)?.yaml : undefined;
    const outcome = await generateTemplate(description, refine ? null : authorImage, {
      apiKey,
      model: modelSel.value,
      existingYaml: existing,
      history: refine ? (authorOutcome?.history ?? undefined) : undefined,
      signal: controller.signal,
      onProgress: ({ round, text }) => {
        if (seq !== authorSeq) return;
        const where = round > 1 ? ` (repair ${round - 1})` : "";
        authorStatus.textContent = `Generating template${where}… ${text.length.toLocaleString()} characters`;
      },
    });
    if (seq !== authorSeq) return; // dialog closed or a newer generation started meanwhile
    authorOutcome = outcome;
    const n = authorOutcome.rounds.length;
    if (authorOutcome.error) {
      authorStatus.textContent = `${authorOutcome.error} (${n} round${n === 1 ? "" : "s"})`;
    } else {
      authorStatus.textContent = `Template "${authorOutcome.doc!.template}" ready after ${n} round${n === 1 ? "" : "s"} — check the preview, refine, or save.`;
      authorRefineEl.hidden = authorRefineBtn.hidden = authorSaveBtn.hidden = false;
      await renderAuthorPreview(seq);
    }
  } catch (err) {
    if (seq === authorSeq) authorStatus.textContent = describeApiError(err);
  } finally {
    if (authorAbort === controller) authorAbort = null;
    if (seq === authorSeq) {
      authorRefineBtn.disabled = false;
      authorGenBtn.textContent = "Generate template";
      authorGenBtn.classList.remove("cancelling");
    }
  }
}

authorGenBtn.addEventListener("click", () => {
  if (authorAbort) {
    authorAbort.abort();
    authorStatus.textContent = "Cancelling…";
    return;
  }
  void runAuthor(authorDescEl.value, false);
});
authorRefineBtn.addEventListener("click", () => {
  const t = authorRefineEl.value.trim();
  if (t) {
    authorRefineEl.value = "";
    void runAuthor(t, true);
  }
});

authorSaveBtn.addEventListener("click", () => {
  if (!authorOutcome?.yaml || !authorOutcome.doc) return;
  const id = authorOutcome.doc.template;
  const reg = registerUserTemplateYaml(authorOutcome.yaml);
  if (!reg.ok) {
    authorStatus.textContent = `Save failed: ${reg.errors.join("; ")}`;
    return;
  }
  draftIds.add(id);
  saveMyTemplate({ id, yaml: authorOutcome.yaml, ts: new Date().toISOString() });
  refreshMyTemplates();
  refreshTemplatePicker();
  authorStatus.textContent = `Saved. "${id}" is now in the catalog — try: use the ${id} template.`;
});

function openAuthorDialog(improve?: { id: string }): void {
  authorImproveId = improve?.id ?? null;
  authorOutcome = null;
  setAuthorImage(null);
  authorDescEl.value = "";
  authorRefineEl.value = "";
  // Unconditional: every dialog open starts with live buttons, even if a stale
  // generation from a previous session is still in flight (its seq-guarded
  // finally will no-op — see runAuthor — so this can't get re-disabled by it).
  authorGenBtn.disabled = authorRefineBtn.disabled = false;
  authorGenBtn.textContent = "Generate template";
  authorGenBtn.classList.remove("cancelling");
  authorStatus.textContent = authorImproveId ? `Improving "${authorImproveId}" — describe what to change.` : "";
  authorRefineEl.hidden = authorRefineBtn.hidden = authorSaveBtn.hidden = true;
  authorMount?.destroy();
  authorMount = null;
  authorPreviewHost.replaceChildren();
  (authorDialog.querySelector("h3") as HTMLElement).textContent = authorImproveId ? `✦ Improve template: ${authorImproveId}` : "✦ New template";
  authorDialog.showModal();
}

// The dialog's native "close" event fires for the ✕ button, backdrop clicks
// (both via .close()) AND ESC (the browser's own cancel→close, which bypasses
// any click handler entirely) — so all cleanup lives here.
authorDialog.addEventListener("close", () => {
  // Invalidate any runAuthor()/renderAuthorPreview() continuation still in
  // flight: it must not register a draft or resurrect authorMount after this.
  authorSeq++;
  // And stop the call itself — the seq guard only silences the reply, the
  // request would otherwise keep running (and billing) with nowhere to land.
  authorAbort?.abort();
  authorAbort = null;
  authorMount?.destroy();
  authorMount = null;
  // Every id this session registered a preview under (draftIds — not just the
  // current authorOutcome's id, so an earlier draft abandoned mid-session by a
  // fresh Generate isn't orphaned) reverts to its stored version if one exists,
  // or is unregistered if this draft was never saved.
  for (const id of draftIds) {
    const stored = loadMyTemplates().find((t) => t.id === id);
    if (!stored) unregisterUserTemplate(id);
    else registerUserTemplateYaml(stored.yaml);
  }
  draftIds.clear();
});

// ---------- explore-in-3D modal ----------

const model3dContainer = h("div", { class: "model3d-container" });
const model3dSpinBtn = h("button", {}, "Pause spin");
const model3dLabelsBtn = h("button", {}, "Hide labels");
const model3dModal = createModal("⬡ Explore in 3D", { size: "m", class: "model3d-dialog" });
const model3dDialog = model3dModal.dialog;
model3dModal.body.append(model3dContainer);
model3dModal.footer.append(model3dSpinBtn, model3dLabelsBtn);
app.appendChild(model3dDialog);

let model3dDestroy: (() => void) | null = null;
let model3dViewer: Model3dViewer | null = null;
let model3dSpinning = true;
function setModel3dSpin(on: boolean): void {
  model3dSpinning = on;
  model3dSpinBtn.textContent = on ? "Pause spin" : "Spin";
  model3dViewer?.spin(on);
}
model3dSpinBtn.addEventListener("click", () => setModel3dSpin(!model3dSpinning));
let model3dLabelsOn = true;
function setModel3dLabelsState(on: boolean): void {
  model3dLabelsOn = on;
  model3dLabelsBtn.textContent = on ? "Hide labels" : "Show labels";
  if (model3dViewer) setModel3dLabels(model3dViewer, on);
}
model3dLabelsBtn.addEventListener("click", () => setModel3dLabelsState(!model3dLabelsOn));
/**
 * One AbortController per open, held module-level. This is the generation
 * marker for the whole flow — not just a main.ts-side "ignore this result"
 * flag: it's threaded into openModel3d(), which forwards it into the PubChem
 * fetch (so a superseded fetch is actually cancelled, not left to complete
 * pointlessly) and checks it immediately before mounting a viewer (so a
 * still-in-flight call that resolves AFTER a newer one has already mounted
 * can never clobber that newer viewer's container — the bug a plain
 * "seq !== current" counter here in main.ts could not catch, because that
 * check only ever ran in main.ts's own .then(), after openModel3d had
 * already mutated the shared container).
 */
let model3dAbort: AbortController | null = null;

function openModel3dDialog(q: NonNullable<ReturnType<typeof qualifiesFor3d>>): void {
  // Aborting the previous controller — whether or not the dialog was closed
  // first — cancels any of ITS still-in-flight work before this one starts.
  model3dAbort?.abort();
  model3dDestroy?.();
  model3dDestroy = null;
  const ac = new AbortController();
  model3dAbort = ac;
  model3dViewer = null;
  setModel3dSpin(true); // every open starts spinning, whatever the last session did
  setModel3dLabelsState(true); // and with element labels showing
  model3dDialog.showModal();
  void openModel3d(model3dDialog, model3dContainer, q, ac.signal, {
    onMounted: (v) => {
      if (!ac.signal.aborted) {
        model3dViewer = v;
        v.spin(model3dSpinning); // re-apply any toggle click that landed during the async mount
        setModel3dLabels(v, model3dLabelsOn); // same for the labels toggle (clear-then-add, so never stacked)
      }
    },
  }).then((destroy) => {
    if (ac.signal.aborted) {
      destroy(); // no-op if openModel3d itself never mounted; a safe teardown otherwise
      return;
    }
    model3dDestroy = destroy;
  });
}

// Native "close" fires for the ✕ button, backdrop clicks and ESC (which
// bypasses any click handler) — all cleanup lives here.
model3dDialog.addEventListener("close", () => {
  model3dAbort?.abort();
  model3dAbort = null;
  model3dDestroy?.();
  model3dDestroy = null;
  model3dViewer = null;
  model3dContainer.replaceChildren();
});

// ---------- rendering the current document ----------

function persist(): void {
  saveSettings(settings);
}

// ---- Subtitles: making a track for another language -----------------------
// Translation happens ONCE, here, and the answer is written into the document.
// Playback never calls a model — which is what lets the standalone viewer, key
// and all, show a Norwegian caption.

const subLangSel = h("select", { class: "sub-lang" }) as HTMLSelectElement;
const subGo = h("button", { class: "primary" }, "Add subtitles") as HTMLButtonElement;
const subStatus = h("div", { class: "sub-status" });
const subModal = createModal("Subtitles", { class: "sub-dialog" });
subModal.body.append(
  h(
    "p",
    { class: "hint" },
    "Translates what the narrator SAYS, once, and stores it in this drawcast. " +
      "The figure's labels and the narrator's voice stay as they are — a viewer picks the language with the CC button, and needs no key of their own.",
  ),
  h("div", { class: "row" }, subLangSel, subGo),
  subStatus,
);
app.appendChild(subModal.dialog);

/** Languages this document already carries a track for, plus its own. */
function subtitleLanguagesHere(): Set<string> {
  return new Set(subtitleLanguages(itemsOf(doc.playlist).map((i) => i.spec)).map((l) => l.code));
}

function openSubtitleDialog(): void {
  const here = subtitleLanguagesHere();
  subLangSel.replaceChildren();
  for (const l of LANGUAGES) {
    if (here.has(l.code)) continue;
    subLangSel.appendChild(h("option", { value: l.code }, l.label));
  }
  const none = subLangSel.options.length === 0;
  subGo.disabled = none;
  subStatus.textContent = none ? "Every language drawcast can speak already has a track here." : "";
  subModal.open();
}

async function addSubtitleTrack(): Promise<void> {
  const target = LANGUAGES.find((l) => l.code === subLangSel.value);
  const apiKey = getApiKey();
  if (!target) return;
  if (!apiKey) {
    subStatus.textContent = "Subtitles need your Anthropic API key — add it in Settings.";
    return;
  }
  const budget = anthropicBudgetError();
  if (budget) {
    subStatus.textContent = budget;
    return;
  }
  subGo.disabled = true;
  const items = itemsOf(doc.playlist).map((i) => i.spec);
  const specs: Spec[] = [];
  let missing = 0;
  try {
    for (const [i, spec] of items.entries()) {
      subStatus.textContent =
        items.length > 1 ? `Translating into ${target.label} — part ${i + 1} of ${items.length}…` : `Translating into ${target.label}…`;
      const out = await translateSubtitles(spec, target, { apiKey, model: settings.model });
      missing += out.missing.length;
      specs.push(withSubtitles(spec, target.code, out.track));
    }
  } catch (err) {
    subStatus.textContent = `Could not translate — ${(err as Error).message}`;
    subGo.disabled = false;
    return;
  }
  // Written into the document, so it is saved, published and exported with it.
  setDoc({ ...doc, playlist: playlistWithSpecs(doc.playlist, specs) }, undefined, { label: `subtitles: ${target.label}`, kind: "revise" });
  subStatus.textContent =
    missing > 0
      ? `Added ${target.label} subtitles — ${missing} line(s) came back untranslated and will show in ${languageLabel(sourceLanguage(doc.playlist))}.`
      : `Added ${target.label} subtitles. Pick them with the CC button.`;
  subGo.disabled = false;
}

subGo.addEventListener("click", () => void addSubtitleTrack());

/** The CC choice, remembered across drawcasts like mode and speed. */
function captionPrefs(): {
  on: boolean;
  lang: string;
  onChange(next: { on: boolean; lang: string }): void;
  onAdd(): void;
  hasCloudVoice: boolean;
  cloudVoices(): { lang: string; name: string }[];
  cloudPicked(): Record<string, string>;
  onCloudVoice(lang: string, name: string): void;
} {
  return {
    on: settings.captionsOn,
    lang: settings.captionLang,
    onChange: (next) => {
      settings.captionsOn = next.on;
      settings.captionLang = next.lang;
      persist();
    },
    onAdd: openSubtitleDialog,
    hasCloudVoice: settings.cloudPlayback && getTtsKey() !== "",
    // The quick-pick layer (B12): cloud voices in the CC menu's Voice row.
    // The catalog fetch is kicked here, synchronously returning whatever has
    // arrived — the menu simply grows them on its next open.
    cloudVoices: () => {
      const langs = [...subtitleLanguagesHere()];
      ensureCloudCatalog(langs);
      return langs.flatMap((code) => cloudCatalog.get(code) ?? []);
    },
    cloudPicked: () => settings.cloudVoices,
    onCloudVoice: (lang, name) => {
      // Fresh object, never mutation: when nothing was stored, `settings.cloudVoices`
      // IS the shared DEFAULT_SETTINGS instance.
      settings.cloudVoices = { ...settings.cloudVoices, [lang]: name };
      persist();
      refreshCloudVoiceField();
      speakVoiceSample(lang, name);
      setStatus(`${languageLabel(lang)} narration voice: ${name}.`, "ok");
    },
  };
}

// ---------- cloud voice preference (B12) ----------
// Per LANGUAGE, because a voice belongs to a language: the durable default
// lives in Settings, the CC menu's Voice row is the quick pick, and both
// write the same settings.cloudVoices. The bake's reuse key carries the
// voice (export/bake.ts), so changing it re-synthesizes instead of mixing.

const cloudCatalog = new Map<string, { lang: string; name: string }[]>();
// Every interested party, not just whoever happened to start the fetch: the
// CC menu kicks callback-less, and the Settings dropdown must still refresh
// when that fetch lands (final review 2026-09-02 — the onArrive was silently
// dropped whenever the in-flight sentinel already existed).
const catalogListeners = new Set<() => void>();
function ensureCloudCatalog(langs: string[], onArrive?: () => void): void {
  if (onArrive) catalogListeners.add(onArrive);
  const key = getTtsKey();
  if (!key) return;
  for (const code of langs) {
    if (cloudCatalog.has(code)) continue;
    cloudCatalog.set(code, []); // fetch once; deleted on failure so a retry can happen
    const lc = LANGUAGES.find((l) => l.code === code)?.languageCode ?? code;
    void listCloudVoices(key, lc)
      .then((vs) => {
        cloudCatalog.set(code, vs.map((v) => ({ lang: code, name: v.name })));
        for (const cb of catalogListeners) cb();
      })
      .catch(() => cloudCatalog.delete(code));
  }
}

/** What a voice pick sounds like, immediately — the audition B12 asks for. */
const VOICE_SAMPLES: Record<string, string> = {
  en: "Hello! This is how your drawcasts will sound.",
  nb: "Hei! Slik kommer dine drawcasts til å høres ut.",
};
function speakVoiceSample(lang: string, name: string): void {
  const key = getTtsKey();
  if (!key) return;
  const sample = VOICE_SAMPLES[lang] ?? VOICE_SAMPLES.en;
  void synthesizeBase64({ apiKey: key, rate: settings.rate, lang, voices: { [lang]: name } }, sample)
    .then((b64) => new Audio(`data:audio/mp3;base64,${b64}`).play())
    .catch((err: unknown) => setStatus(`Could not play a sample: ${(err as Error).message}`, "error"));
}

function playbackPrefs(): PlaybackPrefs {
  return {
    mode: settings.mode,
    speed: settings.speed,
    muted: settings.muted,
    onMode: (m) => {
      settings.mode = m;
      persist();
    },
    onSpeed: (s) => {
      settings.speed = s;
      persist();
    },
    onMute: (m) => {
      settings.muted = m;
      persist();
    },
  };
}

let presentSeq = 0;

// Which part the editor preview last mounted — the Insert portrait dialog's
// default "Part", so a portrait lands where you were actually looking instead
// of always into part 1 (the old insertion's hardcoded position).
let previewedPart = 0;

/**
 * `andPlay` closes the Play trap: the Play button that was just pressed lives
 * INSIDE the session this call is about to destroy, so pressing it can never
 * itself start the new one. When true, the freshly mounted session is told
 * (via SessionOptions.autoplay) to start playing on its own the moment it
 * mounts — the exact call its own brand-new Play button would have made.
 */
async function present(andPlay = false): Promise<void> {
  // Guard against overlapping presents (e.g. an edit landing while a mount is
  // in flight): only the latest call may keep its session.
  const seq = ++presentSeq;
  const isPlayer = settings.uiMode === "player";
  const host = isPlayer ? playerHost : previewHost;
  session?.destroy();
  session = null;
  host.replaceChildren();
  document.title = `${doc.title} — drawcast`;
  // A declared language picks the narrator's voice; without one the old
  // per-line sniff stands, which only ever tells English from Norwegian.
  speech.setLangHint(itemsOf(doc.playlist).find((i) => i.spec.lang)?.spec.lang ?? null);
  // Narration baked into the document plays from there; the live manager stays
  // behind it for anything the bake does not cover. Released before the next
  // mount, since the clips hold object URLs.
  bakedAudio?.destroy();
  bakedAudio = bakedAudioFor(speech, doc.playlist);
  const playSpeech = bakedAudio.speech;
  try {
    // Warm the cloud-voice cache so narrated playback starts without stalls —
    // skipping lines already baked, which would be paid for twice.
    if (settings.mode === "narrated") speech.prefetch(bakedAudio.unbaked(playlistSpeakLines(doc.playlist)), settings.speed);
    // Player mode has no chrome of its own, so the control bar carries the way
    // back. The editor's own way into player mode is the sidebar's ▶ Player
    // row (A5) — a second switch here would only crowd the narrow preview bar.
    const switchBtn = h("button", { class: "cs-bar-btn", title: "Open the editor" }, "✎ Edit");
    switchBtn.addEventListener("click", () => showMode("editor"));
    // A failed engine load is reported but never blocks the mount — the
    // affected template falls through with its own existing warning.
    await ensureEnginesForSpecs(itemsOf(doc.playlist).map((i) => i.spec)).catch((err) => {
      setStatus(`Engine load failed: ${(err as Error).message}`, "error");
    });
    const mounted = await mountPlaylist(host, doc.playlist, {
      style: settings.style,
      mode: settings.mode,
      speed: settings.speed,
      questions: settings.skipQuestions ? "skip" : "on",
      speech: playSpeech,
      prefs: playbackPrefs(),
      captions: captionPrefs(),
      autoplay: andPlay,
      controls: {
        onPlayingChange: (playing) => document.body.classList.toggle("is-playing", playing),
        speech: playSpeech,
        fullscreenEl: host,
        onTheater: isPlayer ? toggleTheater : undefined,
        trailing: isPlayer ? [switchBtn] : [],
        // The Play button lives inside THIS session. Pressing it while the text
        // is ahead replaces the session out from under it (ensureRendered(true)
        // → present(true) → autoplay above) rather than starting the timeline
        // that click is about to lose; when nothing changed, this returns
        // false and the press plays today's session as usual.
        beforePlay: () => ensureRendered(true),
      },
      onItemMounted: (hd, item) => {
        if (!isPlayer) {
          setLint(hd);
          previewedPart = item.index;
        }
        // Per-item chrome: the control bar is rebuilt fresh on every item mount
        // (session.ts), so this only ever appends into the CURRENT bar — no
        // stale button to remove from a previous item.
        const q = qualifiesFor3d(item.spec);
        const bar = host.querySelector<HTMLElement>(".cs-controlbar");
        if (q && bar) {
          const model3dBtn = h("button", { class: "cs-bar-btn model3d-btn", title: "Explore this molecule in 3D" }, "⬡ 3D");
          model3dBtn.addEventListener("click", () => openModel3dDialog(q));
          bar.appendChild(model3dBtn);
        }
        attachParamsTray(host, hd);
      },
    });
    if (seq !== presentSeq) {
      mounted.destroy(); // a newer present superseded this one mid-mount
      return;
    }
    session = mounted;
  } catch (err) {
    setStatus(`Render failed: ${(err as Error).message}`, "error");
  }
}

/** Render a version WITHOUT recording it — arrows navigate, they never mutate. */
function showVersion(index: number): void {
  const v = currentVersion(viewAt(stack, index));
  if (!v) return;
  // Stepping back FROM the newest version overwrites the textarea, and a
  // programmatic assignment also wipes its native undo stack — so an un-rendered
  // hand-edit would be gone with no way back. Seal it as a version instead: the
  // edit becomes history rather than a casualty. (The read-only lock only applies
  // once you are ALREADY viewing, which is why this case exists at all.)
  if (atNewest(stack) && specArea.value !== currentVersion(stack)?.text) {
    stack = pushManualEdit(stack, specArea.value, new Date().toISOString());
  }
  // The click handlers computed `index` before the seal ran, and sealing may
  // append — which at the 20-version cap also trims from the front and shifts
  // every index. So the target is re-located by IDENTITY: pushVersion rebuilds
  // the array but keeps the element references.
  const at = stack.versions.indexOf(v);
  if (at < 0) {
    // Only reachable if the seal coalesced into the very version we targeted
    // (i.e. it was the newest manual one) — the cursor is already where it
    // belongs, so there is nothing to render, just a longer counter to show.
    applyHistoryUi();
    return;
  }
  const target = viewAt(stack, at);
  const playlist = readPlaylistText(v.text);
  if (!playlist) {
    applyHistoryUi(); // readPlaylistText already reported why; cursor never moved
    return;
  }
  stack = target;
  restoring = true;
  try {
    specArea.value = v.text;
    // Same rule as setDoc: the version's own text is authoritative about the
    // founding request (B9) when it carries one; doc.prompt is the fallback.
    doc = { id: doc.id, driveFileId: doc.driveFileId, publishedAs: doc.publishedAs, publishedComments: doc.publishedComments, drivePublishedId: doc.drivePublishedId, drivePublishedName: doc.drivePublishedName, sourcePath: doc.sourcePath, title: docTitleOf(playlist, doc.title), prompt: playlist.meta.prompt ?? doc.prompt, playlist };
    void present();
    // A history restore filled the textarea, not a keystroke — it already
    // matches what present() just drew.
    markRendered(v.text);
  } finally {
    restoring = false;
  }
  applyHistoryUi();
}

/** Reflects `stack` onto the ◀ ▶ arrows and their surrounding UI. */
function applyHistoryUi(): void {
  const n = stack.versions.length;
  const viewing = !atNewest(stack);
  histNav.hidden = n < 2;
  histCounter.textContent = `${stack.cursor + 1}/${n}`;
  const v = currentVersion(stack);
  histCounter.title = v ? `${v.label}${v.from ? ` · from "${v.from}"` : ""}` : "";
  histPrev.disabled = stack.cursor <= 0;
  histNext.disabled = atNewest(stack);
  viewBar.hidden = !viewing;
  // While viewing, editing has nowhere to land — lock the pane rather than let
  // hand-edits vanish on the next arrow press.
  specArea.readOnly = viewing;
  applyAuthorMode(); // the one button reads viewing (Revise from here) and the derived mode
  // Both of these target `lastLogId` — the log entry for the NEWEST version — so
  // while you are viewing an older one they would record against a spec that is
  // not on screen. Ratings feed the prompt-improvement loop, which makes that a
  // corrupted signal rather than a cosmetic slip.
  ratingButtons.forEach((rb) => (rb.disabled = viewing));
  // Exemplars are (request, single spec) pairs — a multi-part doc has no such
  // pair. Counted in ITEMS, not via isSingle: since B9 a generated single
  // figure carries its founding prompt in the header, which makes isSingle
  // false — and that is exactly the document this button exists for.
  promoteBtn.disabled = viewing || promoted || itemsOf(doc.playlist).length !== 1;
}

histPrev.addEventListener("click", () => showVersion(stack.cursor - 1));
histNext.addEventListener("click", () => showVersion(stack.cursor + 1));
latestBtn.addEventListener("click", () => showVersion(stack.versions.length - 1));
restoreBtn.addEventListener("click", () => {
  stack = restoreViewed(stack, new Date().toISOString());
  showVersion(stack.versions.length - 1);
  setStatus(currentVersion(stack)?.label ?? "Restored an earlier version", "ok");
  autosave(); // after the status line, so a save failure is what you are left reading
  // Unconditional: restoreViewed has already moved the cursor, so if showVersion
  // bailed out the counter, viewing bar, read-only lock and button label would
  // otherwise keep describing the cursor we left behind.
  applyHistoryUi();
});

function setDoc(next: Doc, statusText?: string, version?: { label: string; kind: "generate" | "revise" }): void {
  doc = next;
  // One founding request, two homes: the file carries it (playlist.meta.prompt,
  // B9) and the library keeps its own copy (Doc.prompt → SavedDrawing.prompt).
  // The file is authoritative WHEN IT HAS ONE — so opening a document that
  // carries its request adopts it, and a pre-B9 entry (or a bundled example,
  // which has a request but no header) keeps the copy it came with.
  doc.prompt = doc.playlist.meta.prompt ?? doc.prompt;
  lastLogId = null; // ratings apply to generations only
  promoted = false; // before applyHistoryUi(), which reads it
  specArea.value = formatPlaylist(doc.playlist, "yaml");
  // A new document starts a new history. Generate hands us a brand-new drawcast
  // (`id: null`, and autosave() mints it its own library row straight after), so
  // its stack is RESEEDED: appending it to the outgoing document's stack would
  // leave the arrows spanning two unrelated drawcasts, and ◀ + Restore would then
  // autosave the previous document's text into the new one's row. A revise is the
  // only action that stays inside the same document, so it alone pushes.
  if (version?.kind === "revise") {
    stack = pushVersion(stack, { text: specArea.value, label: version.label, kind: "revise", ts: new Date().toISOString() });
  } else {
    // `||`, not `??`: ＋ New drawcast passes prompt: "", and a version labelled
    // with the empty string names nothing in the counter's tooltip.
    stack = seedStack(specArea.value, version?.label || doc.prompt || doc.title, version?.kind ?? "loaded");
  }
  applyHistoryUi();
  promptEl.value = doc.prompt ?? promptEl.value;
  refreshChips();
  ratingButtons.forEach((rb) => rb.classList.remove("lit"));
  promoteBtn.textContent = "👍 Learn from this"; // applyHistoryUi() above owns .disabled
  if (statusText) setStatus(statusText, "ok");
  void present();
  // The textarea was just filled by a load/generation, not typed — it must
  // not read as "edited" the instant it appears.
  markRendered(specArea.value);
}

/**
 * Copy-on-write persistence: the first change to a document mints its library
 * id, and every later change replaces that same entry (saveDrawing filters by
 * id before unshifting). Loading an example or a share saves nothing until you
 * change it.
 */
function autosave(): void {
  doc.id ??= crypto.randomUUID();
  try {
    saveDrawing({
      id: doc.id,
      title: doc.title,
      prompt: doc.prompt,
      spec: firstSpec(doc),
      playlist: isSingle(doc.playlist) ? undefined : formatPlaylist(doc.playlist, "yaml"),
      // What the library's ▤ marker reads. Stored rather than re-derived per
      // row: the sidebar rebuilds on every keystroke of the filter box, and
      // parsing every row's YAML to count its items would be absurd there.
      parts: itemsOf(doc.playlist).length,
      publishedAs: doc.publishedAs,
      publishedComments: doc.publishedComments,
      drivePublishedId: doc.drivePublishedId,
      drivePublishedName: doc.drivePublishedName,
      sourcePath: doc.sourcePath,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    // saveDrawing is an unguarded localStorage.setItem, so a full origin throws
    // QuotaExceededError straight through its caller — which in revise() landed
    // BEFORE the request box was cleared and surfaced as an unhandled rejection,
    // leaving the status reading "Revised: …" with nothing on disk. Say so
    // instead. Making room automatically (eviction) is phase 2, deliberately.
    setStatus(`Could not save: ${(err as Error).message}`, "error");
  }
  refreshLibrary();
}

/**
 * Parse + validate playlist text; returns null after reporting the first
 * problem. The actual decision lives in checkSaveable() (ui/save-gate.ts,
 * pure and unit-tested) — this just adds the setStatus side effect every
 * caller here wants.
 */
function readPlaylistText(text: string): Playlist | null {
  const decision = checkSaveable(text);
  if (!decision.ok) {
    setStatus(decision.reason, "error");
    return null;
  }
  return decision.playlist;
}

function docTitleOf(playlist: Playlist, fallback: string): string {
  return playlist.meta.title ?? itemsOf(playlist)[0]?.spec.title ?? fallback;
}

/** The last rendered handle, so toggling developer mode can redraw the lint. */
let lastHandle: RenderHandle | null = null;

/**
 * Lint shows as a chip: nothing at all when the drawing is clean, a count
 * otherwise, expanding to the list on click. Non-developers only ever see
 * error-severity issues (a genuinely broken layout); warn-severity lint is
 * developer-only, since the author cannot act on it by editing YAML.
 * Developer mode also reports a clean result, since there the absence of
 * warnings is itself information.
 */
function setLint(hd: RenderHandle): void {
  lastHandle = hd;
  lintBox.replaceChildren();
  const m = lintChipModel(hd.layout.issues, [...hd.layout.warnings, ...hd.plan.warnings], settings.developerMode);
  lintChip.hidden = m.hidden;
  lintChip.className = m.className;
  lintChip.textContent = m.text;
  lintChip.title = m.title;
  if (m.hidden || m.items.length === 0) {
    lintBox.hidden = true;
    lintOpen = false;
    return;
  }
  const ul = h("ul", { class: "lint-list" });
  for (const i of m.items) ul.appendChild(h("li", i.className ? { class: i.className } : {}, i.text));
  lintBox.appendChild(ul);
  lintBox.hidden = !lintOpen;
}

function setLintFromSession(): void {
  if (lastHandle) setLint(lastHandle);
}

function clearLint(): void {
  lastHandle = null;
  lintChip.hidden = true;
  lintBox.hidden = true;
  lintBox.replaceChildren();
  lintOpen = false;
}

// ---------- mode switching ----------

function showMode(mode: "player" | "editor"): void {
  settings.uiMode = mode;
  persist();
  document.body.classList.toggle("mode-player", mode === "player");
  document.body.classList.toggle("mode-editor", mode === "editor");
  // Switching to Player is "go watch it" — catch the drawing up first.
  // ensureRendered() already re-presents into the (now-current) host when it
  // does; only fall back to a bare present() when there was nothing to catch
  // up on, so a text-unchanged mode switch does not mount twice.
  if (mode === "player" && ensureRendered()) return;
  void present();
}

// ---------- editor actions ----------

function requireKey(): string | null {
  const key = getApiKey();
  if (!key) {
    setStatus("Add your Anthropic API key in Settings to generate with AI. Everything else works without one.", "error");
    openSettings();
    return null;
  }
  return key;
}

/** Log one generation outcome; returns the log id. */
function logOutcome(prompt: string, outcome: Awaited<ReturnType<typeof generateSpec>>): string {
  const logId = crypto.randomUUID();
  const entry: LogEntry = {
    id: logId,
    ts: new Date().toISOString(),
    prompt,
    config: { model: settings.model, promptVariant: currentVariant().name, specVersion: SPEC_VERSION },
    rounds: outcome.rounds.map((r) => ({
      label: r.label,
      validationErrors: r.validationErrors,
      lintCount: r.lintIssues.length,
      ms: Math.round(r.meta.ms),
      structuredOutput: r.meta.structuredOutput,
    })),
    spec: outcome.spec,
    lintIssues: [],
    warnings: [],
    error: outcome.error,
  };
  appendLog(entry);
  refreshCounts();
  return logId;
}

/** Log one revision; returns the log id. Mirrors generateMulti's convention of naming the sub-request in `prompt`. */
function logRevision(instruction: string, outcome: ReviseOutcome): string {
  const logId = crypto.randomUUID();
  appendLog({
    id: logId,
    ts: new Date().toISOString(),
    prompt: `${doc.prompt || doc.title} ⟶ revise: ${instruction}`,
    config: { model: settings.model, promptVariant: currentVariant().name, specVersion: SPEC_VERSION },
    rounds: outcome.rounds.map((r) => ({
      label: r.label,
      validationErrors: r.errors,
      lintCount: r.lintIssues.length,
      ms: Math.round(r.ms),
      structuredOutput: false,
    })),
    spec: outcome.playlist ? (itemsOf(outcome.playlist)[0]?.spec ?? null) : null, // LogEntry.spec is Spec | null, not optional
    lintIssues: [],
    warnings: [],
    error: outcome.error,
  });
  refreshCounts();
  return logId;
}

/**
 * True while a Generate or Revise call is in flight. Both write a whole document
 * on resolve, so anything that swaps the document underneath them silently loses
 * work: Generate then Revise writes a revision of the OLD document into the newly
 * minted library row, and opening a library row / an example / a new drawcast mid
 * revise lets the resolving revise autosave over the entry just opened. One flag
 * closes all of it — the two buttons go down together, and the load paths refuse.
 */
let aiBusy = false;
/** Aborts whatever call is in flight. Null exactly when `aiBusy` is false. */
let aiAbort: AbortController | null = null;

function setAiBusy(busy: boolean, controller: AbortController | null = null): void {
  aiBusy = busy;
  aiAbort = busy ? controller : null;
  // The button deliberately stays ENABLED while busy — it IS the cancel
  // button. One button, one place: the thing that started the call stops it.
  generateBtn.classList.toggle("cancelling", busy);
  applyAuthorMode();
}

function cancelAi(): void {
  if (!aiAbort) return;
  aiAbort.abort();
  setStatus("Cancelling…");
}

// ---------- the live status line ----------
// A generation is 15–60 seconds of nothing without this: elapsed time proves
// the app is alive, the character count proves the model is writing, and the
// phase names the round so a repair does not read as a hang.

let aiTicker: number | null = null;
let aiStartedAt = 0;
let aiLabel = "";
let aiPhase = "";
let aiChars = 0;

function renderAiStatus(): void {
  const secs = Math.round((performance.now() - aiStartedAt) / 1000);
  const parts = [`${aiLabel}… ${secs}s`];
  if (aiChars > 0) parts.push(`${aiChars.toLocaleString()} characters`);
  if (aiPhase) parts.push(aiPhase);
  setStatus(parts.join(" · "));
}

function startAiStatus(label: string, phase = ""): void {
  aiLabel = label;
  aiPhase = phase;
  aiChars = 0;
  aiStartedAt = performance.now();
  renderAiStatus();
  aiTicker = window.setInterval(renderAiStatus, 1000);
}

function stopAiStatus(): void {
  if (aiTicker !== null) window.clearInterval(aiTicker);
  aiTicker = null;
}

/** How a round's label reads in the status line. Round 1 has nothing to add. */
function phaseText(label: string, round: number): string {
  if (label === "template-fetch") return "fetching a template";
  if (label === "pedagogy") return "teaching pass";
  if (label === "initial") return round > 1 ? `attempt ${round}` : "";
  return `repair ${round - 1}`;
}

// ---------- the spec pane during a call ----------
// The model's own text goes into the pane while it writes, so the wait has
// something to watch. The pane's previous contents are held so a cancel or a
// failure puts them back untouched.

let specBeforeStream: string | null = null;

function streamIntoSpec(text: string): void {
  if (specBeforeStream === null) {
    specBeforeStream = specArea.value;
    specArea.readOnly = true;
    specArea.classList.add("streaming");
  }
  specArea.value = text;
  specArea.scrollTop = specArea.scrollHeight;
}

/** `restore` puts the pre-call text back — for a cancel or a failure, not a success. */
function endSpecStream(restore: boolean): void {
  if (specBeforeStream !== null && restore) specArea.value = specBeforeStream;
  specBeforeStream = null;
  specArea.classList.remove("streaming");
  applyHistoryUi(); // owns readOnly (it is also the version-viewing lock)
}

/** Guard for the document-loading paths: true (and says so) when a call is in flight. */
function blockedByAi(what: string): boolean {
  if (!aiBusy) return false;
  setStatus(`An AI call is still running — wait for it to finish before ${what}.`, "error");
  return true;
}

async function generate(): Promise<void> {
  const rawRequest = promptEl.value.trim();
  if (!rawRequest) return;
  const parsed = parseTags(rawRequest);
  if (!parsed.clean) {
    setStatus("The request is only tags — add what to draw.", "error");
    return;
  }
  // #template=<id> (or the toolbar picker) forces a template — validate BEFORE
  // requireKey/any API work so a typo'd id never burns the repair budget (or
  // makes the user add a key just to hit a dead end).
  const forcedTemplate = parsed.template ?? (templateChoice || undefined);
  if (forcedTemplate && !isReadyTemplate(forcedTemplate)) {
    setStatus(`Unknown template "${forcedTemplate}" — see the Template picker for valid ids.`, "error");
    return;
  }
  const apiKey = requireKey();
  if (!apiKey) return;
  const brief = buildBrief(parsed.tags);
  // Computed once, before the playlist branch: an explicit selection (the
  // #template= tag or the toolbar picker) applies to every part of a
  // playlist too — spec §5a, explicit wins.
  const priorityIds = settings.priorityPacks.flatMap((p) => packTemplateIds(p));
  const controller = new AbortController();
  setAiBusy(true, controller);
  try {
    if (parsed.playlist) {
      await generateMulti(rawRequest, parsed, brief, apiKey, forcedTemplate, priorityIds, controller.signal);
      return;
    }
    startAiStatus("Generating");
    const outcome = await generateSpec(parsed.clean, {
      apiKey,
      pedagogyReview: true,
      model: settings.model,
      variant: currentVariant(),
      styleText: activeStyleText(),
      exemplars: usableExemplars(loadExemplars(), isReadyTemplate),
      bundledExemplars: bundledExemplarPool(),
      brief,
      forcedTemplate,
      priorityIds,
      signal: controller.signal,
      onProgress: ({ label, round, text }) => {
        aiChars = text.length;
        aiPhase = phaseText(label, round);
        streamIntoSpec(text);
        renderAiStatus();
      },
    });
    stopAiStatus();
    const logId = logOutcome(rawRequest, outcome);
    if (!outcome.spec) {
      endSpecStream(true);
      // You asked for it — a cancel is not a failure, so it is not red.
      setStatus(outcome.error ?? "Generation failed.", controller.signal.aborted ? "info" : "error");
      return;
    }
    endSpecStream(false); // setDoc below writes the formatted spec over it
    if (parsed.level && !outcome.spec.level) outcome.spec.level = parsed.level;
    if (parsed.voiceGender && !outcome.spec.voice) outcome.spec.voice = parsed.voiceGender;
    const playlist = singlePlaylist(outcome.spec);
    // The founding request travels IN the document from here on (B9), so a
    // Drive/disk/GitHub round trip — and the published copy — keeps it. The
    // cost is visible and accepted (§F.3.3): a generated single figure now
    // opens with a two-line `playlist:` header above its spec.
    playlist.meta.prompt = rawRequest;
    setDoc(
      { id: null, driveFileId: null, sourcePath: null, title: outcome.spec.title ?? parsed.clean, prompt: rawRequest, playlist },
      outcome.error ? `Partial: ${outcome.error}` : `Generated in ${outcome.rounds.length} round${outcome.rounds.length === 1 ? "" : "s"}.`,
      { label: rawRequest, kind: "generate" },
    );
    autosave();
    lastLogId = logId; // after setDoc, so the rating stars target this generation
  } finally {
    // Unconditional, in this order: an early return above (or a throw) must not
    // leave the ticker running, the pane locked, or the button saying Cancel.
    stopAiStatus();
    endSpecStream(true);
    setAiBusy(false);
  }
}

async function revise(): Promise<void> {
  const instruction = promptEl.value.trim();
  if (!instruction) {
    setStatus("Describe the change you want, then press Revise.", "error");
    return;
  }
  const apiKey = requireKey();
  if (!apiKey) return;
  // The TEXTAREA is the source, not `doc` — hand-edits you have not re-rendered
  // still ride along into the revision, so the label must not pretend otherwise.
  const docText = specArea.value;
  const dirty = docText !== currentVersion(stack)?.text;
  const label = dirty ? `${instruction} (+ manual edits)` : instruction;

  const controller = new AbortController();
  setAiBusy(true, controller);
  try {
    startAiStatus("Revising");
    const outcome = await reviseDocument(docText, instruction, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      styleText: activeStyleText(),
      priorityIds: settings.priorityPacks.flatMap((p) => packTemplateIds(p)),
      signal: controller.signal,
      onProgress: ({ label, round, text }) => {
        aiChars = text.length;
        aiPhase = phaseText(label === "repair" ? "lint-repair" : label, round);
        streamIntoSpec(text);
        renderAiStatus();
      },
    });
    stopAiStatus();
    const logId = logRevision(instruction, outcome);
    if (!outcome.playlist) {
      endSpecStream(true);
      setStatus(outcome.error ?? "Revision failed.", controller.signal.aborted ? "info" : "error");
      return;
    }
    endSpecStream(false);
    // doc.prompt is deliberately NOT replaced: it stays the original request, so
    // exemplars, the log and "👍 Learn from this" keep pairing original request -> current spec.
    setDoc(
      // Same document, edited in place by AI (same as a manual re-render) — carry
      // driveFileId forward too, or a Save right after a Revise would litter
      // Drive with a second copy of the file the earlier Save already created.
      { id: doc.id, driveFileId: doc.driveFileId, publishedAs: doc.publishedAs, drivePublishedId: doc.drivePublishedId, drivePublishedName: doc.drivePublishedName, sourcePath: doc.sourcePath, title: docTitleOf(outcome.playlist, doc.title), prompt: doc.prompt, playlist: outcome.playlist },
      `Revised: ${instruction}`,
      { label, kind: "revise" },
    );
    lastLogId = logId; // after setDoc, so the rating stars target this revision
    autosave();
    promptEl.value = ""; // consumed — and an empty box makes Generate inert
    refreshChips();
  } finally {
    stopAiStatus();
    endSpecStream(true);
    setAiBusy(false);
  }
}

reviewBtn.addEventListener("click", () => {
  if (review) {
    review.destroy();
    review = null;
    reviewBtn.classList.remove("active");
    return;
  }
  review = attachReview(previewHost, {
    applyLabel: "Send to Revise",
    onApply: (instruction) => {
      // Into the prompt box the Revise button already reads, rather than
      // revising directly: the notes are a draft you can still edit, and
      // Revise is where the user already knows changes come from.
      promptEl.value = instruction;
      promptEl.focus();
      review?.destroy();
      review = null;
      reviewBtn.classList.remove("active");
      setStatus("Notes collected — check the text and press Revise with AI.", "ok");
    },
  });
  reviewBtn.classList.add("active");
});

/** #playlist / #parts=N: one outline call, then one ordinary generation per part. */
async function generateMulti(
  rawRequest: string,
  parsed: ParsedTags,
  brief: string,
  apiKey: string,
  forcedTemplate: string | undefined,
  priorityIds: string[],
  signal: AbortSignal,
): Promise<void> {
  // No spec streaming here: the parts generate in parallel, and N models
  // writing into one pane would interleave into nonsense. The counter below
  // is this path's progress signal.
  startAiStatus("Outlining a multi-part drawcast");
  let partTitles: string[] = [];
  const result = await generateParts(
    { request: parsed.clean, parts: parsed.parts, brief },
    {
      apiKey,
      pedagogyReview: true,
      model: settings.model,
      variant: currentVariant(),
      styleText: activeStyleText(),
      exemplars: usableExemplars(loadExemplars(), isReadyTemplate),
      bundledExemplars: bundledExemplarPool(),
      forcedTemplate,
      priorityIds,
      signal,
    },
    {
      onOutline: (outline) => {
        partTitles = outline.parts.map((p) => p.title);
        aiLabel = `Generating ${outline.parts.length} parts in parallel`;
        aiPhase = `0/${outline.parts.length} done`;
        renderAiStatus();
      },
      onPart: (done, total, index, outcome) => {
        aiPhase = `${done}/${total} done`;
        renderAiStatus();
        logOutcome(`${rawRequest} [part ${index + 1}: ${partTitles[index] ?? index + 1}]`, outcome);
      },
    },
  );
  if (result.specs.length === 0) {
    if (signal.aborted) setStatus("Cancelled.");
    else setStatus(`Every part failed: ${result.error}`, "error");
    return;
  }
  for (const spec of result.specs) spec.voice ??= parsed.voiceGender ?? undefined;
  for (const spec of result.specs) spec.level ??= parsed.level ?? undefined;
  const title = result.outline?.title ?? parsed.clean;
  const n = result.outline?.parts.length ?? result.specs.length;
  const playlist: Playlist = {
    meta: { ...DEFAULT_META, title },
    entries: result.specs.map((spec) => ({ kind: "item" as const, spec })),
    warnings: [],
  };
  // Same as generate(): the founding request goes in the file (B9). Written as
  // its own statement rather than inline above so both generation paths carry
  // the one expression a drift test can pin.
  playlist.meta.prompt = rawRequest;
  setDoc(
    { id: null, driveFileId: null, sourcePath: null, title, prompt: rawRequest, playlist },
    result.failed.length > 0
      ? `Generated ${result.specs.length}/${n} parts (part${result.failed.length > 1 ? "s" : ""} ${result.failed.join(", ")} failed).`
      : `Generated a ${result.specs.length}-part drawcast.`,
    { label: rawRequest, kind: "generate" },
  );
  autosave();
}

// TRULY empty (Hans 2026-09-02): a blank page, not a starter example — the
// schema admits it as the one valid nothing (spec/schema.ts). Examples are
// one click away in the sidebar; the blank page should not pre-write one.
const BLANK_SPEC: Spec = { elements: [], commands: [] };

/** The blank text ＋ New puts in the editor — authoringMode's "empty document". */
let blankTextCache: string | null = null;
function blankDocText(): string {
  return (blankTextCache ??= formatPlaylist(singlePlaylist(JSON.parse(JSON.stringify(BLANK_SPEC)) as Spec), "yaml"));
}

/** One button, one truth (B7): label, tooltip and placeholder all derive from
 *  the same mode read. Called on every keystroke, every history/document
 *  change (applyHistoryUi) and every busy transition (setAiBusy). */
function applyAuthorMode(): void {
  const mode = authoringMode(specArea.value, blankDocText());
  const viewing = !atNewest(stack);
  generateBtn.textContent = authorButtonLabel(mode, { busy: aiBusy, viewing });
  promptEl.placeholder = promptPlaceholder(mode);
  generateBtn.title = aiBusy
    ? "Stop this AI call (Esc)"
    : mode === "generate" && !viewing
      ? "Create a drawcast from the description above"
      : "Change the current drawcast with AI";
}
specArea.addEventListener("input", applyAuthorMode);

generateBtn.addEventListener("click", () => {
  if (aiBusy) return cancelAi();
  // Viewing an old version is always a revise — branching from history.
  if (!atNewest(stack) || authoringMode(specArea.value, blankDocText()) === "revise") return void revise();
  void generate();
});

// Esc cancels too — but only when nothing modal is open, where Esc already
// means "close this dialog" (the browser fires it there first).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !aiBusy) return;
  if (document.querySelector("dialog[open]")) return;
  cancelAi();
});
// A new drawcast is a clean slate on both sides: the request box empties too
// (setDoc keeps the old text when the incoming doc has no prompt of its own).
blankBtn.addEventListener("click", () => {
  if (blockedByAi("starting a new drawcast")) return;
  promptEl.value = "";
  refreshChips();
  clearLint();
  setDoc(
    { id: null, driveFileId: null, sourcePath: null, title: "Untitled drawcast", prompt: "", playlist: singlePlaylist(JSON.parse(JSON.stringify(BLANK_SPEC)) as Spec) },
    "New drawcast — describe one above, or edit the spec below.",
  );
  if (window.innerWidth < 940 && settings.sidebarOpen) {
    settings.sidebarOpen = false; // the overlay would cover what you just cleared
    persist();
    applySidebar();
  }
  promptEl.focus();
});

async function loadBundledExample(index: number): Promise<void> {
  if (blockedByAi("opening an example")) return;
  const ex = examples[index] ?? examples[0];
  // Pack-based examples enable their packs exactly like the panel toggle
  // would, so the catalog, picker and panel stay consistent afterwards.
  if (ex.packs && ex.packs.length > 0) {
    const results = await ensureEnabledPacks(ex.packs);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      setStatus(`This example needs the ${failed.map((f) => f.id).join(", ")} pack — loading it failed: ${failed.flatMap((f) => f.errors).join("; ")}`, "error");
      return;
    }
    let changed = false;
    for (const id of ex.packs) {
      if (!settings.enabledPacks.includes(id)) {
        settings.enabledPacks = [...settings.enabledPacks, id];
        changed = true;
      }
    }
    if (changed) {
      persist();
      refreshTemplatePicker();
      refreshTemplatePacksPanel();
    }
  }
  if (ex.playlist) {
    try {
      const playlist = parsePlaylistText(ex.playlist);
      // Untouched bundled example: not yours until you change it (copy-on-write).
      setDoc({ id: null, driveFileId: null, sourcePath: null, title: docTitleOf(playlist, ex.title ?? ex.request), prompt: ex.request, playlist }, "Example loaded.");
    } catch (err) {
      setStatus(`Example failed to parse: ${(err as Error).message}`, "error");
    }
    return;
  }
  if (ex.spec) setDoc({ id: null, driveFileId: null, sourcePath: null, title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) }, "Example loaded.");
}

// The last text a render actually reflected. null until the first present() —
// needsRender() treats that as "behind" unconditionally, so a fresh boot
// never confuses "nothing rendered yet" with "nothing changed".
let lastRenderedText: string | null = null;

/** Un-hides the preview bar's dot exactly when the drawing has fallen behind
 *  the text — recomputed on every keystroke and everywhere lastRenderedText
 *  itself changes (through markRendered, its only writer). */
function refreshEditedDot(): void {
  editedDot.hidden = !needsRender(specArea.value, lastRenderedText);
}
specArea.addEventListener("input", refreshEditedDot);

/** The one place lastRenderedText is written, so the dot can never drift out
 *  of sync with it by a call site forgetting to refresh it. */
function markRendered(text: string): void {
  lastRenderedText = text;
  refreshEditedDot();
}

/**
 * Bring the drawing up to date with the text, if it is behind — the old
 * ↻ Re-render handler, now driven by needsRender() instead of a click.
 * Returns whether it re-rendered: callers reachable from a Play button use
 * that to decide whether the fresh session (which autostarts on its own via
 * `andPlay`) has already taken care of playback, or whether today's already-
 * current session still needs to be told to play (see beforePlay in present()).
 *
 * Silent by design: this now fires from Play, Share, Save and mode-switch as
 * well as an explicit edit, so an "ok" status line here would routinely cover
 * up something more relevant. The edited dot is the drawing's visible signal.
 *
 * canRender() restores what a disabled ↻ button used to prevent for free:
 * while viewing an old version (the pane is read-only, but Insert's two items
 * still write to specArea.value directly) or while an AI call is
 * streaming its own partial text into the same textarea, this must not push
 * a manual edit or autosave — doing either would silently jump the cursor to
 * newest, or commit the model's half-formed draft as the author's.
 */
function ensureRendered(andPlay = false): boolean {
  // Keeps the dot honest even on every early return below — including a
  // playlist that fails to parse, which otherwise leaves it stale.
  refreshEditedDot();
  if (!canRender(!atNewest(stack), aiBusy)) return false;
  if (!needsRender(specArea.value, lastRenderedText)) return false;
  const playlist = readPlaylistText(specArea.value);
  if (!playlist) return false;
  // Same document, edited in place — carry the id forward so autosave() below
  // replaces this entry instead of minting a second one (copy-on-write). The
  // prompt follows setDoc's rule: what the TEXT says wins (a hand-edited
  // header is an edit like any other), with doc.prompt as the fallback.
  doc = { id: doc.id, driveFileId: doc.driveFileId, publishedAs: doc.publishedAs, publishedComments: doc.publishedComments, drivePublishedId: doc.drivePublishedId, drivePublishedName: doc.drivePublishedName, sourcePath: doc.sourcePath, title: docTitleOf(playlist, doc.title), prompt: playlist.meta.prompt ?? doc.prompt, playlist };
  if (!restoring) stack = pushManualEdit(stack, specArea.value, new Date().toISOString());
  applyHistoryUi();
  void present(andPlay);
  autosave();
  markRendered(specArea.value);
  return true;
}

/**
 * The shared refusal path for every Save destination (disk / Drive /
 * GitHub — see openSaveToDisk/saveDiskBtn, saveToDrive, saveSourceToGithub
 * below). "What you see is what you save": the decision is re-derived
 * straight from specArea.value via checkSaveable() — never from doc.playlist,
 * which is only ever last render's GOOD text and goes stale the moment the
 * editor holds something that fails to parse. ensureRendered() is still
 * called first for its side effects (catches the preview/history/autosave up
 * when the text DOES parse) but its return value is intentionally ignored:
 * ensureRendered() also returns false when there is simply nothing new to
 * render, which must NOT block a save. On refusal this sets the red status
 * itself and returns null — callers must not follow up with a "Saving…"
 * status of their own, or it silently overwrites the reason the save didn't
 * happen (the exact bug this replaces).
 */
function prepareSave(andPlay = false): { text: string; playlist: Playlist; title: string } | null {
  ensureRendered(andPlay);
  const text = specArea.value;
  const decision = checkSaveable(text);
  if (!decision.ok) {
    setStatus(decision.reason, "error");
    return null;
  }
  return { text, playlist: decision.playlist, title: docTitleOf(decision.playlist, doc.title) };
}

promoteBtn.addEventListener("click", () => {
  addExemplar({ prompt: doc.prompt || doc.title, spec: firstSpec(doc), ts: new Date().toISOString() });
  promoteBtn.textContent = "✓ Learning from this";
  promoted = true; // so stepping away and back does not re-arm it
  promoteBtn.disabled = true;
  refreshCounts();
  refreshReferences();
  setStatus("Added to your references — the AI will follow this drawing's style from now on. Manage them under Instructions.", "ok");
});

// ---------- account ----------

function refreshAccountRow(): void {
  if (!accountRow) return;
  // No email is shown: reading one needs an `openid`/`email` scope this app
  // never asks for. What the row must guarantee is that a live grant always
  // offers sign-out.
  accountRow.textContent = signedIn() ? "Signed in — sign out" : "Sign in with Google";
  accountRow.hidden = !googleConfigured();
}

async function toggleAccount(): Promise<void> {
  if (signedIn()) {
    signOut();
    setStatus("Signed out of Google.", "ok");
  } else {
    const token = await requireScope(DRIVE_SCOPE);
    setStatus(token ? "Signed in to Google." : "Google sign-in was cancelled.", token ? "ok" : "error");
  }
  refreshAccountRow();
}

// ---------- library ----------

function sidebarInput(): SectionInput {
  const library = loadLibrary();
  return {
    library: library.map((d) => ({ title: d.title, courseId: d.courseId })),
    courses: loadCourses().map((c) => {
      const ids = new Set(referencedLectureIds(c.text));
      return { id: c.id, title: c.title, lectures: library.filter((i) => ids.has(i.id)).map((i) => i.title) };
    }),
    examples: examples.map((ex) => ({ title: ex.title ?? ex.spec?.title ?? ex.request })),
    templates: loadMyTemplates().map((t) => ({ id: t.id })),
  };
}

/** Recomputes all four sections' header text and open state — cheap, and
 *  called after anything that could change what they list or count. */
function refreshSidebarShell(): void {
  const sections: Record<string, SidebarSection> = { library: librarySection, courses: coursesSection, examples: examplesSection, templates: templatesSection };
  for (const model of sidebarSections(sidebarInput(), sidebarFilter, settings.sidebarSections)) {
    applySection(sections[model.id], model);
  }
}

function row(item: SavedDrawing): HTMLElement {
  // NOT `item.playlist` truthiness: since B9 a single generated figure stores
  // playlist text too (its header carries the founding prompt), and marking
  // that ▤ "playlist" would make the marker a lie on most rows in the library.
  const multi = isMultiPart(item);
  const label = multi ? `${item.title} ▤` : item.title;
  const openBtn = h("button", { class: "library-open", title: multi ? "Load this playlist" : "Load this drawing" }, label);
  openBtn.addEventListener("click", () => {
    if (blockedByAi("opening another drawcast")) return;
    setDoc(docFromSaved(item), "Loaded from library.");
  });
  const delBtn = h("button", { class: "library-del", title: "Delete from library" }, "✕");
  delBtn.addEventListener("click", () => {
    deleteDrawing(item.id);
    refreshLibrary();
  });
  return h("div", { class: "library-item" }, openBtn, delBtn);
}

/** Loose drawcasts only — a lecture belongs to its course (the Courses
 *  section below), not here. */
function refreshLibrary(): void {
  libraryList.replaceChildren();
  // Loose = not referenced by any course DOCUMENT. A row tagged with a
  // courseId but no longer referenced (an old version after a plan revision,
  // or its course deleted) belongs here — under the old `!i.courseId` filter
  // it was reachable only through the course group that now rightly excludes
  // it, i.e. invisible. Newest first: saveDrawing unshifts.
  const referenced = new Set(loadCourses().flatMap((c) => referencedLectureIds(c.text)));
  const loose = loadLibrary().filter((i) => !referenced.has(i.id));
  const items = loose.filter((i) => matchesFilter(i.title));
  if (items.length === 0) {
    libraryList.appendChild(h("div", { class: "hint" }, loose.length === 0 ? "Nothing saved yet." : "No match."));
  } else {
    for (const item of items) libraryList.appendChild(row(item));
  }
  refreshCourses();
  refreshSidebarShell();
}

/** One row per saved course, opening the same panel `openCourse` does, with
 *  that course's lectures inline behind its own caret (ui/sidebar.ts's
 *  courseGroup — the exact per-course <details> grouping this function used
 *  to build for the library, moved out and now driven by every saved course
 *  rather than only the ones with a lecture already in view).
 *
 *  A course is a match on its own title OR any lecture's (sidebarSections
 *  pins this) — searching for a lecture by name must surface the course
 *  that has it, not make it vanish. While filtering, a course that matched
 *  only through a lecture renders just its matching lectures (the old
 *  per-item library filter's behaviour, preserved); a course whose own
 *  title matched shows every lecture, since the whole course is the hit —
 *  and with no filter active `matchesFilter` is true for everything, so
 *  every course shows all of its lectures as before. */
function refreshCourses(): void {
  coursesSection.list.replaceChildren();
  const all = loadCourses();
  const library = loadLibrary();
  // The DOCUMENT's lectures, in its order — never "every row ever tagged
  // with this courseId", which counts orphaned old versions too (33 vs 20).
  // Orphans surface in the loose Library list below instead of vanishing.
  const withLectures = all.map((course) => ({
    course,
    lectures: referencedLectureIds(course.text)
      .map((id) => library.find((d) => d.id === id))
      .filter((d): d is SavedDrawing => d !== undefined),
  }));
  const shown = withLectures.filter(({ course, lectures }) => matchesFilter(course.title) || lectures.some((l) => matchesFilter(l.title)));
  if (shown.length === 0) {
    coursesSection.list.appendChild(h("div", { class: "hint" }, all.length === 0 ? "No courses yet." : "No match."));
    return;
  }
  for (const { course, lectures } of shown) {
    const visible = matchesFilter(course.title) ? lectures : lectures.filter((l) => matchesFilter(l.title));
    coursesSection.list.appendChild(courseGroup(course, visible, row, (id) => openCourse(id)));
  }
}

/** Opens the course panel — the "＋ New course" row and every course row in
 *  the Courses section share this one call site; the panel itself offers the
 *  saved-course picker and ＋ New once open. `id` names the course a
 *  sidebar row was clicked for, so the panel loads THAT course rather than
 *  whichever one it last happened to have open — omitted by "＋ New course",
 *  which leaves the panel wherever it already was. */
function openCourse(id?: string): void {
  openCoursePanel({
    apiKey: () => getApiKey(),
    model: () => settings.model,
    variant: () => currentVariant(),
    styleText: () => activeStyleText(),
    exemplars: () => usableExemplars(loadExemplars(), isReadyTemplate),
    bundledExemplars: () => bundledExemplarPool(),
    setStatus,
    openDrawing: (id) => {
      const saved = loadLibrary().find((d) => d.id === id);
      if (saved) setDoc(docFromSaved(saved), `Loaded "${saved.title}".`);
    },
    refreshLibrary: () => refreshLibrary(),
    settings,
    persist,
    setStatusAction,
    refreshAccountRow,
    openSettings,
    renderVideo,
    beginExport,
    setProgress: (text) => (exportChipText.textContent = text),
    endExport,
    setAbort: (c) => (exportAbort = c),
  }, id);
}

refreshLibrary();
refreshAccountRow();

// ---------- my templates ----------

myTplImportBtn.addEventListener("click", () => myTplImportInput.click());
myTplImportInput.addEventListener("change", () => {
  const file = myTplImportInput.files?.[0];
  if (!file) return;
  void file.text().then((yaml) => {
    // Same plain-risk confirm() gate a custom-URL pack load gets (final
    // review, important #4) — confirmTemplateImport is defined further down
    // (hoisted function declaration, so this early reference is safe, same
    // pattern as openAuthorDialog/setStatus elsewhere in this file).
    if (!confirmTemplateImport(file.name)) return;
    const r = registerUserTemplateYaml(yaml);
    if (!r.ok) {
      setStatus(`Template import failed: ${r.errors.join("; ")}`, "error");
      return;
    }
    const replaced = loadMyTemplates().some((t) => t.id === r.id);
    saveMyTemplate({ id: r.id!, yaml, ts: new Date().toISOString() });
    refreshMyTemplates();
    refreshTemplatePicker();
    setStatus(replaced ? `Imported template "${r.id}" (replaced existing).` : `Imported template "${r.id}".`, "ok");
  });
  myTplImportInput.value = "";
});

function refreshMyTemplates(): void {
  myTemplatesList.replaceChildren();
  const all = loadMyTemplates();
  if (all.length === 0) {
    myTemplatesList.appendChild(h("div", { class: "hint" }, "No templates yet — create one with ✦ New template."));
  } else {
    for (const t of all) {
      const improveBtn = h("button", { class: "small" }, "Improve");
      improveBtn.addEventListener("click", () => openAuthorDialog({ id: t.id }));
      const exportBtn2 = h("button", { class: "small", title: "Download this template's YAML" }, "Export");
      exportBtn2.addEventListener("click", () => downloadBlob(`${t.id}.yaml`, new Blob([t.yaml], { type: "text/yaml" })));
      const delBtn2 = h("button", { class: "small" }, "Delete");
      delBtn2.addEventListener("click", () => {
        deleteMyTemplate(t.id);
        unregisterUserTemplate(t.id);
        refreshMyTemplates();
        refreshTemplatePicker();
      });
      myTemplatesList.appendChild(h("div", { class: "library-item" }, h("span", { class: "library-title" }, t.id), improveBtn, exportBtn2, delBtn2));
    }
  }
  refreshTemplatesSection();
}
refreshMyTemplates();

/** The Templates section (sidebar): the author's own templates, opened the
 *  same way "Improve" in the modal does. Full management (export, delete)
 *  stays behind Manage… — the modal above, unchanged. */
function refreshTemplatesSection(): void {
  templatesSection.list.replaceChildren();
  const all = loadMyTemplates();
  const shown = all.filter((t) => matchesFilter(t.id));
  if (shown.length === 0) {
    templatesSection.list.appendChild(h("div", { class: "hint" }, all.length === 0 ? "No templates yet." : "No match."));
  } else {
    for (const t of shown) {
      const b = h("button", { class: "library-open" }, t.id);
      b.addEventListener("click", () => openAuthorDialog({ id: t.id }));
      templatesSection.list.appendChild(h("div", { class: "library-item" }, b));
    }
  }
  refreshSidebarShell();
}

// ---------- template packs (M3) ----------

/**
 * One row per PACK_DEFS entry. The checkbox always mirrors settings.enabledPacks
 * (not registration) — interactively enabling loads + registers the pack
 * (async), and a load/compile failure there reverts the checkbox rather than
 * persisting a pack that isn't actually usable (a user-initiated action they're
 * watching, so "just try again" is enough). Startup is different (spec §8: a
 * pack fetch failure must leave the enabled set unchanged) — a pack can end up
 * enabled-in-settings but not registered after a transient load failure there,
 * so this row also shows a retry hint whenever that mismatch holds.
 */
function refreshTemplatePacksPanel(): void {
  templatePacksList.replaceChildren();
  const defs = Object.values(PACK_DEFS).sort((a, b) => a.title.localeCompare(b.title));
  if (defs.length === 0) {
    templatePacksList.appendChild(h("div", { class: "hint" }, "No template packs available."));
    return;
  }
  for (const def of defs) {
    const enabledCb = h("input", { type: "checkbox" }) as HTMLInputElement;
    enabledCb.checked = settings.enabledPacks.includes(def.id);
    const defaultCb = h("input", { type: "checkbox" }) as HTMLInputElement;
    defaultCb.checked = settings.priorityPacks.includes(def.id);
    defaultCb.disabled = !enabledCb.checked;
    // Enabled in settings but not (yet) registered — a startup load failure
    // left it that way (spec §8). Toggling off/on retries the load.
    const notRegistered = enabledCb.checked && packTemplateIds(def.id).length === 0;

    enabledCb.addEventListener("change", () => {
      if (enabledCb.checked) {
        enabledCb.disabled = true;
        void ensureEnabledPacks([def.id]).then((rs) => {
          enabledCb.disabled = false;
          const r = rs[0];
          if (!r?.ok) {
            enabledCb.checked = false; // revert — don't persist a pack that failed to load
            setStatus(`Pack "${def.id}" failed to load: ${r?.errors.join("; ") ?? "unknown error"}`, "error");
            return;
          }
          // Reassign rather than mutate in place: on a first-ever run (nothing in
          // localStorage yet) loadSettings() returns the literal DEFAULT_SETTINGS
          // object, and its array fields must never be pushed into.
          if (!settings.enabledPacks.includes(def.id)) settings.enabledPacks = [...settings.enabledPacks, def.id];
          persist();
          defaultCb.disabled = false;
          refreshTemplatePicker();
          const n = packTemplateIds(def.id).length;
          setStatus(`Pack "${def.id}" enabled (${n} template${n === 1 ? "" : "s"}).`, "ok");
        });
      } else {
        unregisterPack(def.id);
        settings.enabledPacks = settings.enabledPacks.filter((id) => id !== def.id);
        settings.priorityPacks = settings.priorityPacks.filter((id) => id !== def.id); // a disabled pack can't be a default domain
        persist();
        defaultCb.checked = false;
        defaultCb.disabled = true;
        refreshTemplatePicker();
      }
    });

    defaultCb.addEventListener("change", () => {
      if (defaultCb.checked) {
        if (!settings.priorityPacks.includes(def.id)) settings.priorityPacks = [...settings.priorityPacks, def.id];
      } else {
        settings.priorityPacks = settings.priorityPacks.filter((id) => id !== def.id);
      }
      persist();
    });

    templatePacksList.appendChild(
      h(
        "div",
        { class: "pack-row" },
        h(
          "div",
          { class: "library-item" },
          h("span", { class: "library-title" }, def.title),
          h("label", { class: "pack-check" }, enabledCb, "Enabled"),
          h("label", { class: "pack-check" }, defaultCb, "Default domain"),
          ...(notRegistered ? [h("span", { class: "hint pack-fail-hint" }, "(failed to load — toggle to retry)")] : []),
        ),
        h("div", { class: "hint" }, def.description),
      ),
    );
  }
}
refreshTemplatePacksPanel();

// ---------- remote packs (M5) ----------
//
// Reuses M3's pack machinery end to end: fetchRemotePackYaml gets the bytes,
// registerRemotePackYaml is the SAME parsePack→registerPack path bundled and
// My-templates packs use — never a parallel path — so id collisions and
// all-or-nothing-per-pack rollback come free. This section only handles
// fetching, the localStorage cache (store.ts's RemotePackEntry trio), and
// the trust-tier confirm() gate.
//
// Trust is derived from the URL itself (isOfficialPackUrl — the ref-pinned
// raw.githubusercontent.com/hmelberg/drawcast-templates/main/ prefix), never from
// "this URL happened to be listed in the index". An index entry is just a
// pointer the app fetched from an unauthenticated host; if it doesn't
// actually point under the official prefix, Add routes through the exact
// same confirm() gate a pasted custom URL gets — it is de-privileged, not
// refused outright.

/**
 * The one-sentence risk text (final review, minor #6: names the concrete
 * risk instead of a generic "runs JavaScript" warning) — used verbatim by
 * BOTH gates below (the custom-URL Load button, and Add on a non-official
 * index entry). confirmTemplateImport below is the same gate adapted for a
 * local file instead of a URL (final review, important #4).
 */
function confirmRemotePackLoad(url: string): boolean {
  return confirm(
    `This pack's templates run as JavaScript in your browser and can read any data this page can access, including your stored API key — load "${url}" only if you trust the source.`,
  );
}

/**
 * Same plain-risk gate as confirmRemotePackLoad, for the My-templates file
 * import (final review, important #4 — the spec pre-committed to this:
 * "imports need an explicit confirmation"). A locally-picked file is not
 * inherently more trustworthy than a pasted URL: its `layout` body is the
 * same JS-in-the-browser risk either way, so it gets the same gate, naming
 * the file instead of a URL.
 */
function confirmTemplateImport(fileName: string): boolean {
  return confirm(
    `This template runs as JavaScript in your browser and can read any data this page can access, including your stored API key — import "${fileName}" only if you trust the source.`,
  );
}

/** Fetch → registerRemotePackYaml → cache → refresh, shared by every entry
 * point (official Add, de-privileged Add, custom-URL Load) — they differ
 * only in whether/how they gate on confirm() before calling this. */
async function loadAndRegisterRemotePack(url: string): Promise<void> {
  let yaml: string;
  try {
    yaml = await fetchRemotePackYaml(url);
  } catch (err) {
    setStatus(`Pack fetch failed: ${(err as Error).message}`, "error");
    // The panel/picker can't have gone stale here (nothing was touched before
    // the fetch failed) but refreshing anyway keeps every failure branch
    // uniform — review fix round 2.
    refreshTemplatePicker();
    refreshRemotePacksPanel();
    return;
  }
  const r = registerRemotePackYaml(url, yaml);
  if (!r.ok) {
    if (r.unloaded) {
      // A same-url replace attempt (re-Load/re-Add) whose self-restore also
      // failed: the pack is now genuinely unregistered even though this
      // entry's cache still says enabled. Never let the cache lie about
      // that — flip it off and persist (review fix round 2).
      const cached = loadRemotePacks().find((e) => e.url === url);
      if (cached) saveRemotePack({ ...cached, enabled: false });
    }
    setStatus(`Pack failed to load: ${r.errors.join("; ")}`, "error");
    refreshTemplatePicker();
    refreshRemotePacksPanel();
    return;
  }
  saveRemotePack({ url, id: r.id!, yaml, ts: new Date().toISOString(), enabled: true });
  refreshTemplatePicker();
  refreshRemotePacksPanel();
  setStatus(`Pack "${r.id}" added from ${url}.`, "ok");
}

browseOfficialBtn.addEventListener("click", () => {
  browseOfficialBtn.disabled = true;
  void fetchOfficialIndex()
    .then((entries) => renderOfficialPacksList(entries))
    .catch((err) => setStatus(`Official pack index failed to load: ${(err as Error).message}`, "error"))
    .finally(() => {
      browseOfficialBtn.disabled = false;
    });
});

function renderOfficialPacksList(entries: RemoteIndexEntry[]): void {
  officialPacksList.replaceChildren();
  if (entries.length === 0) {
    officialPacksList.appendChild(h("div", { class: "hint" }, "No official packs listed."));
    return;
  }
  for (const entry of entries) {
    const addBtn = h("button", { class: "small" }, "Add");
    addBtn.addEventListener("click", () => {
      // Trust comes from the URL, not from being listed here (review fix
      // round 1): an entry whose url isn't actually under the official
      // prefix is de-privileged to the SAME confirm() gate Load uses below.
      if (!isOfficialPackUrl(entry.url) && !confirmRemotePackLoad(entry.url)) return;
      addBtn.disabled = true;
      void loadAndRegisterRemotePack(entry.url).finally(() => {
        addBtn.disabled = false;
      });
    });
    officialPacksList.appendChild(
      h("div", { class: "library-item" }, h("span", { class: "library-title" }, entry.title), addBtn),
    );
    officialPacksList.appendChild(h("div", { class: "hint" }, entry.description));
  }
}

loadUrlBtn.addEventListener("click", () => {
  const url = remoteUrlInput.value.trim();
  if (!url) return;
  // Custom URL = untrusted tier: a pack's templates are JS that runs in this
  // browser when drawing — plain risk text, native confirm() (spec).
  if (!confirmRemotePackLoad(url)) return;
  loadUrlBtn.disabled = true;
  void loadAndRegisterRemotePack(url).finally(() => {
    loadUrlBtn.disabled = false;
  });
  remoteUrlInput.value = "";
});

/**
 * Loaded remote-pack rows. Enabled toggles register/unregister from the
 * CACHED yaml only (no fetch — the toggle is the same "flip it on/off"
 * action as the built-in packs panel above, not a refresh). Refresh
 * re-fetches; on a fetch OR registration failure the cache (and whatever was
 * live in the registry) is left exactly as it was, only setStatus reports
 * it — a failed refresh must never leave the user with a broken or missing
 * pack. Refresh on a currently-DISABLED entry updates the cached yaml/id
 * without touching the registry (it wasn't registered before Refresh either)
 * — Refresh must never silently re-enable a pack the user turned off.
 */
function refreshRemotePacksPanel(): void {
  remotePacksList.replaceChildren();
  const all = loadRemotePacks();
  if (all.length === 0) {
    remotePacksList.appendChild(h("div", { class: "hint" }, "No remote packs loaded yet."));
    return;
  }
  for (const entry of all) {
    const enabledCb = h("input", { type: "checkbox" }) as HTMLInputElement;
    enabledCb.checked = entry.enabled;
    enabledCb.addEventListener("change", () => {
      if (enabledCb.checked) {
        const r = registerRemotePackYaml(entry.url, entry.yaml);
        if (!r.ok) {
          enabledCb.checked = false; // revert — don't persist a pack that failed to register
          setStatus(`Pack "${entry.id}" failed to register: ${r.errors.join("; ")}`, "error");
          return;
        }
      } else {
        unregisterRemotePack(entry.url);
      }
      saveRemotePack({ ...entry, enabled: enabledCb.checked });
      refreshTemplatePicker();
    });

    const refreshBtn = h("button", { class: "small" }, "Refresh");
    refreshBtn.addEventListener("click", () => {
      refreshBtn.disabled = true;
      void fetchRemotePackYaml(entry.url)
        .then((yaml) => {
          if (entry.enabled) {
            unregisterRemotePack(entry.url); // drop the old cached version's ids first
            const r = registerRemotePackYaml(entry.url, yaml);
            if (!r.ok) {
              // Restore the previously-working version — but that restore
              // can ALSO fail (e.g. the old id now collides with something
              // else registered in the meantime). Never leave the cache
              // saying `enabled` while the registry has nothing registered
              // for this pack at all (review fix round 1).
              const restore = registerRemotePackYaml(entry.url, entry.yaml);
              if (!restore.ok) {
                saveRemotePack({ ...entry, enabled: false });
                refreshTemplatePicker(); // the pack's templates are gone from the registry entirely — drop them from the picker too
                refreshRemotePacksPanel();
                setStatus(`Pack "${entry.id}" could not be restored — re-add it.`, "error");
                return;
              }
              setStatus(`Refresh failed for "${entry.id}": ${r.errors.join("; ")} — keeping the previous version.`, "error");
              return;
            }
            saveRemotePack({ url: entry.url, id: r.id!, yaml, ts: new Date().toISOString(), enabled: true });
          } else {
            // Disabled: nothing is registered to touch — just validate the
            // fetched yaml and refresh the cache (still disabled).
            const { pack, errors } = parsePack(yaml);
            if (!pack) {
              setStatus(`Refresh failed for "${entry.id}": ${errors.join("; ")} — keeping the previous version.`, "error");
              return;
            }
            saveRemotePack({ url: entry.url, id: pack.id, yaml, ts: new Date().toISOString(), enabled: false });
          }
          refreshTemplatePicker();
          refreshRemotePacksPanel();
          setStatus(`Pack "${entry.id}" refreshed.`, "ok");
        })
        .catch((err) => setStatus(`Refresh failed for "${entry.id}": ${(err as Error).message} — keeping the cached version.`, "error"))
        .finally(() => {
          refreshBtn.disabled = false;
        });
    });

    const removeBtn = h("button", { class: "small" }, "Remove");
    removeBtn.addEventListener("click", () => {
      unregisterRemotePack(entry.url);
      deleteRemotePack(entry.url);
      refreshTemplatePicker();
      refreshRemotePacksPanel();
    });

    remotePacksList.appendChild(
      h(
        "div",
        { class: "pack-row" },
        h(
          "div",
          { class: "library-item" },
          h("span", { class: "library-title", title: entry.url }, `${entry.id} — ${entry.url}`),
          h("label", { class: "pack-check" }, enabledCb, "Enabled"),
          refreshBtn,
          removeBtn,
        ),
      ),
    );
  }
}
refreshRemotePacksPanel();

// Image insertion and embedding now live behind the 🖼 Images menu
// (ui/insert.ts): openInsertPortrait builds a real draw command at a chosen
// step, instead of this spot's old raw window.prompt() + implicit-tail-draw
// placement, and openEmbedDialog holds the click handler that used to be wired
// to a bare 📌 icon button right here.

importInput.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    importInput.value = "";
    // Same in-flight guard as the other document-loading paths: an upload that
    // lands mid-revise would be overwritten by the revise that resolves after it.
    if (blockedByAi("uploading a document")) return;
    // A saved-drawing JSON export ({title, spec, …}) still opens: unwrap it first.
    try {
      const maybe = JSON.parse(text) as Partial<SavedDrawing>;
      if (maybe && typeof maybe === "object" && maybe.spec) {
        const inner = maybe.playlist ?? JSON.stringify(maybe.spec);
        const playlist = readPlaylistText(inner);
        // An uploaded file is a shared document, not yours until you change it (copy-on-write).
        // sourcePath rides along IF the export already had one (round-trip of
        // your own backup/export); a file from anywhere else has none to lose.
        if (playlist) setDoc({ id: null, driveFileId: null, sourcePath: maybe.sourcePath ?? null, title: maybe.title ?? file.name, prompt: maybe.prompt, playlist }, "Uploaded.");
        return;
      }
    } catch {
      /* not a saved-drawing object — treat as spec/playlist text */
    }
    const playlist = readPlaylistText(text);
    if (!playlist) return;
    setDoc({ id: null, driveFileId: null, sourcePath: null, title: docTitleOf(playlist, file.name.replace(/\.(json|ya?ml|txt)$/i, "")), playlist }, "Uploaded.");
  });
});

// ---- Publishing one drawcast to the author's own public repo ---------------

/**
 * Embed the images and bake the narration, if asked for, and return the text to
 * publish. Reuses whatever the drawcast already published, so a second publish
 * pays only for lines that are new or changed.
 *
 * `source` — never `doc.playlist` past its first line — is what the rest of
 * this function must read: embedding resolves images into a CLONE (see
 * publish/embed.ts), so the published copy carries them and the document on
 * screen is left byte-for-byte as the author wrote it (P §3.4, §F.3).
 *
 * The embed COUNT (and, when there is anything to embed, what gets embedded)
 * reads `editorPlaylist` — the editor text, re-parsed — rather than
 * `doc.playlist`: render() resolves portraits/sources IN PLACE on the
 * document's own spec objects on every preview render (render/index.ts), so
 * by publish time `doc.playlist` may already carry strokes even though the
 * text on screen (and the Insert-menu Embed dialog, which parses that same
 * text) says otherwise. When there is nothing to embed, or embedding was not
 * asked for, publishing reads `doc.playlist` exactly as before.
 *
 * `previousText` is where the already-synthesized narration is read back
 * from, and it is per-DESTINATION: reuse only saves money if it reads the
 * copy this publish is about to overwrite. The default is the GitHub
 * published copy, which is what this function always did; the Drive publish
 * passes its own hook (spec §7). Any miss — no repo, never published, a
 * deleted file, a network failure — is null, and null just means paying for
 * every line again, never a failed publish.
 */
async function publishTextFor(
  signal: AbortSignal,
  bake: boolean,
  embedImages: boolean,
  allowComments?: boolean,
  previousText: () => Promise<string | null> = async () => {
    const repo = parseRepo(settings.githubRepo);
    if (!repo || !doc.publishedAs) return null;
    return readFile(repo, joinPath(joinPath(settings.coursesDir, "casts"), `${doc.publishedAs}.yaml`), (input, init) =>
      fetch(input, { ...init, signal }),
    ).catch(() => null);
  },
): Promise<string> {
  const editorPlaylist = embedImages ? (readPlaylistText(specArea.value) ?? doc.playlist) : null;
  const before = editorPlaylist ? unembeddedImages(editorPlaylist) : 0;
  let source = doc.playlist;
  if (embedImages && before > 0 && editorPlaylist) {
    setStatus("Embedding images…");
    source = await embeddedPlaylist(editorPlaylist, { resolvePortraits, resolveSources, contactEmail: settings.contactEmail });
    const embedded = before - unembeddedImages(source);
    lastEmbedNote = embedded > 0 ? ` — ${embedded} image(s) embedded` : "";
  }
  // "Allow comments" writes the giscus wiring onto the published COPY only
  // (C1) — Save stays verbatim, and the viewer reads everything it needs
  // from the file plus its own URL.
  if (allowComments && settings.giscusRepoId && settings.giscusCategoryId) {
    source = {
      ...source,
      meta: { ...source.meta, comments: { repoId: settings.giscusRepoId, category: settings.giscusCategory, categoryId: settings.giscusCategoryId } },
    };
  }
  const plain = formatPlaylist(source, "yaml");
  if (!bake) return plain;
  const apiKey = getTtsKey();
  if (!apiKey) throw new Error("Publishing with narration needs a Google TTS key — add one in Settings.");
  const published = await previousText();
  const existing: AudioTrack["lines"] = published ? (parsePlaylistText(published).audio?.lines ?? {}) : {};
  const bakeLines = playlistSpeakLines(source);
  const voiceOf = (line: SpeakLine): string | undefined => stampedVoice(settings.cloudVoices, detectLang(line.text), line);
  const stats: SynthStats = { cached: 0, synthesized: 0 };
  const track = await bakeNarration(
    bakeLines,
    {
      lang: itemsOf(source).find((i) => i.spec.lang)?.spec.lang ?? "en",
      existing,
      // B15: clips land in the local cache the moment they are synthesized,
      // and the cache answers before the API — a quota failure mid-bake
      // costs nothing to retry.
      synthesize: cachingSynthesizer(
        bakeClipStore,
        (line) => clipCacheKey(settings.rate, settings.cloudVoices, line),
        (line) => synthesizeBase64({ apiKey, rate: settings.rate, voices: settings.cloudVoices }, line.text, line),
        stats,
      ),
      // Mirrors what synthesize will do (same detectLang, same decision) —
      // the reuse check and the synthesis must never disagree about the voice.
      voiceOf,
    },
    (done, total) => setStatus(`Synthesizing narration — ${done}/${total} lines…`),
    signal,
  );
  const size = bakeSize(track);
  // The accounting that answers "why is it synthesizing again?" — what the
  // published copy provided, what the local cache replayed free, what was
  // actually bought, and whether a voice change (an audition pick counts!)
  // was the reason.
  const reused = linesToBake(bakeLines, {}, voiceOf).length - linesToBake(bakeLines, existing, voiceOf).length;
  const revoiced = voiceChanges(bakeLines, existing, voiceOf)
    .map((c) => `${c.count} line(s) re-voiced ${c.from} → ${c.to}`)
    .join("; ");
  lastBakeNote = ` Narration included — ${size.lines} line(s), ${(size.inlineBytes / 1_048_576).toFixed(1)} MB, so viewers need no key (${reused} reused from the published copy, ${stats.cached} replayed free from the local cache, ${stats.synthesized} synthesized${revoiced ? `. NOTE: ${revoiced} — a voice pick counts as a change; Settings → Playback puts it back` : ""}).`;
  return formatPublished(source, track);
}

let lastBakeNote = "";
let lastEmbedNote = "";

async function publishDrawcast({ bake, embedImages, slug, allowComments }: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean }): Promise<void> {
  const token = getGithubToken();
  const repo = parseRepo(settings.githubRepo);
  if (!token || !repo) {
    setStatus("Set your GitHub repository and token in Settings first (Settings → Publishing).", "error");
    return;
  }
  if (itemsOf(doc.playlist).length === 0) {
    setStatus("There is nothing to publish yet.", "error");
    return;
  }
  shareBtn.disabled = true;
  lastBakeNote = "";
  lastEmbedNote = "";
  const ac = new AbortController();
  try {
    setStatus("Publishing to GitHub…");
    const text = await publishTextFor(ac.signal, bake, embedImages, allowComments);
    const out = await publishCast({
      title: doc.title,
      text,
      slug,
      previousSlug: doc.publishedAs,
      repo,
      token,
      castsDir: joinPath(settings.coursesDir, "casts"),
      viewerBase: settings.viewerBase,
      fetchImpl: (input, init) => fetch(input, { ...init, signal: ac.signal }),
    });
    // Past this line the commit has LANDED. Recording the slug is what keeps
    // the link permanent, so it is worth saying if only that part failed.
    doc.publishedAs = out.slug;
    doc.publishedComments = allowComments === true && settings.giscusRepoId !== "" && settings.giscusCategoryId !== "";
    try {
      autosave();
    } catch (err) {
      console.error("drawcast: publish succeeded, bookkeeping failed", err);
    }
    setStatus(`Published to ${out.castUrl}${lastEmbedNote}${lastBakeNote}`, "ok");
  } catch (err) {
    console.error("drawcast: publish failed", err);
    const e = err as Error;
    setStatus(`Publish failed — ${e.name}: ${e.message} (full details in the browser console)`, "error");
  } finally {
    shareBtn.disabled = false;
  }
}

/**
 * Publish → Google Drive (spec §7-8): the SAME copy publishDrawcast sends to
 * GitHub — embedded images, baked narration, the author's own choices —
 * written as a plain `.yaml` file into the app-created `drawcast` folder.
 *
 * Never a Google Doc: Docs cap at about a million characters, which a
 * self-contained publish (images and audio inlined) sails past, and Docs curl
 * quotes inside the text they store.
 *
 * Sharing stays manual (spec §8): the app never touches permissions, so the
 * status line shows the playable link AND an "Open in Drive" action, which is
 * where the author flips "Anyone with the link can view".
 */
async function publishDriveCast({ bake, embedImages, name }: { bake: boolean; embedImages: boolean; name?: string }): Promise<void> {
  if (!googleConfigured()) {
    setStatus("This build has no Google client configured — publishing to Drive is unavailable.", "error");
    return;
  }
  if (itemsOf(doc.playlist).length === 0) {
    setStatus("There is nothing to publish yet.", "error");
    return;
  }
  shareBtn.disabled = true;
  lastBakeNote = "";
  lastEmbedNote = "";
  const ac = new AbortController();
  try {
    // Consent FIRST, before a single cent is spent. Baking narration costs
    // real money per line and takes minutes; leaving the first requireScope
    // to ensureFolder/saveSpec meant a declined popup threw a paid bake away.
    // Worse, transient user activation lapses after about five seconds, so a
    // popup opened on the far side of a bake is BLOCKED by the browser and
    // the author is told sign-in was cancelled after all that work — exactly
    // why the YouTube upload asks up front too. The token lands in the cache,
    // so every Drive call below prompts nobody.
    if (!(await requireScope(DRIVE_SCOPE))) {
      setStatus("Google sign-in was cancelled — nothing was published.", "error");
      return;
    }
    setStatus("Publishing to Google Drive…");
    // Narration reuse reads back THIS destination's previous copy — the
    // GitHub default would charge for every line again on a Drive republish,
    // and could hand over lines from a different (older) publish entirely.
    const text = await publishTextFor(ac.signal, bake, embedImages, undefined, () =>
      doc.drivePublishedId ? readFileText(doc.drivePublishedId) : Promise.resolve(null),
    );
    // Parents are a create-time placement; saveSpec's PATCH must never carry
    // them, so the folder is only looked up when there is no file yet.
    // ensureFolder degrades to null (a root-level file) rather than blocking
    // the publish on a failed lookup.
    const folder = doc.drivePublishedId ? null : await ensureFolder();
    const base = fileSafe(name ?? doc.title);
    const res = await saveSpec(text, `${base}.yaml`, "text/yaml", doc.drivePublishedId ?? null, folder);
    if (!res) {
      setStatus("Google sign-in was cancelled — nothing was published.", "error");
      return;
    }
    // Past this line the file has LANDED. Recording the id is what keeps the
    // link permanent, so it is worth saying if only that part failed. The
    // NAME is recorded beside it for a related reason: the panel prefills
    // from it, so the next publish leaves the file called what the author
    // called it instead of quietly renaming it back to the document title.
    doc.drivePublishedId = res.fileId;
    doc.drivePublishedName = base;
    try {
      autosave();
    } catch (err) {
      console.error("drawcast: Drive publish succeeded, bookkeeping failed", err);
    }
    setStatusAction(
      `Published to Drive — ${settings.viewerBase.replace(/\/+$/, "")}/#gdrive=${res.fileId} plays once link-sharing is on.${lastEmbedNote}${lastBakeNote}`,
      "Open in Drive",
      () => window.open(`https://drive.google.com/file/d/${res.fileId}/view`, "_blank"),
      "ok",
    );
  } catch (err) {
    console.error("drawcast: Drive publish failed", err);
    // The one failure with a way out. `drivePublishedId` outlives the Google
    // token — it is in localStorage, the token is not — so deleting the file
    // in Drive, or signing in as a different account, used to make EVERY
    // later republish 404 with nothing the author could do about it. Forget
    // the dead id so the next publish creates a new file, and say so out
    // loud: silently minting a second file would change the link without
    // telling anyone it had changed.
    if (doc.drivePublishedId && isMissingFileError(err)) {
      doc.drivePublishedId = undefined;
      // The name belonged to that file too. Cleared together, set together —
      // one invariant instead of a half-remembered publish.
      doc.drivePublishedName = undefined;
      try {
        autosave();
      } catch (bookkeeping) {
        console.error("drawcast: could not forget the dead Drive file id", bookkeeping);
      }
      setStatus("That Drive file is gone (or belongs to another account) — publish again to create a new one.", "error");
      return;
    }
    const e = err as Error;
    setStatus(`Drive publish failed — ${e.name}: ${e.message} (full details in the browser console)`, "error");
  } finally {
    shareBtn.disabled = false;
  }
}

// In-flight guards for the two Drive operations. These used to live as
// `driveSaveBtn.disabled` / `driveOpenBtn.disabled` — but that only ever
// protected the one button wired to the call. Now that Open/Save are menu
// items (createMenu returns a different element shape depending on which
// items are configured-visible, so there is no single stable button to
// disable), the guard belongs to the operation itself: a saveToDrive() that
// cannot be re-entered is correct no matter what calls it — a menu item
// today, a keyboard shortcut or Share tomorrow.
let driveSaveInFlight = false;
async function saveToDrive(): Promise<void> {
  if (driveSaveInFlight) return;
  driveSaveInFlight = true;
  try {
    // What you see is what you save — refuses (and says why) rather than
    // uploading text that doesn't even parse. See prepareSave()'s doc comment.
    const save = prepareSave();
    if (!save) return;
    // Everything this save is ABOUT is captured at click time. The first Save
    // opens a consent popup and the page stays interactive behind it, so `doc`
    // may be a different document by the time the await resolves — and writing
    // file A's id onto document B would make B's next Save overwrite A.
    const target = doc;
    // The textarea always holds YAML now (the format picker is gone), so the
    // extension and the MIME type follow it.
    const name = `${fileSafe(save.title)}.yaml`;
    const mimeType = "text/yaml";
    setStatus("Saving to Drive…");
    // Updates reuse target.driveFileId and never move the file, so only a
    // brand-new save needs the folder — ensureFolder degrades to null (a
    // root-level save) rather than blocking the save on a failed lookup.
    const folder = target.driveFileId ? null : await ensureFolder();
    const res = await saveSpec(save.text, name, mimeType, target.driveFileId, folder);
    if (!res) {
      setStatus("Drive sign-in was cancelled — nothing was saved.", "error");
      return;
    }
    // Only if that document is still the open one: otherwise the id belongs to
    // a document nobody is looking at, and dropping it merely costs the next
    // Save of it a new Drive file.
    if (doc === target) doc.driveFileId = res.fileId;
    refreshAccountRow();
    setStatus(`Saved "${name}" to your Google Drive.`, "ok");
  } catch (err) {
    setStatus(`Drive save failed: ${(err as Error).message}`, "error");
  } finally {
    driveSaveInFlight = false;
  }
}

let driveOpenInFlight = false;
async function openFromDrive(): Promise<void> {
  // Same in-flight guard as every other document-loading path — checked twice
  // on purpose: once before the picker opens, and again once it resolves,
  // because the consent popup and the chooser both leave the page interactive
  // long enough to press Revise. A revise that resolves after this setDoc
  // would write the old document's text into the Drive document's identity.
  if (blockedByAi("opening from Drive")) return;
  if (driveOpenInFlight) return;
  driveOpenInFlight = true;
  try {
    const picked = await openSpec();
    if (!picked) return; // cancelled, or sign-in declined — say nothing
    if (blockedByAi("opening from Drive")) return;
    const playlist = readPlaylistText(picked.text);
    if (!playlist) return; // readPlaylistText already reported why
    setDoc({
      id: null, // copy-on-write: opening creates no library entry until you change it
      driveFileId: null, // a NEW Save should not overwrite the file you opened
      sourcePath: null, // a Drive open, not a GitHub one — nothing to carry forward
      title: docTitleOf(playlist, picked.name.replace(/\.(ya?ml|json)$/i, "")),
      prompt: "",
      playlist,
    }, `Opened "${picked.name}" from Drive.`);
    refreshAccountRow();
  } catch (err) {
    setStatus(`Drive open failed: ${(err as Error).message}`, "error");
  } finally {
    driveOpenInFlight = false;
  }
}

// ---- Save/Open → GitHub source (publish/source.ts) --------------------
//
// Distinct from Publish (publishDrawcast, above): that commits a RENDERED
// viewer page for an audience and says "Published to <url>". This commits the
// .yaml a document is EDITED as — the source itself, so it gets real version
// history and diffs — and says `Saved "<title>" to <owner>/<repo>`. Neither
// path implies the other happened; a document can be published, saved as a
// source, both, or neither.
let sourceSaveInFlight = false;
async function saveSourceToGithub(): Promise<void> {
  if (sourceSaveInFlight) return;
  sourceSaveInFlight = true;
  try {
    // What you see is what you save — refuses (and says why) instead of
    // committing doc.playlist, last render's GOOD text, past the author's
    // edits. See prepareSave()'s doc comment. This is also the fix for the
    // original bug report: a broken indent used to sail straight through to
    // "Saved … to owner/repo" because setStatus("Saving source to GitHub…")
    // below overwrote the parse error readPlaylistText had already posted —
    // prepareSave() returning null here stops that dead in its tracks.
    const save = prepareSave();
    if (!save) return;
    const target = doc;
    const token = getGithubToken();
    const repo = parseRepo(settings.githubRepo);
    if (!token || !repo) {
      setStatus("Set your GitHub repository and token in Settings first (Settings → Publishing).", "error");
      return;
    }
    setStatus("Saving source to GitHub…");
    const out = await saveSource({
      title: save.title,
      text: save.text,
      existing: target.sourcePath,
      dir: joinPath(settings.coursesDir, "casts"),
      repo,
      token,
    });
    // Only if that document is still the open one — same rule saveToDrive
    // follows for driveFileId: the popup/network delay may have let the user
    // switch documents while this was in flight.
    if (doc === target) {
      doc.sourcePath = out.path;
      try {
        autosave();
      } catch (err) {
        console.error("drawcast: source save succeeded, bookkeeping failed", err);
      }
    }
    setStatus(`Saved "${save.title}" to ${repo.owner}/${repo.repo}`, "ok");
  } catch (err) {
    console.error("drawcast: source save failed", err);
    const e = err as Error;
    setStatus(`Save to GitHub failed — ${e.name}: ${e.message} (full details in the browser console)`, "error");
  } finally {
    sourceSaveInFlight = false;
  }
}

// Built once, like the app's other small modals; body content is dynamic
// (one row per saved source) so it is rebuilt on every open, not just once.
const sourceOpenModal = createModal("Open from GitHub", { size: "s" });
app.appendChild(sourceOpenModal.dialog);

/** Fetch one saved source and open it — the picker's per-row click handler. */
async function loadSourceFromGithub(repo: RepoRef, entryPath: string, fallbackTitle: string): Promise<void> {
  // Re-checked here (not just before the picker opened): the picker stays up
  // waiting for a click, long enough for a revise to land in the meantime —
  // same hazard openFromDrive's double-check guards against.
  if (blockedByAi("opening from GitHub")) return;
  try {
    const text = await readFile(repo, entryPath);
    if (text === null) {
      setStatus(`GitHub open failed: "${entryPath}" was not found in ${repo.owner}/${repo.repo}.`, "error");
      return;
    }
    const playlist = readPlaylistText(text);
    if (!playlist) return; // readPlaylistText already reported why
    setDoc(
      {
        id: null, // copy-on-write: opening creates no library entry until you change it
        driveFileId: null,
        // A GitHub source open — unlike a Drive open, this path IS carried
        // forward: a later Save → To GitHub must overwrite this same file,
        // not mint a second one next to it.
        sourcePath: entryPath,
        title: docTitleOf(playlist, fallbackTitle),
        prompt: "",
        playlist,
      },
      `Opened "${fallbackTitle}" from GitHub.`,
    );
  } catch (err) {
    setStatus(`GitHub open failed: ${(err as Error).message}`, "error");
  }
}

let sourceOpenInFlight = false;
async function openSourceFromGithub(): Promise<void> {
  if (blockedByAi("opening from GitHub")) return;
  if (sourceOpenInFlight) return;
  sourceOpenInFlight = true;
  try {
    const token = getGithubToken();
    const repo = parseRepo(settings.githubRepo);
    if (!token || !repo) {
      setStatus("Set your GitHub repository and token in Settings first (Settings → Publishing).", "error");
      return;
    }
    const dir = joinPath(settings.coursesDir, "casts");
    const indexText = await readFile(repo, sourceIndexPath(dir));
    // A missing manifest is the normal state of a repo nothing has been saved
    // to yet — readFile answers null on a 404, not a rejection, so this is
    // not the catch block below; it is read the same as an empty manifest.
    const manifest = indexText ? parseSourceManifest(indexText) : { sources: [] };
    if (manifest.sources.length === 0) {
      setStatus("Nothing saved to this repository yet.");
      return;
    }
    sourceOpenModal.body.replaceChildren();
    for (const entry of [...manifest.sources].sort((a, b) => b.ts.localeCompare(a.ts))) {
      const openBtn = h("button", { class: "library-open" }, entry.title);
      openBtn.addEventListener("click", () => {
        sourceOpenModal.dialog.close();
        void loadSourceFromGithub(repo, entry.path, entry.title);
      });
      sourceOpenModal.body.appendChild(h("div", { class: "library-item" }, openBtn));
    }
    sourceOpenModal.open();
  } catch (err) {
    setStatus(`GitHub open failed: ${(err as Error).message}`, "error");
  } finally {
    sourceOpenInFlight = false;
  }
}

// ---------- video export ----------

// The export runs in the background — no modal, the app stays usable — so the
// recording canvas and the replay stage both live offscreen in the app body.
// Offscreen but laid out: path measurement needs rendered geometry.
const exportCanvas = h("canvas") as HTMLCanvasElement;
const exportStage = h("div");
app.appendChild(h("div", { class: "export-offscreen" }, exportCanvas, exportStage));

let exportAbort: AbortController | null = null;
exportChipCancel.addEventListener("click", () => exportAbort?.abort());

/** Show the chip and freeze Share — the one entry point now — while one export runs. */
function beginExport(status: string): void {
  // Share reads doc() synchronously right after this returns (ui/share.ts) —
  // catch the drawing up first so an export never ships stale content.
  ensureRendered();
  exportChipText.textContent = status;
  exportChip.hidden = false;
  shareBtn.disabled = true;
}
function endExport(): void {
  exportChip.hidden = true;
  shareBtn.disabled = false;
  exportAbort = null;
}

/**
 * Render + encode the current drawcast to a WebM in the background, progress
 * on the export chip. Returns null when the key is missing, the user
 * cancelled, or the export failed — in every one of those cases the status
 * line already says why, so callers just return.
 */
async function renderVideo(specs: Spec[], burnCaptions: boolean, of = ""): Promise<ExportResult | null> {
  const ttsKey = getTtsKey();
  if (!ttsKey) {
    setStatus("Video export needs a Google Cloud Text-to-Speech API key — add it in Settings.", "error");
    openSettings();
    return null;
  }
  const controller = new AbortController();
  exportAbort = controller;
  exportStage.replaceChildren();
  // A Web Worker interval keeps the recording's clock ticking while this tab
  // is hidden — no extra window, no user-gesture requirement. Where workers
  // are unavailable the export still works and pauses while hidden.
  const keepAlive = new ExportKeepAlive(document, (cb) => requestAnimationFrame(() => cb()), () => performance.now());
  const clock = startWorkerClock();
  if (clock) keepAlive.attach(clock.frame);
  try {
    return await exportVideo(
      specs,
      { ttsKey, style: settings.style, rate: settings.rate, questions: settings.skipQuestions ? "skip" : "on", burnCaptions, lang: narrationLanguage(specs) },
      {
        onStatus: (t) => (exportChipText.textContent = of ? `${t.replace(/…$/, "")}${of}…` : t),
        canvas: exportCanvas,
        workbench: exportStage,
        signal: controller.signal,
        keepAlive,
      },
    );
  } catch (err) {
    if (controller.signal.aborted) setStatus("Video export cancelled.");
    else setStatus(`Export failed: ${(err as Error).message}`, "error");
    return null;
  } finally {
    clock?.stop();
    keepAlive.dispose();
    exportStage.replaceChildren();
  }
}

// ↗ Share — one modal over GitHub/Drive/YouTube/Video file, replacing the five
// controls above (spec §2). Spec file left this modal for Save → To disk
// (spec §1) — Share is for reaching an audience, not downloading your own
// source. The panels' own logic (translation, upload, the
// YouTube-into-fresh-playlists trap) lives in ui/share.ts now; this is just
// the wiring to this app's live state.
shareBtn.addEventListener("click", () => {
  // The modal reads `doc` live (below) — catch it up to the text on screen
  // first, so a link/upload never ships a stale drawing.
  ensureRendered();
  openShare({
    subject: "drawcast",
    // playlist: read from the editor text, not doc.playlist — render()
    // resolves portraits/sources IN PLACE on the document's own spec
    // objects on every preview render (render/index.ts), so by the time
    // this modal opens doc.playlist may already carry strokes even though
    // the text on screen (and the Insert-menu Embed dialog, which parses
    // that same text) says otherwise. Falls back to doc.playlist only if
    // the text does not currently parse.
    doc: () => {
      const playlist = readPlaylistText(specArea.value) ?? doc.playlist;
      return { ...doc, playlist, narrationCost: costLabel(bakeCost(playlistSpeakLines(playlist), settings.cloudVoices)) };
    },
    settings,
    persist,
    setStatus,
    setStatusAction,
    refreshLibrary,
    refreshAccountRow,
    openSettings,
    publish: (choices) => publishDrawcast(choices),
    publishDrive: (choices) => publishDriveCast(choices),
    renderVideo,
    beginExport,
    setProgress: (text) => (exportChipText.textContent = text),
    endExport,
    setAbort: (c) => (exportAbort = c),
  });
});

// ---------- prompt library ----------

function selectUserPrompt(p: UserPrompt): void {
  settings.variant = `user:${p.id}`;
  persist();
  refreshPromptPanel();
}

variantSel.addEventListener("change", () => {
  const picked = variantSel.value;
  if (isActionValue(picked)) {
    variantSel.value = settings.variant; // the action entries select nothing
    if (picked === ACTION_NEW) void newInstructionsFromActive();
    openInstructionsModal();
    return;
  }
  settings.variant = picked;
  persist();
  refreshPromptPanel();
});

promptSaveBtn.addEventListener("click", () => {
  const up = activeUserPrompt();
  if (!up) return;
  const missing = missingPlaceholders(promptSource.value);
  if (missing.includes("{{SCHEMA}}")) {
    setStatus("Not saved: the prompt must keep {{SCHEMA}} — it is replaced by the spec schema at generation time.", "error");
    return;
  }
  saveUserPrompt({ ...up, source: promptSource.value, ts: new Date().toISOString() });
  refreshPromptPanel();
  setStatus(missing.length > 0 ? `Saved "${up.name}" — note: missing ${missing.join(", ")}.` : `Saved "${up.name}".`, missing.length > 0 ? "info" : "ok");
});

promptRenameBtn.addEventListener("click", () => {
  const up = activeUserPrompt();
  if (!up) return;
  const name = window.prompt("New name for this prompt:", up.name)?.trim();
  if (!name) return;
  saveUserPrompt({ ...up, name });
  refreshPromptPanel();
});

/** A new set of instructions always starts from the active one: the
 * {{SCHEMA}}/{{CATALOG}}/{{FEWSHOTS}}/{{EXEMPLARS}} placeholders must survive. */
function copyActivePrompt(): void {
  const up = activeUserPrompt();
  const name = up ? `${up.name} copy` : `${settings.variant} copy`;
  const p: UserPrompt = { id: crypto.randomUUID(), name, source: promptSource.value, ts: new Date().toISOString() };
  saveUserPrompt(p);
  selectUserPrompt(p);
  setStatus(`Created "${name}" — now the active instructions, edit away.`, "ok");
}
promptCopyBtn.addEventListener("click", copyActivePrompt);

promptDeleteBtn.addEventListener("click", () => {
  const up = activeUserPrompt();
  if (!up) return;
  deleteUserPrompt(up.id);
  refreshPromptPanel(); // falls back to the bundled prompt
  setStatus(`Deleted "${up.name}".`, "ok");
});

promptDownloadBtn.addEventListener("click", () => {
  const name = activeUserPrompt()?.name ?? settings.variant;
  downloadText(`${fileSafe(name, "prompt")}.md`, promptSource.value, "text/markdown");
});

promptUploadBtn.addEventListener("click", () => promptUploadInput.click());
promptUploadInput.addEventListener("change", () => {
  const file = promptUploadInput.files?.[0];
  if (!file) return;
  void file.text().then((source) => {
    promptUploadInput.value = "";
    if (missingPlaceholders(source).includes("{{SCHEMA}}")) {
      setStatus("Not a compiler prompt: the file is missing the {{SCHEMA}} placeholder.", "error");
      return;
    }
    const p: UserPrompt = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.(md|txt)$/i, ""),
      source,
      ts: new Date().toISOString(),
    };
    saveUserPrompt(p);
    selectUserPrompt(p);
    setStatus(`Uploaded "${p.name}" — now the active prompt.`, "ok");
  });
});

promptImproveBtn.addEventListener("click", () => void improveActivePrompt());
async function improveActivePrompt(): Promise<void> {
  const apiKey = requireKey();
  if (!apiKey) return;
  promptImproveBtn.disabled = true;
  const cases: ImproveCase[] = worstLoggedCases(6).map((l) => ({
    prompt: l.prompt,
    rating: l.rating,
    error: l.error,
    lintMessages: l.lintIssues.map((i) => i.message),
    rounds: l.rounds.length,
  }));
  setStatus(
    cases.length > 0
      ? `Asking ${settings.model} to revise the prompt from your ${cases.length} worst logged generations…`
      : `No logged failures yet — asking ${settings.model} for a clarity pass…`,
  );
  try {
    const outcome = await improvePrompt({ apiKey, model: settings.model }, currentVariant().source, cases);
    if (!outcome.source) {
      setStatus(`Prompt improvement failed: ${outcome.error}`, "error");
      return;
    }
    const baseName = activeUserPrompt()?.name ?? settings.variant;
    const p: UserPrompt = { id: crypto.randomUUID(), name: `${baseName} improved`, source: outcome.source, ts: new Date().toISOString() };
    saveUserPrompt(p);
    selectUserPrompt(p);
    setStatus(
      `Proposal saved as "${p.name}" and made active${outcome.error ? ` (${outcome.error})` : ""}. Review the diff and test-generate before trusting it.`,
      "ok",
    );
  } finally {
    promptImproveBtn.disabled = false;
  }
}

// ---------- settings + misc wiring ----------

keyInput.addEventListener("change", () => void handleKeyEntry(keyInput.value.trim()));

/**
 * The key field also accepts the shared password (deliberately unadvertised).
 * Anything that doesn't look like an Anthropic key is TRIED against the
 * vending endpoint — the server decides; on failure the text is stored
 * as-entered, exactly like before. On success BOTH keys are filled at once.
 */
async function handleKeyEntry(text: string): Promise<void> {
  if (text && !looksLikeAnthropicKey(text)) {
    const vended = await redeemPassword(text);
    if (vended) {
      setApiKey(vended.anthropicKey);
      keyInput.value = vended.anthropicKey;
      if (vended.googleKey) {
        setTtsKey(vended.googleKey);
        ttsKeyInput.value = vended.googleKey;
      }
      setVendedFlags({ anthropic: true, tts: vended.googleKey.length > 0 });
      setStatus("Keys unlocked.", "ok");
      return;
    }
  }
  setApiKey(text);
  setVendedFlags({ ...loadVendedFlags(), anthropic: false });
}
clearKeyBtn.addEventListener("click", () => {
  setApiKey("");
  keyInput.value = "";
  setVendedFlags({ ...loadVendedFlags(), anthropic: false });
});
ttsKeyInput.addEventListener("change", () => {
  setTtsKey(ttsKeyInput.value.trim());
  setVendedFlags({ ...loadVendedFlags(), tts: false });
});
burnCaptionsCb.addEventListener("change", () => {
  settings.burnCaptions = burnCaptionsCb.checked;
  persist();
});
skipQuestionsCb.addEventListener("change", () => {
  settings.skipQuestions = skipQuestionsCb.checked;
  persist();
  void present();
});
cloudPlaybackCb.addEventListener("change", () => {
  settings.cloudPlayback = cloudPlaybackCb.checked;
  persist();
});
clearTtsKeyBtn.addEventListener("click", () => {
  setTtsKey("");
  ttsKeyInput.value = "";
  setVendedFlags({ ...loadVendedFlags(), tts: false });
});
voiceSel.addEventListener("change", () => {
  settings.voiceURI = voiceSel.value || null;
  speech.setVoice(settings.voiceURI);
  persist();
});
rateSel.addEventListener("change", () => {
  settings.rate = parseFloat(rateSel.value);
  speech.setRate(settings.rate);
  persist();
});
modelSel.addEventListener("change", () => {
  settings.model = modelSel.value;
  persist();
});
styleSel.addEventListener("change", () => {
  settings.style = styleSel.value as RenderStyle;
  persist();
  void present();
});
themeSel.addEventListener("change", () => {
  settings.theme = themeSel.value as "system" | "light" | "dark";
  persist();
  applyTheme();
});

exportPacketBtn.addEventListener("click", () => downloadJson(`drawcast-improvement-packet-${Date.now()}.json`, buildImprovementPacket()));
clearLogsBtn.addEventListener("click", () => {
  clearLogs();
  refreshCounts();
});

// ---------- boot ----------

specArea.value = formatPlaylist(doc.playlist, "yaml");
stack = seedStack(specArea.value, doc.prompt || doc.title);
applyHistoryUi();
refreshStylePanel();
if (doc.prompt) promptEl.value = doc.prompt;
refreshChips();
// A freshly opened document is not an edit — mark it caught up BEFORE
// showMode()'s first present() (which, for Player, routes through
// ensureRendered() and would otherwise mint a bogus history entry the
// instant the app opens, since lastRenderedText starts out null).
markRendered(specArea.value);
showMode(settings.uiMode);
