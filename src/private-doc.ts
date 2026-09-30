// Is this drawing private? (registry delivery 2, task 10 fix round 2.)
//
// Derived, never trusted from one copied flag: a lecture of a private course
// opened on its own (▶ Watch → openDrawing → docFromSaved) is an ordinary
// library drawing, and its row may predate the course going private. Every
// guard in front of a plaintext upload — Save source, Publish → Drive,
// Publish → drawcast server — asks this.

import { parseCourse } from "./course/document";
import { isLocked } from "./crypto/lecture-lock";

/** Whether library drawing `id` is a lecture of a PRIVATE course — by its
 *  row's courseId, or by any private course document that names it (the
 *  lookup links/course.ts courseBaseForDrawing does; the editor's autosave
 *  does not carry courseId, so the document is the one that always holds). */
export function inPrivateCourse(
  id: string | null,
  library: readonly { id: string; courseId?: string }[],
  courses: readonly { id: string; text: string }[],
): boolean {
  if (!id) return false;
  const privateCourse = (text: string): boolean => {
    try {
      return parseCourse(text).private === true;
    } catch {
      return false;
    }
  };
  const row = library.find((d) => d.id === id);
  if (row?.courseId) {
    const own = courses.find((c) => c.id === row.courseId);
    if (own && privateCourse(own.text)) return true;
  }
  return courses.some((c) => privateCourse(c.text) && parseCourse(c.text).lectures.some((l) => l.status?.id === id));
}

/**
 * The fields autosave carries over from the row it replaces (task 10 fix
 * round 3): saveDrawing replaces a whole row, and the editor's document does
 * not hold `courseId`, nor necessarily `private`. A private flag is never
 * cleared by a save — only an explicit make-public (`doc.private === false`,
 * which only a public GitHub publish of the drawcast sets) clears it.
 */
export function keptRowFields(
  doc: { private?: boolean },
  existing: { private?: boolean; courseId?: string } | undefined,
): { private: true | undefined; courseId: string | undefined } {
  const priv = doc.private === false ? undefined : doc.private || existing?.private ? true : undefined;
  return { private: priv, courseId: existing?.courseId };
}

export function isPrivateDrawing(
  doc: { id: string | null; private?: boolean },
  library: readonly { id: string; courseId?: string; private?: boolean }[],
  courses: readonly { id: string; text: string }[],
): boolean {
  if (doc.private) return true;
  if (!doc.id) return false;
  const row = library.find((d) => d.id === doc.id);
  if (row?.private) return true;
  return inPrivateCourse(doc.id, library, courses);
}

/**
 * What a GitHub publish actually does about privacy (final review I1b). The
 * server's own word wins over local state that never learned it — a course
 * made private with the skill, then loaded into the app; a quote that timed
 * out after the payment cleared: `server` saying `private: true` while the
 * local state is public publishes LOCKED (`upgraded`), unless the author
 * explicitly confirmed making it public (Share's "Make public" confirm).
 * No answer (signed out, "key", "error") leaves the local state as it is.
 */
export function publishPrivacy(
  local: boolean,
  server: { private: boolean } | string | null,
  confirmedPublic: boolean,
  repoLocked = false,
): { private: boolean; upgraded: boolean } {
  if (local) return { private: true, upgraded: false };
  const serverPrivate = typeof server === "object" && server !== null && server.private === true;
  // `repoLocked` (round 2): the repo itself already holds it locked — fail
  // CLOSED even when the quote could not run (signed out, "key", Anvil down).
  if ((serverPrivate || repoLocked) && !confirmedPublic) return { private: true, upgraded: true };
  return { private: false, upgraded: false };
}

/** Whether a course lecture has a generated file a publish would commit —
 *  done, with an id, and a library row behind it (ui/course.ts savedYaml). */
export function hasBuiltLecture(
  lecture: { status?: { state?: string; id?: string } },
  library: readonly { id: string }[],
): boolean {
  const s = lecture.status;
  return s?.state === "done" && !!s.id && library.some((d) => d.id === s.id);
}

/** The lectures a private course is priced for (final review M2): the ones
 *  the publish commits, counted the SAME way for Share's quote/pay and for
 *  the publish's own re-quote — never an unbuilt lecture of the outline.
 *  At least 1: the registry wants 1–200. */
export function privateLectureCount(
  course: { lectures: readonly { status?: { state?: string; id?: string } }[] },
  library: readonly { id: string }[],
): number {
  return Math.max(1, course.lectures.filter((l) => hasBuiltLecture(l, library)).length);
}

/** A repo read: the file's text, or null (missing). May throw (offline). */
export type RepoRead = (path: string) => Promise<string | null>;

async function readOrNull(read: RepoRead, path: string): Promise<string | null> {
  try {
    return await read(path);
  } catch {
    return null; // an unreadable repo stays fail-open: the commit would fail too
  }
}

/** Whether the cast file at `path` (the PREDICTED publish path, not only
 *  the one this app published before) is already a locked envelope in the
 *  repo (final review I1b round 2) — a cast made private with the skill or
 *  in another browser, whatever this browser's state or the quote says. */
export async function castLockedInRepo(read: RepoRead, path: string): Promise<boolean> {
  const raw = await readOrNull(read, path);
  return raw !== null && isLocked(raw);
}

/** Whether the course published at `dir` is private in the repo itself: its
 *  course.md says `private: true`, or its first published lecture file is a
 *  locked envelope (a course the skill made private before course.md said
 *  so). Missing/unreadable → false. */
export async function courseLockedInRepo(read: RepoRead, dir: string): Promise<boolean> {
  const base = dir.replace(/\/+$/, "");
  const md = await readOrNull(read, `${base}/course.md`);
  if (md === null) return false;
  let course;
  try {
    course = parseCourse(md);
  } catch {
    return false;
  }
  if (course.private) return true;
  const first = course.lectures.find((l) => l.status?.file)?.status?.file;
  if (!first) return false;
  const raw = await readOrNull(read, `${base}/${first}`);
  return raw !== null && isLocked(raw);
}
