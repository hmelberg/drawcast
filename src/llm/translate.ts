// Translate a drawcast into another language WITHOUT letting the model near
// the structure. It sees the whole spec (context is what makes a translation
// read like speech rather than like a dictionary), but the only thing taken
// from its reply is a map from source string to translated string — and only
// for strings we put in front of it. Ids, gotos, {var} tokens, quotes and
// expressions are never sent, so no answer can reach them.

import { callForJson, callForText, makeClient, type CallOpts } from "./client";
import { applyTranslations, translatableStrings, type Translatable } from "../spec/i18n";
import { layoutSpec } from "../layout/layout";
import { collectDrawnText } from "../layout/text-map";
import type { Spec } from "../spec/types";

export interface TranslationCheck {
  /** Source string → translation. Only strings that were sent, only non-blank answers. */
  map: Record<string, string>;
  /** Sent but unanswered: these stay in the source language rather than vanish. */
  missing: string[];
  /** Answered but never sent — dropped, and worth showing: it means the model was inventing. */
  unknown: string[];
}

/**
 * Reduce whatever came back to a map we are willing to apply. A blank answer is
 * treated as no answer: an empty string would erase a label, and a figure with
 * a missing axis caption is worse than one with an English caption.
 */
export function verifyTranslation(sent: Translatable[], received: unknown): TranslationCheck {
  const wanted = new Set(sent.map((t) => t.text));
  const map: Record<string, string> = {};
  const unknown: string[] = [];
  if (received && typeof received === "object" && !Array.isArray(received)) {
    for (const [key, value] of Object.entries(received as Record<string, unknown>)) {
      if (!wanted.has(key)) {
        unknown.push(key);
        continue;
      }
      if (typeof value === "string" && value.trim().length > 0) map[key] = value;
    }
  }
  return { map, missing: sent.map((t) => t.text).filter((t) => !(t in map)), unknown };
}

const SYSTEM = `You translate drawcasts: short animated explanations where a narrator speaks while a figure is drawn.

You are given the whole spec as context and a list of strings to translate. Reply with a JSON object mapping each source string to its translation. Include every string; translate nothing else.

- The narration is SPOKEN. Write what a good lecturer would say in the target language, not a literal rendering of the English.
- Labels and axis captions are drawn on a figure and have no room to grow. Keep them at most about 20% longer than the source; shorter is better.
- Keep each spoken line close to the length of the source: the words are timed against the drawing.
- Keep established technical terms and abbreviations that the field uses untranslated (QALY, ICER, DNA, p-value) unless the target language has a genuinely standard equivalent.
- Copy anything in curly braces exactly: {score}, {answer}. They are substituted at playback.
- Numbers, units and proper names stay as they are.`;

const SCHEMA = {
  type: "object",
  description: "Source string → translated string, one entry per requested string.",
  additionalProperties: { type: "string" },
} as const;

export interface TranslationResult {
  spec: Spec;
  check: TranslationCheck;
}

export interface TranslateConfig {
  apiKey: string;
  model: string;
}

/**
 * Text the FIGURE draws that the spec does not hold: a scene template computes
 * its own captions, so "Susceptible" lives in the layout code for a spec that
 * only says compartment "S". Measured before this existed: 67 of the 114
 * bundled drawcasts had such words, and every one of them stayed English.
 */
export function drawnOnlyStrings(spec: Spec, covered: Set<string>): Translatable[] {
  let drawables: ReturnType<typeof layoutSpec>["drawables"] = [];
  try {
    // Solved labels are already drawables by the time layoutSpec returns, so
    // this sees every word on the canvas. A template that throws must not take
    // the translation down with it — the spec strings are still worth having.
    drawables = layoutSpec(spec).drawables;
  } catch {
    return [];
  }
  return collectDrawnText(drawables, [])
    .filter((t) => !covered.has(t))
    .map((text) => ({ text, role: "figure text" }));
}

/**
 * A translated COPY of the spec. The original is never touched — exportSequence
 * hands out the document's own objects, so the copy is what keeps an upload in
 * another language from rewriting the user's library.
 */
export async function translateSpec(
  spec: Spec,
  target: { code: string; label: string },
  cfg: TranslateConfig,
  paramsSchema?: object,
  opts: CallOpts = {},
): Promise<TranslationResult> {
  const fromSpec = translatableStrings(spec, paramsSchema);
  const drawnOnly = drawnOnlyStrings(spec, new Set(fromSpec.map((t) => t.text)));
  const sent = [...fromSpec, ...drawnOnly];
  const empty = { map: {}, missing: [], unknown: [] };
  if (sent.length === 0) return { spec: { ...spec, lang: target.code }, check: empty };
  const listing = sent.map((t) => `- (${t.role}) ${JSON.stringify(t.text)}`).join("\n");
  const { json } = await callForJson(
    makeClient(cfg.apiKey),
    cfg.model,
    SYSTEM,
    [
      {
        role: "user",
        content: `Translate this drawcast into ${target.label}.\n\nThe whole spec, for context:\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`\n\nTranslate exactly these strings:\n${listing}`,
      },
    ],
    SCHEMA,
    opts,
  );
  const check = verifyTranslation(sent, json);
  // Spec strings are rewritten in place; the template's own computed captions
  // cannot be — they have no field to live in — so they ride along in text_map
  // and the layout substitutes them as it draws.
  const textMap: Record<string, string> = {};
  for (const t of drawnOnly) if (check.map[t.text]) textMap[t.text] = check.map[t.text];
  const translated: Spec = { ...applyTranslations(spec, check.map, paramsSchema), lang: target.code };
  // The copy declares its language, so its narrator's voice is chosen rather
  // than sniffed — and so it stays right if the copy is ever saved and played.
  if (Object.keys(textMap).length > 0) translated.text_map = { ...spec.text_map, ...textMap };
  return { spec: translated, check };
}

/**
 * One loose piece of prose in another language — the YouTube description,
 * which belongs to no spec and so has no structure to protect. That makes it
 * the one place a plain text call is right: nothing is extracted from the
 * answer, the answer IS the result, and a bad one costs a paragraph rather
 * than a figure.
 *
 * An empty description is answered without calling anything: a video with no
 * description is a real choice, and paying for the model to translate nothing
 * is not. An empty ANSWER falls back to the source text for the same reason
 * `verifyTranslation` drops blanks — a description in the wrong language beats
 * no description at all.
 */
export async function translateText(
  text: string,
  target: { code: string; label: string },
  cfg: TranslateConfig,
  opts: CallOpts = {},
): Promise<string> {
  if (text.trim().length === 0) return "";
  const { text: out } = await callForText(
    makeClient(cfg.apiKey),
    cfg.model,
    `Translate this YouTube video description into ${target.label}; return the translation only.`,
    [{ role: "user", content: text }],
    opts,
  );
  return out.trim() || text;
}
