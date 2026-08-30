// Reconciling a course document against the library.
//
// The document's `status: done` lines are what make a run resumable, and they
// are the only thing the runner reads — so a lecture whose drawcast exists but
// whose status line was lost gets generated again, at full cost. Two concurrent
// runs used to do exactly that to each other. This finds the drawcasts that are
// already there and hands back the lines that should be restored.

import type { Course, LectureStatus } from "./document";

export interface LibraryEntry {
  id: string;
  title: string;
  /** Set for lectures generated as part of a course. */
  courseId?: string;
}

export interface Match {
  index: number;
  id: string;
  title: string;
}

/**
 * Lectures that are missing a `done` status but whose drawcast is sitting in
 * the library. Matched on exact title, newest first, and never two lectures to
 * the same drawcast — a guess that silently pointed two lectures at one file
 * would be worse than leaving them to regenerate.
 *
 * An entry belonging to a DIFFERENT course is never a candidate; one with no
 * course at all is, because rows saved before courses existed carry no id.
 */
export function matchLibrary(course: Course, library: LibraryEntry[], courseId: string | null): Match[] {
  const used = new Set<string>();
  // Ids the document already claims must not be handed to a second lecture.
  for (const lecture of course.lectures) {
    if (lecture.status?.id) used.add(lecture.status.id);
  }

  const matches: Match[] = [];
  course.lectures.forEach((lecture, index) => {
    if (lecture.status?.state === "done" && lecture.status.id) return;
    const wanted = lecture.title.trim().toLowerCase();
    if (!wanted) return;
    const hit = library.find(
      (entry) =>
        !used.has(entry.id) &&
        (entry.courseId === undefined || entry.courseId === courseId) &&
        entry.title.trim().toLowerCase() === wanted,
    );
    if (!hit) return;
    used.add(hit.id);
    matches.push({ index, id: hit.id, title: lecture.title });
  });
  return matches;
}

/** The status line a match restores. */
export function restoredStatus(id: string, previous?: LectureStatus): LectureStatus {
  return {
    state: "done",
    id,
    // A file name already recorded is permanent — carry it through, or a
    // republish would move the lecture and break the link that points at it.
    file: previous?.file,
    ts: new Date().toISOString().slice(0, 10),
  };
}
