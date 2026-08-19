// drawcast — two modes over one document:
//   Player: a YouTube-like screen that just plays the current drawcast.
//   Editor: create drawings with AI or by hand, load examples and saved work,
//           edit the spec JSON, and change/improve the compiler prompt.

import "./styles.css";
import { render, type RenderHandle, type RenderStyle } from "./render";
import { SpeechManager } from "./render/speech";
import { generateSpec, promptVariants, type PromptVariant } from "./llm/compile";
import { MODELS } from "./llm/client";
import { validateSpec, SPEC_VERSION } from "./spec/schema";
import type { Spec } from "./spec/types";
import { h } from "./ui/dom";
import { attachPlayerControls, type PlaybackPrefs } from "./ui/controls";
import {
  addExemplar,
  appendLog,
  buildImprovementPacket,
  clearLogs,
  deleteDrawing,
  downloadJson,
  getApiKey,
  loadCustomPrompt,
  loadExemplars,
  loadLibrary,
  loadLogs,
  loadSettings,
  saveCustomPrompt,
  saveDrawing,
  saveSettings,
  setApiKey,
  updateLog,
  type LogEntry,
  type SavedDrawing,
} from "./store";
import fewshots from "./llm/prompts/fewshots.json";

const settings = loadSettings();
const speech = new SpeechManager();
speech.setVoice(settings.voiceURI);
speech.setRate(settings.rate);
const variants: PromptVariant[] = promptVariants();
const examples = fewshots as { request: string; spec: Spec }[];

interface Doc {
  title: string;
  prompt?: string;
  spec: Spec;
}

let doc: Doc = initialDoc();
let handle: RenderHandle | null = null;
let lastLogId: string | null = null;

function initialDoc(): Doc {
  const saved = loadLibrary()[0];
  if (saved) return { title: saved.title, prompt: saved.prompt, spec: saved.spec };
  const ex = examples[0];
  return { title: ex.spec.title ?? ex.request, prompt: ex.request, spec: ex.spec };
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

const playerTitle = h("h1", { class: "player-title squiggle" }, doc.title);
const playerHost = h("div", { class: "player-figure" });
const playerWrap = h(
  "div",
  { class: "player-wrap" },
  playerTitle,
  playerHost,
  h("div", { class: "player-hint hint" }, "Click the drawing to play — or switch to the editor to change it."),
);

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

const modelSel = h("select", { title: "Model" });
for (const m of MODELS) modelSel.appendChild(h("option", { value: m.id }, m.label));
modelSel.value = settings.model;

const styleSel = h("select", { title: "Drawing style" });
styleSel.append(h("option", { value: "clean" }, "Clean lines"), h("option", { value: "sketchy" }, "Hand-drawn"));
styleSel.value = settings.style;

// Examples & library panel
const exampleSel = h("select", { title: "Bundled examples" });
examples.forEach((ex, i) => exampleSel.appendChild(h("option", { value: String(i) }, ex.spec.title ?? ex.request)));
const exampleLoadBtn = h("button", { class: "small" }, "Load example");
const saveBtn = h("button", { class: "small" }, "Save to library");
const exportBtn = h("button", { class: "small", title: "Download the current spec as JSON" }, "Download");
const importInput = h("input", { type: "file", accept: ".json", style: "display:none" }) as HTMLInputElement;
const importBtn = h("button", { class: "small" }, "Upload JSON");
const libraryList = h("div", { class: "library-list" });

// Prompt panel (change/improve the compiler prompt)
const variantSel = h("select", { title: "Prompt variant" });
function refreshVariantOptions(): void {
  variantSel.replaceChildren();
  for (const v of variants) variantSel.appendChild(h("option", { value: v.name }, `bundled ${v.name}`));
  if (loadCustomPrompt() !== null) variantSel.appendChild(h("option", { value: "custom" }, "custom (edited)"));
  variantSel.value =
    [...variantSel.options].some((o) => o.value === settings.variant) ? settings.variant : variants[0].name;
}
refreshVariantOptions();
const promptSource = h("textarea", { class: "prompt-source", spellcheck: "false" });
const promptSaveBtn = h("button", { class: "small" }, "Save as custom prompt");
const promptResetBtn = h("button", { class: "small" }, "Discard custom prompt");

function currentVariant(): PromptVariant {
  if (settings.variant === "custom") {
    const source = loadCustomPrompt();
    if (source) return { name: "custom", source };
  }
  return variants.find((v) => v.name === settings.variant) ?? variants[0];
}

function showVariantSource(): void {
  promptSource.value = currentVariant().source;
  promptResetBtn.disabled = loadCustomPrompt() === null;
}
showVariantSource();

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
const specArea = h("textarea", { class: "spec-json", spellcheck: "false", "aria-label": "Spec JSON" });
const rerenderBtn = h("button", { class: "small" }, "Re-render");
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

const editorWrap = h(
  "div",
  { class: "editor-grid" },
  h(
    "div",
    { class: "editor-side" },
    h(
      "section",
      { class: "panel" },
      h("h2", { class: "squiggle" }, "Create"),
      promptEl,
      h("div", { class: "row" }, generateBtn, blankBtn),
      h("div", { class: "row config-row" }, h("label", {}, "Model ", modelSel), h("label", {}, "Style ", styleSel)),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", { class: "squiggle" }, "Examples & library"),
      h("div", { class: "row" }, exampleSel, exampleLoadBtn),
      h("div", { class: "row" }, saveBtn, exportBtn, importBtn, importInput),
      libraryList,
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", { class: "squiggle" }, "Prompt"),
      h("div", { class: "row" }, h("label", {}, "Variant ", variantSel)),
      promptSource,
      h("div", { class: "row" }, promptSaveBtn, promptResetBtn),
      h("div", { class: "hint" }, "The compiler prompt is data. Edit it, save it as the custom variant, and generation uses your version. {{SCHEMA}}, {{CATALOG}}, {{FEWSHOTS}}, {{EXEMPLARS}} are filled in automatically."),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", { class: "squiggle" }, "Data"),
      h("div", { class: "row" }, exemplarCount),
      h("div", { class: "row" }, exportPacketBtn, clearLogsBtn),
    ),
  ),
  h(
    "div",
    { class: "editor-main" },
    statusEl,
    previewHost,
    h(
      "section",
      { class: "panel" },
      h("div", { class: "row" }, h("span", { class: "rating-label" }, "Would use in teaching:"), ratingBox, " ", promoteBtn),
      h("details", { open: "" }, h("summary", {}, "Spec JSON (editable)"), specArea, h("div", { class: "row" }, rerenderBtn)),
      lintBox,
    ),
  ),
);

const main = h("main", {}, playerWrap, editorWrap);
app.appendChild(main);

// ---------- settings dialog ----------

const keyInput = h("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off" }) as HTMLInputElement;
keyInput.value = getApiKey();
const clearKeyBtn = h("button", { class: "small" }, "Clear key");
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
  h("div", { class: "settings-field" }, h("label", {}, "Narration voice"), voiceSel),
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
    onMode: (m) => {
      settings.mode = m;
      persist();
    },
    onSpeed: (s) => {
      settings.speed = s;
      persist();
    },
  };
}

