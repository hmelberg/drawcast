// The course planner: one call turning a free-form request into a course
// document. It writes questions and assigns tags; it never writes specs — the
// runner hands each lecture to the ordinary generator.

import { makeClient, callForJson } from "../llm/client";
import { buildBrief, TAGS } from "../llm/tags";
import { MAX_LECTURES, type Course, type CourseLecture } from "./document";
import COURSE_PROMPT from "../llm/prompts/course-v1.md?raw";

/** Flat schema (structured-output friendly: no oneOf/anyOf), mirroring OUTLINE_SCHEMA. */
export const COURSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title of the whole course." },
    // Closed on purpose: structured outputs accept only `additionalProperties:
    // false`, and an open map here 400'd every plan (2026-09-06). The four
    // keys are the ones the prompt already names; omit what you have nothing
    // to say for.
    context: {
      type: "object",
      description: "What every lecture shares. Omit a key you have nothing to say for.",
      properties: {
        level: { type: "string", description: "Who the course is for, e.g. \"master students in economics\"." },
        language: { type: "string", description: "The language the lectures are narrated in." },
        notation: { type: "string", description: "The symbols the whole course uses for its quantities." },
        example: { type: "string", description: "One running example every lecture returns to." },
      },
      additionalProperties: false,
    },
    intro: { type: "string", description: "One or two sentences describing the course." },
    lectures: {
      type: "array",
      description: "The lectures, in teaching order. Each becomes one video.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title of this lecture." },
          questions: {
            type: "array",
            description: "2–4 concrete questions this lecture must answer.",
            items: { type: "string" },
          },
          tags: {
            type: "array",
            description: "Tags from the vocabulary, without the leading #, e.g. why, controversy, parts=4.",
            items: { type: "string" },
          },
          chapters: {
            type: "array",
            description: "Only for a lecture near ten minutes; otherwise empty.",
            items: { type: "string" },
          },
        },
        required: ["title", "questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "lectures"],
  additionalProperties: false,
} as const;

function tagVocabulary(): string {
  return TAGS.map((t) => `- \`#${t.tag}\` — ${t.hint}`).join("\n");
}

/**
 * The course philosophy — questions not topics, the shared context block, tag
 * variation, the fabrication guardrail. Shared with revision, so a revised
 * course is held to the same rules the planner wrote it under.
 */
export function courseSystemPrompt(): string {
  return COURSE_PROMPT.replace("{{TAGS}}", () => tagVocabulary());
}

/**
 * The course's brief as the planner reads it: the tags' directing sentences,
 * framed as fixed. `tags` are the course-level tags (`#for=nurses`, `#basic`);
 * "" when there are none.
 */
export function courseBriefBlock(tags: string[]): string {
  const brief = buildBrief(tags.map((t) => t.replace(/^#/, "")));
  if (!brief) return "";
  return [
    `The author has set the course's brief (${tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}). Every lecture will be generated with it, so plan for this audience and level — the questions, the running example and context.level — and do not repeat these tags on the lectures:`,
    brief,
  ].join("\n");
}

export function buildCourseMessages(request: string, lectures: number | null, brief: string[] = []): { system: string; user: string } {
  const count =
    lectures !== null
      ? `exactly ${lectures} lectures`
      : `as many lectures as the topic needs (your judgement; never more than ${MAX_LECTURES})`;
  const system = [
    courseSystemPrompt(),
    "",
    `Plan ${count}.`,
    // The shape lives in the prompt text too: when structured outputs are
    // unavailable (the client degrades to plain JSON per session), the model
    // must still know exactly what to return.
    "Return ONLY a minified JSON object of exactly this shape, nothing else:",
    '{"title":"<course title>","context":{"level":"…","language":"…","notation":"…","example":"…"},"intro":"<one or two sentences>","lectures":[{"title":"<lecture title>","questions":["<question>"],"tags":["why","parts=4"],"chapters":[]}]}',
  ].join("\n");
  const block = courseBriefBlock(brief);
  return { system, user: block ? `${request}\n\n${block}` : request };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/**
 * Validate/clean the plan JSON; null when unusable. Tolerant on purpose — in
 * the plain-JSON fallback the model is unconstrained, so a lecture needs only
 * a title to survive, exactly like normalizeOutline.
 */
export function normalizeCoursePlan(json: unknown): Course | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = json as Record<string, unknown>;
  if (!Array.isArray(raw.lectures)) return null;

  const lectures: CourseLecture[] = [];
  for (const item of raw.lectures) {
    if (typeof item !== "object" || item === null) continue;
    const { title, questions, tags, chapters } = item as Record<string, unknown>;
    if (typeof title !== "string" || title.length === 0) continue;
    lectures.push({
      title,
      questions: stringArray(questions),
      chapters: stringArray(chapters),
      // The document format is canonical: tags always carry their #.
      tags: stringArray(tags).map((t) => (t.startsWith("#") ? t : `#${t}`)),
      options: {},
    });
  }
  if (lectures.length < 2) return null;

  const context: Record<string, string> = {};
  if (typeof raw.context === "object" && raw.context !== null) {
    for (const [key, value] of Object.entries(raw.context as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) context[key.toLowerCase()] = value;
    }
  }
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    context,
    intro: typeof raw.intro === "string" && raw.intro.length > 0 ? raw.intro : undefined,
    lectures: lectures.slice(0, MAX_LECTURES),
    warnings: [],
  };
}

export async function generateCoursePlan(
  request: string,
  cfg: { apiKey: string; model: string },
  lectures: number | null,
  signal?: AbortSignal,
  brief: string[] = [],
): Promise<Course | null> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildCourseMessages(request, lectures, brief);
  // Medium, not the default high: one call per course, and its judgement is
  // the product (which questions, which lecture gets `controversy`), so it
  // keeps more thinking than the outline does — but a plan is a page of
  // JSON, not a proof (cost round 2026-09-18).
  const { json } = await callForJson(client, cfg.model, system, [{ role: "user", content: user }], COURSE_SCHEMA as unknown as object, { signal, effort: "medium" });
  const course = normalizeCoursePlan(json);
  if (course && !course.title) course.title = request;
  // Stored with the course (the header's tag line), so every lecture's
  // storyboard and part is generated with the same brief (run.ts lectureTags).
  if (course && brief.length > 0) course.tags = brief.map((t) => (t.startsWith("#") ? t : `#${t}`));
  return course;
}
