// Multi-part generation (#playlist / #parts=N): one small outline call, then
// one ordinary generateSpec per part. Per-part generation stays inside the
// schema and quality envelope tuned for single figures — one giant completion
// with several specs would not. The builders here are pure and tested; the
// orchestrator lives in main.ts where progress is reported.

export interface OutlinePart {
  title: string;
  brief: string;
  level?: "basic" | "advanced";
}

export interface Outline {
  title: string;
  parts: OutlinePart[];
}

const MAX_PARTS = 6;

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
          title: { type: "string", description: "Short title of this part (shown on its transition card)." },
          brief: { type: "string", description: "One line: what this part covers and its role in the arc." },
          level: { type: "string", enum: ["basic", "advanced"], description: "Only when the request implies one." },
        },
        required: ["title", "brief"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "parts"],
  additionalProperties: false,
} as const;

export function buildOutlineMessages(request: string, parts: number | null): { system: string; user: string } {
  const count = parts !== null ? `exactly ${parts} parts` : "2–4 parts (your judgement: fewest parts that teach it well)";
  const system = [
    "You plan a multi-part drawcast: a short series of narrated, hand-drawn teaching figures, each about 30–90 seconds.",
    `Split the request into ${count}. Each part must stand on one single figure and one idea.`,
    "Design the arc across parts: part 1 opens with the hook, the middle carries the development (a worked example, and one pros/cons or debate moment if the topic has one), the last part delivers the synthesis.",
    "Return ONLY JSON matching the given schema.",
  ].join("\n");
  return { system, user: request };
}

/** Validate/clean the outline JSON; null when unusable. */
export function normalizeOutline(json: unknown): Outline | null {
  if (typeof json !== "object" || json === null) return null;
  const raw = json as { title?: unknown; parts?: unknown };
  if (typeof raw.title !== "string" || !Array.isArray(raw.parts)) return null;
  const parts: OutlinePart[] = [];
  for (const p of raw.parts) {
    if (typeof p !== "object" || p === null) continue;
    const { title, brief, level } = p as Record<string, unknown>;
    if (typeof title !== "string" || typeof brief !== "string") continue;
    const part: OutlinePart = { title, brief };
    if (level === "basic" || level === "advanced") part.level = level;
    parts.push(part);
  }
  if (parts.length < 2) return null;
  return { title: raw.title, parts: parts.slice(0, MAX_PARTS) };
}

/** The per-part request handed to the ordinary single-figure generator. */
export function buildPartRequest(clean: string, outline: Outline, index: number, brief: string): string {
  const part = outline.parts[index];
  const n = outline.parts.length;
  const lines = [
    clean,
    "",
    `This drawcast is part ${index + 1} of ${n} in the series "${outline.title}".`,
    `This part: ${part.title} — ${part.brief}.`,
    `The full series: ${outline.parts.map((p, i) => `${i + 1}. ${p.title}`).join("; ")}.`,
  ];
  if (index === 0) {
    lines.push("Open the series with a hook — a question, a puzzle, a surprising number, or an analogy — that the final part will answer.");
  } else {
    lines.push(
      `The previous part was "${outline.parts[index - 1].title}". Open by bridging from it in one sentence ("Now that we have seen …") — do not re-introduce the whole topic.`,
    );
  }
  if (index === n - 1) {
    lines.push("End with a synthesis that answers the series' opening hook.");
  }
  if (brief) lines.push("", brief);
  return lines.join("\n");
}
