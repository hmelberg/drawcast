// Hashtag directives in the AI request text. One vocabulary drives parsing,
// the recognized-tag chips, and the autosuggest popup. A tag changes what the
// AI writes — never how the app plays (playback stays in Settings/controls).
// Recognized tags are stripped from the text; unknown #words are left alone
// (a literal # in a request must never be eaten) and reported for the UI.

export type TagGroup = "length" | "level" | "language" | "teaching" | "pacing" | "gestures" | "structure";

export interface TagDef {
  tag: string;
  aliases?: string[];
  /** Tags in the same exclusive group overwrite each other (last one wins). */
  group: TagGroup;
  /** One-line effect, shown in the autosuggest popup and chip tooltips. */
  hint: string;
  /** Sentences contributed to the directing brief ("" for structure tags). */
  brief: string;
}

export const TAGS: TagDef[] = [
  {
    tag: "veryshort",
    group: "length",
    hint: "2–3 spoken lines, one single idea",
    brief: "Keep it VERY short: 2–3 speak lines, one single idea, no preamble. Override the examples' length.",
  },
  {
    tag: "short",
    group: "length",
    hint: "3–4 spoken lines, one idea",
    brief: "Keep it short: 3–4 speak lines, one idea only, no preamble. Override the examples' length.",
  },
  {
    tag: "long",
    group: "length",
    hint: "10–16 lines in 2–3 acts: announce, example, step by step, synthesis",
    brief:
      "Make it a long drawcast: 10–16 speak lines in 2–3 acts (use clear between acts); override the examples' length. " +
      "Open by saying in one sentence what you will explain (with drawing already underway), then ground it in one concrete example with real numbers — a concrete case is the best hook. " +
      "Build the explanation step by step through that example: draw each element FIRST, then explain it — what it is and why it matters — and no step is skipped. " +
      "End with a one-line synthesis of the insight.",
  },
  {
    tag: "verylong",
    group: "length",
    hint: "16–24 lines, deep dive: announce, example, steps, debate, synthesis",
    brief:
      "Make it a deep-dive drawcast: 16–24 speak lines in 3–4 acts (use clear between acts); override the examples' length. " +
      "Open by saying in one sentence what you will explain (with drawing already underway), then ground it in one concrete example with real numbers — a concrete case is the best hook. " +
      "Build the explanation step by step through that example: draw each element FIRST, then explain it — what it is and why it matters — and no step is skipped. " +
      "Give context for why the concept matters, include one pros/cons or debate/controversy moment related to it, and optionally a brief historical remark. " +
      "End with a synthesis that restates the core insight in the example's terms.",
  },
  {
    tag: "basic",
    group: "level",
    hint: "beginner audience: no jargon, everyday example",
    brief: "Audience: beginners. No jargon — define every term in everyday words, use a familiar everyday example, assume no prior knowledge.",
  },
  {
    tag: "advanced",
    group: "level",
    hint: "advanced audience: technical terms, assumptions stated",
    brief: "Audience: advanced. Use precise technical vocabulary, assume prior knowledge, and state assumptions or conditions where they matter.",
  },
  {
    tag: "norwegian",
    aliases: ["nb", "norsk"],
    group: "language",
    hint: "narration and labels in Norwegian",
    brief: "Write ALL narration (speak lines) and all labels in Norwegian (bokmål).",
  },
  {
    tag: "english",
    aliases: ["en"],
    group: "language",
    hint: "narration and labels in English",
    brief: "Write all narration (speak lines) and all labels in English.",
  },
  {
    tag: "socratic",
    group: "teaching",
    hint: "ask → pause → reveal",
    brief:
      "Socratic style: before each key reveal, ask the viewer a question in a speak line, then pause (1.5–2 s), then draw or show the answer. " +
      "A guessed-then-corrected belief sticks; an announced fact doesn't.",
  },
  {
    tag: "calm",
    group: "pacing",
    hint: "unhurried pacing with more pauses",
    brief: "Calm pacing: add short pauses between ideas and keep sentences unhurried.",
  },
  {
    tag: "rich",
    group: "gestures",
    hint: "generous gestures: point, highlight, camera",
    brief: "Use gestures generously: a point or highlight after most reveals, and at least one camera zoom on a key detail.",
  },
  {
    tag: "nogestures",
    group: "gestures",
    hint: "no point/highlight/camera at all",
    brief: "Use no gesture verbs (no point, highlight, or camera) — just speak, draw and pause.",
  },
  {
    tag: "click",
    group: "structure",
    hint: "click-to-continue gates at act boundaries",
    brief:
      'At each act boundary (and before the key reveal, if natural) insert a {"wait": "click"} command so the viewer clicks to continue.',
  },
  {
    tag: "playlist",
    group: "structure",
    hint: "multi-part drawcast (AI chooses 2–4 parts)",
    brief: "",
  },
  {
    tag: "parts=N",
    group: "structure",
    hint: "multi-part drawcast with exactly N parts",
    brief: "",
  },
];

