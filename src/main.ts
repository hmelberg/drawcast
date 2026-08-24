// drawcast — two modes over one document:
//   Player: a YouTube-like screen that just plays the current drawcast.
//   Editor: create drawings with AI or by hand, load examples and saved work,
//           edit the spec JSON, and change/improve the compiler prompt.

import "./styles.css";
import { type RenderHandle, type RenderStyle } from "./render";
import { generateOutline, generateSpec, improvePrompt, promptVariants, type ImproveCase, type PromptVariant } from "./llm/compile";
import { buildPartRequest } from "./llm/outline";
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
import { createModal, createTabs, dialogHead } from "./ui/modal";
import { validateSpec, SPEC_VERSION } from "./spec/schema";
import { type SpecFormat } from "./spec/text";
import type { Spec } from "./spec/types";
import { h } from "./ui/dom";
import { type PlaybackPrefs } from "./ui/controls";
import {
  DEFAULT_META,
  formatPlaylist,
  isSingle,
  itemsOf,
  makeTitleCard,
  parsePlaylistText,
  singlePlaylist,
  type Playlist,
} from "./playlist/playlist";
import { itemTitle, mountPlaylist, playlistSpeakTexts, type SessionHandle } from "./playlist/session";
import { exportVideo } from "./export/video";
import { CloudSpeech } from "./export/tts";
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
  deleteUserPrompt,
  getApiKey,
  getTtsKey,
  setTtsKey,
  loadExemplars,
  loadLibrary,
  loadLogs,
  loadMyTemplates,
  loadRemotePacks,
  loadSettings,
  loadUserPrompts,
  migrateLegacyCustomPrompt,
  deleteRemotePack,
  saveDrawing,
  saveMyTemplate,
  saveRemotePack,
  saveSettings,
  saveUserPrompt,
  setApiKey,
  loadVendedFlags,
  setVendedFlags,
  usageSummary,
  updateLog,
  worstLoggedCases,
  type LogEntry,
  type SavedDrawing,
  type UserPrompt,
} from "./store";
import { currentUser, DRIVE_SCOPE, googleConfigured, pickerConfigured, requireScope, signOut } from "./google/auth";
import { openSpec, saveSpec } from "./google/drive";
import fewshots from "./llm/prompts/fewshots.json";
import bundledExamples from "./examples.json";

const settings = loadSettings();
// Cloud voices for live playback when a TTS key is set (and the toggle is on);
// falls back to the browser's speechSynthesis otherwise, per line.
const speech = new CloudSpeech(() => (settings.cloudPlayback ? getTtsKey() : ""));
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
  if (saved.playlist) {
    try {
      return { id: saved.id, driveFileId: null, title: saved.title, prompt: saved.prompt, playlist: parsePlaylistText(saved.playlist) };
    } catch {
      /* fall through to the single spec */
    }
  }
  return { id: saved.id, driveFileId: null, title: saved.title, prompt: saved.prompt, playlist: singlePlaylist(saved.spec) };
}

function initialDoc(): Doc {
  const saved = loadLibrary()[0];
  if (saved) return docFromSaved(saved);
  // Fewshots come first in `examples` and always carry a spec.
  const ex = examples.find((e) => e.spec) as BundledExample & { spec: Spec };
  // An untouched bundled example is not yours until you change it (copy-on-write).
  return { id: null, driveFileId: null, title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) };
}

const app = document.getElementById("app")!;

// ---------- topbar with the mode toggle ----------
// The topbar exists only in editor mode; player mode is chrome-free (the
// control bar's ✎ Edit button is the way back).

const playerModeBtn = h("button", { class: "mode-btn", title: "Watch the current drawcast" }, "▶ Player");
const editorModeBtn = h("button", { class: "mode-btn", title: "Create and edit drawcasts" }, "✎ Editor");
const menuBtn = h("button", { class: "icon-btn", title: "Show or hide the menu" }, "☰");

