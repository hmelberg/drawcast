// The course runner: generate the lectures that are missing, in two parallel
// phases through the ordinary multi-part generator, writing status back into
// the document as each lands so an interrupted run resumes instead of
// restarting.

import { collectSpeakLines } from "../export/video";
import { type GenerateConfig } from "../llm/compile";
import { generateFromOutline, outlineParts, type PartsRequest, type PartsResult } from "../llm/multi";
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
    // Deferential on purpose. The teacher has already decided what this lecture
    // is; classifying their lines for them would make the model perform a
    // category instead of serving the content, and how a line is written is
    // itself the signal. The opinions live in the planner (prompts/course-v1.md),
    // whose output is a draft the teacher edits — not here, where it is not.
    lines.push(
      "",
      "These are the teacher's notes for this lecture — what it must cover, in this order:",
      ...lecture.questions.map((q) => `- ${q}`),
      "",
      "Read them as they are written: some are questions to answer, some are things to explain, some are material to show.",
    );
  } else {
    lines.push(
      "",
      `No questions or topics were given, so the lecture is its title: explain "${lecture.title}" — what it is, why it matters, and how it works.`,
    );
  }
  // `minutes` is a budget for the planner and `slug` is a file name; neither
  // is something to narrate.
  const context = Object.entries({ ...course.context, ...lecture.options }).filter(
    ([key]) => key !== "minutes" && key !== "slug",
  );
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
  // The founding request travels in the file (B9), for a lecture exactly as
  // for a hand-typed Generate: what the teacher asked this lecture to cover.
  // The notes, not buildLectureRequest's assembled prompt — that one restates
  // the whole course around them and goes stale the moment a lecture is
  // renamed or reordered. A lecture with no notes IS its title, which is how
  // buildLectureRequest reads it too.
  const prompt = lecture.questions.join(" ").trim() || lecture.title;
  return { meta: { ...DEFAULT_META, title: lecture.title, prompt }, entries, warnings: [] };
}

/** An error must fit on one status line: no newlines, no "·" (the line's own separator), not endless. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").replace(/·/g, "-").trim().slice(0, 300);
}

/**
 * Why a lecture failed, from its parts result — undefined when every part
 * landed. A lecture with a part missing is a failed lecture: its arc has a
 * hole, and storing it as done would hide that the run lost work.
 */
export function partsFailure(result: PartsResult, parts: number): string | undefined {
  if (result.failed.length === 0 && result.specs.length > 0) return undefined;
  const first = result.errors?.[0] ?? result.error ?? "no spec";
  if (result.specs.length === 0) return oneLine(first);
  const which = result.failed.length === 1 ? `part ${result.failed[0]}` : `parts ${result.failed.join(", ")}`;
  return oneLine(`${which} of ${parts} failed — ${first}`);
}

export interface RunProgress {
  phase: "outlining" | "generating";
  lecturesTotal: number;
  lecturesDone: number;
  /** Known only once the outlines are in; 0 while outlining. */
  partsTotal: number;
  partsDone: number;
}

