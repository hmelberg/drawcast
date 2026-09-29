// Is this drawing private? (registry delivery 2, task 10 fix round 2.)
//
// Derived, never trusted from one copied flag: a lecture of a private course
// opened on its own (▶ Watch → openDrawing → docFromSaved) is an ordinary
// library drawing, and its row may predate the course going private. Every
// guard in front of a plaintext upload — Save source, Publish → Drive,
// Publish → drawcast server — asks this.

import { parseCourse } from "./course/document";

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
