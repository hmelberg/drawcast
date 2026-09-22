// Multi-part generation (#playlist / #parts=N): one small outline call, then
// one ordinary generateSpec per part. Per-part generation stays inside the
// schema and quality envelope tuned for single figures — one giant completion
// with several specs would not. The builders here are pure and tested; the
// orchestrator lives in main.ts where progress is reported.

export interface OutlinePart {
  title: string;
  brief: string;
  level?: "basic" | "advanced";
  /** The author-declared chapter this part falls under, when the caller declared any. */
  chapter?: string;
  /**
   * Storyboard approach only (llm/storyboard.ts): what this part's figure
   * is and what changes across its beats — the artist's paragraph.
   */
  figure?: string;
  /**
   * Storyboard approach only: the spoken lines, in order, written for the
   * whole series at once. A part with a script is DRAWN to it
   * (buildPartRequest) and skips the per-part teaching pass (multi.ts).
   */
  script?: string[];
}

export interface Outline {
  title: string;
  parts: OutlinePart[];
}

export const MAX_PARTS = 6;

/** Flat schema for the outline call (structured-output friendly: no oneOf/anyOf). */
export const OUTLINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short overall title of the series." },
    parts: {
      type: "array",
      description: "The parts, in teaching order.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title of this part (shown on the continue button between parts)." },
          brief: { type: "string", description: "One line: what this part covers and its role in the arc." },
          level: { type: "string", enum: ["basic", "advanced"], description: "Only when the request implies one." },
          chapter: { type: "string", description: "Which declared chapter this part belongs to. Omit when no chapters were declared." },
        },
        required: ["title", "brief"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "parts"],
  additionalProperties: false,
} as const;

/**
 * The outline schema with an explicit `#parts=N` written INTO it. This call's
 * schema is a real structured-output constraint (client.ts
 * structuredOutputSupported passes it), so the count is enforced by the
 * grammar rather than asked for in prose and clipped afterwards — the
 * measured failure (2026-09-22) was five parts for an explicit three, and
 * clipping the five loses the synthesis. normalizeOutline's clip stays as
 * the backstop for the plain-JSON fallback. `want` null (a bare `#parts`)
 * leaves the count to the planner.
 */
export function outlineSchemaFor(want: number | null, base: typeof OUTLINE_SCHEMA = OUTLINE_SCHEMA): object {
  if (want === null) return base;
  const n = Math.max(1, Math.min(want, MAX_PARTS));
  return { ...base, properties: { ...base.properties, parts: { ...base.properties.parts, minItems: n, maxItems: n } } };
}

/**
 * A series short enough to watch in one sitting needs no chapters: the cards
 * would be two extra title screens in four minutes. From four parts up the
 * arc can have movements worth naming, so the planner is OFFERED the field —
 * never required to use it. Below the gate the shape does not mention
 * chapters at all, which is how a three-part drawcast stays chapterless
 * without being told to.
 *
 * A course is the other case entirely: there the author declared the
 * chapters, and the planner's job is to assign parts to them, not to invent
 * any (buildOutlineMessages / buildStoryboardMessages take `chapters`).
 */
export const CHAPTERS_FROM_PARTS = 4;

export function mayProposeChapters(parts: number | null, declared?: string[]): boolean {
  return (!declared || declared.length === 0) && parts !== null && parts >= CHAPTERS_FROM_PARTS;
}

/** The one copy of the instruction, so the two planners cannot drift apart. */
export const PROPOSE_CHAPTERS_LINE =
  "chapter: OPTIONAL. If this series really has movements — two or three stretches that each do something different — name them and give every part the one it falls under, in order. The viewer then gets a chapter card where each begins. A chapter covering every part says nothing, and one chapter per part is not a grouping: leave the field out entirely unless several parts share each name.";

