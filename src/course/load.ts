// Loading published courses back from the GitHub repo (course-load round,
// 2026-09-17). A course lives in localStorage; the repo copy publishCourse
// writes — course.md with `file:` on every generated lecture, one yaml per
// lecture, courses.json listing them — is "the source you can re-open"
// (publish.ts). This module is the pure half of re-opening it: which courses
// to fetch, and what the fetched text becomes locally. The fetching itself
// is main.ts's (readFile), so this stays testable without a network.

import type { Manifest, RepoRef } from "../publish/github";
import { formatPlaylist, itemsOf } from "../playlist/playlist";
import type { SavedCourse, SavedDrawing } from "../store";
import { isBlankSpec } from "../spec/schema";
import { checkSaveable } from "../ui/save-gate";
import { parseCourse } from "./document";
import { joinPath } from "./publish";

export interface LoadTodo {
  slug: string;
  title: string;
  /** Repo-relative folder holding course.md and the lecture yamls. */
  dir: string;
  /** The local course this refreshes, or null to import as new. */
  localId: string | null;
  /** The manifest's time — becomes the local course's ts, so the next load is a no-op. */
  updated: string;
}

/**
 * Which manifest courses to fetch. A local course matches a repo course by
 * the `slug:` option publish stamps into its text (never by title — titles
 * get edited). The repo copy wins only when the manifest's time is newer
 * than the local save: a publish, or any local edit after it, stamps a
 * newer local ts, so unpublished work is never overwritten. Local courses
 * with no repo counterpart are not this function's business.
 */
export function planCourseLoad(manifest: Manifest, local: SavedCourse[], repo: RepoRef, coursesDir: string): LoadTodo[] {
  const bySlug = new Map<string, SavedCourse>();
  for (const c of local) {
    const slug = slugOf(c.text);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, c);
  }
  void repo; // the manifest is already the one repo's; kept in the signature for the target it names
  const todo: LoadTodo[] = [];
  for (const entry of manifest.courses) {
    const mine = bySlug.get(entry.slug);
    if (mine && mine.ts >= entry.updated) continue;
    todo.push({ slug: entry.slug, title: entry.title, dir: joinPath(coursesDir, entry.slug), localId: mine?.id ?? null, updated: entry.updated });
  }
  return todo;
}

function slugOf(text: string): string | undefined {
  try {
    return parseCourse(text).context.slug;
  } catch {
    return undefined;
  }
}

/** The lecture files a course document names (`file:` on generated lectures), in document order. */
export function lectureFilesOf(text: string): string[] {
  return parseCourse(text)
    .lectures.map((l) => l.status?.file)
    .filter((f): f is string => typeof f === "string" && f.length > 0);
}

export interface ImportArgs {
  /** The fetched course.md. */
  text: string;
  /** Fetched lecture yamls by file name; a file that did not come back is simply absent. */
  yamlByFile: Record<string, string>;
  /** The local course id to write under — the matched one, or a fresh one. */
  courseId: string;
  /** The manifest's time for this course. */
  updated: string;
}

export interface ImportResult {
  course: SavedCourse;
  drawings: SavedDrawing[];
  /** Lecture files the document names that could not be read or parsed. */
  missing: string[];
}

/**
 * What a fetched course becomes locally. The document is kept verbatim (the
 * author's layout is never rewritten — document.ts). Each generated lecture
 * becomes a library row under the id its status line already carries, so a
 * re-load writes over the same rows and the sidebar's grouping (by the ids
 * the document references) works at once. The stored playlist goes through
 * formatPlaylist — the one path that drops baked audio, which localStorage
 * cannot carry (design §15.2) — and loses meta.next, a publish-only artifact
 * that publish recomputes anyway.
 */
export function importCourse(args: ImportArgs): ImportResult {
  const course = parseCourse(args.text);
  const drawings: SavedDrawing[] = [];
  const missing: string[] = [];
  for (const lecture of course.lectures) {
    const status = lecture.status;
    if (!status?.file || !status.id) continue;
    const yaml = args.yamlByFile[status.file];
    if (yaml === undefined) {
      missing.push(status.file);
      continue;
    }
    // The gate every opened document passes (main.ts readPlaylistText): the
    // parser is tolerant and reads garbage as an item, so parse alone is no
    // check. A file that fails it is reported, never stored.
    const decision = checkSaveable(yaml);
    if (!decision.ok) {
      missing.push(status.file);
      continue;
    }
    const playlist = decision.playlist;
    const items = itemsOf(playlist);
    // …and the gate lets a BLANK page through (＋ New's empty page is
    // saveable); a published lecture with nothing to draw is not a lecture.
    if (items.some((it) => isBlankSpec(it.spec))) {
      missing.push(status.file);
      continue;
    }
    delete playlist.meta.next;
    drawings.push({
      id: status.id,
      title: lecture.title,
      prompt: playlist.meta.prompt ?? lecture.questions.join(" "),
      spec: items[0].spec,
      playlist: formatPlaylist(playlist, "yaml"),
      parts: items.length,
      courseId: args.courseId,
      sourcePath: null,
      ts: args.updated,
    });
  }
  return {
    course: { id: args.courseId, title: course.title, text: args.text, ts: args.updated },
    drawings,
    missing,
  };
}