app.appendChild(
  h(
    "header",
    { class: "topbar" },
    h("div", { class: "topbar-left" }, menuBtn, h("div", { class: "wordmark squiggle" }, "drawcast")),
    h("div", { class: "mode-toggle" }, playerModeBtn, editorModeBtn),
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

// Create panel
const promptEl = h("textarea", {
  "aria-label": "Describe the drawing",
  placeholder: 'Describe the drawing… e.g. "Show the deadweight loss from a tax, with shaded regions"',
});
const generateBtn = h("button", { class: "primary" }, "Generate with AI");
const reviseBtn = h("button", { class: "primary", title: "Change the current drawcast with AI" }, "Revise with AI");
const blankBtn = h("button", { class: "sidebar-new", title: "Start a new drawcast from a minimal hand-editable spec" }, "＋ New drawcast");

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

// Examples list (sidebar): clicking an example loads it directly. Both sidebar
// lists honour the one search box above them.
const examplesList = h("div", { class: "library-list" });
let sidebarFilter = "";

function matchesFilter(text: string): boolean {
  return sidebarFilter === "" || text.toLowerCase().includes(sidebarFilter);
}

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
}
refreshExamples();
const exportBtn = h("button", { class: "icon-only", title: "Download the spec as a file" }, "⬇");
const importInput = h("input", { type: "file", accept: ".json,.yaml,.yml,.txt", style: "display:none" }) as HTMLInputElement;
const importBtn = h("button", { class: "icon-only", title: "Load a spec file from disk" }, "⬆");
const driveOpenBtn = h("button", { class: "small", title: "Open a spec from Google Drive" }, "☁ Open");
const driveSaveBtn = h("button", { class: "small", title: "Save this spec to Google Drive" }, "☁ Save");
// A capability without its credential does not advertise itself (spec §6).
// Open needs the Picker's own developer key; Save does not.
driveOpenBtn.hidden = !pickerConfigured();
driveSaveBtn.hidden = !googleConfigured();
const exportVideoBtn = h(
  "button",
  { title: "Record the drawcast as a narrated WebM video (needs a Google Cloud TTS key in Settings). YouTube accepts WebM directly." },
  "🎬 Export video",
);
// openAuthorDialog is defined later (template-authoring section, ./llm/author) —
// a hoisted function declaration, so this early reference is safe.
const newTemplateBtn = h("button", { title: "Create a reusable template with AI (describe it, optionally paste an image)" }, "✦ New template");
newTemplateBtn.addEventListener("click", () => {
  templatesModal.dialog.close(); // hand over rather than stack (see openTemplatesModal)
  openAuthorDialog();
});
const libraryList = h("div", { class: "library-list" });
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
const rerenderBtn = h("button", { class: "small", title: "Redraw from the edited text" }, "↻ Re-render");
const formatSel = h("select", { class: "cs-bar-select", title: "Spec text format (parsing accepts both)" });
formatSel.append(h("option", { value: "yaml" }, "YAML"), h("option", { value: "json" }, "JSON"));
formatSel.value = settings.specFormat;

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
  h("label", { class: "quiet-label" }, "Instructions ", variantSel),
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
  const prompt = variantSel.options[variantSel.selectedIndex]?.textContent ?? settings.variant;
  choicesBtn.title = `Template: ${tpl} · Instructions: ${prompt} · Model: ${model}`;
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
    h("div", { class: "row gen-row" }, choicesBtn, histNav, generateBtn, reviseBtn),
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
        formatSel,
        rerenderBtn,
        h("span", { class: "pane-spacer" }),
        exportBtn,
        importBtn,
        importInput,
        driveOpenBtn,
        driveSaveBtn,
      ),
      specArea,
    ),
    h(
      "div",
      { class: "panel editor-preview" },
      h("div", { class: "pane-bar" }, lintChip, h("span", { class: "pane-spacer" }), ratingBox, promoteBtn, exportVideoBtn),
      previewHost,
      lintBox,
    ),
  ),
);

// ---------- left sidebar: the one menu ----------

const sidebarSearch = h("input", { type: "text", class: "sidebar-search", placeholder: "Search…", "aria-label": "Filter library and examples" }) as HTMLInputElement;
const dataRow = h("button", { class: "sidebar-row" }, "📊 Data");
// Declared here, ABOVE the sidebar, not near refreshAccountRow(): the IIFE
// below that assigns it runs during module initialisation, before a `let`
// declared further down in the file would leave its temporal dead zone.
let accountRow: HTMLButtonElement | null = null;
const sidebar = h(
  "aside",
  { class: "sidebar" },
  blankBtn,
  sidebarSearch,
  h("div", { class: "sidebar-section" }, h("h2", { class: "sidebar-heading" }, "📚 Library"), libraryList),
  h("div", { class: "sidebar-section" }, h("h2", { class: "sidebar-heading" }, "✨ Examples"), examplesList),
  h(
    "div",
    { class: "sidebar-tools" },
    (() => {
      const b = h("button", { class: "sidebar-row" }, "✦ Templates");
      b.addEventListener("click", () => openTemplatesModal("list"));
      return b;
    })(),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "📝 Instructions");
      b.addEventListener("click", () => openInstructionsModal());
      return b;
    })(),
    dataRow,
    h("a", { class: "sidebar-row", href: "./help.html", target: "_blank", rel: "noopener" }, "❓ Help"),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "☁ Sign in with Google");
      accountRow = b;
      b.addEventListener("click", () => void toggleAccount());
      b.hidden = !googleConfigured();
      return b;
    })(),
    (() => {
      const b = h("button", { class: "sidebar-row" }, "⚙ Settings");
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
});

