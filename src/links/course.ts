// A course as a link base: `lecture:N` and `./<file>.yaml` read against the
// course document's own lecture list (status lines: file, library id).

import { parseCourse } from "../course/document";
import type { LinkBase } from "./resolve";

/** The course in `courseText` as a base; `dir` is its folder's own base
 *  (GitHub, dev), absent in the app, where lectures open by library id. */
export function courseBase(courseText: string, dir?: LinkBase): LinkBase {
  const lectures = parseCourse(courseText).lectures.map((l) => ({
    ...(l.status?.file ? { file: l.status.file } : {}),
    ...(l.status?.state === "done" && l.status.id ? { drawingId: l.status.id } : {}),
  }));
  return dir ? { kind: "course", lectures, dir } : { kind: "course", lectures };
}

/** The course (of `courseTexts`) that holds the library drawing `id`, as a base. */
export function courseBaseForDrawing(courseTexts: readonly string[], id: string): LinkBase | null {
  for (const text of courseTexts) {
    const course = parseCourse(text);
    if (course.lectures.some((l) => l.status?.id === id)) return courseBase(text);
  }
  return null;
}

/** A file's own base, widened to its course when the folder's course.md
 *  names that file: then `lecture:N` works too. */
export function withCourse(file: LinkBase, fileName: string, courseText: string | null): LinkBase {
  if (courseText === null) return file;
  const base = courseBase(courseText, file);
  return base.kind === "course" && base.lectures.some((l) => l.file === fileName) ? base : file;
}

/** The published lectures' titles, in the order a course's names number
 *  them (`course/1` is the first lecture with a file — lectureCastKeys's
 *  order): the watch page's Up next names the next lectures with them. */
export function publishedLectureTitles(courseText: string): string[] {
  return parseCourse(courseText).lectures.flatMap((l) => (l.status?.file ? [l.title] : []));
}
