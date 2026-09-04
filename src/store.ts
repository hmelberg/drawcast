// Local persistence: settings, API key, the drawing library, the exemplar
// library (Loop 2), a custom compiler-prompt override, and generation logs
// that feed the exportable improvement packet (Loop 3).

import type { TextFamily } from "./layout/text-style";
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
  courses: "drawcast.courses.v1",
  customPrompt: "drawcast.customPrompt.v1", // legacy single slot; migrated into prompts
  prompts: "drawcast.prompts.v1",
  styles: "drawcast.styles.v1",
  apiKey: "drawcast.apikey",
  ttsKey: "drawcast.ttskey",
  githubToken: "drawcast.githubtoken",
  authorKey: "drawcast.authorkey",
  myTemplates: "drawcast.myTemplates.v1",
  remotePacks: "drawcast.remotePacks.v1",
  vendedKeys: "drawcast.vendedKeys.v1",
  // v2 on 2026-08-27: one-shot reset of the soft-cap ledger — a month of
  // sound-feature testing burned the 250k vended-TTS allowance and silently
  // dropped playback to the browser voice. Stale v1 ledgers are simply orphaned.
  usage: "drawcast.usage.v2",
  // One-shot flag, see loadSettings. Bumped to v2 on 2026-08-25: the default
  // pack set grew again (economics/evidence/mathlogic joined
  // physics/chemistry/biology), and browsers that already ran the v1 upgrade
  // have the v1 key set, so the v1 flag alone would never let them see this
  // second union. Re-running the union under a new flag is safe — it only
  // ever adds ids, riding along any pack the user enabled themselves or that
  // came from a remote source, and a pack the user deliberately turned off
  // gets re-enabled once (accepted: no back-compat guarantee here, see
  // feedback_no_backwards_compat).
  packsUpgrade: "drawcast.packsDefault.v7",
} as const;

/** Where Share last sent this document. Declared here rather than in the UI:
 *  store.ts is imported by the standalone viewer and must stay UI-free.
 *  "spec" is gone — downloading your own source is a save, not a share
 *  (spec §1), and now lives in Save → To disk. "drive" is the second PUBLISH
 *  destination (spec §7) — a finished file in the author's own Drive, not a
 *  link the app hands out. */
export type ShareTo = "link" | "youtube" | "video" | "drive";

/**
 * A settings blob written before the source download moved out of Share can
 * still name "spec" as its remembered destination — that member no longer
 * exists, and Share would open on nothing. Anything else unrecognised falls
 * back to "link" too, rather than trusting an arbitrary stored string.
 *
 * Every destination Share can remember has to be named here: Share writes
 * `shareTo` on each rail click, so a member missing from this list would be
 * written happily and then silently downgraded to "link" on the next load.
 */
export function migrateShareTo(v: string): ShareTo {
  return v === "youtube" || v === "video" || v === "drive" ? v : "link";
}

