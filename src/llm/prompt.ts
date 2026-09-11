// Prompt assembly. Prompts are data (src/llm/prompts/*.md) with placeholders;
// exemplars are runtime data (Loop 2). Everything here is pure and tested.

import type { Spec } from "../spec/types";
import { stripStrokesForModel } from "./hoist";

export interface PromptParts {
  schema: object;
  catalog: string;
  fewshots: string;
  exemplars: string;
  /**
   * The code-element block (src/llm/prompts/compiler-v1-code.md), sent ONLY
   * for a request that wants a running script — 15k chars every other request
   * paid for nothing. Absent or "" fills {{CODE}} with nothing; see wantsCode.
   */
  code?: string;
  /**
   * The `play` verb (src/llm/prompts/compiler-v1-sound.md), sent ONLY for a
   * request about sound or music — 1.4k chars of note notation and ABC that
   * the prompt already gates in prose ("ONLY when the figure is genuinely
   * about sound or music"), so every other request was paying to be told no.
   * Absent or "" fills {{SOUND}} with nothing; see wantsSound.
   */
  sound?: string;
}

export function buildSystemPrompt(variantSource: string, parts: PromptParts): string {
  const { prefix, suffix } = buildSystemBlocks(variantSource, parts);
  return prefix + suffix;
}

/**
 * The system prompt split for prompt caching: `prefix` holds everything up to
 * the exemplars placeholder (schema/catalog/fewshots filled — byte-stable
 * across requests, so it caches), `suffix` holds the request-dependent tail
 * (exemplars vary per request). No {{EXEMPLARS}} in the source → all prefix.
 */
export function buildSystemBlocks(variantSource: string, parts: PromptParts): { prefix: string; suffix: string } {
  const fill = (s: string) =>
    s
      .replaceAll("{{SCHEMA}}", JSON.stringify(parts.schema, null, 2))
      .replaceAll("{{CATALOG}}", parts.catalog)
      .replaceAll("{{FEWSHOTS}}", parts.fewshots)
      .replaceAll("{{CODE}}", parts.code ?? "")
      .replaceAll("{{SOUND}}", parts.sound ?? "");
  const at = variantSource.indexOf("{{EXEMPLARS}}");
  if (at === -1) return { prefix: fill(variantSource), suffix: "" };
  return {
    prefix: fill(variantSource.slice(0, at)),
    suffix: fill(variantSource.slice(at)).replaceAll("{{EXEMPLARS}}", parts.exemplars),
  };
}

/**
 * Assemble the system blocks for one API call: the cached prefix first, then
 * the request-dependent tail.
 *
 * Blocks whose text is only whitespace are DROPPED. The API rejects them
 * outright ("system: text content blocks must contain non-whitespace text"),
 * and the suffix collapses to exactly that whenever the prompt source ends
 * with {{EXEMPLARS}} and there are no exemplars to fill it with — the slice
 * keeps the trailing newline, so `suffix` is "\n": whitespace, but truthy, so
 * a plain `suffix ? …` guard sails straight past it. That is every revise
 * call, which passes no exemplars by design.
 */
export function systemBlocks(prefix: string, suffix: string): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const blocks: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] = [];
  if (prefix.trim()) blocks.push({ type: "text", text: prefix, cache_control: { type: "ephemeral" } });
  if (suffix.trim()) blocks.push({ type: "text", text: suffix });
  return blocks;
}

/** The placeholders every compiler prompt must carry; filled in at generation time. */
export const PROMPT_PLACEHOLDERS = ["{{SCHEMA}}", "{{CATALOG}}", "{{FEWSHOTS}}", "{{EXEMPLARS}}"] as const;

/**
 * Placeholders a prompt MAY carry: filled when present, ignored when not, and
 * never reported by missingPlaceholders — a user's own prompt fork predates
 * them and is not broken for lacking one. {{CODE}} is the conditional code
 * block (wantsCode); a fork without it simply never gets the code element.
 * {{SOUND}} is the same arrangement for the `play` verb (wantsSound).
 */
export const OPTIONAL_PROMPT_PLACEHOLDERS = ["{{CODE}}", "{{SOUND}}"] as const;

/**
 * Does this request want the code block (15k chars of script/runtime rules)?
 * Cheap and generous on purpose: a missed code request writes a code element
 * against the schema alone, while a false positive only costs tokens.
 *
 * NORWEGIAN counts too: half this app's requests are written in it, and a
 * `Simuler 500 myntkast` got the schema alone until these stems landed.
 *
 * The request text is the ONLY input. There used to be a tag branch matching
 * `code|python|r|microdata|c64`, but src/llm/tags.ts has never defined any of
 * them — the vocabulary is length/level/language/style/…, and `#basic` there
 * is the DIFFICULTY tag ("assume no background"), the very request this
 * budget exists to protect. The branch could only ever fire from a test that
 * fabricated a tag, so it is gone rather than left looking load-bearing.
 * (`basic` stays in the words below: in free text it may be Commodore BASIC.)
 */
const CODE_WORDS =
  /\b(code|script|python|pandas|numpy|matplotlib|plotly|simul(at|er)\w*|tidyverse|ggplot|brython|micropython|microdata|c64|commodore|basic|kode\w*|skript\w*|program\w*|beregn\w*|regn ut)\b|\bR\b/i;
export function wantsCode(request: string): boolean {
  return CODE_WORDS.test(request);
}