export function buildOutlineMessages(
  request: string,
  parts: number | null,
  chapters?: string[],
): { system: string; user: string } {
  const count = parts !== null ? `exactly ${parts} parts` : "1–4 parts (your judgement: the fewest that teach it well — ONE is a real answer when the question is genuinely one figure, and padding a single idea into three is worse than one good part)";
  const system = [
    "You plan a multi-part drawcast: a short series of narrated, hand-drawn teaching figures, each about 30–90 seconds.",
    `Split the request into ${count}. Each part must stand on one single figure and one idea.`,
    "Design the arc across parts: part 1 announces what the series will explain and grounds it in a concrete example, the middle carries the step-by-step development (the worked example, and one brief enrichment moment if the topic genuinely offers one — why it matters, a real debate, a historical note, an empirical number, or strengths and weaknesses — never more than one per part), the last part delivers the synthesis.",
  ];
  const propose = mayProposeChapters(parts, chapters);
  if (chapters && chapters.length > 0) {
    system.push(
      `The author declared these chapters, in order: ${chapters.map((c, i) => `${i + 1}. ${c}`).join("; ")}. ` +
        "Assign every part to one of them with the `chapter` field, in order, and never invent a chapter that is not on this list.",
    );
  } else if (propose) {
    system.push(PROPOSE_CHAPTERS_LINE);
  }
  // The shape lives in the prompt text too: when structured outputs are
  // unavailable (the client degrades to plain JSON per session), the model
  // must still know exactly what to return.
  const part = [
    '"title": "<short part title>"',
    '"brief": "<one line: coverage and role in the arc>"',
    '"level": "basic|advanced (only when the request implies one)"',
    ...(chapters && chapters.length > 0 ? ['"chapter": "<one of the declared chapters>"'] : propose ? ['"chapter": "<the chapter this part falls under, or omit the field>"'] : []),
  ].join(", ");
  system.push("Return ONLY a minified JSON object of exactly this shape, nothing else:", `{"title": "<short series title>", "parts": [{${part}}]}`);
  return { system: system.join("\n"), user: request };
}

/**
 * Validate/clean the outline JSON; null when unusable. Tolerant on purpose —
 * in the plain-JSON fallback the model is unconstrained, so a part needs only
 * a title to survive; a missing series title becomes "" (caller falls back to
 * the request).
 */
/**
 * `want` is the count the author asked for with `#parts=N`, or null for a
 * bare `#parts` (the planner's own judgement). Until 2026-09-22 this was not
 * passed at all: the prompt said "exactly N parts" and NOTHING checked the
 * reply, so an explicit #parts=3 could come back as five — measured, with
 * two of the five near-duplicate syntheses. Asking is not enforcing.
 */
export function normalizeOutline(json: unknown, chapters?: string[], want: number | null = null): Outline | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = json as { title?: unknown; parts?: unknown };
  if (!Array.isArray(raw.parts)) return null;
  const parts: OutlinePart[] = [];
  for (const p of raw.parts) {
    if (typeof p !== "object" || p === null) continue;
    const { title, brief, level, chapter, figure, script } = p as Record<string, unknown>;
    if (typeof title !== "string" || title.length === 0) continue;
    const part: OutlinePart = { title, brief: typeof brief === "string" ? brief : "" };
    if (level === "basic" || level === "advanced") part.level = level;
    // Declared chapters are a closed list — the plain-JSON fallback is
    // unconstrained, so an invented one must not reach the playlist as a
    // chapter card nobody asked for. With none declared the planner may have
    // been invited to propose some (mayProposeChapters), and those are taken
    // as written; dropPointlessChapters below throws out the groupings that
    // group nothing.
    if (typeof chapter === "string" && chapter.trim() && (!chapters || chapters.includes(chapter))) part.chapter = chapter.trim();
    // The storyboard's two extra fields (llm/storyboard.ts); an outline reply
    // simply never carries them. An empty script is no script: the part then
    // falls back to being written on its own, teaching pass included.
    if (typeof figure === "string" && figure.trim()) part.figure = figure.trim();
    if (Array.isArray(script)) {
      const lines = script.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim());
      if (lines.length > 0) part.script = lines;
    }
    parts.push(part);
  }
  // ONE part is a legitimate answer to a bare `#parts` (Hans 2026-09-22):
  // some questions are one figure, and a planner forced to split them pads.
  // Zero is not an answer, and neither is a reply we could not read.
  if (parts.length < 1) return null;
  // An explicit #parts=N is honoured by CLIPPING to the first N, never by
  // grafting the planner's last part onto a shorter arc. The parts arrive in
  // teaching order, and a synthesis written to follow five parts names what
  // those five showed — pasted after part two it promises a payoff the
  // viewer never saw ("now that we have seen … the mathematics", when the
  // mathematics was one of the parts dropped). Truncation loses the ending;
  // grafting invents a false one, which is worse.
  const ceiling = want !== null ? Math.min(want, MAX_PARTS) : MAX_PARTS;
  const kept = parts.slice(0, ceiling);
  if (!chapters || chapters.length === 0) dropPointlessChapters(kept);
  return { title: typeof raw.title === "string" ? raw.title : "", parts: kept };
}