export interface Settings {
  model: string;
  style: RenderStyle;
  /** Viewer's text size in the player — a base size (22/32/38), or null to follow the drawcast. */
  textSize: number | null;
  /** Viewer's font in the player — a CSS generic family, or null to follow the drawcast. */
  textFamily: TextFamily | null;
  /** Prompt variant name, or "custom" for the locally edited prompt. */
  variant: string;
  /** The active style profile (B5) — null means no addendum. */
  activeStyleId: string | null;
  /** Per-language cloud narration voice (B12): language code → Google voice
   *  name. A language not listed uses the built-in default chain. */
  cloudVoices: Record<string, string>;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  voiceURI: string | null;
  rate: number;
  muted: boolean;
  /** Theater mode: wide player. */
  theater: boolean;
  /** Use the cloud TTS voices for live playback too (when a TTS key is set). */
  cloudPlayback: boolean;
  /** Skip quiz/ask questions in playback and exports. */
  skipQuestions: boolean;
  /**
   * Subtitles (CC) on the picture. On by default: a drawcast in silent mode
   * has nothing BUT the caption, and in narrated mode the caption is what the
   * narrator is saying — turning it off is a choice, not a default.
   */
  captionsOn: boolean;
  /**
   * Which subtitle track to show, as a language code. Remembered across
   * drawcasts: someone who reads Norwegian reads it in the next one too. A
   * drawcast without a track for it simply shows its own language.
   */
  captionLang: string;
  /**
   * Paint the caption into the DOWNLOADED video. On by default: a file handed
   * to someone has no subtitle layer, and a loose .vtt beside it gets lost.
   * The DOWNLOAD is the only destination this asks about — a YouTube upload
   * never burns in (spec §2 ruling 4): YouTube has a subtitle layer and shows
   * its own captions over the picture, so a burnt-in upload says everything
   * twice.
   */
  burnCaptions: boolean;
  uiMode: "player" | "editor";
  /** Editor's left sidebar (Library + Examples) visibility. */
  sidebarOpen: boolean;
  /** Sidebar sections that are open, by id. Absent = that section's default. */
  sidebarSections: Record<string, boolean>;
  /** The Template/Instructions/Model row under Generate, folded away by default. */
  choicesOpen: boolean;
  /**
   * Shows the authoring-loop instruments: the 1–5 rating (which only feeds the
   * improvement packet), the lint list even when clean, and the Data panel.
   * Off for normal use — "Learn from this" is the user-facing feedback.
   */
  developerMode: boolean;
  /** How the editor presents the spec text (parsing always accepts both). */
  specFormat: SpecFormat;
  /** The Share destination used last, so a repeat publish is one keypress. */
  shareTo: ShareTo;
  /** Domain pack ids (M3) currently enabled — loaded and registered at startup. */
  enabledPacks: string[];
  /** Enabled pack ids whose templates get a full catalog entry (never summarized). */
  priorityPacks: string[];
  /** Contact address Unpaywall asks callers for (source elements, DOI path). Empty = skip Unpaywall. */
  contactEmail: string;
  /** owner/repo courses publish to. Empty until the user sets one. */
  githubRepo: string;
  /** Subdirectory inside that repo; empty (the default) publishes at its root. */
  coursesDir: string;
  /** Where a published lecture link points; the app has two deploys. */
  viewerBase: string;
  /**
   * giscus wiring for "Allow comments" on published drawcasts (C1). The ids
   * come from giscus.app's config page — the one-time setup the author does
   * (Discussions on, giscus app installed); empty means comments are off the
   * table and the Publish checkbox says why. Category defaults to what
   * giscus recommends.
   */
  giscusRepoId: string;
  giscusCategory: string;
  giscusCategoryId: string;
  /** Chrome appearance. "system" follows prefers-color-scheme; the figure
   *  itself never reads this (see render/figure-style.ts). */
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5",
  style: "clean",
  textSize: null,
  textFamily: null,
  variant: "v1",
  activeStyleId: null,
  cloudVoices: {},
  mode: "narrated",
  speed: 1,
  voiceURI: null,
  rate: 1,
  muted: false,
  theater: false,
  cloudPlayback: true,
  skipQuestions: false,
  captionsOn: true,
  captionLang: "",
  burnCaptions: true,
  uiMode: "player",
  sidebarOpen: true,
  sidebarSections: {},
  choicesOpen: false,
  developerMode: false,
  specFormat: "yaml",
  shareTo: "link",
  // Every built-in pack, on. A pack that is off is invisible to the compiler
  // (its templates are not in the catalog at all), so a chemistry request
  // silently degrades to hand-composed primitives instead of the SMILES
  // layout that exists — while the whole catalog still fits under the
  // two-level threshold, so nothing is paid for the reach. Remote packs
  // stay opt-in: those are code, these are bundled. Literal ids, not
  // Object.keys(PACK_DEFS) — store.ts is imported by the viewer, and reaching
  // into scenes/packs.ts would drag the whole scene registry into that chunk.
  // tests/pack-defaults.test.ts pins this list against PACK_DEFS instead.
  enabledPacks: ["physics", "chemistry", "biology", "economics", "evidence", "mathlogic", "medicine", "macro", "empirics", "hta", "music", "stats", "data"],
  priorityPacks: [],
  contactEmail: "",
  githubRepo: "",
  coursesDir: "",
  viewerBase: "https://drawcast.app/",
  giscusRepoId: "",
  giscusCategory: "Announcements",
  giscusCategoryId: "",
  theme: "system",
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
  const s = read(KEYS.settings, DEFAULT_SETTINGS);
  // A blob written before Share dropped its Spec file destination may still
  // hold "spec" here — see migrateShareTo's own comment. Applied on every
  // load (cheap, idempotent) rather than as a one-shot flag: nothing else in
  // this file writes shareTo back to storage on its own.
  s.shareTo = migrateShareTo(s.shareTo);
  // One-time upgrade: the bundled packs moved from opt-in to baseline
  // (DEFAULT_SETTINGS.enabledPacks). A settings blob stored before that keeps
  // its own list, which `{...fallback, ...parsed}` leaves untouched — so union
  // the defaults in exactly once, remembered by a flag rather than by
  // comparing lists, otherwise every deliberate un-toggle would be undone on
  // the next load. Anything the user had enabled (remote packs included) rides
  // along unchanged.
  // KEYS.packsUpgrade's value gets bumped (v1 -> v2 -> ...) whenever
  // DEFAULT_SETTINGS.enabledPacks grows again — a browser that already ran an
  // older version of this upgrade has the older flag set, so only a new flag
  // key re-triggers the union for it.
  // Guarded like read()/readArray(): the viewer calls loadSettings in
  // environments without storage at all, where it must degrade to the
  // defaults rather than throw.
  try {
    if (!localStorage.getItem(KEYS.packsUpgrade)) {
      localStorage.setItem(KEYS.packsUpgrade, "1");
      const merged = [...new Set([...s.enabledPacks, ...DEFAULT_SETTINGS.enabledPacks])];
      if (merged.length !== s.enabledPacks.length) {
        const upgraded = { ...s, enabledPacks: merged };
        saveSettings(upgraded);
        return upgraded;
      }
    }
  } catch {
    /* no storage — the defaults already carry the packs */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
}

/**
 * Which settings field belongs on which tab. A list rather than a lookup so
 * the order is the reading order, and a test can pin that "skip questions" no
 * longer lives under the text-to-speech KEY it had been nested beneath.
 */
export const SETTINGS_TABS: { id: string; label: string; fields: string[] }[] = [
  { id: "keys", label: "Keys", fields: ["apiKey", "ttsKey"] },
  { id: "playback", label: "Playback", fields: ["style", "textSize", "textFamily", "theme", "voice", "rate", "cloudPlayback", "cloudVoice", "skipQuestions", "burnCaptions"] },
  { id: "publishing", label: "Publishing", fields: ["githubRepo", "githubToken", "authorKey", "coursesDir", "giscus"] },
  { id: "advanced", label: "Advanced", fields: ["contactEmail", "developerMode", "backup"] },
];

export function getApiKey(): string {
  return localStorage.getItem(KEYS.apiKey) || (import.meta.env.VITE_ANTHROPIC_API_KEY ?? "");
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEYS.apiKey, key);
  else localStorage.removeItem(KEYS.apiKey);
}