async function present(): Promise<void> {
  const host = settings.uiMode === "player" ? playerHost : previewHost;
  handle?.destroy();
  handle = null;
  host.replaceChildren();
  playerTitle.textContent = doc.title;
  document.title = `${doc.title} — drawcast`;
  try {
    const hd = await render(doc.spec, host, { style: settings.style, speech, mode: settings.mode, speed: settings.speed });
    handle = hd;
    attachPlayerControls(host, hd, playbackPrefs(), (playing) => document.body.classList.toggle("is-playing", playing));
    if (settings.uiMode === "editor") setLint(hd);
  } catch (err) {
    setStatus(`Render failed: ${(err as Error).message}`, "error");
  }
}

function setDoc(next: Doc, statusText?: string): void {
  doc = next;
  lastLogId = null; // ratings apply to generations only
  specArea.value = JSON.stringify(doc.spec, null, 2);
  promptEl.value = doc.prompt ?? promptEl.value;
  ratingButtons.forEach((rb) => rb.classList.remove("lit"));
  promoteBtn.disabled = false;
  promoteBtn.textContent = "☆ Promote to exemplar";
  if (statusText) setStatus(statusText, "ok");
  void present();
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

async function generate(): Promise<void> {
  const request = promptEl.value.trim();
  if (!request) return;
  const apiKey = requireKey();
  if (!apiKey) return;
  generateBtn.disabled = true;
  const logId = crypto.randomUUID();
  setStatus(`Generating (${settings.model}, prompt ${settings.variant})…`);
  try {
    const outcome = await generateSpec(request, {
      apiKey,
      model: settings.model,
      variant: currentVariant(),
      exemplars: loadExemplars(),
    });
    const entry: LogEntry = {
      id: logId,
      ts: new Date().toISOString(),
      prompt: request,
      config: { model: settings.model, promptVariant: settings.variant, specVersion: SPEC_VERSION },
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
    if (!outcome.spec) {
      setStatus(outcome.error ?? "Generation failed.", "error");
      return;
    }
    setDoc(
      { title: outcome.spec.title ?? request, prompt: request, spec: outcome.spec },
      outcome.error ? `Partial: ${outcome.error}` : `Generated in ${outcome.rounds.length} round${outcome.rounds.length === 1 ? "" : "s"}.`,
    );
    lastLogId = logId; // after setDoc, so the rating stars target this generation
  } finally {
    generateBtn.disabled = false;
  }
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
  setDoc({ title: "Untitled drawcast", spec: JSON.parse(JSON.stringify(BLANK_SPEC)) as Spec }, "Blank spec loaded — edit the JSON below.");
});

exampleLoadBtn.addEventListener("click", () => {
  const ex = examples[parseInt(exampleSel.value, 10)] ?? examples[0];
  setDoc({ title: ex.spec.title ?? ex.request, prompt: ex.request, spec: ex.spec }, "Example loaded.");
});

rerenderBtn.addEventListener("click", () => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(specArea.value);
  } catch (err) {
    setStatus(`Spec is not valid JSON: ${(err as Error).message}`, "error");
    return;
  }
  const v = validateSpec(parsed);
  if (!v.ok) {
    setStatus(`Spec invalid: ${v.errors[0]}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ""}`, "error");
    return;
  }
  const spec = parsed as Spec;
  doc = { title: spec.title ?? doc.title, prompt: doc.prompt, spec };
  setStatus("Re-rendered from edited spec.", "ok");
  void present();
});