/**
 * Does this request want the `play` verb (1.4k chars of note notation, ABC,
 * instruments and the two ink-to-sound sync lists)? The same arrangement as
 * wantsCode, and cheaper to get wrong in both directions: the prompt already
 * says play is ONLY for a figure genuinely about sound or music, so a miss
 * costs the sound — which is the default anyway — and a false positive costs
 * only tokens.
 *
 * Norwegian counts, as everywhere here. Deliberately NOT in the list: "wave",
 * "frequency" and "hertz", which belong to physics figures far more often
 * than to music ones, and "string", which is a data type.
 */
const SOUND_WORDS =
  /\b(sound|music\w*|musikk\w*|musical|note|notes|chord\w*|akkord\w*|melod\w*|tune|scale\b|skala\w*|octave|oktav\w*|interval|intervall\w*|piano\w*|keyboard|tangent\w*|staff|notesystem|pitch|tonehøyde|tone[rn]?\b|toner\w*|sing\w*|synge|sang\w*|kvint|kvart|ters|harmon\w*|rhythm|rytme|beat\b|hør\w*|lyd\w*)\b/i;
export function wantsSound(request: string): boolean {
  return SOUND_WORDS.test(request);
}

/**
 * The author's style profile as a prompt block (B5, S §4): ADDED to the
 * prompt rather than replacing it, and appended LAST — after every rule of
 * ours — so it wins where they disagree. Appended to the request suffix by
 * the callers (compile.ts, revise.ts) instead of living as a placeholder in
 * the prompt source: user-made prompt forks predate the concept and would
 * silently drop a placeholder, while an append can never be skipped.
 * Empty or missing style → empty string, so callers concatenate unconditionally.
 */
export function styleBlock(text: string | undefined): string {
  const t = text?.trim();
  if (!t) return "";
  return [
    "\n\n## The author's own style",
    "",
    "The author added these standing instructions for how THEY want their",
    "drawcasts made. They extend everything above, and where they disagree",
    "with anything above, the author's instructions win:",
    "",
    t,
  ].join("\n");
}

/** Placeholders absent from a prompt source. {{SCHEMA}} missing = broken; others = degraded. */
export function missingPlaceholders(source: string): string[] {
  return PROMPT_PLACEHOLDERS.filter((p) => !source.includes(p));
}

/** Strip a single markdown code fence wrapping the whole text (LLMs love adding one). */
export function stripFence(text: string): string {
  const m = /^\s*```[a-z]*\s*\n([\s\S]*?)\n\s*```\s*$/i.exec(text);
  return m ? m[1] : text.trim();
}

export interface Exemplar {
  prompt: string;
  spec: Spec;
}

/**
 * Words that carry no topic, so two requests sharing only these are not
 * similar. Words of 1–2 characters are dropped by length alone (`og`, `en`,
 * `av`, `of`, `to`), so only 3+ belongs here.
 *
 * Three groups, and the last two were the hole: the list started as the
 * IMPERATIVE request verbs, which is the shape a request had when it was
 * written ("Draw a demand curve"). It never covered the INTERROGATIVE
 * openers — and STYLE.md's 2026-09-07 ruling turns every request into a
 * question, so "how"/"what"/"why"/"does" are now what every request shares.
 * Nor did it cover Norwegian at all, though half this app's requests are
 * written in it. Measured before this fix, against src/examples.json:
 * «Forklar hvorfor renter påvirker inflasjonen» picked three exemplars on
 * the single word "hvorfor" (a fraction series, why iron is called Fe, and
 * the circle-area proof), and "How does a vaccine actually work?" picked a
 * confidence-interval figure on "does" and "actually".
 *
 * Under-stop rather than over-stop: a word that might carry topic ("heter",
 * "happens", "work") stays out, because a weak real match still beats none —
 * selectExemplars already drops everything that overlaps on nothing.
 */
const STOPWORDS = new Set([
  // Asking for a drawing — the imperative verbs and the medium's own nouns.
  "draw", "show", "make", "create", "illustrate", "diagram", "figure",
  "tegn", "tegne", "vis", "vise", "lag", "lage", "forklar", "forklare",
  "illustrer", "illustrere", "figur",
  // Asking a question — the openers a question-shaped request always carries.
  "how", "what", "why", "when", "where", "which", "who", "does", "did",
  "hvordan", "hvorfor", "hva", "hvilken", "hvilket", "hvilke", "hvem", "hvor", "når",
  // Grammar and filler.
  "the", "a", "an", "and", "with", "for", "of", "to", "in", "as",
  "me", "please", "that", "this", "actually", "really",
  "som", "det", "den", "der", "ikke", "med", "har", "kan", "man", "seg", "sin",
  "til", "fra", "hvis", "eller", "også",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zà-öø-ÿ0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Keyword-overlap similarity; returns the n most similar exemplars (score > 0). */
export function selectExemplars<T extends Exemplar>(prompt: string, pool: T[], n: number): T[] {
  const target = keywords(prompt);
  const scored = pool
    .map((ex, i) => {
      const kw = keywords(ex.prompt);
      let overlap = 0;
      for (const w of kw) if (target.has(w)) overlap++;
      const denom = Math.sqrt(kw.size * target.size) || 1;
      return { ex, i, score: overlap / denom, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, n).map((s) => s.ex);
}

export function formatExemplars(exemplars: Exemplar[]): string {
  if (exemplars.length === 0) return "(none yet)";
  return exemplars
    .map((ex, i) => `### Exemplar ${i + 1}\nRequest: ${ex.prompt}\nSpec:\n\`\`\`json\n${JSON.stringify(stripStrokesForModel(ex.spec), null, 1)}\n\`\`\``)
    .join("\n\n");
}