/**
 * The user's OWN fine-grained PAT for their OWN repository — the same BYOK
 * shape as the API key. There is no shared repo and so no shared credential.
 */
export function getGithubToken(): string {
  return localStorage.getItem(KEYS.githubToken) ?? "";
}

export function setGithubToken(token: string): void {
  if (token) localStorage.setItem(KEYS.githubToken, token);
  else localStorage.removeItem(KEYS.githubToken);
}

/**
 * The author key from the drawcast Anvil dashboard (spec §7): lets a publish
 * register its name in the drawcast.app registry. Same shape as the GitHub
 * token — a personal credential, never a shared one.
 */
export function getAuthorKey(): string {
  return localStorage.getItem(KEYS.authorKey) ?? "";
}

export function setAuthorKey(key: string): void {
  if (key) localStorage.setItem(KEYS.authorKey, key);
  else localStorage.removeItem(KEYS.authorKey);
}

export function getTtsKey(): string {
  return localStorage.getItem(KEYS.ttsKey) || (import.meta.env.VITE_GOOGLE_TTS_KEY ?? "");
}

export function setTtsKey(key: string): void {
  if (key) localStorage.setItem(KEYS.ttsKey, key);
  else localStorage.removeItem(KEYS.ttsKey);
}

/** A localStorage write that did not fit. Callers report it; nothing is silently lost. */
export class StorageFullError extends Error {
  constructor(what: string) {
    super(`Out of browser storage while saving ${what}. Delete a few saved drawcasts and try again.`);
    this.name = "StorageFullError";
  }
}