const main = h("main", {}, sidebar, playerWrap, editorWrap);
app.append(main, sidebarBackdrop);

// ---------- templates modal (create + my templates + packs) ----------

const templatesModal = createModal("✦ Templates", { class: "wide-dialog" });
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
const instructionsModal = createModal("📝 Instructions", { class: "wide-dialog" });
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
const developerCb = h("input", { type: "checkbox" }) as HTMLInputElement;
developerCb.checked = settings.developerMode;
const voiceSel = h("select", {});
const rateSel = h("select", {});
for (const r of ["0.8", "0.9", "1", "1.1", "1.25"]) rateSel.appendChild(h("option", { value: r }, `${r}×`));
rateSel.value = String(settings.rate);

const dialog = h("dialog", {});
dialog.append(
  dialogHead(dialog, "Settings"),
  h("div", { class: "settings-field" }, h("label", {}, "Drawing style"), styleSel),
  h(
    "div",
    { class: "settings-field" },
    h("label", {}, "Anthropic API key (bring your own)"),
    keyInput,
    h("div", {}, clearKeyBtn),
    h("div", { class: "settings-note" }, "Stored in this browser's localStorage only. It never leaves the browser except in requests to api.anthropic.com."),
    usageNote,
  ),
  h(
    "div",
    { class: "settings-field" },
    h("label", {}, "Google Cloud Text-to-Speech key (for video export)"),
    ttsKeyInput,
    h("div", {}, clearTtsKeyBtn),
    h(
      "div",
      { class: "settings-note" },
      "Video export narrates with Google's neural voices (browser speech cannot be recorded). Stored in localStorage only; sent only to texttospeech.googleapis.com. The free tier (~1M characters/month) covers roughly a thousand drawcasts.",
    ),
    h("label", { class: "settings-check" }, cloudPlaybackCb, " Also use these voices for normal playback (falls back to the browser voice if a call fails)"),
  ),
  h("div", { class: "settings-field" }, h("label", {}, "Browser narration voice (used when no cloud voices)"), voiceSel),
  h("div", { class: "settings-field" }, h("label", {}, "Narration rate"), rateSel),
  h(
    "div",
    { class: "settings-field" },
    h("label", {}, "Advanced"),
    h("label", { class: "settings-check" }, developerCb, " Developer mode — show the 1–5 rating, the full lint list and the Data panel"),
  ),
);
app.appendChild(dialog);

function openSettings(): void {
  usageNote.textContent = usageSummary();
  usageNote.hidden = usageNote.textContent === "";
  dialog.showModal();
}

