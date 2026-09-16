// The local record (spec 2026-09-15-stored-answers §2, "two stores"): every
// answer a viewer gives, appended per cast in THIS browser's localStorage —
// the student's own log, and what a later Submit sends. Distinct from the
// player's variable map (narration and `if` read that; it dies with the
// drawcast). Writing here sends nothing anywhere. Same rule as views.ts and
// learn.ts: storage can be absent or throw (private mode), and then the
// drawing goes on — nothing here may ever throw into playback.

export const RECORD_PREFIX = "drawcast.answers:";

/** Newest entries win the cap; a runaway retry loop must not eat the store. */
const MAX_RECORDS = 500;

export interface AnswerRecord {
  /** 0-based playlist item the question sat in. */
  item: number;
  /** Step index inside that item's plan. */
  step: number;
  /** The variable name the answer was stored under: the explicit store, else `_answers.N`. */
  id: string;
  question: string;
  /** Every attempt, verbatim; [] for a skipped quiz. */
  given: string[];
  expected: string;
  correct: boolean;
  /** Seconds from the gate opening to the answer (latest attempt); absent without a live gate. */
  secs?: number;
  /** ISO timestamp of the answer. */
  at: string;
  /** ISO time the course server took this answer (the outbox stamp, spec
   *  2026-09-16-course-progress §3); absent = not sent yet. */
  sent?: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** localStorage when this browser offers one, else null — never a throw. */
export function localRecordStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The cast's record, oldest first; [] for none, or for an entry that no longer parses. */
export function readRecords(storage: StorageLike | null, castKey: string): AnswerRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECORD_PREFIX + castKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnswerRecord[]) : [];
  } catch {
    return [];
  }
}

/** The cast's answers the server has not taken yet — the outbox. */
export function unsentRecords(storage: StorageLike | null, castKey: string): AnswerRecord[] {
  return readRecords(storage, castKey).filter((r) => r.sent === undefined);
}

/** Stamp the given entries (matched by item, step and at) as sent. */
export function markSent(storage: StorageLike | null, castKey: string, entries: AnswerRecord[], sentAt: string): boolean {
  if (!storage || entries.length === 0) return false;
  const keys = new Set(entries.map((e) => `${e.item}|${e.step}|${e.at}`));
  try {
    const next = readRecords(storage, castKey).map((r) => (keys.has(`${r.item}|${r.step}|${r.at}`) ? { ...r, sent: sentAt } : r));
    storage.setItem(RECORD_PREFIX + castKey, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

const HANDIN_PREFIX = "drawcast.handin:";

/** When this browser handed the cast in (course-progress §4), or null. */
export function readHandIn(storage: StorageLike | null, castKey: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(HANDIN_PREFIX + castKey) || null;
  } catch {
    return null;
  }
}

export function writeHandIn(storage: StorageLike | null, castKey: string, at: string): void {
  if (!storage) return;
  try {
    storage.setItem(HANDIN_PREFIX + castKey, at);
  } catch {
    /* no storage — the server's answer still says handed in next time */
  }
}

/** Append one answer to the cast's record. False when nothing could be written. */
export function appendRecord(storage: StorageLike | null, castKey: string, rec: AnswerRecord): boolean {
  if (!storage) return false;
  try {
    const next = [...readRecords(storage, castKey), rec].slice(-MAX_RECORDS);
    storage.setItem(RECORD_PREFIX + castKey, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