/**
 * Every library write goes through here, so a full quota is an error a caller
 * can show. Batch course generation is the first thing that realistically
 * fills the ~5 MB quota, and an uncaught throw there would lose a run that had
 * already spent forty AI calls.
 */
function writeJson(key: string, value: unknown, what: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (err instanceof Error && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
      throw new StorageFullError(what);
    }
    throw err;
  }
}

// ---- Drawing library (the user's saved drawcasts) ----

export interface SavedDrawing {
  id: string;
  title: string;
  /** The request that produced it, when AI-generated. */
  prompt?: string;
  /** First item's spec (kept for poster/back-compat; the whole doc when single). */
  spec: Spec;
  /**
   * The full document as serialized multi-doc YAML, whenever it does not fit
   * in `spec` alone. That is no longer the same as "multi-part": since B9 a
   * single figure carrying its founding prompt has a header too, so this
   * field's presence says nothing about part count — ask `isMultiPart`.
   */
  playlist?: string;
  /** How many items (chapters excluded) the document holds. Absent on rows written before B9. */
  parts?: number;
  /**
   * The course this lecture belongs to, when it came from one. Lectures are
   * saved the moment they are generated — they cost real money, so they are
   * never provisional — and this is what lets the library group them under
   * their course instead of scattering ten rows through everything else.
   */
  courseId?: string;
  /**
   * The name this drawcast was published under in the author's repo, once it
   * has been. Permanent from the first publish: retitling must never move the
   * file a shared link already points at.
   */
  publishedAs?: string;
  /** Whether the last GitHub publish carried the giscus wiring (C1) — seeds the checkbox on the next publish so a typo-fix republish doesn't silently strip a live page's comments. */
  publishedComments?: boolean;
  /** Whether the last GitHub publish counted views — seeds the checkbox so a republish cannot silently re-enable counting. */
  publishedViews?: boolean;
  /**
   * The Drive file id this drawcast was PUBLISHED to, once it has been
   * (spec §7). Persisted for the same reason as `publishedAs`: a republish
   * has to update the file whose link is already out there rather than mint a
   * second one. Distinct from the in-memory `driveFileId` on main.ts's `Doc`,
   * which is where Save → Drive keeps its working copy — one drawcast can
   * have both, pointing at two different files.
   */
  drivePublishedId?: string;
  /**
   * What that published file is CALLED in Drive, without the .yaml. Kept
   * beside the id so the Publish panel can prefill it: a republish carries a
   * name, so without this one it would rename the author's file back to the
   * document title every time. Set and cleared together with the id.
   */
  drivePublishedName?: string;
  /**
   * The path this drawcast's SOURCE was last saved to in the author's repo —
   * distinct from `publishedAs`, which is the rendered viewer page. Absent or
   * null until a save to GitHub happens (Task 7); carried here, not just on
   * the in-memory `Doc`, so it survives a reload instead of asking for a
   * second file the next time the author saves. Optional like this
   * interface's other extra fields — a library entry from before this field
   * existed simply has none, and `docFromSaved` treats that the same as null.
   */
  sourcePath?: string | null;
  ts: string;
}

