// Local persistence: settings, API key, the drawing library, the exemplar
// library (Loop 2), a custom compiler-prompt override, and generation logs
// that feed the exportable improvement packet (Loop 3).

import { SPEC_VERSION } from "./spec/schema";
import type { Spec } from "./spec/types";
import type { SpecFormat } from "./spec/text";
import type { LintIssue } from "./lint/lint";
import type { RenderStyle } from "./render";

const KEYS = {
  settings: "drawcast.settings.v1",
  logs: "drawcast.logs.v1",
  exemplars: "drawcast.exemplars.v1",
  library: "drawcast.library.v1",
  customPrompt: "drawcast.customPrompt.v1", // legacy single slot; migrated into prompts
  prompts: "drawcast.prompts.v1",
  apiKey: "drawcast.apikey",
  ttsKey: "drawcast.ttskey",
  myTemplates: "drawcast.myTemplates.v1",
  remotePacks: "drawcast.remotePacks.v1",
} as const;

export interface Settings {
  model: string;
  style: RenderStyle;
  /** Prompt variant name, or "custom" for the locally edited prompt. */
  variant: string;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  voiceURI: string | null;
  rate: number;
  muted: boolean;
  /** Theater mode: wide player. */
  theater: boolean;
  /** Use the cloud TTS voices for live playback too (when a TTS key is set). */
  cloudPlayback: boolean;
  uiMode: "player" | "editor";
  /** How the editor presents the spec text (parsing always accepts both). */
  specFormat: SpecFormat;
  /** Domain pack ids (M3) currently enabled — loaded and registered at startup. */
  enabledPacks: string[];
  /** Enabled pack ids whose templates get a full catalog entry (never summarized). */
  priorityPacks: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5",
  style: "clean",
  variant: "v1",
  mode: "narrated",
  speed: 1,
  voiceURI: null,
  rate: 1,
  muted: false,
  theater: false,
  cloudPlayback: true,
  uiMode: "player",
  specFormat: "yaml",
  enabledPacks: [],
  priorityPacks: [],
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    // Always a fresh top-level object — never the literal fallback object —
    // but NOT a deep copy: on the upgrade path (an older stored blob that
    // predates a field DEFAULT_SETTINGS later added, e.g. enabledPacks before
    // M3) `{...fallback, ...parsed}` has no key to overwrite for that field,
    // so the merged object's array/object-valued field is still the exact
    // same reference as fallback's (DEFAULT_SETTINGS' own array instance) —
    // residual aliasing. This is safe only because every caller reassigns
    // rather than mutates such a field in place (main.ts always does
    // `settings.x = [...settings.x, id]` or `.filter(...)`, never
    // `settings.x.push(...)`); a caller that mutated in place would corrupt
    // the shared DEFAULT_SETTINGS object for every future load.
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function loadSettings(): Settings {
  return read(KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
}

export function getApiKey(): string {
  return localStorage.getItem(KEYS.apiKey) || (import.meta.env.VITE_ANTHROPIC_API_KEY ?? "");
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEYS.apiKey, key);
  else localStorage.removeItem(KEYS.apiKey);
}

export function getTtsKey(): string {
  return localStorage.getItem(KEYS.ttsKey) || (import.meta.env.VITE_GOOGLE_TTS_KEY ?? "");
}

export function setTtsKey(key: string): void {
  if (key) localStorage.setItem(KEYS.ttsKey, key);
  else localStorage.removeItem(KEYS.ttsKey);
}

// ---- Drawing library (the user's saved drawcasts) ----

export interface SavedDrawing {
  id: string;
  title: string;
  /** The request that produced it, when AI-generated. */
  prompt?: string;
  /** First item's spec (kept for poster/back-compat; the whole doc when single). */
  spec: Spec;
  /** Multi-part drawcasts: the full playlist as serialized multi-doc YAML. */
  playlist?: string;
  ts: string;
}

export function loadLibrary(): SavedDrawing[] {
  return readArray<SavedDrawing>(KEYS.library);
}

export function saveDrawing(d: SavedDrawing): void {
  const all = loadLibrary().filter((x) => x.id !== d.id);
  all.unshift(d);
  localStorage.setItem(KEYS.library, JSON.stringify(all));
}

export function deleteDrawing(id: string): void {
  localStorage.setItem(KEYS.library, JSON.stringify(loadLibrary().filter((x) => x.id !== id)));
}

// ---- My templates (user-authored TemplateDocs, M2) ----

export interface MyTemplate {
  /** The doc's template id — one entry per id. */
  id: string;
  /** The full template document as YAML (never contains images). */
  yaml: string;
  ts: string;
}

export function loadMyTemplates(): MyTemplate[] {
  return readArray<MyTemplate>(KEYS.myTemplates);
}

export function saveMyTemplate(t: MyTemplate): void {
  const all = loadMyTemplates().filter((x) => x.id !== t.id);
  all.unshift(t);
  localStorage.setItem(KEYS.myTemplates, JSON.stringify(all));
}

export function deleteMyTemplate(id: string): void {
  localStorage.setItem(KEYS.myTemplates, JSON.stringify(loadMyTemplates().filter((x) => x.id !== id)));
}

// ---- Remote packs (M5): pack YAML fetched from a URL, cached locally ----

export interface RemotePackEntry {
  /** Where the pack YAML was fetched from — the entry's key (upsert by url). */
  url: string;
  /** The pack's own id, from its header — captured at save time so
   * unregistering never needs to re-parse the cached YAML. */
  id: string;
  /** The full pack YAML as last fetched (the local cache Refresh updates). */
  yaml: string;
  ts: string;
  enabled: boolean;
}

export function loadRemotePacks(): RemotePackEntry[] {
  return readArray<RemotePackEntry>(KEYS.remotePacks);
}

export function saveRemotePack(e: RemotePackEntry): void {
  const all = loadRemotePacks().filter((x) => x.url !== e.url);
  all.unshift(e);
  localStorage.setItem(KEYS.remotePacks, JSON.stringify(all));
}

export function deleteRemotePack(url: string): void {
  localStorage.setItem(KEYS.remotePacks, JSON.stringify(loadRemotePacks().filter((x) => x.url !== url)));
}

// ---- User prompt library (named compiler-prompt variants, Loop 2's UI) ----

export interface UserPrompt {
  id: string;
  name: string;
  source: string;
  ts: string;
}

export function loadUserPrompts(): UserPrompt[] {
  return readArray<UserPrompt>(KEYS.prompts);
}

/** Insert or update (by id). Newest-edited first. */
export function saveUserPrompt(p: UserPrompt): void {
  const all = loadUserPrompts().filter((x) => x.id !== p.id);
  all.unshift(p);
  localStorage.setItem(KEYS.prompts, JSON.stringify(all));
}

export function deleteUserPrompt(id: string): void {
  localStorage.setItem(KEYS.prompts, JSON.stringify(loadUserPrompts().filter((x) => x.id !== id)));
}

/** One-time migration of the legacy single custom-prompt slot into the library. */
export function migrateLegacyCustomPrompt(): UserPrompt | null {
  const source = localStorage.getItem(KEYS.customPrompt);
  if (source === null) return null;
  const p: UserPrompt = { id: crypto.randomUUID(), name: "custom", source, ts: new Date().toISOString() };
  saveUserPrompt(p);
  localStorage.removeItem(KEYS.customPrompt);
  return p;
}

// ---- Generation log (the improvement packet's raw material) ----

export interface LogRound {
  label: string;
  validationErrors: string[];
  lintCount: number;
  ms: number;
  structuredOutput?: boolean;
}

export interface LogEntry {
  id: string;
  ts: string;
  prompt: string;
  config: {
    model: string;
    promptVariant: string;
    specVersion: string;
  };
  rounds: LogRound[];
  spec: Spec | null;
  lintIssues: Pick<LintIssue, "rule" | "ids" | "message" | "severity">[];
  warnings: string[];
  renderMs?: number;
  error?: string;
  rating?: number;
}

const MAX_LOGS = 300;

export function loadLogs(): LogEntry[] {
  return readArray<LogEntry>(KEYS.logs);
}

export function appendLog(entry: LogEntry): void {
  const logs = loadLogs();
  logs.push(entry);
  while (logs.length > MAX_LOGS) logs.shift();
  try {
    localStorage.setItem(KEYS.logs, JSON.stringify(logs));
  } catch {
    // quota: drop oldest half and retry once
    localStorage.setItem(KEYS.logs, JSON.stringify(logs.slice(Math.floor(logs.length / 2))));
  }
}

export function updateLog(id: string, patch: Partial<LogEntry>): void {
  const logs = loadLogs();
  const idx = logs.findIndex((l) => l.id === id);
  if (idx === -1) return;
  logs[idx] = { ...logs[idx], ...patch };
  localStorage.setItem(KEYS.logs, JSON.stringify(logs));
}

export function clearLogs(): void {
  localStorage.removeItem(KEYS.logs);
}

/** The worst logged generations (lowest rating, most lint, errors), for prompt improvement. */
export function worstLoggedCases(n: number): LogEntry[] {
  return [...loadLogs()]
    .filter((l) => l.rating !== undefined || l.error || l.lintIssues.length > 0)
    .sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0) || b.lintIssues.length - a.lintIssues.length)
    .slice(0, n);
}

