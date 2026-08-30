// Hashtag directives in the AI request text. One vocabulary drives parsing,
// the recognized-tag chips, and the autosuggest popup. A tag changes what lands
// in the SPEC — commands, briefs that shape them, or spec metadata like level
// and voice — never Settings (device playback stays in Settings/controls).
// Recognized tags are stripped from the text; unknown #words are left alone
// (a literal # in a request must never be eaten) and reported for the UI.

export type TagGroup = "length" | "level" | "language" | "style" | "hook" | "why" | "controversy" | "history" | "facts" | "proscons" | "mode" | "pacing" | "tone" | "human" | "voice" | "gestures" | "structure" | "interaction";

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

/** Shared truthfulness guardrail for reality-referencing tags (spec principle 4). */
export const GUARDRAIL =
  "Only include claims, people, and numbers you are confident are real; if unsure, choose different material — never manufacture a controversy, quote, or statistic.";

/** Shared restraint clause for the tone tags (spec: tone briefs). */
export const RESTRAINT =
  "At most 1–2 light touches per drawcast, never forced — exaggerated humor bores fast — and the explanation stays rigorous; a joke rides on a narrated action and never delays the drawing.";

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
      "Build the explanation step by step through that example: narrate each element AS it is drawn (put speak on the draw command) — what it is and why it matters — and no step is skipped. " +
      "End with a one-line synthesis of the insight.",
  },
  {
    tag: "verylong",
    group: "length",
    hint: "16–24 lines, deep dive: announce, example, steps, debate, synthesis",
    brief:
      "Make it a deep-dive drawcast: 16–24 speak lines in 3–4 acts (use clear between acts); override the examples' length. " +
      "Open by saying in one sentence what you will explain (with drawing already underway), then ground it in one concrete example with real numbers — a concrete case is the best hook. " +
      "Build the explanation step by step through that example: narrate each element AS it is drawn (put speak on the draw command) — what it is and why it matters — and no step is skipped. " +
      "You have room for up to TWO enrichment moments (why it matters, a real debate, a historical note, empirical numbers, or strengths and weaknesses) — pick only what genuinely fits the topic. " +
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
    group: "style",
    hint: "ask → pause → reveal",
    brief:
      "Socratic style: before each key reveal, ask the viewer a question in a speak line, then pause (1.5–2 s), then draw or show the answer. " +
      "A guessed-then-corrected belief sticks; an announced fact doesn't.",
  },
  {
    tag: "qa",
    group: "style",
    hint: "dialogue: one asks and reacts, one answers and draws",
    brief:
      'Two speakers at a whiteboard, not two people at microphones. Speaker A (voice "a") is the teacher: A answers and draws. Speaker B (voice "b") asks and reacts — and is not a question machine: B also mis-guesses, reacts ("Oh — so the gap IS the loss?"), and summarizes; a wrong guess then corrected is where the insight lands. Mark EVERY speak line with voice "a" or "b". B\'s lines ride on gestures (point at what is being asked about) and A\'s on draws; never more than two speak-only lines in a row — the canvas keeps moving. Scale to the length budget: a short qa is one question, one drawn answer, one reaction.',
  },
  {
    tag: "podcast",
    group: "style",
    hint: "two peers talking informally while sketching",
    brief:
      'Two peers (voices "a" and "b") in an informal conversation at a whiteboard, not two people at microphones — either may draw and narrate; interruptions and sentences finished by the other are welcome, but always over a moving canvas: attach lines to draw/point/highlight/animate wherever possible, never more than two speak-only lines in a row. Mark EVERY speak line with voice "a" or "b".',
  },
  {
    tag: "story",
    group: "style",
    hint: "a historical episode or character, drawn as told",
    brief:
      "Tell it as a story: a historical episode or a running character, drawn as it is told — the timeline, data points, or schematic appear beat by beat with the telling. The story IS the hook; no separate opening needed. " +
      GUARDRAIL,
  },
  {
    tag: "question",
    group: "hook",
    hint: "open on a question the figure answers",
    brief:
      "Open on a real question: in the first beats, pose the puzzle the figure will answer in a speak line WHILE drawing the setup (never over a blank canvas), let the drawing answer it step by step, and end by answering the opening question explicitly.",
  },
  {
    tag: "debate",
    group: "hook",
    hint: "A says X, B says Y — the drawing decides",
    brief:
      "Open on a disagreement: voice two rival claims ('Some say X; others say Y — who is right?') while drawing both candidate pictures, then resolve it by drawing what is actually true, and strike or cross out the losing claim with an annotation at the moment of resolution. " +
      GUARDRAIL,
  },
  {
    tag: "provoke",
    group: "hook",
    hint: "state a common belief, then draw why it fails",
    brief:
      "Open on a provocation: state a common belief while drawing the naive picture of it, then visibly correct the picture (erase, redraw, or animate) as the narration shows why the belief fails. Only use beliefs people actually hold. " +
      GUARDRAIL,
  },
  {
    tag: "why",
    group: "why",
    hint: "say why the concept matters",
    brief:
      "Include the stakes: one or two speak lines on why this concept matters in the real world — who uses it, what goes wrong without it — woven in near the start or the synthesis, within the length budget.",
  },
  {
    tag: "controversy",
    group: "controversy",
    hint: "mention a real debate about the topic",
    brief:
      "Include one genuine controversy or debate related to the topic — what the sides claim and why it is unresolved — in one or two speak lines, within the length budget. " + GUARDRAIL,
  },
  {
    tag: "history",
    group: "history",
    hint: "the person or moment behind the concept",
    brief:
      "Include a brief historical note — the person or moment behind the concept — told in one or two speak lines where it illuminates the idea, within the length budget. " + GUARDRAIL,
  },
  {
    tag: "facts",
    group: "facts",
    hint: "real empirical numbers, not invented ones",
    brief:
      "Ground the explanation in real empirical numbers — actual magnitudes, dates, or study results, not invented placeholders — within the length budget. " + GUARDRAIL,
  },
  {
    tag: "proscons",
    group: "proscons",
    hint: "one strengths-and-weaknesses moment",
    brief:
      "Include one balanced strengths-and-weaknesses moment: what this concept or method does well and where it breaks down, in one or two speak lines, within the length budget.",
  },
  {
    tag: "data",
    group: "mode",
    hint: "the figure IS the content: present the numbers",
    brief:
      "This drawcast presents material rather than arguing a point: the figure IS the content — a distribution, a comparison, a series over time — and the narration serves the display rather than the other way round. " +
      "Read the shape out loud: what is large, what is small, what changed, what is surprising. Let the numbers carry it — reach for a 'why' only where the material itself raises one. " +
      "If you do not know the real magnitudes, draw a clearly illustrative shape and SAY that it is illustrative, rather than putting invented precision on the axes. " +
      GUARDRAIL,
  },
  {
    tag: "calm",
    group: "pacing",
    hint: "unhurried pacing: ~1 s between beats",
    brief: "Calm pacing: lengthen the between-beat pauses to about 1 second, and keep sentences unhurried.",
  },
  {
    tag: "fun",
    group: "tone",
    hint: "playful: a quirky tongue-in-cheek example",
    brief:
      "Playful register: let the CONCRETE EXAMPLE itself be quirky or gently absurd, tongue-in-cheek (umbrella rentals in a rainstorm; a zombie outbreak for infection curves) — the numbers stay real and the reasoning exact; only the setting winks. " +
      RESTRAINT,
  },
  {
    tag: "dry",
    group: "tone",
    hint: "deadpan understatement, delivered straight",
    brief:
      "Dry humor: one or two deadpan asides delivered completely straight — understatement, no exclamation marks, the joke never announced. " + RESTRAINT,
  },
  {
    tag: "pun",
    group: "tone",
    hint: "one or two puns, landed at reveals",
    brief:
      "Include one pun, at most two, placed at a reveal so the pun lands on something now visible on the canvas — never in the opening line. " + RESTRAINT,
  },
  {
    tag: "human",
    group: "human",
    hint: "hesitations and natural pauses in the narration",
    brief:
      "Sound human, not machine-read: an occasional hesitation ('Hmm —', 'well,', 'so…') at a genuine thinking moment (a few per drawcast, not per line), at most one self-correction ('about 30 — actually, closer to 33'), and em dashes or ellipses for natural micro-pauses. Never write literal stutters ('th-the') — text-to-speech reads them as glitches." +
      ' Where the meaning warrants it, mark 2–4 speak lines with a delivery hint: "soft" for a confiding lean-in, "grave" to let a key reveal land slowly, "brisk" for recaps and transitions; leave all other lines unmarked.',
  },
  {
    tag: "male",
    group: "voice",
    hint: "male narrator voice (lead speaker in dialogue)",
    brief: "",
  },
  {
    tag: "female",
    group: "voice",
    hint: "female narrator voice (lead speaker in dialogue)",
    brief: "",
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
    tag: "quiz",
    aliases: ["test"],
    group: "interaction",
    hint: "include multiple-choice quiz question(s)",
    brief:
      "Include one `quiz` command per question — one for a single check, several in a row for a test — each placed right after the figure has shown its answer, with 2-4 short choices, a 1-based `correct`, and one-sentence `right`/`wrong` feedback.",
  },
  {
    tag: "ask",
    aliases: ["personal"],
    group: "interaction",
    hint: "collect a typed answer and personalize",
    brief:
      "Include an `ask` command that collects a typed response with store + default (e.g. store: name, default: friend) early on, and weave {name} into at least one later speak line. Use answer instead of store when the reply should be checked.",
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
  {
    // "=" in the name (mirrors "parts=N" above) keeps it OUT of byName below,
    // so a bare #template (no "=") is not silently swallowed as a no-op
    // recognized tag — it surfaces as unknown, same as bare #parts does.
    // #template=<id> itself is parsed separately in parseTags (the
    // templateMatch regex), independent of byName.
    tag: "template=<id>",
    group: "structure",
    hint: "force a specific template, e.g. #template=free_body",
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
  /** Narrator gender from #male/#female, stamped into the spec (never a brief). */
  voiceGender: "male" | "female" | null;
  /** Forced template id from #template=<id>; null = not given. */
  template: string | null;
}

const TAG_RE = /(^|\s)#([a-zæøå]+(?:=[^\s#]+)?)/gi;

export function parseTags(text: string): ParsedTags {
  const unknown: string[] = [];
  /** Per exclusive group: the def that currently wins (last mention). */
  const byGroup = new Map<TagGroup, TagDef>();
  const order: TagDef[] = [];
  let playlist = false;
  let parts: number | null = null;
  let template: string | null = null;

  const clean = text
    .replace(TAG_RE, (whole, lead: string, word: string) => {
      const lower = word.toLowerCase();
      const partsMatch = /^parts=(\d+)$/.exec(lower);
      if (partsMatch) {
        playlist = true;
        parts = parseInt(partsMatch[1], 10);
        return lead;
      }
      const templateMatch = /^template=(.+)$/.exec(lower);
      if (templateMatch) {
        template = templateMatch[1];
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
  const vg = byGroup.get("voice")?.tag ?? null;
  return {
    clean,
    tags: order.map((d) => d.tag),
    playlist,
    parts,
    unknown,
    level: level === "basic" || level === "advanced" ? level : null,
    voiceGender: vg === "male" || vg === "female" ? vg : null,
    template,
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