/** Developer mode hides the instruments that only feed the authoring loop. */
function applyDeveloperMode(): void {
  const on = settings.developerMode;
  ratingBox.hidden = !on;
  dataRow.hidden = !on;
  document.body.classList.toggle("dev-mode", on);
}
developerCb.addEventListener("change", () => {
  settings.developerMode = developerCb.checked;
  persist();
  applyDeveloperMode();
  if (session) setLintFromSession();
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

const authorDialog = h("dialog", { class: "author-dialog" });
authorDialog.append(
  dialogHead(authorDialog, "✦ New template"),
  authorDescEl,
  h("div", { class: "row" }, authorDrop, authorImgInput, authorImgThumb, authorImgClear),
  h("div", { class: "row" }, authorGenBtn),
  authorStatus,
  authorPreviewHost,
  h("div", { class: "row" }, authorRefineEl, authorRefineBtn, authorSaveBtn),
);
app.appendChild(authorDialog);

let authorImage: AuthorImage | null = null;
let authorOutcome: AuthorOutcome | null = null;
let authorImproveId: string | null = null;
let authorMount: { destroy(): void } | null = null;
/** Bumped at the start of every runAuthor() call and in the close handler; an
 * async continuation that finds it stale on resume (dialog closed or a newer
 * generation started meanwhile) must not touch the registry, mounts, or status. */
let authorSeq = 0;
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
  authorGenBtn.disabled = authorRefineBtn.disabled = true;
  authorStatus.textContent = "Generating template…";
  try {
    const existing = authorImproveId && !refine ? loadMyTemplates().find((t) => t.id === authorImproveId)?.yaml : undefined;
    const outcome = await generateTemplate(description, refine ? null : authorImage, {
      apiKey,
      model: modelSel.value,
      existingYaml: existing,
      history: refine ? (authorOutcome?.history ?? undefined) : undefined,
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
    if (seq === authorSeq) authorGenBtn.disabled = authorRefineBtn.disabled = false;
  }
}

authorGenBtn.addEventListener("click", () => void runAuthor(authorDescEl.value, false));
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
const model3dDialog = h("dialog", { class: "model3d-dialog" });
model3dDialog.append(
  dialogHead(model3dDialog, "⬡ Explore in 3D"),
  model3dContainer,
  h("div", { class: "row" }, model3dSpinBtn, model3dLabelsBtn),
);
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

async function present(): Promise<void> {
  // Guard against overlapping presents (e.g. Re-render while a mount is in
  // flight): only the latest call may keep its session.
  const seq = ++presentSeq;
  const isPlayer = settings.uiMode === "player";
  const host = isPlayer ? playerHost : previewHost;
  session?.destroy();
  session = null;
  host.replaceChildren();
  document.title = `${doc.title} — drawcast`;
  try {
    // Warm the cloud-voice cache so narrated playback starts without stalls.
    if (settings.mode === "narrated") speech.prefetch(playlistSpeakTexts(doc.playlist), settings.speed);
    // Player mode has no chrome of its own, so the control bar carries the way
    // back. The editor already has the Player/Editor pill in the topbar — a
    // second switch there would only crowd the narrow preview bar.
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
      speech,
      prefs: playbackPrefs(),
      controls: {
        onPlayingChange: (playing) => document.body.classList.toggle("is-playing", playing),
        speech,
        fullscreenEl: host,
        onTheater: isPlayer ? toggleTheater : undefined,
        trailing: isPlayer ? [switchBtn] : [],
      },
      onItemMounted: (hd, item) => {
        if (!isPlayer) setLint(hd);
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
    doc = { id: doc.id, driveFileId: doc.driveFileId, title: docTitleOf(playlist, doc.title), prompt: doc.prompt, playlist };
    void present();
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
  rerenderBtn.disabled = viewing;
  reviseBtn.textContent = viewing ? "Revise from here" : "Revise with AI";
  // Both of these target `lastLogId` — the log entry for the NEWEST version — so
  // while you are viewing an older one they would record against a spec that is
  // not on screen. Ratings feed the prompt-improvement loop, which makes that a
  // corrupted signal rather than a cosmetic slip.
  ratingButtons.forEach((rb) => (rb.disabled = viewing));
  // Exemplars are (request, single spec) pairs — a multi-part doc has no such pair.
  promoteBtn.disabled = viewing || promoted || !isSingle(doc.playlist);
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
  lastLogId = null; // ratings apply to generations only
  promoted = false; // before applyHistoryUi(), which reads it
  specArea.value = formatPlaylist(doc.playlist, settings.specFormat);
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

/** Parse + validate playlist text; returns null after reporting the first problem. */
function readPlaylistText(text: string): Playlist | null {
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(text);
  } catch (err) {
    setStatus(`Spec unreadable: ${(err as Error).message}`, "error");
    return null;
  }
  const items = itemsOf(playlist);
  if (items.length === 0) {
    setStatus("The playlist has no drawable items.", "error");
    return null;
  }
  for (const item of items) {
    const v = validateSpec(item.spec);
    if (!v.ok) {
      const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
      setStatus(`Spec invalid: ${where}${v.errors[0]}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ""}`, "error");
      return null;
    }
  }
  return playlist;
}

function docTitleOf(playlist: Playlist, fallback: string): string {
  return playlist.meta.title ?? itemsOf(playlist)[0]?.spec.title ?? fallback;
}

/** The last rendered handle, so toggling developer mode can redraw the lint. */
let lastHandle: RenderHandle | null = null;

/**
 * Lint shows as a chip: nothing at all when the drawing is clean, a count
 * otherwise, expanding to the list on click. Developer mode also reports a
 * clean result, since there the absence of warnings is itself information.
 */
function setLint(hd: RenderHandle): void {
  lastHandle = hd;
  lintBox.replaceChildren();
  const issues = hd.layout.issues;
  const warnings = [...hd.layout.warnings, ...hd.plan.warnings];
  const total = issues.length + warnings.length;
  if (total === 0) {
    lintChip.hidden = !settings.developerMode;
    lintChip.className = "lint-chip clean";
    lintChip.textContent = "✓ Lint clean";
    lintBox.hidden = true;
    lintOpen = false;
    return;
  }
  const worst = issues.some((i) => i.severity === "error") ? "error" : "warn";
  lintChip.hidden = false;
  lintChip.className = `lint-chip ${worst}`;
  lintChip.textContent = `⚠ ${total}`;
  lintChip.title = `${total} layout ${total === 1 ? "warning" : "warnings"} — click for details`;
  const ul = h("ul", { class: "lint-list" });
  for (const i of issues) ul.appendChild(h("li", { class: i.severity }, `${i.rule}: ${i.message}`));
  for (const w of warnings) ul.appendChild(h("li", {}, w));
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
  playerModeBtn.classList.toggle("active", mode === "player");
  editorModeBtn.classList.toggle("active", mode === "editor");
  void present();
}

playerModeBtn.addEventListener("click", () => showMode("player"));
editorModeBtn.addEventListener("click", () => showMode("editor"));

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

function setAiBusy(busy: boolean): void {
  aiBusy = busy;
  generateBtn.disabled = busy;
  reviseBtn.disabled = busy;
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
  setAiBusy(true);
  try {
    if (parsed.playlist) {
      await generateMulti(rawRequest, parsed, brief, apiKey, forcedTemplate, priorityIds);
      return;
    }
    setStatus(`Generating (${settings.model}, prompt ${currentVariant().name})…`);
    const outcome = await generateSpec(parsed.clean, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      exemplars: usableExemplars(loadExemplars(), isReadyTemplate),
      bundledExemplars: bundledExemplarPool(),
      brief,
      forcedTemplate,
      priorityIds,
    });
    const logId = logOutcome(rawRequest, outcome);
    if (!outcome.spec) {
      setStatus(outcome.error ?? "Generation failed.", "error");
      return;
    }
    if (parsed.level && !outcome.spec.level) outcome.spec.level = parsed.level;
    setDoc(
      { id: null, driveFileId: null, title: outcome.spec.title ?? parsed.clean, prompt: rawRequest, playlist: singlePlaylist(outcome.spec) },
      outcome.error ? `Partial: ${outcome.error}` : `Generated in ${outcome.rounds.length} round${outcome.rounds.length === 1 ? "" : "s"}.`,
      { label: rawRequest, kind: "generate" },
    );
    autosave();
    lastLogId = logId; // after setDoc, so the rating stars target this generation
  } finally {
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

  setAiBusy(true);
  try {
    setStatus(`Revising (${settings.model}, prompt ${currentVariant().name})…`);
    const outcome = await reviseDocument(docText, instruction, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      priorityIds: settings.priorityPacks.flatMap((p) => packTemplateIds(p)),
    });
    const logId = logRevision(instruction, outcome);
    if (!outcome.playlist) {
      setStatus(outcome.error ?? "Revision failed.", "error");
      return;
    }
    // doc.prompt is deliberately NOT replaced: it stays the original request, so
    // exemplars, the log and "👍 Learn from this" keep pairing original request -> current spec.
    setDoc(
      // Same document, edited in place by AI (same as a manual re-render) — carry
      // driveFileId forward too, or a Save right after a Revise would litter
      // Drive with a second copy of the file the earlier Save already created.
      { id: doc.id, driveFileId: doc.driveFileId, title: docTitleOf(outcome.playlist, doc.title), prompt: doc.prompt, playlist: outcome.playlist },
      `Revised: ${instruction}`,
      { label, kind: "revise" },
    );
    lastLogId = logId; // after setDoc, so the rating stars target this revision
    autosave();
    promptEl.value = ""; // consumed — and an empty box makes Generate inert
    refreshChips();
  } finally {
    setAiBusy(false);
  }
}

reviseBtn.addEventListener("click", () => void revise());

/** #playlist / #parts=N: one outline call, then one ordinary generation per part. */
async function generateMulti(
  rawRequest: string,
  parsed: ParsedTags,
  brief: string,
  apiKey: string,
  forcedTemplate: string | undefined,
  priorityIds: string[],
): Promise<void> {
  setStatus(`Outlining a multi-part drawcast (${settings.model})…`);
  let outline;
  try {
    outline = await generateOutline(parsed.clean, { apiKey, model: settings.model }, parsed.parts);
  } catch (err) {
    setStatus(`Outline failed: ${describeApiError(err)}`, "error");
    return;
  }
  if (!outline) {
    setStatus("The model could not outline this into parts — try rephrasing, or drop #playlist.", "error");
    return;
  }
  if (!outline.title) outline.title = parsed.clean;
  // Parts depend only on the outline (bridging uses outline titles, not each
  // other's specs), so they generate in parallel: N parts in ~one part's time.
  const n = outline.parts.length;
  let finished = 0;
  setStatus(`Generating ${n} parts in parallel (${settings.model})…`);
  const outcomes = await Promise.all(
    outline.parts.map((part, i) =>
      generateSpec(buildPartRequest(parsed.clean, outline, i, brief), {
        apiKey,
        model: settings.model,
        variant: currentVariant(),
        exemplars: usableExemplars(loadExemplars(), isReadyTemplate),
        bundledExemplars: bundledExemplarPool(),
        forcedTemplate,
        priorityIds,
      }).then((outcome) => {
        finished++;
        setStatus(`Generating ${n} parts in parallel — ${finished}/${n} done…`);
        logOutcome(`${rawRequest} [part ${i + 1}: ${part.title}]`, outcome);
        return outcome;
      }),
    ),
  );
  const specs: Spec[] = [];
  const failedParts: number[] = [];
  outcomes.forEach((outcome, i) => {
    if (!outcome.spec) {
      failedParts.push(i + 1);
      return;
    }
    outcome.spec.title ??= outline.parts[i].title;
    outcome.spec.level ??= outline.parts[i].level ?? parsed.level ?? undefined;
    specs.push(outcome.spec);
  });
  if (specs.length === 0) {
    setStatus(`Every part failed: ${outcomes[0]?.error ?? "no spec"}`, "error");
    return;
  }
  const playlist: Playlist = {
    meta: { ...DEFAULT_META, title: outline.title },
    entries: specs.map((spec) => ({ kind: "item", spec })),
    warnings: [],
  };
  setDoc(
    { id: null, driveFileId: null, title: outline.title, prompt: rawRequest, playlist },
    failedParts.length > 0
      ? `Generated ${specs.length}/${n} parts (part${failedParts.length > 1 ? "s" : ""} ${failedParts.join(", ")} failed).`
      : `Generated a ${specs.length}-part drawcast.`,
    { label: rawRequest, kind: "generate" },
  );
  autosave();
}

const BLANK_SPEC: Spec = {
  title: "Untitled drawcast",
  domain: { x: [0, 100], y: [0, 100] },
  elements: [
    { id: "ax", type: "axes", x_label: "x", y_label: "y" },
    { id: "curve1", type: "curve", expr: "80 - 0.6*x" },
    { id: "label1", type: "label", text: "A curve", attach_to: "curve1", side: "above-right" },
  ],
  commands: [
    { speak: "Start with a pair of axes." },
    { draw: ["ax"] },
    { speak: "Then draw a curve and label it." },
    { draw: ["curve1", "label1"] },
  ],
};

generateBtn.addEventListener("click", () => void generate());
// A new drawcast is a clean slate on both sides: the request box empties too
// (setDoc keeps the old text when the incoming doc has no prompt of its own).
blankBtn.addEventListener("click", () => {
  if (blockedByAi("starting a new drawcast")) return;
  promptEl.value = "";
  refreshChips();
  clearLint();
  setDoc(
    { id: null, driveFileId: null, title: "Untitled drawcast", prompt: "", playlist: singlePlaylist(JSON.parse(JSON.stringify(BLANK_SPEC)) as Spec) },
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
      setDoc({ id: null, driveFileId: null, title: docTitleOf(playlist, ex.title ?? ex.request), prompt: ex.request, playlist }, "Example loaded.");
    } catch (err) {
      setStatus(`Example failed to parse: ${(err as Error).message}`, "error");
    }
    return;
  }
  if (ex.spec) setDoc({ id: null, driveFileId: null, title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) }, "Example loaded.");
}

rerenderBtn.addEventListener("click", () => {
  const playlist = readPlaylistText(specArea.value);
  if (!playlist) return;
  // Same document, edited in place — carry the id forward so autosave() below
  // replaces this entry instead of minting a second one (copy-on-write).
  doc = { id: doc.id, driveFileId: doc.driveFileId, title: docTitleOf(playlist, doc.title), prompt: doc.prompt, playlist };
  if (!restoring) stack = pushManualEdit(stack, specArea.value, new Date().toISOString());
  applyHistoryUi();
  setStatus("Re-rendered from edited spec.", "ok");
  void present();
  autosave();
});

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
  const u = currentUser();
  accountRow.textContent = u ? `☁ ${u.email} — sign out` : "☁ Sign in with Google";
  accountRow.hidden = !googleConfigured();
}

async function toggleAccount(): Promise<void> {
  if (currentUser()) {
    signOut();
    setStatus("Signed out of Google.", "ok");
  } else {
    const token = await requireScope(DRIVE_SCOPE);
    setStatus(token ? "Signed in to Google." : "Google sign-in was cancelled.", token ? "ok" : "error");
  }
  refreshAccountRow();
}

// ---------- library ----------

function refreshLibrary(): void {
  libraryList.replaceChildren();
  const all = loadLibrary(); // newest first: saveDrawing unshifts
  const items = all.filter((i) => matchesFilter(i.title));
  if (items.length === 0) {
    libraryList.appendChild(h("div", { class: "hint" }, all.length === 0 ? "Nothing saved yet." : "No match."));
    return;
  }
  for (const item of items) {
    const label = item.playlist ? `${item.title} ▤` : item.title;
    const openBtn = h("button", { class: "library-open", title: item.playlist ? "Load this playlist" : "Load this drawing" }, label);
    openBtn.addEventListener("click", () => {
      if (blockedByAi("opening another drawcast")) return;
      setDoc(docFromSaved(item), "Loaded from library.");
    });
    const delBtn = h("button", { class: "library-del", title: "Delete from library" }, "✕");
    delBtn.addEventListener("click", () => {
      deleteDrawing(item.id);
      refreshLibrary();
    });
    libraryList.appendChild(h("div", { class: "library-item" }, openBtn, delBtn));
  }
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
    return;
  }
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
refreshMyTemplates();

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

exportBtn.addEventListener("click", () => {
  const base = doc.title.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
  const format: SpecFormat = isSingle(doc.playlist) ? settings.specFormat : "yaml";
  downloadText(`${base}.${format}`, formatPlaylist(doc.playlist, format));
});

importBtn.addEventListener("click", () => importInput.click());
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
        if (playlist) setDoc({ id: null, driveFileId: null, title: maybe.title ?? file.name, prompt: maybe.prompt, playlist }, "Uploaded.");
        return;
      }
    } catch {
      /* not a saved-drawing object — treat as spec/playlist text */
    }
    const playlist = readPlaylistText(text);
    if (!playlist) return;
    setDoc({ id: null, driveFileId: null, title: docTitleOf(playlist, file.name.replace(/\.(json|ya?ml|txt)$/i, "")), playlist }, "Uploaded.");
  });
});