/**
 * Does this row hold a genuinely multi-part drawcast — what the library's ▤
 * marker and its "Load this playlist" tooltip claim?
 *
 * `parts` is what every row written since B9 carries. A row written before it
 * has none, and for those the presence of `playlist` text IS the right answer:
 * back then only a real playlist had a header worth storing. Reading the field
 * that way is not a compatibility shim — it is what that older row's data
 * actually meant.
 */
export function isMultiPart(saved: Pick<SavedDrawing, "parts" | "playlist">): boolean {
  return saved.parts === undefined ? saved.playlist !== undefined : saved.parts > 1;
}

export function loadLibrary(): SavedDrawing[] {
  return readArray<SavedDrawing>(KEYS.library);
}

export function saveDrawing(d: SavedDrawing): void {
  const all = loadLibrary().filter((x) => x.id !== d.id);
  all.unshift(d);
  writeJson(KEYS.library, all, "a drawcast");
}

export function deleteDrawing(id: string): void {
  writeJson(KEYS.library, loadLibrary().filter((x) => x.id !== id), "the library");
}

// ---- Course library (course documents, stage A) ----

export interface SavedCourse {
  id: string;
  title: string;
  /** The course document, verbatim — the author's layout is never rewritten. */
  text: string;
  /** owner/repo/dir this course was last published to (stage B). */
  target?: string;
  /** Whether the last GitHub publish counted views — seeds the checkbox so a republish cannot silently re-enable counting. */
  publishedViews?: boolean;
  ts: string;
}

export function loadCourses(): SavedCourse[] {
  return readArray<SavedCourse>(KEYS.courses);
}

export function saveCourse(c: SavedCourse): void {
  const all = loadCourses().filter((x) => x.id !== c.id);
  all.unshift(c);
  writeJson(KEYS.courses, all, "a course");
}

