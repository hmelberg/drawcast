// The storyboard approach (docs/2026-09-19-storyboard-approach.md): one call
// writes the whole series' narration — the script — and names each part's
// figure; every part is then drawn to its script by the ordinary
// single-figure generator. Builders here are pure; the call is
// compile.ts's generateStoryboard, the choice multi.ts's outlineParts.

/**
 * Whether the story is written first. See GenerateConfig.approach. Since
 * 2026-09-28 it governs a SINGLE drawcast too: "storyboard" writes its
 * storyline first (llm/treatment.ts v3, singleCastTreatment) and stages the
 * figure to it; "independent" is the one-shot call. The ids are unchanged, so
 * stored settings need no migration.
 */
export type Approach = "storyboard" | "independent";

export const DEFAULT_APPROACH: Approach = "storyboard";

/** The user-facing choices, in the order the picker shows them. */
export const APPROACHES: readonly { id: Approach; label: string; hint: string }[] = [
  {
    id: "storyboard",
    label: "Write the story first (storyline)",
    hint: "Every spoken line is written before anything is drawn, then the figure is staged to it. A single drawcast gets one storyline call first; a multi-part drawcast or course gets one storyboard for the whole series, so the parts cohere.",
  },
  {
    id: "independent",
    label: "Write it in one go",
    hint: "A single drawcast is written in one call, words and drawing together; the parts of a multi-part drawcast are each written on their own, knowing the others by title only.",
  },
];

import { mayProposeChapters, OUTLINE_SCHEMA, PROPOSE_CHAPTERS_LINE, outlineSchemaFor } from "./outline";
import { styleBlock } from "./prompt";

/** The outline's shape plus, per part, the figure paragraph and the script — closed, so structured outputs hold the model to it. */
export const STORYBOARD_SCHEMA = {
  ...OUTLINE_SCHEMA,
  properties: {
    ...OUTLINE_SCHEMA.properties,
    parts: {
      ...OUTLINE_SCHEMA.properties.parts,
      items: {
        ...OUTLINE_SCHEMA.properties.parts.items,
        properties: {
          ...OUTLINE_SCHEMA.properties.parts.items.properties,
          figure: {
            type: "string",
            description: "What is drawn: the kind of figure, its named parts, and what appears, moves or is highlighted across the beats, in order.",
          },
          script: {
            type: "array",
            description: "The spoken lines of this part, in order, 8–14 of them.",
            items: { type: "string" },
          },
        },
        required: [...OUTLINE_SCHEMA.properties.parts.items.required, "figure", "script"],
      },
    },
  },
} as const;

/** STORYBOARD_SCHEMA with an explicit `#parts=N` written into it — see outlineSchemaFor. */
export function storyboardSchemaFor(want: number | null): object {
  return outlineSchemaFor(want, STORYBOARD_SCHEMA as unknown as typeof OUTLINE_SCHEMA);
}

/**
 * The storyboard call's messages. The teaching rules the per-part pedagogy
 * pass held a finished spec against (compile.ts PEDAGOGY_RUBRIC) are here
 * instead, because this is where the narration is now written — and here
 * they can say what a per-part pass never could: situate ONCE, bridge from
 * what the previous part actually said, one interesting thing per SERIES.
 * The author's style block comes last, after every rule, so it wins.
 */