driveSaveBtn.addEventListener("click", () => void saveToDrive());
async function saveToDrive(): Promise<void> {
  const base = doc.title.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
  driveSaveBtn.disabled = true;
  try {
    setStatus("Saving to Drive…");
    const res = await saveSpec(specArea.value, `${base}.yaml`, doc.driveFileId);
    if (!res) {
      setStatus("Drive sign-in was cancelled — nothing was saved.", "error");
      return;
    }
    doc.driveFileId = res.fileId;
    refreshAccountRow();
    setStatus(`Saved "${base}.yaml" to your Google Drive.`, "ok");
  } catch (err) {
    setStatus(`Drive save failed: ${(err as Error).message}`, "error");
  } finally {
    driveSaveBtn.disabled = false;
  }
}

driveOpenBtn.addEventListener("click", () => void openFromDrive());
async function openFromDrive(): Promise<void> {
  driveOpenBtn.disabled = true;
  try {
    const picked = await openSpec();
    if (!picked) return; // cancelled, or sign-in declined — say nothing
    const playlist = readPlaylistText(picked.text);
    if (!playlist) return; // readPlaylistText already reported why
    setDoc({
      id: null, // copy-on-write: opening creates no library entry until you change it
      driveFileId: null, // a NEW Save should not overwrite the file you opened
      title: docTitleOf(playlist, picked.name.replace(/\.(ya?ml|json)$/i, "")),
      prompt: "",
      playlist,
    }, `Opened "${picked.name}" from Drive.`);
    refreshAccountRow();
  } catch (err) {
    setStatus(`Drive open failed: ${(err as Error).message}`, "error");
  } finally {
    driveOpenBtn.disabled = false;
  }
}

