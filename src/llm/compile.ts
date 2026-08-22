// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, callForText, describeApiError, opusTier, type JsonCallMeta } from "./client";
import { buildOutlineMessages, normalizeOutline, OUTLINE_SCHEMA, type Outline } from "./outline";
import { buildSystemBlocks, buildSystemPrompt, formatExemplars, missingPlaceholders, selectExemplars, stripFence, PROMPT_PLACEHOLDERS, type Exemplar } from "./prompt";
import { catalogText, detectNeedTemplate } from "../scenes/catalog";
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
  label: "initial" | "schema-repair" | "lint-repair" | "template-fetch";
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
  /**
   * Directing brief from #tags, appended to the user message only. The request
   * itself stays clean — it also drives exemplar selection and logging.
   */
  brief?: string;
  /** #template=<id> — the model must use this template (checked post-validation). */
  forcedTemplate?: string;
  /** Template ids to always give a full catalog entry, above the two-level threshold. */
  priorityIds?: string[];
}

export function assembleSystemPrompt(
  request: string,
  variant: PromptVariant,
  exemplarPool: Exemplar[],
  forcedTemplate?: string,
  priorityIds?: string[],
): string {
  return buildSystemPrompt(variant.source, {
    schema: apiSchema(),
    catalog: catalogText({ request, forced: forcedTemplate, priorityIds }),
    fewshots: fewshotsText(),
    exemplars: formatExemplars(selectExemplars(request, exemplarPool, 3)),
  });
}

/** A repair round is warranted only for real problems — warn-level lint is cosmetic. */
export function needsRepair(validationErrors: string[], lintIssues: LintIssue[]): boolean {
  return validationErrors.length > 0 || lintIssues.some((i) => i.severity === "error");
}

/**
 * Repairs are mechanical ("here are the errors, return the corrected spec") —
 * a fast model does them as well as Opus. Never pick a slower model than chosen.
 */
export function repairModelFor(model: string): string {
  return opusTier(model) ? "claude-sonnet-5" : model;
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
  // Prompt caching: the schema/catalog/fewshots prefix is byte-stable across
  // requests, so it is sent as a cache_control block — repair rounds (and any
  // generation within the TTL) skip re-processing ~10k tokens of prompt.
  let blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema(),
    catalog: catalogText({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds }),
    fewshots: fewshotsText(),
    exemplars: formatExemplars(selectExemplars(request, cfg.exemplars, 3)),
  });
  let system: Anthropic.TextBlockParam[] = [
    { type: "text", text: blocks.prefix, cache_control: { type: "ephemeral" } },
    ...(blocks.suffix ? [{ type: "text" as const, text: blocks.suffix }] : []),
  ];
  const schema = apiSchema();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;

  const userContent = cfg.brief ? `${request}\n\n${cfg.brief}` : request;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  const rounds: GenerationRound[] = [];
  let best: Spec | null = null;
  let repairsUsed = 0;
  let escalated = false;

  try {
    while (true) {
      const prevRound = rounds[rounds.length - 1];
      const label: GenerationRound["label"] =
        rounds.length === 0
          ? "initial"
          : prevRound.label === "template-fetch"
            ? "initial"
            : prevRound.validationErrors.length > 0
              ? "schema-repair"
              : "lint-repair";
      // The creative first round uses the chosen model; mechanical repairs use a faster one.
      const roundModel = rounds.length === 0 ? cfg.model : repairModelFor(cfg.model);
      const { json, raw, meta } = await callForJson(client, roundModel, system, messages, schema);

      // Escalation (fires at most once): the model asked for a template's full
      // definition instead of guessing its parameters from the index line.
      const needed = detectNeedTemplate(json);
      if (needed && !escalated) {
        escalated = true;
        blocks = buildSystemBlocks(cfg.variant.source, {
          schema: apiSchema(),
          catalog: catalogText({ request, forced: needed }),
          fewshots: fewshotsText(),
          exemplars: formatExemplars(selectExemplars(request, cfg.exemplars, 3)),
        });
        system = [
          { type: "text", text: blocks.prefix, cache_control: { type: "ephemeral" } },
          ...(blocks.suffix ? [{ type: "text" as const, text: blocks.suffix }] : []),
        ];
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `Full definition of "${needed}" is now in your instructions. Return the complete spec using it.` },
        );
        rounds.push({ label: "template-fetch", spec: json, validationErrors: [], lintIssues: [], meta });
        continue;
      }

      const validation = validateSpec(json);
      if (cfg.forcedTemplate && (json as Spec)?.template !== cfg.forcedTemplate) {
        validation.errors.push(`the request requires template "${cfg.forcedTemplate}" — set "template" to it and use its params`);
      }
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

      if (!needsRepair(validation.errors, lintIssues) || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const feedback =
        validation.errors.length > 0
          ? `The spec failed validation:\n${validation.errors.join("\n")}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON.`
          : `The rendered figure has visual problems:\n${lintReportText(lintErrors)}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON. Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return {
      spec: best,
      rounds,
      error: describeApiError(err),
      systemPromptChars: blocks.prefix.length + blocks.suffix.length,
    };
  }

  return {
    spec: best,
    rounds,
    error: best ? undefined : "The model never produced a valid spec (see rounds).",
    systemPromptChars: blocks.prefix.length + blocks.suffix.length,
  };
}

/** The outline call for #playlist / #parts=N. Throws on API errors; null when the model's outline is unusable. */
export async function generateOutline(request: string, cfg: { apiKey: string; model: string }, parts: number | null): Promise<Outline | null> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildOutlineMessages(request, parts);
  const { json } = await callForJson(client, cfg.model, system, [{ role: "user", content: user }], OUTLINE_SCHEMA as unknown as object);
  return normalizeOutline(json);
}