export function deleteCourse(id: string): void {
  writeJson(KEYS.courses, loadCourses().filter((x) => x.id !== id), "the course library");
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

/**
 * A style profile (B5, S §3–§4): the author's own teaching style as prose —
 * "how it draws". It is ADDED to the compiler prompt, last, so it wins where
 * they disagree (llm/prompt.ts styleBlock). Nothing in it can break
 * generation, which is the whole point of splitting it from the prompt
 * variants below. localStorage only, by ruling (S §4.1 option 1): a style
 * is a paragraph; syncing it is a bigger machine than the thing it syncs.
 */
export interface StyleProfile {
  id: string;
  name: string;
  text: string;
  ts: string;
}

export function loadStyles(): StyleProfile[] {
  return readArray<StyleProfile>(KEYS.styles);
}

/** Insert or update (by id). Newest-edited first. */
export function saveStyle(p: StyleProfile): void {
  const all = loadStyles().filter((x) => x.id !== p.id);
  all.unshift(p);
  localStorage.setItem(KEYS.styles, JSON.stringify(all));
}

export function deleteStyle(id: string): void {
  localStorage.setItem(KEYS.styles, JSON.stringify(loadStyles().filter((x) => x.id !== id)));
}

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

/** Drop one reference by position (the References tab lists them in store order). */
export function deleteExemplar(index: number): void {
  const all = loadExemplars();
  if (index < 0 || index >= all.length) return;
  all.splice(index, 1);
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

// ---- Vended-key provenance + monthly usage caps ----
// The vending endpoint hands out Hans's real keys; these SOFT caps protect the
// shared quota from accidents (a looping export, a runaway playlist session).
// They apply PER BROWSER and ONLY to vended keys — a user's own keys are never
// capped. They are not a security boundary (the raw keys are in localStorage);
// hard limits belong in the provider consoles (Anthropic workspace spend
// limit; Google quota caps).

/** Which of the stored keys came from the vending endpoint. */
export interface VendedFlags {
  anthropic: boolean;
  tts: boolean;
}

export function loadVendedFlags(): VendedFlags {
  return read<VendedFlags>(KEYS.vendedKeys, { anthropic: false, tts: false });
}

export function setVendedFlags(f: VendedFlags): void {
  localStorage.setItem(KEYS.vendedKeys, JSON.stringify(f));
}

/** Generous per-browser monthly allowances for vended keys. */
export const ANTHROPIC_MONTHLY_TOKEN_CAP = 2_000_000;
export const TTS_MONTHLY_CHAR_CAP = 250_000;

interface UsageLedger {
  /** "YYYY-MM" — the ledger resets when the month changes. */
  month: string;
  anthropicTokens: number;
  ttsChars: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function loadUsage(): UsageLedger {
  const u = read<UsageLedger>(KEYS.usage, { month: currentMonth(), anthropicTokens: 0, ttsChars: 0 });
  if (u.month !== currentMonth()) return { month: currentMonth(), anthropicTokens: 0, ttsChars: 0 };
  return u;
}

function saveUsage(u: UsageLedger): void {
  // A usage counter must never fail the work it is counting. loadUsage reads
  // through the guarded `read` helper; this write was the one unguarded half,
  // so a browser that refuses storage (private mode, a blocked third-party
  // context) turned a paid, SUCCESSFUL synthesis into a failed publish.
  try {
    localStorage.setItem(KEYS.usage, JSON.stringify(u));
  } catch {
    /* the clip is already synthesized; losing the tally is the cheaper loss */
  }
}

export function addAnthropicTokens(n: number): void {
  const u = loadUsage();
  saveUsage({ ...u, anthropicTokens: u.anthropicTokens + Math.max(0, n) });
}

export function addTtsChars(n: number): void {
  const u = loadUsage();
  saveUsage({ ...u, ttsChars: u.ttsChars + Math.max(0, n) });
}

/** Null when within budget (or the key is the user's own); else the refusal message. */
export function anthropicBudgetError(): string | null {
  if (!loadVendedFlags().anthropic) return null;
  if (loadUsage().anthropicTokens < ANTHROPIC_MONTHLY_TOKEN_CAP) return null;
  return `This month's shared-key allowance is used up (${ANTHROPIC_MONTHLY_TOKEN_CAP.toLocaleString("en")} tokens). Add your own Anthropic API key in Settings to continue.`;
}

export function ttsBudgetError(): string | null {
  if (!loadVendedFlags().tts) return null;
  if (loadUsage().ttsChars < TTS_MONTHLY_CHAR_CAP) return null;
  return `This month's shared-voice allowance is used up (${TTS_MONTHLY_CHAR_CAP.toLocaleString("en")} narration characters). Add your own Google TTS key in Settings to continue.`;
}

/** One line for the Settings dialog; empty when no vended keys are active. */
export function usageSummary(): string {
  const f = loadVendedFlags();
  if (!f.anthropic && !f.tts) return "";
  const u = loadUsage();
  const parts: string[] = [];
  if (f.anthropic) parts.push(`${u.anthropicTokens.toLocaleString("en")} / ${ANTHROPIC_MONTHLY_TOKEN_CAP.toLocaleString("en")} tokens`);
  if (f.tts) parts.push(`${u.ttsChars.toLocaleString("en")} / ${TTS_MONTHLY_CHAR_CAP.toLocaleString("en")} voice characters`);
  return `Shared-key use this month: ${parts.join(" · ")}.`;
}
