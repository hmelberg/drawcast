// Revising a course: the whole document goes out, a whole replacement comes
// back. Text in, text out — so the author's hand-editing rides along and only
// what the instruction asks for changes.
//
// Deliberately not a continued conversation, for the same reason
// llm/revise.ts is not: a stateless call also works on a course loaded from
// the library, and its cost does not grow every round. The document IS the
// conversation state.
//
// Status lines never leave and never come back from the model. A free-text
// rewrite that quietly dropped "status: done" would make the next run
// regenerate the whole course — real money, silently. So they are stripped
// before sending and re-applied afterwards by matching lecture titles.

import { callForText, describeApiError, makeClient } from "../llm/client";
import { stripFence } from "../llm/prompt";
import { parseCourse, setLectureStatus, type LectureStatus } from "./document";
import { courseSystemPrompt } from "./plan";

const STATUS_LINE_RE = /^\s*status\s*:/;

/** The document as the model should see it: no bookkeeping, no wasted tokens. */
export function stripStatusLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !STATUS_LINE_RE.test(line))
    .join("\n");
}

/** Every generated lecture's status, keyed by the title it had. */
export function statusesByTitle(text: string): Map<string, LectureStatus> {
  const map = new Map<string, LectureStatus>();
  for (const lecture of parseCourse(text).lectures) {
    if (lecture.status) map.set(lecture.title, lecture.status);
  }
  return map;
}

/**
 * Put the statuses back on the lectures that still carry the same title. A
 * renamed lecture loses its status and will regenerate — which is right:
 * retitling a lecture usually means having changed your mind about it.
 */
export function applyStatuses(text: string, statuses: Map<string, LectureStatus>): string {
  let out = text;
  parseCourse(text).lectures.forEach((lecture, i) => {
    const status = statuses.get(lecture.title);
    if (status) out = setLectureStatus(out, i, status);
  });
  return out;
}

export function buildCourseReviseUser(docText: string, instruction: string): string {
  return [
    "Here is the current course document:",
    "```markdown",
    stripStatusLines(docText).trim(),
    "```",
    "",
    `Apply this change: ${instruction}`,
    "",
    "Return the COMPLETE document in the same markdown shape it came in.",
    "Change only what the instruction asks for and leave every other lecture exactly as it is, word for word.",
    "Return the document only, with no commentary before or after it.",
  ].join("\n");
}

/** Accept a reply only if it is actually a course document. */
export function acceptRevision(raw: string): { text: string | null; error?: string } {
  const cleaned = stripFence(raw).trim();
  if (!cleaned) return { text: null, error: "the model returned nothing" };
  const course = parseCourse(cleaned);
  if (course.lectures.length === 0) {
    return { text: null, error: "the reply contains no lectures — the document was left as it was" };
  }
  return { text: cleaned };
}

export interface CourseReviseConfig {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** Called as the model rewrites, once per streamed delta. */
  onProgress?: (chars: number) => void;
}

export interface CourseReviseOutcome {
  text: string | null;
  error?: string;
}

export async function reviseCourse(
  docText: string,
  instruction: string,
  cfg: CourseReviseConfig,
): Promise<CourseReviseOutcome> {
  const system = [
    // The same philosophy the planner wrote under, so a revised course is held
    // to the same rules: questions not topics, varied tags, no invented debates.
    courseSystemPrompt(),
    "",
    "You are REVISING an existing course document, not writing a new one.",
    "Keep its markdown shape exactly: `#` course title, `key: value` context lines, `---` between lectures, `##` per lecture, questions one per line, and a tag line such as `#why #parts=4`.",
  ].join("\n");

  const statuses = statusesByTitle(docText);
  try {
    const { text: raw } = await callForText(
      makeClient(cfg.apiKey),
      cfg.model,
      system,
      [{ role: "user", content: buildCourseReviseUser(docText, instruction) }],
      {
        signal: cfg.signal,
        onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!(text.length)),
      },
    );
    const accepted = acceptRevision(raw);
    if (!accepted.text) return accepted;
    return { text: applyStatuses(accepted.text, statuses) };
  } catch (err) {
    return { text: null, error: describeApiError(err) };
  }
}