const byName = new Map<string, TagDef>();
for (const def of TAGS) {
  if (!def.tag.includes("=")) byName.set(def.tag, def);
  for (const a of def.aliases ?? []) byName.set(a, def);
}

export interface ParsedTags {
  /** The request with recognized tags removed (whitespace collapsed). */
  clean: string;
  /** Canonical tag names in the order they apply, after exclusive-group resolution. */
  tags: string[];
  playlist: boolean;
  /** Explicit part count from #parts=N; null = not given (AI decides). */
  parts: number | null;
  /** #words that matched no tag — left in the text, surfaced in the UI. */
  unknown: string[];
  /** Difficulty for stamping into the generated spec. */
  level: "basic" | "advanced" | null;
}

const TAG_RE = /(^|\s)#([a-zæøå]+(?:=[^\s#]+)?)/gi;

export function parseTags(text: string): ParsedTags {
  const unknown: string[] = [];
  /** Per exclusive group: the def that currently wins (last mention). */
  const byGroup = new Map<TagGroup, TagDef>();
  const order: TagDef[] = [];
  let playlist = false;
  let parts: number | null = null;

  const clean = text
    .replace(TAG_RE, (whole, lead: string, word: string) => {
      const lower = word.toLowerCase();
      const partsMatch = /^parts=(\d+)$/.exec(lower);
      if (partsMatch) {
        playlist = true;
        parts = parseInt(partsMatch[1], 10);
        return lead;
      }
      const def = byName.get(lower);
      if (!def) {
        unknown.push(word);
        return whole; // unrecognized: leave the text untouched
      }
      if (def.tag === "playlist") {
        playlist = true;
        return lead;
      }
      const prev = byGroup.get(def.group);
      if (prev) order.splice(order.indexOf(prev), 1);
      byGroup.set(def.group, def);
      order.push(def);
      return lead;
    })
    .replace(/[ \t]+/g, " ")
    .trim();

  const level = byGroup.get("level")?.tag ?? null;
  return {
    clean,
    tags: order.map((d) => d.tag),
    playlist,
    parts,
    unknown,
    level: level === "basic" || level === "advanced" ? level : null,
  };
}

/** The directing-brief block appended to the user message ("" when nothing applies). */
export function buildBrief(tags: string[]): string {
  const lines = tags
    .map((t) => byName.get(t)?.brief ?? "")
    .filter((b) => b.length > 0);
  if (lines.length === 0) return "";
  return `Directing brief:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export interface TagSuggestion {
  tag: string;
  hint: string;
}

/** Tags matching a (possibly empty) prefix — canonical names and aliases both match. */
export function suggestTags(prefix: string): TagSuggestion[] {
  const p = prefix.toLowerCase();
  const seen = new Set<string>();
  const out: TagSuggestion[] = [];
  for (const def of TAGS) {
    const names = [def.tag, ...(def.aliases ?? [])];
    if (names.some((n) => n.toLowerCase().startsWith(p)) && !seen.has(def.tag)) {
      seen.add(def.tag);
      out.push({ tag: def.tag, hint: def.hint });
    }
  }
  return out;
}