/**
 * The two groupings that group nothing, which a prompt rule alone will not
 * hold off: EVERY part under one chapter — a label that shows no card at all,
 * since exportSequence only cards a CROSSING — and one chapter per part,
 * which turns every junction into a title card. Both come back as no
 * chapters, which is what the series would have had before it was offered the
 * field. A partial naming is left alone: parts outside the first chapter read
 * as a preface, and the crossing into it is a real one.
 *
 * Proposed chapters only — a declared list is the author's business, however
 * they use it.
 */
function dropPointlessChapters(parts: OutlinePart[]): void {
  const named = parts.filter((p) => p.chapter !== undefined);
  if (named.length === 0 || named.length !== parts.length) return;
  const distinct = new Set(named.map((p) => p.chapter)).size;
  if (distinct > 1 && distinct < parts.length) return;
  for (const p of parts) delete p.chapter;
}

/** The per-part request handed to the ordinary single-figure generator. */
export function buildPartRequest(clean: string, outline: Outline, index: number, brief: string): string {
  const part = outline.parts[index];
  const n = outline.parts.length;
  const lines = [
    clean,
    "",
    `This drawcast is part ${index + 1} of ${n} in the series "${outline.title}".`,
    `This part: ${part.brief ? `${part.title} — ${part.brief}` : part.title}.`,
    `The full series: ${outline.parts.map((p, i) => `${i + 1}. ${p.title}`).join("; ")}.`,
  ];
  if (index === 0) {
    lines.push(
      "Open by saying in one sentence what the whole series will explain, then ground this part in a concrete example — with drawing already underway, never a teaser over a blank canvas.",
    );
  } else {
    lines.push(
      `The previous part was "${outline.parts[index - 1].title}". Open by bridging from it in one sentence ("Now that we have seen …") — do not re-introduce the whole topic.`,
    );
  }
  if (index === n - 1) {
    lines.push("End with a synthesis that ties the series together and restates the core insight.");
  }
  if (brief) lines.push("", brief);
  if (part.script && part.script.length > 0) lines.push("", scriptBlock(part));
  return lines.join("\n");
}

/**
 * The storyboard's hand-over to the artist (docs/2026-09-19-storyboard-
 * approach.md): the figure paragraph and the lines, with the one rule that
 * makes the series cohere — the words are written, the job is to STAGE
 * them. Appended LAST, after the tag brief, so that a brief's "open with a
 * question" cannot read as licence to write a line the script lacks.
 */
export function scriptBlock(part: OutlinePart): string {
  const out: string[] = [];
  if (part.figure) out.push(`The figure for this part: ${part.figure}`, "");
  out.push(
    "The narration for this part is ALREADY WRITTEN — for the whole series at once, so it bridges from the previous part, uses the series' notation and repeats nothing. Your job is to STAGE it: each line below becomes the `speak` of the draw command it belongs to, in this order, one line per beat (two short ones where the ink is a single stroke). You may tighten a line to fit its ink; do not reword its content, reorder, drop or add lines — a quiz or ask the brief calls for carries its own question text and nothing more.",
    "",
    ...(part.script ?? []).map((line, i) => `${i + 1}. ${line}`),
  );
  return out.join("\n");
}