export interface RunHooks {
  onLecture(index: number, phase: "start" | "done" | "failed"): void;
  /** Aggregate progress across the whole run — a lecture takes minutes, and a
   *  status line that never moves reads as a hang. */
  onProgress(progress: RunProgress): void;
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

/** The lectures a run would touch: what is missing, or exactly the one named. */
export function pendingIndices(course: Course, opts: RunOptions = {}): number[] {
  if (opts.only !== undefined) return opts.only < course.lectures.length ? [opts.only] : [];
  return course.lectures.map((_, i) => i).filter((i) => isPending(course.lectures[i]));
}

function requestFor(course: Course, index: number): PartsRequest {
  const lecture = course.lectures[index];
  const parsedTags = parseTags(lecture.tags.join(" "));
  return {
    request: buildLectureRequest(course, index),
    parts: partsOf(lecture),
    brief: buildBrief(parsedTags.tags),
    chapters: lecture.chapters.length > 0 ? lecture.chapters : undefined,
  };
}

/**
 * "Generate" means "generate what is missing": a lecture marked done is skipped
 * unless `only` names it.
 *
 * Two phases, both parallel. Every outline first — they are small, independent,
 * and doing one inside each lecture's turn left the generation gate idle while
 * it ran. Then every part of every lecture is poured into ONE pool, so the gate
 * stays saturated instead of draining at each lecture boundary. Lectures have
 * no dependency on each other: buildLectureRequest composes its context from
 * the document's titles, never from another lecture's generated specs.
 *
 * Results land as they finish, so status is written back per lecture and a
 * cancelled run keeps everything that was already generated.
 */
export async function runCourse(
  text: string,
  cfg: GenerateConfig,
  hooks: RunHooks,
  store: StoreLecture,
  opts: RunOptions = {},
): Promise<RunResult> {
  const course = parseCourse(text);
  const targets = pendingIndices(course, opts);
  let current = text;
  let generated = 0;
  const failed: number[] = [];
  let lecturesDone = 0;
  let partsDone = 0;
  let partsTotal = 0;

  const progress = (phase: RunProgress["phase"]): void =>
    hooks.onProgress({ phase, lecturesTotal: targets.length, lecturesDone, partsTotal, partsDone });

  // ---- Phase 1: every outline at once -------------------------------------
  progress("outlining");
  const ts = new Date().toISOString().slice(0, 10);
  const plans = await Promise.all(
    targets.map(async (i) => {
      hooks.onLecture(i, "start");
      const request = requestFor(course, i);
      return { index: i, request, ...(await outlineParts(request, cfg)) };
    }),
  );

  for (const plan of plans) {
    if (plan.outline) partsTotal += plan.outline.parts.length;
    else {
      failed.push(plan.index);
      current = setLectureStatus(current, plan.index, { state: "failed", error: oneLine(plan.error ?? "no outline"), ts });
      hooks.onLecture(plan.index, "failed");
    }
  }
  if (failed.length > 0) hooks.onDocument(current);
  progress("generating");

  // ---- Phase 2: every part of every lecture in one pool --------------------
  await Promise.all(
    plans.map(async (plan) => {
      if (!plan.outline || cfg.signal?.aborted) return;
      const i = plan.index;
      const lecture = course.lectures[i];
      const parsedTags = parseTags(lecture.tags.join(" "));
      const result = await generateFromOutline(plan.request, plan.outline, cfg, {
        onPart: () => {
          partsDone++;
          progress("generating");
        },
      });

      const failure = partsFailure(result, plan.outline.parts.length);
      if (failure !== undefined) {
        failed.push(i);
        current = setLectureStatus(current, i, { state: "failed", error: failure, ts });
        hooks.onLecture(i, "failed");
      } else {
        for (const spec of result.specs) {
          spec.level ??= parsedTags.level ?? undefined;
          spec.voice ??= parsedTags.voiceGender ?? undefined;
        }
        try {
          // Synchronous between awaits, so the parallel lectures cannot
          // interleave mid-write and lose one another's status lines.
          const id = store(i, lecture, lecturePlaylist(course, i, result));
          generated++;
          // The published file name, once stage B has minted one, is permanent —
          // carry it through so a regenerated lecture keeps its link.
          current = setLectureStatus(current, i, { state: "done", id, file: lecture.status?.file, ts });
          hooks.onLecture(i, "done");
        } catch (err) {
          failed.push(i);
          current = setLectureStatus(current, i, { state: "failed", error: oneLine((err as Error).message), ts });
          hooks.onLecture(i, "failed");
        }
      }
      lecturesDone++;
      progress("generating");
      hooks.onDocument(current);
    }),
  );
  return { text: current, generated, failed: [...new Set(failed)].sort((a, b) => a - b) };
}