export function buildStoryboardMessages(
  request: string,
  parts: number | null,
  opts: { chapters?: string[]; brief?: string; styleText?: string } = {},
): { system: string; user: string } {
  const count = parts !== null ? `exactly ${parts} parts` : "1–4 parts (your judgement: the fewest that teach it well — ONE is a real answer when the question is genuinely one figure, and padding a single idea into three is worse than one good part)";
  const chapters = opts.chapters && opts.chapters.length > 0 ? opts.chapters : undefined;
  const system: string[] = [
    "You write the STORYBOARD for a multi-part drawcast: a short series of narrated, hand-drawn teaching figures, each part 30–90 seconds on one single figure and one idea. You write the whole series' narration now, in one sitting, so that it coheres; another pass draws each part's figure to your lines and cannot change your words — it may only tighten a line to fit the ink.",
    "",
    `Split the request into ${count}. Each part stands on one figure and one idea.`,
    "",
    "For every part give:",
    "- title: short (it is shown on the continue button between parts).",
    "- brief: one line — what this part covers and its role in the arc.",
    "- figure: what is drawn. The kind of figure (a plot, a thing with named parts, a table, a timeline, a formula built up), its named parts, and what appears, moves or is highlighted across the beats, in order — concrete enough that an artist with only this paragraph draws the right thing. The same quantities and parts carry the same names and symbols in every part.",
    "- script: the spoken lines in order, 8–14 per part, each one or two sentences that land while the ink lands — a line says what is appearing at that moment and what it means.",
    "",
    "The arc across parts: part 1 says in one sentence what the whole series will explain, then grounds it in a concrete example with drawing already underway — never a teaser over a blank canvas. The middle parts carry the step-by-step development. Every later part opens by bridging from the previous one in one sentence (\"Now that we have seen …\") and never re-introduces the topic. The last part ends with a synthesis that ties the series together and names what the viewer can now see.",
    "",
    "How the lines teach:",
    "- Situate before you explain, ONCE, in part 1: the opening states or hints why this matters — the decision it informs, the mistake it prevents — the stakes, not the conclusion. Later parts build; they do not re-situate.",
    "- Explain in passing, never by announcement: no \"note that\", \"it is important\", \"here we see\". The ink shows where to look; the line carries the idea.",
    "- Assume an intelligent viewer: spend the words on the step they would not have seen coming, and let the obvious pass without ceremony.",
    "- A rhetorical question is a line of its own, and the line after it begins the answer, never a second question: the player leaves a moment of silence after a question mark, and that silence is where the viewer thinks.",
    "- One genuinely interesting thing in the whole series — a surprising implication, a real number, a scrap of history, a reframing — placed where it fits, and only if it is true: a clean explanation beats an invented tidbit. Never manufacture a controversy, a quote or a statistic.",
    "- Each part converges on one insight, and its closing line says what the viewer can now see.",
    "- Write the lines in the language of the request.",
    "- level: \"basic\" or \"advanced\" only when the request implies one.",
  ];
  const propose = mayProposeChapters(parts, opts.chapters);
  if (chapters) {
    system.push(
      `- chapter: the author declared these chapters, in order: ${chapters.map((c, i) => `${i + 1}. ${c}`).join("; ")}. Assign every part to one of them, in order, and never invent a chapter that is not on this list.`,
    );
  } else if (propose) {
    system.push(`- ${PROPOSE_CHAPTERS_LINE}`);
  }
  const chapterField = chapters
    ? '"chapter":"<one of the declared chapters>",'
    : propose
      ? '"chapter":"<the chapter this part falls under, or omit the field>",'
      : "";
  system.push(
    "",
    "Return ONLY a minified JSON object of exactly this shape, nothing else:",
    `{"title":"<short series title>","parts":[{"title":"<short part title>","brief":"<one line>","level":"basic|advanced (only when implied)",${chapterField}"figure":"<what is drawn and what changes>","script":["<line 1>","<line 2>"]}]}`,
  );
  const user = opts.brief ? `${request}\n\n${opts.brief}` : request;
  return { system: system.join("\n") + styleBlock(opts.styleText), user };
}

// ---------------------------------------------------------------------------
// Storyboard v2 (2026-09-28): v1's arc rules PLUS the single-cast storyline
// rules (llm/prompts/treatment-v3.md) adapted per part, and the templates
// with what the viewer can do with each. Behind Settings.storyboardVersion,
// default "v1" until the owner has compared the two blind. v1 above stays
// byte-for-byte what it was (tests/storyboard-v2.test.ts pins its hash).
// ---------------------------------------------------------------------------

/** Which storyboard prompt (and, with it, which per-part staging hand-over — outline.ts buildPartRequest). */
export type StoryboardVersion = "v1" | "v2";
export const DEFAULT_STORYBOARD_VERSION: StoryboardVersion = "v2";

/** The picker's choices, in order. */
export const STORYBOARD_VERSIONS: readonly { id: StoryboardVersion; label: string; hint: string }[] = [
  { id: "v1", label: "current (v1)", hint: "The storyboard prompt multi-part drawcasts and courses have used since 2026-09-19." },
  {
    id: "v2",
    label: "new (v2)",
    hint: "The storyboard also carries the storyline rules (question first, the naive answer, one ghosted change at a time, a figure budget per part, templates with what the viewer can do, a transfer quiz), and each part is staged the way a single drawcast's storyline is.",
  },
];

/** A stored value → a version; anything unknown is the default. */
export function asStoryboardVersion(v: unknown): StoryboardVersion {
  return v === "v1" || v === "v2" ? v : DEFAULT_STORYBOARD_VERSION;
}

/** v1's schema plus an OPTIONAL `template` per part — the planned template id, absent for freehand. */
export const STORYBOARD_SCHEMA_V2 = {
  ...STORYBOARD_SCHEMA,
  properties: {
    ...STORYBOARD_SCHEMA.properties,
    parts: {
      ...STORYBOARD_SCHEMA.properties.parts,
      items: {
        ...STORYBOARD_SCHEMA.properties.parts.items,
        properties: {
          ...STORYBOARD_SCHEMA.properties.parts.items.properties,
          template: {
            type: "string",
            description: "The id of the ready template this part's figure is drawn with, when one fits. Omit for a freehand figure.",
          },
        },
      },
    },
  },
} as const;

