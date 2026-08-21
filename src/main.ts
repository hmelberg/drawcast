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
  loadSettings,
  loadUserPrompts,
  migrateLegacyCustomPrompt,
  saveDrawing,
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
  // parts=N keeps the caret after the '=' so the number can be typed.
  const insert = tag === "parts=N" ? "#parts=" : `#${tag} `;
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
const libraryList = h("div", { class: "library-list" });

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
      h("span", { class: "toolbar-sep" }),
      h("label", { class: "toolbar-label" }, "Style ", styleSel),
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

async function present(): Promise<void> {
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
    session = await mountPlaylist(host, doc.playlist, {
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
  const apiKey = requireKey();
  if (!apiKey) return;
  const parsed = parseTags(rawRequest);
  if (!parsed.clean) {
    setStatus("The request is only tags — add what to draw.", "error");
    return;
  }
  const brief = buildBrief(parsed.tags);
  generateBtn.disabled = true;
  try {
    if (parsed.playlist) {
      await generateMulti(rawRequest, parsed, brief, apiKey);
      return;
    }
    setStatus(`Generating (${settings.model}, prompt ${currentVariant().name})…`);
    const outcome = await generateSpec(parsed.clean, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      exemplars: loadExemplars(),
      brief,
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
async function generateMulti(rawRequest: string, parsed: ParsedTags, brief: string, apiKey: string): Promise<void> {
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