promoteBtn.addEventListener("click", () => {
  addExemplar({ prompt: doc.prompt ?? doc.title, spec: doc.spec, ts: new Date().toISOString() });
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
    const openBtn = h("button", { class: "library-open", title: "Load this drawing" }, item.title);
    openBtn.addEventListener("click", () => setDoc({ title: item.title, prompt: item.prompt, spec: item.spec }, "Loaded from library."));
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
  const title = doc.spec.title ?? doc.title;
  saveDrawing({ id: crypto.randomUUID(), title, prompt: doc.prompt, spec: doc.spec, ts: new Date().toISOString() });
  refreshLibrary();
  setStatus(`Saved "${title}" to the library (this browser).`, "ok");
});

exportBtn.addEventListener("click", () => {
  downloadJson(`${(doc.spec.title ?? "drawcast").replace(/[^\wæøå -]+/gi, "").trim() || "drawcast"}.json`, doc.spec);
});

importBtn.addEventListener("click", () => importInput.click());
importInput.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    importInput.value = "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setStatus(`Not valid JSON: ${(err as Error).message}`, "error");
      return;
    }
    // Accept either a bare spec or a saved-drawing object.
    const maybe = parsed as Partial<SavedDrawing> & Partial<Spec>;
    const spec = (maybe.spec ?? parsed) as unknown;
    const v = validateSpec(spec);
    if (!v.ok) {
      setStatus(`Spec invalid: ${v.errors[0]}`, "error");
      return;
    }
    const s = spec as Spec;
    setDoc({ title: s.title ?? maybe.title ?? file.name.replace(/\.json$/i, ""), prompt: maybe.prompt, spec: s }, "Uploaded.");
  });
});

// ---------- prompt panel ----------

variantSel.addEventListener("change", () => {
  settings.variant = variantSel.value;
  persist();
  showVariantSource();
});

promptSaveBtn.addEventListener("click", () => {
  saveCustomPrompt(promptSource.value);
  settings.variant = "custom";
  persist();
  refreshVariantOptions();
  showVariantSource();
  setStatus("Custom prompt saved — generation now uses it.", "ok");
});

promptResetBtn.addEventListener("click", () => {
  saveCustomPrompt(null);
  if (settings.variant === "custom") settings.variant = variants[0].name;
  persist();
  refreshVariantOptions();
  showVariantSource();
  setStatus("Custom prompt discarded — back to the bundled prompt.", "ok");
});

// ---------- settings + misc wiring ----------

keyInput.addEventListener("change", () => setApiKey(keyInput.value.trim()));
clearKeyBtn.addEventListener("click", () => {
  setApiKey("");
  keyInput.value = "";
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

specArea.value = JSON.stringify(doc.spec, null, 2);
if (doc.prompt) promptEl.value = doc.prompt;
showMode(settings.uiMode);
