// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, callForText, describeApiError, type JsonCallMeta } from "./client";
import { buildSystemPrompt, formatExemplars, missingPlaceholders, selectExemplars, stripFence, PROMPT_PLACEHOLDERS, type Exemplar } from "./prompt";
import { sceneCatalogText } from "../scenes/registry";
import { specSchema, validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { layoutSpec } from "../layout/layout";
import { lintReportText, type LintIssue } from "../lint/lint";
import { makeBrowserMeasure } from "../render/svg-backend";
import fewshots from "./prompts/fewshots.json";

export interface PromptVariant {
  name: string;
  source: string;
}

const variantModules = import.meta.glob("./prompts/compiler-*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function promptVariants(): PromptVariant[] {
  return Object.entries(variantModules)
    .map(([path, source]) => ({
      name: path.replace(/^.*compiler-/, "").replace(/\.md$/, ""),
      source,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fewshotsText(): string {
  return (fewshots as { request: string; spec: unknown }[])
    .map((ex, i) => `### Example ${i + 1}\nRequest: ${ex.request}\nSpec:\n\`\`\`json\n${JSON.stringify(ex.spec, null, 1)}\n\`\`\``)
    .join("\n\n");
}

/** Schema copy for the API's structured-output constraint. */
function apiSchema(): object {
  const copy = JSON.parse(JSON.stringify(specSchema)) as Record<string, unknown>;
  delete copy.$schema;
  return copy;
}

export interface GenerationRound {
  label: "initial" | "schema-repair" | "lint-repair";
  spec: unknown;
  validationErrors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
}

export interface GenerationOutcome {
  spec: Spec | null;
  rounds: GenerationRound[];
  /** Set when no usable spec was produced. */
  error?: string;
  systemPromptChars: number;
}

export interface GenerateConfig {
  apiKey: string;
  model: string;
  variant: PromptVariant;
  exemplars: Exemplar[];
  maxRepairs?: number;
}

export function assembleSystemPrompt(request: string, variant: PromptVariant, exemplarPool: Exemplar[]): string {
  return buildSystemPrompt(variant.source, {
    schema: apiSchema(),
    catalog: sceneCatalogText(),
    fewshots: fewshotsText(),
    exemplars: formatExemplars(selectExemplars(request, exemplarPool, 3)),
  });
}

// ---- Local prompt improvement (Loop 2's meta-improvement, run in-app) ----

export interface ImproveCase {
  prompt: string;
  rating?: number;
  error?: string;
  lintMessages: string[];
  rounds: number;
}

/** Pure builder for the meta-improvement call (testable without a client). */
export function buildImproveMessages(source: string, cases: ImproveCase[]): { system: string; user: string } {
  const system = [
    "You improve the system prompt of a compiler that turns short teaching requests into structured drawing specs.",
    "You will receive the CURRENT prompt and a set of logged FAILURE CASES (requests that produced errors, lint problems, or low human ratings).",
    "Propose a revised prompt that addresses the observed failure patterns while keeping everything that already works.",
    "Hard rules:",
    `- Preserve these placeholders EXACTLY as written, each on its own line where they appear now: ${PROMPT_PLACEHOLDERS.join(", ")}. They are substituted at runtime; a prompt without them is broken.`,
    "- Keep the coordinate convention and the LLM-writes-semantics principle intact.",
    "- Make targeted edits, not a rewrite from scratch; keep roughly the current length.",
    "Return ONLY the complete revised prompt text (markdown). No commentary before or after.",
  ].join("\n");

  const caseText =
    cases.length === 0
      ? "(no logged failures — improve clarity and tighten wording instead)"
      : cases
          .map((c, i) =>
            [
              `### Case ${i + 1}`,
              `Request: ${c.prompt}`,
              c.rating !== undefined ? `Human rating: ${c.rating}/5` : null,
              c.error ? `Error: ${c.error}` : null,
              c.lintMessages.length > 0 ? `Lint: ${c.lintMessages.join("; ")}` : null,
              `Rounds used: ${c.rounds}`,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n");

  const user = `## Current prompt\n\n${source}\n\n## Failure cases\n\n${caseText}`;
  return { system, user };
}

export interface ImproveOutcome {
  source: string | null;
  error?: string;
}

/** Ask the model for a revised prompt; validates that the placeholders survived. */
export async function improvePrompt(
  cfg: { apiKey: string; model: string },
  source: string,
  cases: ImproveCase[],
): Promise<ImproveOutcome> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildImproveMessages(source, cases);
  try {
    const { text } = await callForText(client, cfg.model, system, [{ role: "user", content: user }]);
    const revised = stripFence(text);
    const missing = missingPlaceholders(revised);
    if (missing.includes("{{SCHEMA}}")) {
      return { source: null, error: `the proposal dropped required placeholders (${missing.join(", ")}) — discarded` };
    }
    return { source: revised, error: missing.length > 0 ? `note: proposal is missing ${missing.join(", ")}` : undefined };
  } catch (err) {
    return { source: null, error: describeApiError(err) };
  }
}

export async function generateSpec(request: string, cfg: GenerateConfig): Promise<GenerationOutcome> {
  const client = makeClient(cfg.apiKey);
  const system = assembleSystemPrompt(request, cfg.variant, cfg.exemplars);
  const schema = apiSchema();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: request }];
  const rounds: GenerationRound[] = [];
  let best: Spec | null = null;
  let repairsUsed = 0;

  try {
    while (true) {
      const label: GenerationRound["label"] = rounds.length === 0 ? "initial" : rounds[rounds.length - 1].validationErrors.length > 0 ? "schema-repair" : "lint-repair";
      const { json, raw, meta } = await callForJson(client, cfg.model, system, messages, schema);
      const validation = validateSpec(json);
      let lintIssues: LintIssue[] = [];
      if (validation.ok) {
        best = json as Spec;
        try {
          lintIssues = layoutSpec(best, measure).issues;
        } catch (err) {
          lintIssues = [];
          validation.errors.push(`layout failed: ${(err as Error).message}`);
        }
      }
      rounds.push({ label, spec: json, validationErrors: validation.errors, lintIssues, meta });

      const needsRepair = validation.errors.length > 0 || lintIssues.length > 0;
      if (!needsRepair || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const feedback =
        validation.errors.length > 0
          ? `The spec failed validation:\n${validation.errors.join("\n")}\n\nReturn the corrected COMPLETE spec (not a diff).`
          : `The rendered figure has visual problems:\n${lintReportText(lintIssues)}\n\nReturn the corrected COMPLETE spec (not a diff). Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return {
      spec: best,
      rounds,
      error: describeApiError(err),
      systemPromptChars: system.length,
    };
  }

  return {
    spec: best,
    rounds,
    error: best ? undefined : "The model never produced a valid spec (see rounds).",
    systemPromptChars: system.length,
  };
}
