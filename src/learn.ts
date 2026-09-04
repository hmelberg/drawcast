// Learners, client side (spec §1, §4): the course code a browser remembers
// per course, and the three events the player reports. Same rule as
// views.ts — nothing here may ever throw into playback; every failure path
// returns null/false and the drawing goes on.

export const LEARNERS_KEY = "drawcast.learners";
export const DEFAULT_ENROLL_API = "https://drawcast.anvil.app";
/** Mirrors codes.CODE_RE in drawcast-anvil/server_code/codes.py. */
export const CODE_RE = /^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$/;
/** Mirrors the cast-key rule in netlify/lib/view-key.mts (and src/views.ts). */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
const OPENED_PREFIX = "drawcast.learned:";
const LEARNER_PARAM_RE = /([?&#])learner=([^&#]*)/;

export interface LearnerEntry {
  code: string;
  /** The Anvil app that issued the code — events go there and nowhere else. */
  api: string;
  name?: string | null;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().split(/\s+/).join("-");
  return CODE_RE.test(s) ? s : null;
}

/** owner/repo/<dir>/<slug> — the cast key without its file name. */
export function courseKeyOf(castKey: string): string {
  return castKey.replace(/\/[^/]*$/, "");
}

export function apiBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readLearners(storage: StorageLike | null): Record<string, LearnerEntry> {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LEARNERS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, LearnerEntry>) : {};
  } catch {
    return {};
  }
}

function writeLearners(storage: StorageLike | null, map: Record<string, LearnerEntry>): void {
  if (!storage) return;
  try {
    storage.setItem(LEARNERS_KEY, JSON.stringify(map));
  } catch {
    /* no storage — the code lives for this page only */
  }
}

export function learnerFor(storage: StorageLike | null, courseKey: string): LearnerEntry | null {
  const entry = readLearners(storage)[courseKey];
  return entry && typeof entry.code === "string" && typeof entry.api === "string" ? entry : null;
}

export function saveLearner(storage: StorageLike | null, courseKey: string, entry: LearnerEntry): void {
  const map = readLearners(storage);
  map[courseKey] = { code: entry.code, api: apiBase(entry.api), name: entry.name ?? null };
  writeLearners(storage, map);
}

export function forgetLearner(storage: StorageLike | null, courseKey: string): void {
  const map = readLearners(storage);
  delete map[courseKey];
  writeLearners(storage, map);
}

/** The code riding a URL, in the hash (viewer) or the query (course page). */
export function learnerParam(url: string): string | null {
  const m = LEARNER_PARAM_RE.exec(url);
  if (!m) return null;
  try {
    return normalizeCode(decodeURIComponent(m[2]));
  } catch {
    return null; // a malformed percent-escape is not a code, not a crash
  }
}

/** The same URL without the learner parameter — a copied link never carries a code. */
export function stripLearnerParam(url: string): string {
  return url
    .replace(/([?&#])learner=[^&#]*&/, "$1") // another parameter follows: keep the delimiter for it
    .replace(/[?&]learner=[^&#]*(?=#|$)/, ""); // last in its segment: drop it with its delimiter
}

/** Events go to the app that issued the code, whatever a YAML says. */
export function reportingAllowed(entry: LearnerEntry | null, enroll: string | undefined): entry is LearnerEntry {
  if (!entry) return false;
  return enroll === undefined || apiBase(enroll) === apiBase(entry.api);
}

/** Same shape as firstViewInSession: a reload does not re-report `opened`. */
export function firstOpenInSession(castKey: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  try {
    const marker = OPENED_PREFIX + castKey;
    if (storage.getItem(marker)) return false;
    storage.setItem(marker, "1");
    return true;
  } catch {
    return true;
  }
}

export interface AnswerPayload {
  step: number;
  question: string;
  /** Every attempt, verbatim; [] for a skipped quiz. */
  given: string[];
  expected: string;
  correct: boolean;
}

export type LearnEvent = { kind: "opened" | "completed"; cast: string } | ({ kind: "answer"; cast: string } & AnswerPayload);

export async function sendEvent(entry: LearnerEntry, ev: LearnEvent, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!CAST_KEY_RE.test(ev.cast)) return false;
  try {
    const res = await fetchImpl(`${apiBase(entry.api)}/_/api/event`, {
      method: "POST",
      // text/plain keeps this a simple request: no preflight, and keepalive
      // lets a `completed` fired on the last frame outlive the tab.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ code: entry.code, ...ev }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProgressLecture {
  cast: string;
  opened: boolean;
  completed: boolean;
  answers: { step: number; question: string | null; given: string[]; expected: string | null; correct: boolean }[];
}

export interface Progress {
  name: string | null;
  course: { key: string; title: string; page: string };
  lectures: ProgressLecture[];
}

export async function readProgress(api: string, code: string, fetchImpl: typeof fetch = fetch): Promise<Progress | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/progress?code=${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return (await res.json()) as Progress;
  } catch {
    return null;
  }
}