formatSel.addEventListener("change", () => {
  const next = formatSel.value as SpecFormat;
  // Convert whatever is in the textarea (possibly with unsaved edits) — don't lose work.
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(specArea.value);
  } catch (err) {
    setStatus(`Fix the spec text before switching format: ${(err as Error).message}`, "error");
    formatSel.value = settings.specFormat;
    return;
  }
  if (next === "json" && !isSingle(playlist)) {
    setStatus("Playlists are YAML-only (a JSON document cannot hold a multi-document stream).", "error");
    formatSel.value = "yaml";
    return;
  }
  specArea.value = formatPlaylist(playlist, next);
  settings.specFormat = next;
  persist();
});

// ---------- video export ----------

const exportCanvas = h("canvas", { class: "export-canvas" }) as HTMLCanvasElement;
const exportStatus = h("div", { class: "hint" });
const exportCloseBtn = h("button", { class: "small" }, "Cancel");
// Offscreen but laid out: path measurement needs rendered geometry.
const exportStage = h("div", { class: "export-offscreen" });
const exportDialog = h("dialog", { class: "export-dialog" });
let exportAbort: AbortController | null = null;
const cancelExport = (): void => {
  exportAbort?.abort();
  exportDialog.close();
};
// No backdrop dismiss here: a stray outside click must not abort a long
// render. ✕ and Cancel both mean "abort the export".
exportDialog.append(
  dialogHead(exportDialog, "🎬 Export video", { backdropCloses: false, onClose: cancelExport }),
  exportStatus,
  exportCanvas,
  h("div", { class: "row" }, exportCloseBtn),
  exportStage,
);
app.appendChild(exportDialog);

