// The lock step of a PRIVATE publish (registry delivery 2, task 10): every
// lecture file of a plan is replaced by its locked envelope BEFORE the one
// commit, all or nothing. Review Focus #1 — a plaintext lecture must never
// reach commitFiles — is enforced here twice: a lock that throws aborts the
// whole publish, and whatever the lock returned is checked for the envelope
// header before anything is handed on, so a lock that "succeeds" with
// plaintext (a bug, a stub) aborts too. No poster rides along either: a
// thumbnail is a frame of the lecture.

import { LOCK_HEADER } from "../crypto/lecture-lock";
import type { PublishFile } from "./github";

/** Locks one lecture file's text; `path` is its repo path. */
export type LectureLock = (path: string, text: string) => Promise<string>;

/** A private publish refused before anything was committed. The message is
 *  meant for the status line as it stands — it never carries the key. */
export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

function shortReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const line = text.split("\n")[0].trim() || "unknown error";
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/**
 * The plan's files with every path in `lecturePaths` locked. Throws a
 * LockError — "Not published: could not lock the lectures (<reason>)" — when
 * any lock fails, a lecture path is missing from the plan, a locked result
 * does not start with the envelope header, or a `.png` is in the files.
 */
export async function lockLectureFiles(files: PublishFile[], lecturePaths: string[], lock: LectureLock): Promise<PublishFile[]> {
  const fail = (reason: string) => new LockError(`Not published: could not lock the lectures (${reason})`);
  const wanted = new Set(lecturePaths);
  for (const p of wanted) if (!files.some((f) => f.path === p)) throw fail(`${p} is not in the plan`);
  const out: PublishFile[] = [];
  for (const f of files) {
    if (!wanted.has(f.path)) {
      out.push(f);
      continue;
    }
    let locked: string;
    try {
      locked = await lock(f.path, f.content);
    } catch (err) {
      throw fail(shortReason(err));
    }
    // A lecture travels as text only: `bytes` would win over `content` in
    // commitFiles (fileBytes), so it is dropped rather than trusted.
    out.push({ path: f.path, content: locked });
  }
  for (const f of out) {
    if (wanted.has(f.path) && !f.content.startsWith(LOCK_HEADER)) throw fail(`${f.path} did not lock`);
    if (/\.png$/i.test(f.path)) throw fail(`a thumbnail (${f.path}) would show the lecture`);
  }
  return out;
}
