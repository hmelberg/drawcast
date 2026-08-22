// drawcast — two modes over one document:
//   Player: a YouTube-like screen that just plays the current drawcast.
//   Editor: create drawings with AI or by hand, load examples and saved work,
//           edit the spec JSON, and change/improve the compiler prompt.

import "./styles.css";
import { type RenderHandle, type RenderStyle } from "./render";
import { generateOutline, generateSpec, improvePrompt, promptVariants, type ImproveCase, type PromptVariant } from "./llm/compile";
import { buildPartRequest } from "./llm/outline";
import { missingPlaceholders } from "./llm/prompt";
import { buildBrief, parseTags, suggestTags, TAGS, type ParsedTags } from "./llm/tags";
import { MODELS, describeApiError } from "./llm/client";
import { generateTemplate, type AuthorImage, type AuthorOutcome } from "./llm/author";
import { registerMyTemplatesAtStartup, registerUserTemplateYaml, unregisterUserTemplate } from "./scenes/my-templates";
import { PACK_DEFS, ensureEnabledPacks, packTemplateIds, parsePack, unregisterPack } from "./scenes/packs";
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
  updateLog,
  worstLoggedCases,
  type LogEntry,
  type SavedDrawing,
  type UserPrompt,
} from "./store";
import fewshots from "./llm/prompts/fewshots.json";

const settings = loadSettings();
// Cloud voices for live playback when a TTS key is set (and the toggle is on);
// falls back to the browser's speechSynthesis otherwise, per line.
const speech = new CloudSpeech(() => (settings.cloudPlayback ? getTtsKey() : ""));
speech.setVoice(settings.voiceURI);
speech.setRate(settings.rate);
const variants: PromptVariant[] = promptVariants();
const examples = fewshots as { request: string; spec: Spec }[];

interface Doc {
  title: string;
  prompt?: string;
  playlist: Playlist;
}

let doc: Doc = initialDoc();
let session: SessionHandle | null = null;
let lastLogId: string | null = null;

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
void ensureEnabledPacks(settings.enabledPacks).then((rs) => {
  let changed = false;
  const failed: string[] = [];
  for (const r of rs) {
    if (r.ok) continue;
    console.warn(`pack "${r.id}" failed:`, r.errors.join("; "));
    failed.push(`"${r.id}" (${r.errors.join("; ")})`);
    if (!r.retriable && settings.enabledPacks.includes(r.id)) {
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
      return { title: saved.title, prompt: saved.prompt, playlist: parsePlaylistText(saved.playlist) };
    } catch {
      /* fall through to the single spec */
    }
  }
  return { title: saved.title, prompt: saved.prompt, playlist: singlePlaylist(saved.spec) };
}

function initialDoc(): Doc {
  const saved = loadLibrary()[0];
  if (saved) return docFromSaved(saved);
  const ex = examples[0];
  return { title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) };
}

const app = document.getElementById("app")!;

// ---------- topbar with the mode toggle ----------

const playerModeBtn = h("button", { class: "mode-btn", title: "Watch the current drawcast" }, "▶ Player");
const editorModeBtn = h("button", { class: "mode-btn", title: "Create and edit drawcasts" }, "✎ Editor");
const settingsBtn = h("button", { class: "mode-btn", title: "Settings" }, "⚙");

app.appendChild(
  h(
    "header",
    { class: "topbar" },
    h("div", { class: "wordmark squiggle" }, "drawcast"),
    h("div", { class: "mode-toggle" }, playerModeBtn, editorModeBtn),
    settingsBtn,
  ),
);

// ---------- player mode ----------

// YouTube-like: the video first, the title below it.
const playerTitle = h("h1", { class: "player-title squiggle" }, doc.title);
const playerHost = h("div", { class: "player-figure" });
const playerWrap = h(
  "div",
  { class: "player-wrap" },
  playerHost,
  playerTitle,
  h("div", { class: "player-hint hint" }, "Click the drawing to play."),
);

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
const blankBtn = h("button", { title: "Start from a minimal hand-editable spec" }, "New blank");

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

// The model choice lives ON the send button (split button): the speed/quality
// decision happens where generation starts. Repairs always run on a fast model.
const modelSel = h("select", { class: "gen-model", title: "Model for generation. Repair rounds always use a fast model." });
for (const m of MODELS) modelSel.appendChild(h("option", { value: m.id }, m.label));
modelSel.value = settings.model;
if (!modelSel.value) modelSel.value = MODELS[0].id;