// ---- Exemplar library (Loop 2) ----

export interface StoredExemplar {
  prompt: string;
  spec: Spec;
  rating?: number;
  ts: string;
}

export function loadExemplars(): StoredExemplar[] {
  return readArray<StoredExemplar>(KEYS.exemplars);
}

export function addExemplar(ex: StoredExemplar): void {
  const all = loadExemplars();
  all.push(ex);
  localStorage.setItem(KEYS.exemplars, JSON.stringify(all));
}

// ---- Exports ----

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, type = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

/** Loop 3 handoff: the exportable improvement packet for a Claude Code session. */
export function buildImprovementPacket(): object {
  const logs = loadLogs();
  const byFamily: Record<string, { count: number; ratings: number[]; lintRules: Record<string, number> }> = {};
  const untemplatedPrompts: string[] = [];

  for (const log of logs) {
    const family = log.spec?.template ? `template:${log.spec.template}` : "untemplated";
    byFamily[family] ??= { count: 0, ratings: [], lintRules: {} };
    const f = byFamily[family];
    f.count++;
    if (log.rating !== undefined) f.ratings.push(log.rating);
    for (const i of log.lintIssues) f.lintRules[i.rule] = (f.lintRules[i.rule] ?? 0) + 1;
    if (!log.spec?.template && log.spec) untemplatedPrompts.push(log.prompt);
  }

  const worst = [...logs]
    .filter((l) => l.rating !== undefined || l.error)
    .sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0) || b.lintIssues.length - a.lintIssues.length)
    .slice(0, 10)
    .map((l) => ({
      prompt: l.prompt,
      config: l.config,
      spec: l.spec,
      lint: l.lintIssues,
      warnings: l.warnings,
      rounds: l.rounds,
      rating: l.rating,
      error: l.error,
    }));

  return {
    generated_at: new Date().toISOString(),
    app: "drawcast",
    spec_version: SPEC_VERSION,
    stats: {
      total_logged: logs.length,
      by_family: Object.fromEntries(
        Object.entries(byFamily).map(([k, v]) => [
          k,
          {
            count: v.count,
            avg_rating: v.ratings.length ? v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length : null,
            lint_rule_counts: v.lintRules,
          },
        ]),
      ),
      untemplated_prompts: untemplatedPrompts,
    },
    worst_cases: worst,
    handoff_instructions:
      "This packet was exported by drawcast. Feed it to a Claude Code session in the drawcast repo. " +
      "Renderer/layout code lives in src/layout and src/scenes; scene manifests (routing data) in " +
      "src/scenes/*/manifest.json; the compiler prompt in src/llm/prompts/. " +
      "Untemplated prompt clusters above suggest which scene to author next.",
  };
}
