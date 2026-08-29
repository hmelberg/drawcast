// The course runner: generate the lectures that are missing, one lecture at a
// time through the ordinary multi-part generator, writing status back into the
// document after each so an interrupted run resumes instead of restarting.

import { collectSpeakLines } from "../export/video";
import { type GenerateConfig } from "../llm/compile";
import { generateParts, type PartsResult } from "../llm/multi";
import { buildBrief, parseTags } from "../llm/tags";
import { DEFAULT_META, makeNextCard, type Playlist, type PlaylistEntry } from "../playlist/playlist";
import type { Spec } from "../spec/types";
import { parseCourse, setLectureStatus, type Course, type CourseLecture } from "./document";

/**
 * Seconds a spoken line takes at 1×, used only for the runtime estimate shown
 * beside each lecture. CALIBRATE against a real export: record one generated
 * lecture, divide its duration by collectSpeakLines(...).length, and put the
 * measured value here.
 */
export const SECONDS_PER_SPEAK_LINE = 4.5;

/** Default parts when a lecture declares none — about five minutes. */
const DEFAULT_PARTS = 4;

function partsOf(lecture: CourseLecture): number {
  return parseTags(lecture.tags.join(" ")).parts ?? DEFAULT_PARTS;
}

function isPending(lecture: CourseLecture): boolean {
  return lecture.status?.state !== "done";
}

/**
 * The request for one lecture. The shared context and the list of what earlier
 * lectures covered are what make the series a course rather than N unrelated
 * videos — exactly the device buildPartRequest uses one level down.
 */
export function buildLectureRequest(course: Course, index: number): string {
  const lecture = course.lectures[index];
  const lines = [`${lecture.title} — a lecture in the course "${course.title}".`];
  if (lecture.questions.length > 0) {
    lines.push("", "Answer these questions, in this order:", ...lecture.questions.map((q) => `- ${q}`));
  }
  // `minutes` is a budget for the planner, not something to narrate.
  const context = Object.entries({ ...course.context, ...lecture.options }).filter(([key]) => key !== "minutes");
  if (context.length > 0) {
    lines.push("", "The whole course shares this — use it exactly, do not invent your own:");
    for (const [key, value] of context) lines.push(`- ${key}: ${value}`);
  }
  lines.push("", `The full course: ${course.lectures.map((l, i) => `${i + 1}. ${l.title}`).join("; ")}.`);
  if (index > 0) {
    lines.push(
      `Lectures 1–${index} have already covered ${course.lectures
        .slice(0, index)
        .map((l) => l.title)
        .join(", ")}. Build on them; do not re-introduce them.`,
    );
  }
  if (index < course.lectures.length - 1) {
    lines.push(`The next lecture is "${course.lectures[index + 1].title}" — do not cover it here.`);
  }
  // Tags last, in the raw form parseTags expects, so tags.ts fragments apply
  // unchanged rather than being re-described here.
  if (lecture.tags.length > 0) lines.push("", lecture.tags.join(" "));
  return lines.join("\n");
}

/** AI calls a full run would make: one outline plus its parts, per pending lecture. */
export function estimateCalls(course: Course): number {
  return course.lectures.filter(isPending).reduce((sum, lecture) => sum + 1 + partsOf(lecture), 0);
}

/** Rough runtime of a generated lecture, in minutes. */
export function estimateMinutes(specs: Spec[]): number {
  const lines = specs.reduce((sum, spec) => sum + collectSpeakLines(spec).length, 0);
  return (lines * SECONDS_PER_SPEAK_LINE) / 60;
}

/** One lecture's playlist: its parts, its chapters, and the card naming what follows. */
export function lecturePlaylist(course: Course, index: number, result: PartsResult): Playlist {
  const lecture = course.lectures[index];
  const entries: PlaylistEntry[] = [];
  let chapter: string | undefined;
  result.specs.forEach((spec, i) => {
    const next = result.chapterOf[i];
    if (next && next !== chapter) {
      entries.push({ kind: "chapter", title: next });
      chapter = next;
    }
    entries.push({ kind: "item", spec });
  });
  const following = course.lectures[index + 1];
  if (following) {
    entries.push({
      kind: "item",
      spec: makeNextCard({ next: following.title, position: index + 2, total: course.lectures.length }),
    });
  }
  return { meta: { ...DEFAULT_META, title: lecture.title }, entries, warnings: [] };
}

export interface RunHooks {
  onLecture(index: number, phase: "start" | "done" | "failed"): void;
  /** The document after a status write-back; the caller persists and re-renders it. */
  onDocument(text: string): void;
}

export interface RunOptions {
  /** Regenerate exactly this lecture, ignoring its status. */
  only?: number;
}

export interface RunResult {
  text: string;
  generated: number;
  /** Indices of the lectures that failed. */
  failed: number[];
}

/**
 * Persists one finished lecture and returns its library id. A parameter rather
 * than an import, so the runner stays testable without localStorage. It may
 * throw StorageFullError; runCourse catches it and marks that lecture failed.
 */
export type StoreLecture = (index: number, lecture: CourseLecture, playlist: Playlist) => string;

/**
 * "Generate" means "generate what is missing": a lecture marked done is skipped
 * unless `only` names it. Lectures run one at a time — their parts already run
 * in parallel behind the global gate, and stacking both levels would queue
 * dozens of calls with no progress to show for any of them.
 */
export async function runCourse(
  text: string,
  cfg: GenerateConfig,
  hooks: RunHooks,
  store: StoreLecture,
  opts: RunOptions = {},
): Promise<RunResult> {
  const course = parseCourse(text);
  let current = text;
  let generated = 0;
  const failed: number[] = [];

  for (let i = 0; i < course.lectures.length; i++) {
    if (cfg.signal?.aborted) break;
    if (opts.only !== undefined ? i !== opts.only : !isPending(course.lectures[i])) continue;

    const lecture = course.lectures[i];
    hooks.onLecture(i, "start");
    const parsedTags = parseTags(lecture.tags.join(" "));
    const result = await generateParts(
      {
        request: buildLectureRequest(course, i),
        parts: partsOf(lecture),
        brief: buildBrief(parsedTags.tags),
        chapters: lecture.chapters.length > 0 ? lecture.chapters : undefined,
      },
      cfg,
    );

    const ts = new Date().toISOString().slice(0, 10);
    if (result.specs.length === 0) {
      failed.push(i);
      current = setLectureStatus(current, i, { state: "failed", error: result.error ?? "no spec", ts });
      hooks.onLecture(i, "failed");
    } else {
      for (const spec of result.specs) {
        spec.level ??= parsedTags.level ?? undefined;
        spec.voice ??= parsedTags.voiceGender ?? undefined;
      }
      try {
        const id = store(i, lecture, lecturePlaylist(course, i, result));
        generated++;
        // The published file name, once stage B has minted one, is permanent —
        // carry it through so a regenerated lecture keeps its link.
        current = setLectureStatus(current, i, { state: "done", id, file: lecture.status?.file, ts });
        hooks.onLecture(i, "done");
      } catch (err) {
        failed.push(i);
        current = setLectureStatus(current, i, { state: "failed", error: (err as Error).message, ts });
        hooks.onLecture(i, "failed");
      }
    }
    hooks.onDocument(current);
  }
  return { text: current, generated, failed };
}