const styleSel = h("select", { title: "Drawing style" });
styleSel.append(h("option", { value: "clean" }, "Clean lines"), h("option", { value: "sketchy" }, "Hand-drawn"));
styleSel.value = settings.style;

// Toolbar template picker (M3): "Auto" lets the AI pick; a specific choice
// (or a #template= tag, which wins) forces it. Ready templates only — a
// stub can't render.
const templateSel = h("select", { class: "cs-bar-select", title: "Force a template (Auto lets the AI choose; #template= in the request overrides this)" });
function refreshTemplatePicker(): void {
  const current = templateSel.value;
  templateSel.replaceChildren(h("option", { value: "" }, "Template: Auto"));
  for (const id of Object.keys(scenes).sort((a, b) => a.localeCompare(b))) {
    if (isReadyTemplate(id)) templateSel.appendChild(h("option", { value: id }, id));
  }
  if ([...templateSel.options].some((o) => o.value === current)) templateSel.value = current;
}
refreshTemplatePicker();

// Examples & library panel
const exampleSel = h("select", { title: "Bundled examples" });
examples.forEach((ex, i) => exampleSel.appendChild(h("option", { value: String(i) }, ex.spec.title ?? ex.request)));
const exampleLoadBtn = h("button", { class: "small" }, "Load example");
const saveBtn = h("button", { class: "small" }, "Save to library");
const exportBtn = h("button", { class: "small", title: "Download the current spec as JSON" }, "Download");
const importInput = h("input", { type: "file", accept: ".json,.yaml,.yml,.txt", style: "display:none" }) as HTMLInputElement;
const importBtn = h("button", { class: "small" }, "Upload spec");
const exportVideoBtn = h(
  "button",
  { class: "small", title: "Record the drawcast as a narrated WebM video (needs a Google Cloud TTS key in Settings). YouTube accepts WebM directly." },
  "Export video",
);
// openAuthorDialog is defined later (template-authoring section, ./llm/author) —
// a hoisted function declaration, so this early reference is safe.
const newTemplateBtn = h("button", { title: "Create a reusable template with AI (describe it, optionally paste an image)" }, "✦ New template");
newTemplateBtn.addEventListener("click", () => openAuthorDialog());
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

const variantSel = h("select", { title: "Active compiler prompt (used by Generate)" });
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
const rerenderBtn = h("button", { class: "small" }, "Re-render");
const formatSel = h("select", { class: "cs-bar-select", title: "Spec text format (parsing accepts both)" });
formatSel.append(h("option", { value: "yaml" }, "YAML"), h("option", { value: "json" }, "JSON"));
formatSel.value = settings.specFormat;
const lintBox = h("div", {});

const ratingBox = h("span", { class: "rating" });
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
const promoteBtn = h("button", { class: "small", title: "Store (request, spec) as a few-shot exemplar for future generations" }, "☆ Promote to exemplar");