exportCloseBtn.addEventListener("click", cancelExport);

/**
 * The specs a video export plays, in order: items with the same title cards a
 * viewer would see, but always auto-advancing — there is no one to click.
 */
function exportSequence(playlist: Playlist): Spec[] {
  const items = itemsOf(playlist);
  const seq: Spec[] = [];
  items.forEach((item, i) => {
    if (i > 0 && playlist.meta.transitions === "auto") {
      const crossing = item.chapter !== items[i - 1].chapter ? item.chapter : undefined;
      seq.push(makeTitleCard({ next: itemTitle(item), chapter: crossing, level: item.spec.level, gate: "auto", gap: playlist.meta.gap }));
    }
    seq.push(item.spec);
  });
  return seq;
}

exportVideoBtn.addEventListener("click", () => void runVideoExport());
async function runVideoExport(): Promise<void> {
  const ttsKey = getTtsKey();
  if (!ttsKey) {
    setStatus("Video export needs a Google Cloud Text-to-Speech API key — add it in Settings.", "error");
    openSettings();
    return;
  }
  const controller = new AbortController();
  exportAbort = controller;
  exportStage.replaceChildren();
  exportCloseBtn.textContent = "Cancel";
  exportStatus.textContent = "Preparing…";
  exportDialog.showModal();
  exportVideoBtn.disabled = true;
  try {
    const blob = await exportVideo(
      exportSequence(doc.playlist),
      { ttsKey, style: settings.style, rate: settings.rate },
      {
        onStatus: (t) => (exportStatus.textContent = t),
        canvas: exportCanvas,
        workbench: exportStage,
        signal: controller.signal,
      },
    );
    const base = doc.title.replace(/[^\wæøå -]+/gi, "").trim() || "drawcast";
    downloadBlob(`${base}.webm`, blob);
    exportStatus.textContent = "Done — the narrated WebM was downloaded. YouTube accepts WebM uploads directly (Studio → Create → Upload).";
    exportCloseBtn.textContent = "Close";
  } catch (err) {
    if (!controller.signal.aborted) {
      exportStatus.textContent = `Export failed: ${(err as Error).message}`;
      exportCloseBtn.textContent = "Close";
    }
  } finally {
    exportStage.replaceChildren();
    exportVideoBtn.disabled = false;
  }
}

// ---------- prompt library ----------

function fileSafe(name: string): string {
  return name.replace(/[^\wæøå -]+/gi, "").trim() || "prompt";
}

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
  downloadText(`${fileSafe(name)}.md`, promptSource.value, "text/markdown");
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

exportPacketBtn.addEventListener("click", () => downloadJson(`drawcast-improvement-packet-${Date.now()}.json`, buildImprovementPacket()));
clearLogsBtn.addEventListener("click", () => {
  clearLogs();
  refreshCounts();
});

// ---------- boot ----------

specArea.value = formatPlaylist(doc.playlist, isSingle(doc.playlist) ? settings.specFormat : "yaml");
stack = seedStack(specArea.value, doc.prompt || doc.title);
applyHistoryUi();
if (doc.prompt) promptEl.value = doc.prompt;
refreshChips();
showMode(settings.uiMode);
