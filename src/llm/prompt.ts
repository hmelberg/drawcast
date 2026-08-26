// Prompt assembly. Prompts are data (src/llm/prompts/*.md) with placeholders;
// exemplars are runtime data (Loop 2). Everything here is pure and tested.

import type { Spec } from "../spec/types";
import { stripStrokesForModel } from "./hoist";

export interface PromptParts {
  schema: object;
  catalog: string;
  fewshots: string;
  exemplars: string;
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
      .replaceAll("{{FEWSHOTS}}", parts.fewshots);
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

const STOPWORDS = new Set([
  "draw", "the", "a", "an", "and", "with", "for", "of", "to", "in", "as", "show",
  "make", "create", "illustrate", "diagram", "figure", "me", "please", "that", "this",
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