// Editor: an xplainer-style workbench — one compact toolbar, then the spec
// text and the live preview side by side. Everything secondary collapses.
const editorWrap = h(
  "div",
  { class: "editor-wrap" },
  h(
    "div",
    { class: "panel editor-toolbar" },
    h("div", { class: "row prompt-row" }, promptEl, h("div", { class: "gen-split" }, generateBtn, modelSel), tagSuggest),
    tagChips,
    h(
      "div",
      { class: "row toolbar-row" },
      exampleSel,
      exampleLoadBtn,
      blankBtn,
      h("span", { class: "toolbar-sep" }),
      saveBtn,
      exportBtn,
      importBtn,
      importInput,
      exportVideoBtn,
      newTemplateBtn,
      h("span", { class: "toolbar-sep" }),
      h("label", { class: "toolbar-label" }, "Style ", styleSel),
      templateSel,
    ),
  ),
  statusEl,
  h(
    "div",
    { class: "editor-split" },
    h("div", { class: "panel editor-code" }, specArea, h("div", { class: "row" }, rerenderBtn, formatSel)),
    h(
      "div",
      { class: "editor-preview" },
      previewHost,
      h("div", { class: "row" }, h("span", { class: "rating-label" }, "Would use in teaching:"), ratingBox, " ", promoteBtn),
      lintBox,
    ),
  ),
  h("details", { class: "panel editor-extra" }, h("summary", {}, "Library"), libraryList),
  h(
    "details",
    { class: "panel editor-extra" },
    h("summary", {}, "My templates"),
    h("div", { class: "row" }, myTplImportBtn, myTplImportInput),
    myTemplatesList,
  ),
  h(
    "details",
    { class: "panel editor-extra" },
    h("summary", {}, "Template packs"),
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
  h(
    "details",
    { class: "panel editor-extra" },
    h("summary", {}, "Prompt"),
    h("div", { class: "row" }, h("label", {}, "Active ", variantSel)),
    promptSource,
    h("div", { class: "row" }, promptSaveBtn, promptRenameBtn, promptCopyBtn, promptDeleteBtn),
    h("div", { class: "row" }, promptDownloadBtn, promptUploadBtn, promptUploadInput, promptImproveBtn),
    promptHint,
  ),
  h(
    "details",
    { class: "panel editor-extra" },
    h("summary", {}, "Data"),
    h("div", { class: "row" }, exemplarCount),
    h("div", { class: "row" }, exportPacketBtn, clearLogsBtn),
  ),
);

const main = h("main", {}, playerWrap, editorWrap);
app.appendChild(main);

// ---------- settings dialog ----------

const keyInput = h("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off" }) as HTMLInputElement;
keyInput.value = getApiKey();
const clearKeyBtn = h("button", { class: "small" }, "Clear key");
const ttsKeyInput = h("input", { type: "password", placeholder: "AIza…", autocomplete: "off" }) as HTMLInputElement;
ttsKeyInput.value = getTtsKey();
const clearTtsKeyBtn = h("button", { class: "small" }, "Clear key");
const cloudPlaybackCb = h("input", { type: "checkbox" }) as HTMLInputElement;
cloudPlaybackCb.checked = settings.cloudPlayback;
const voiceSel = h("select", {});
const rateSel = h("select", {});
for (const r of ["0.8", "0.9", "1", "1.1", "1.25"]) rateSel.appendChild(h("option", { value: r }, `${r}×`));
rateSel.value = String(settings.rate);