/** The schema for a version, with an explicit `#parts=N` written into it — v1's is exactly storyboardSchemaFor's. */
export function storyboardSchemaForVersion(want: number | null, version: StoryboardVersion): object {
  return version === "v2" ? outlineSchemaFor(want, STORYBOARD_SCHEMA_V2 as unknown as typeof OUTLINE_SCHEMA) : storyboardSchemaFor(want);
}

/**
 * The v2 storyboard call's messages. `templateLines` are the lecture
 * request's shortlist, one story line each with its "Viewer can:" line
 * (catalog.ts storyTemplateLines); `index`, when given, is the rest of the
 * library one line each (catalog.ts catalogIndexText) — the same two blocks
 * the single-cast storyline gets (treatment.ts buildTreatmentSystem v3).
 * Output shape: v1's plus an optional per-part `template`.
 */
export function buildStoryboardMessagesV2(
  request: string,
  parts: number | null,
  opts: { chapters?: string[]; brief?: string; styleText?: string; templateLines?: string; index?: string } = {},
): { system: string; user: string } {
  const count = parts !== null ? `exactly ${parts} parts` : "1–4 parts (your judgement: the fewest that teach it well — ONE is a real answer when the question is genuinely one figure, and padding a single idea into three is worse than one good part)";
  const chapters = opts.chapters && opts.chapters.length > 0 ? opts.chapters : undefined;
  const system: string[] = [
    "You write the STORYBOARD for a multi-part drawcast: a short series of narrated, hand-drawn teaching figures, each part 30–90 seconds on one single figure and one idea. Write it as a great teacher and science communicator would — the kind who makes a hard idea feel obvious afterwards. You write the whole series' narration now, in one sitting, so that it coheres; another pass stages each part's figure to your lines and cannot change your words — it may only tighten a line to fit the ink. That pass lays out the page itself, and may merge, shrink or drop pieces you plan to keep the page clear — so say WHAT is drawn, never WHERE.",
    "",
    `Split the request into ${count}. Each part stands on one figure and one idea.`,
    "",
    "For every part give:",
    "- title: short (it is shown on the continue button between parts).",
    "- brief: one line — what this part covers and its role in the arc.",
    "- template: the id of a ready template (listed below) when one draws this part's figure and can tell THIS part's story; leave the field out for a freehand figure.",
    '- figure: the part\'s ONE main figure — the kind of figure (a plot, a thing with named parts, a table, a timeline, a formula built up), its named parts, and what appears, moves, changes or is highlighted across the beats, in order — concrete enough that an artist with only this paragraph draws the right thing. Then each supporting piece in a sentence of its own, marked temporary with when it goes ("Scratch card: 100 ÷ 4 = 25 — temporary, gone after line 9"). Then, when this part has them, "Explore: <the one thing the viewer is invited to try>" and "Quiz: <question> | <choices> | correct: <n> | wrong hint: <hint>". No positions ("upper left"). The same quantities and parts carry the same names and symbols in every part.',
    "- script: the spoken lines in order, 8–14 per part, each one or two sentences written for the ear that land while the ink lands — a line says what is appearing or changing at that moment and what it means.",
    "",
    'The arc across parts: part 1\'s FIRST line states the question the whole series answers, in the viewer\'s own everyday words, while the first ink appears — then part 1 grounds it in a concrete example with drawing already underway, never a teaser over a blank canvas. The middle parts carry the step-by-step development. Every later part opens by bridging from the previous one in one sentence ("Now that we have seen …") and never re-introduces the topic. The last part ends with a synthesis that ties the series together and names, in plain words, the one thing the viewer can now see — not a summary of the steps.',
    "",
    "How the lines teach:",
    "- Situate before you explain, ONCE, in part 1: the opening states or hints why this matters — the decision it informs, the mistake it prevents — the stakes, not the conclusion. Later parts build; they do not re-situate.",
    "- Hook with the naive answer: when there is a common misconception or a natural wrong guess, part 1 says it early — plainly, as the thing most people would think — before a figure shows why it fails. No straw men: with no real misconception, open with what makes the question puzzling instead.",
    "- Each part converges on ONE insight, and its closing line says what the viewer can now see.",
    '- A concrete example with correct numbers: work real cases with numbers you are sure of; numbers chosen to illustrate are said to be illustrative ("say, 100 people"). Never invent a statistic, a study or a quote.',
    "- Change one thing at a time: a comparison holds everything else fixed and says so, and before the change the figure keeps a faded GHOST of the old state, so the viewer compares before and after on the same figure.",
    "- Key numbers on the canvas too: a number that matters is written where it belongs (a readout, a label on the point) as well as spoken — the figure paragraph says so. A calculation is worked on a scratch card, one line as each is said.",
    "- Every line draws, moves or changes something. Prefer transforming what is already on the page — move a point, animate a parameter, leave a ghost, highlight a part — over adding a new piece. A listener with nothing changing to watch is hearing a podcast.",
    "- Figure budget, per part: ONE main figure the viewer watches throughout, drawn large; beside it at most ONE temporary supporting piece at a time (a scratch card, a readout, a small inset), marked with when it goes; ghosts and helper lines fade once they have served. Anything more is said, not drawn.",
    "- Focus sparingly: dim everything else only when it helps, and only when the whole thing being discussed stays lit.",
    "- An honest caveat: where a simplification matters — a model's assumption, a scale that is not to scale, a case where the rule breaks — one short line says so, in the part where it matters.",
    '- Explain in passing, never by announcement: no "note that", "it is important", "here we see". The ink shows where to look; the line carries the idea.',
    "- Assume an intelligent viewer: spend the words on the step they would not have seen coming, and let the obvious pass without ceremony.",
    "- A rhetorical question is a line of its own, and the line after it begins the answer, never a second question: the player leaves a moment of silence after a question mark, and that silence is where the viewer thinks.",
    "- One genuinely interesting thing in the whole series — a surprising implication, a real number, a scrap of history, a reframing — placed where it fits, and only if it is true: a clean explanation beats an invented tidbit. Never manufacture a controversy, a quote or a statistic.",
    "- Words on the canvas are cues, not sentences: a label, axis title, branch or box is a word or three; the voice says the full thought.",
    "- A group of people (an epidemic, vaccination, screening, a risk, a trial) is a population of person icons whose states change one person at a time (healthy, sick, immune, vaccinated, dead) — never dots.",
    '- Templates: a ready template gives the best-looking, most exact figure — prefer a listed one for a part when it can tell THAT part\'s story, name it in `template`, and plan around what the viewer can really do with it (its "Viewer can" line). A part drawn with a template may plan ONE explore beat: a line inviting the viewer to pause and try one specific thing the template really allows ("drag the demand curve right and watch the shortage close"), with the matching "Explore:" sentence in the figure paragraph. Never bend the story to fit a template — a freehand figure that tells the right story beats a template that tells another.',
    '- Quizzes: only when the brief asks for them. Then each quiz is planned in its part\'s figure paragraph ("Quiz: …") and is a TRANSFER question — it applies the insight to a NEW case, never a recall of a number just said — with a wrong hint that nudges toward the reasoning, never gives the answer. The LAST part closes with one that applies the series\' one insight. The quiz carries its own question text: it is not a line of the script.',
    "- Write the lines in the language of the request.",
    '- level: "basic" or "advanced" only when the request implies one.',
  ];
  const propose = mayProposeChapters(parts, opts.chapters);
  if (chapters) {
    system.push(
      `- chapter: the author declared these chapters, in order: ${chapters.map((c, i) => `${i + 1}. ${c}`).join("; ")}. Assign every part to one of them, in order, and never invent a chapter that is not on this list.`,
    );
  } else if (propose) {
    system.push(`- ${PROPOSE_CHAPTERS_LINE}`);
  }
  const chapterField = chapters
    ? '"chapter":"<one of the declared chapters>",'
    : propose
      ? '"chapter":"<the chapter this part falls under, or omit the field>",'
      : "";
  const lines = opts.templateLines?.trim();
  system.push(
    "",
    "## Templates shortlisted for this request",
    "",
    lines
      ? `Each with what the viewer can do with it while paused. Prefer one for a part when it can tell that part's story.\n\n${lines}`
      : "None fits this request closely: plan freehand figures, unless one in the index below clearly does.",
  );
  if (opts.index?.trim()) {
    system.push("", "## The rest of the library (one line each)", "", "If one of these draws a part's figure better than the shortlist, name its id in that part's `template`; its full entry will be fetched for the artist.", "", opts.index.trim());
  }
  system.push(
    "",
    "Return ONLY a minified JSON object of exactly this shape, nothing else:",
    `{"title":"<short series title>","parts":[{"title":"<short part title>","brief":"<one line>","level":"basic|advanced (only when implied)",${chapterField}"template":"<template id, or leave the field out for freehand>","figure":"<the main figure and what changes; temporary pieces with when they go; Explore:/Quiz: when planned>","script":["<line 1>","<line 2>"]}]}`,
  );
  const user = opts.brief ? `${request}\n\n${opts.brief}` : request;
  return { system: system.join("\n") + styleBlock(opts.styleText), user };
}
