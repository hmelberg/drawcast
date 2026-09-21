// The storyboard approach (docs/2026-09-19-storyboard-approach.md): one call
// writes the whole series' narration — the script — and names each part's
// figure; every part is then drawn to its script by the ordinary
// single-figure generator. Builders here are pure; the call is
// compile.ts's generateStoryboard, the choice multi.ts's outlineParts.

/** How a multi-part drawcast or a lecture is planned. See GenerateConfig.approach. */
export type Approach = "storyboard" | "independent";

export const DEFAULT_APPROACH: Approach = "storyboard";

/** The user-facing choices, in the order the picker shows them. */
export const APPROACHES: readonly { id: Approach; label: string; hint: string }[] = [
  { id: "storyboard", label: "Storyboard first — one script, then each figure", hint: "One call writes the narration for the whole series so the parts cohere; each figure is then drawn to its lines." },
  { id: "independent", label: "Independent parts — each figure written on its own", hint: "An outline names the parts; each part is written separately, knowing the others by title only." },
];

import { mayProposeChapters, OUTLINE_SCHEMA, PROPOSE_CHAPTERS_LINE } from "./outline";
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
  const count = parts !== null ? `exactly ${parts} parts` : "2–4 parts (your judgement: the fewest parts that teach it well)";
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