const dialog = h(
  "dialog",
  {},
  h("h3", {}, "Settings"),
  h(
    "div",
    { class: "settings-field" },
    h("label", {}, "Anthropic API key (bring your own)"),
    keyInput,
    h("div", {}, clearKeyBtn),
    h("div", { class: "settings-note" }, "Stored in this browser's localStorage only. It never leaves the browser except in requests to api.anthropic.com."),
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
  h("div", {}, h("button", { class: "primary small" }, "Close")),
);
app.appendChild(dialog);
dialog.querySelector("button.primary")!.addEventListener("click", () => dialog.close());

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
const authorCloseBtn = h("button", {}, "Close");

const authorDialog = h(
  "dialog",
  { class: "author-dialog" },
  h("h3", {}, "New template"),
  authorDescEl,
  h("div", { class: "row" }, authorDrop, authorImgInput, authorImgThumb, authorImgClear),
  h("div", { class: "row" }, authorGenBtn, authorCloseBtn),
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
  (authorDialog.querySelector("h3") as HTMLElement).textContent = authorImproveId ? `Improve template: ${authorImproveId}` : "New template";
  authorDialog.showModal();
}

authorCloseBtn.addEventListener("click", () => authorDialog.close());

// The dialog's native "close" event fires for BOTH the Close button (via
// .close() above) and ESC (the browser's own cancel→close, which bypasses any
// click handler entirely) — so all cleanup lives here, not on authorCloseBtn.
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
  playerTitle.textContent = doc.title;
  document.title = `${doc.title} — drawcast`;
  try {
    // Warm the cloud-voice cache so narrated playback starts without stalls.
    if (settings.mode === "narrated") speech.prefetch(playlistSpeakTexts(doc.playlist), settings.speed);
    // The editor/player switch lives in the control bar too, YouTube-style.
    const switchBtn = h(
      "button",
      { class: "cs-bar-btn", title: isPlayer ? "Open the editor" : "Watch in the player" },
      isPlayer ? "✎" : "▶ Player",
    );
    switchBtn.addEventListener("click", () => showMode(isPlayer ? "editor" : "player"));
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
        trailing: [switchBtn],
      },
      onItemMounted: (hd) => {
        if (!isPlayer) setLint(hd);
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

function setDoc(next: Doc, statusText?: string): void {
  doc = next;
  lastLogId = null; // ratings apply to generations only
  specArea.value = formatPlaylist(doc.playlist, settings.specFormat);
  promptEl.value = doc.prompt ?? promptEl.value;
  refreshChips();
  ratingButtons.forEach((rb) => rb.classList.remove("lit"));
  // Exemplars are (request, single spec) pairs — a multi-part doc has no such pair.
  promoteBtn.disabled = !isSingle(doc.playlist);
  promoteBtn.textContent = "☆ Promote to exemplar";
  if (statusText) setStatus(statusText, "ok");
  void present();
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

function setLint(hd: RenderHandle): void {
  lintBox.replaceChildren();
  const issues = hd.layout.issues;
  const warnings = [...hd.layout.warnings, ...hd.plan.warnings];
  if (issues.length === 0 && warnings.length === 0) {
    lintBox.appendChild(h("div", { class: "lint-clean" }, "Lint clean ✓"));
    return;
  }
  const ul = h("ul", { class: "lint-list" });
  for (const i of issues) ul.appendChild(h("li", { class: i.severity }, `${i.rule}: ${i.message}`));
  for (const w of warnings) ul.appendChild(h("li", {}, w));
  lintBox.appendChild(ul);
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
settingsBtn.addEventListener("click", () => dialog.showModal());

// ---------- editor actions ----------

function requireKey(): string | null {
  const key = getApiKey();
  if (!key) {
    setStatus("Add your Anthropic API key in Settings to generate with AI. Everything else works without one.", "error");
    dialog.showModal();
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
  const forcedTemplate = parsed.template ?? (templateSel.value || undefined);
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
  generateBtn.disabled = true;
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
      exemplars: loadExemplars(),
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
      { title: outcome.spec.title ?? parsed.clean, prompt: rawRequest, playlist: singlePlaylist(outcome.spec) },
      outcome.error ? `Partial: ${outcome.error}` : `Generated in ${outcome.rounds.length} round${outcome.rounds.length === 1 ? "" : "s"}.`,
    );
    lastLogId = logId; // after setDoc, so the rating stars target this generation
  } finally {
    generateBtn.disabled = false;
  }
}

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
        exemplars: loadExemplars(),
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
    { title: outline.title, prompt: rawRequest, playlist },
    failedParts.length > 0
      ? `Generated ${specs.length}/${n} parts (part${failedParts.length > 1 ? "s" : ""} ${failedParts.join(", ")} failed).`
      : `Generated a ${specs.length}-part drawcast.`,
  );
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
blankBtn.addEventListener("click", () => {
  setDoc(
    { title: "Untitled drawcast", playlist: singlePlaylist(JSON.parse(JSON.stringify(BLANK_SPEC)) as Spec) },
    "Blank spec loaded — edit the JSON below.",
  );
});

exampleLoadBtn.addEventListener("click", () => {
  const ex = examples[parseInt(exampleSel.value, 10)] ?? examples[0];
  setDoc({ title: ex.spec.title ?? ex.request, prompt: ex.request, playlist: singlePlaylist(ex.spec) }, "Example loaded.");
});

rerenderBtn.addEventListener("click", () => {
  const playlist = readPlaylistText(specArea.value);
  if (!playlist) return;
  doc = { title: docTitleOf(playlist, doc.title), prompt: doc.prompt, playlist };
  setStatus("Re-rendered from edited spec.", "ok");
  void present();
});

promoteBtn.addEventListener("click", () => {
  addExemplar({ prompt: doc.prompt ?? doc.title, spec: firstSpec(doc), ts: new Date().toISOString() });
  promoteBtn.textContent = "★ Promoted";
  promoteBtn.disabled = true;
  refreshCounts();
});

// ---------- library ----------

function refreshLibrary(): void {
  libraryList.replaceChildren();
  const items = loadLibrary();
  if (items.length === 0) {
    libraryList.appendChild(h("div", { class: "hint" }, "Nothing saved yet."));
    return;
  }
  for (const item of items) {
    const label = item.playlist ? `${item.title} ▤` : item.title;
    const openBtn = h("button", { class: "library-open", title: item.playlist ? "Load this playlist" : "Load this drawing" }, label);
    openBtn.addEventListener("click", () => setDoc(docFromSaved(item), "Loaded from library."));
    const delBtn = h("button", { class: "library-del", title: "Delete from library" }, "✕");
    delBtn.addEventListener("click", () => {
      deleteDrawing(item.id);
      refreshLibrary();
    });
    libraryList.appendChild(h("div", { class: "library-item" }, openBtn, delBtn));
  }
}
refreshLibrary();

saveBtn.addEventListener("click", () => {
  const title = doc.title;
  saveDrawing({
    id: crypto.randomUUID(),
    title,
    prompt: doc.prompt,
    spec: firstSpec(doc),
    playlist: isSingle(doc.playlist) ? undefined : formatPlaylist(doc.playlist, "yaml"),
    ts: new Date().toISOString(),
  });
  refreshLibrary();
  setStatus(`Saved "${title}" to the library (this browser).`, "ok");
});

// ---------- my templates ----------

myTplImportBtn.addEventListener("click", () => myTplImportInput.click());
myTplImportInput.addEventListener("change", () => {
  const file = myTplImportInput.files?.[0];
  if (!file) return;
  void file.text().then((yaml) => {
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
// Trust is derived from the URL itself (isOfficialPackUrl — the
// raw.githubusercontent.com/hmelberg/drawcast-templates/ prefix), never from
// "this URL happened to be listed in the index". An index entry is just a
// pointer the app fetched from an unauthenticated host; if it doesn't
// actually point under the official prefix, Add routes through the exact
// same confirm() gate a pasted custom URL gets — it is de-privileged, not
// refused outright.

/** The brief's exact risk text — used verbatim by BOTH gates below (the
 * custom-URL Load button, and Add on a non-official index entry). */
function confirmRemotePackLoad(url: string): boolean {
  return confirm(
    `This pack's templates contain JavaScript that will run in your browser when drawing. Only load packs from sources you trust. Load "${url}"?`,
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
    return;
  }
  const r = registerRemotePackYaml(url, yaml);
  if (!r.ok) {
    setStatus(`Pack failed to load: ${r.errors.join("; ")}`, "error");
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
    // A saved-drawing JSON export ({title, spec, …}) still opens: unwrap it first.
    try {
      const maybe = JSON.parse(text) as Partial<SavedDrawing>;
      if (maybe && typeof maybe === "object" && maybe.spec) {
        const inner = maybe.playlist ?? JSON.stringify(maybe.spec);
        const playlist = readPlaylistText(inner);
        if (playlist) setDoc({ title: maybe.title ?? file.name, prompt: maybe.prompt, playlist }, "Uploaded.");
        return;
      }
    } catch {
      /* not a saved-drawing object — treat as spec/playlist text */
    }
    const playlist = readPlaylistText(text);
    if (!playlist) return;
    setDoc({ title: docTitleOf(playlist, file.name.replace(/\.(json|ya?ml|txt)$/i, "")), playlist }, "Uploaded.");
  });
});

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
const exportDialog = h(
  "dialog",
  { class: "export-dialog" },
  h("h3", {}, "Export video"),
  exportStatus,
  exportCanvas,
  h("div", { class: "row" }, exportCloseBtn),
  exportStage,
);
app.appendChild(exportDialog);

let exportAbort: AbortController | null = null;
exportCloseBtn.addEventListener("click", () => {
  exportAbort?.abort();
  exportDialog.close();
});

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
    dialog.showModal();
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
  settings.variant = variantSel.value;
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

promptCopyBtn.addEventListener("click", () => {
  const up = activeUserPrompt();
  const name = up ? `${up.name} copy` : `${settings.variant} copy`;
  const p: UserPrompt = { id: crypto.randomUUID(), name, source: promptSource.value, ts: new Date().toISOString() };
  saveUserPrompt(p);
  selectUserPrompt(p);
  setStatus(`Created "${name}" — now the active prompt, edit away.`, "ok");
});

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

keyInput.addEventListener("change", () => setApiKey(keyInput.value.trim()));
clearKeyBtn.addEventListener("click", () => {
  setApiKey("");
  keyInput.value = "";
});
ttsKeyInput.addEventListener("change", () => setTtsKey(ttsKeyInput.value.trim()));
cloudPlaybackCb.addEventListener("change", () => {
  settings.cloudPlayback = cloudPlaybackCb.checked;
  persist();
});
clearTtsKeyBtn.addEventListener("click", () => {
  setTtsKey("");
  ttsKeyInput.value = "";
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
if (doc.prompt) promptEl.value = doc.prompt;
refreshChips();
showMode(settings.uiMode);
