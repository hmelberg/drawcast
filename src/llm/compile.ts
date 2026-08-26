// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, callForText, describeApiError, opusTier, type JsonCallMeta } from "./client";
import { buildOutlineMessages, normalizeOutline, OUTLINE_SCHEMA, type Outline } from "./outline";
import { buildSystemBlocks, formatExemplars, missingPlaceholders, stripFence, systemBlocks, PROMPT_PLACEHOLDERS, type Exemplar } from "./prompt";
import { pickExemplars } from "./exemplars";
import { catalogParts, detectNeedTemplate } from "../scenes/catalog";
import { ensureEnginesForTemplate } from "../scenes/engines";
import { specSchema, validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { layoutSpec } from "../layout/layout";
import { lintCommands, lintReportText, type LintIssue } from "../lint/lint";
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

/** Schema copy for the API's structured-output constraint, and for the prompt's {{SCHEMA}}. */
export function apiSchema(): object {
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

/** What the model is writing, right now — the UI's only view into a round in flight. */
export interface GenerationProgress {
  /** Same labels as GenerationRound, so the status line can name the phase. */
  label: GenerationRound["label"];
  /** 1-based, counting every round including escalation ("repair 2 of 3"). */
  round: number;
  /** Everything written this round so far, not just the latest delta. */
  text: string;
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
  /** The user's own promoted references ("Learn from this"). These win the exemplar slots. */
  exemplars: Exemplar[];
  /** Curated bundled showcases, used only for the slots `exemplars` leaves empty (src/examples.json). */
  bundledExemplars?: Exemplar[];
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
  /** Template ids to hide from the catalog entirely (host embeds exclude e.g. molecule_3d). */
  excludeIds?: string[];
  /** Cancels the generation, whichever round is in flight. */
  signal?: AbortSignal;
  /** Called as the model writes, once per streamed delta. */
  onProgress?: (progress: GenerationProgress) => void;
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
  // Prompt caching: the schema/catalog/fewshots prefix is sent as a
  // cache_control block, so repair rounds (and any generation within the TTL)
  // skip re-processing ~10k tokens of prompt. Below the catalog's two-level
  // threshold (src/scenes/catalog.ts) catalogParts().variable is always "",
  // so the prefix is byte-stable across requests. At or above it, catalogParts
  // splits {{CATALOG}} itself: `stable` (index + forced/priority/core hot set
  // + stubs + pack lines + escalation, NEVER the free-text request) goes into
  // the cache_control prefix, while `variable` (the keyword-matched shortlist,
  // selectTemplates(request, …) minus anything already in `stable`) is
  // appended to the request-dependent SUFFIX instead — so a stable preference
  // (forced template / priority packs) still pins a stable prefix and full
  // cache reuse, while a free-form request's shortlist no longer busts that
  // cache at all (a strict improvement over the pre-split tradeoff, spec §5a).
  let catalog = catalogParts({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds, excludeIds: cfg.excludeIds });
  let blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema(),
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: formatExemplars(pickExemplars(request, cfg.exemplars, cfg.bundledExemplars ?? [], 3)),
  });
  let suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
  let system: Anthropic.TextBlockParam[] = systemBlocks(blocks.prefix, suffixText);
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
      // The creative round uses the chosen model; mechanical repairs use a
      // faster one. "Creative" means label === "initial" — that's every round
      // that isn't a repair, including the round right after a
      // template-fetch escalation (the label derivation above already maps
      // that round back to "initial"), so it must not fall through to the
      // repair model just because it isn't rounds[0].
      const roundModel = label === "initial" ? cfg.model : repairModelFor(cfg.model);
      // Repairs are mechanical in the same sense that picks the faster model
      // above: "here are the errors, fix them" needs no deliberation, so they
      // also run at low effort. The creative round is left at the model's own
      // default — that judgment is the product.
      const round = rounds.length + 1;
      const { json, raw, meta } = await callForJson(client, roundModel, system, messages, schema, {
        signal: cfg.signal,
        effort: label === "initial" ? undefined : "low",
        onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label, round, text })),
      });

      // Escalation (fires at most once): the model asked for a template's full
      // definition instead of guessing its parameters from the index line.
      // Never for a forced template — the catalog already gives it a full
      // entry (see buildSystemBlocks with `forced`), so
      // a need_template reply there would just loop.
      const needed = detectNeedTemplate(json);
      if (needed && !escalated && !cfg.forcedTemplate) {
        escalated = true;
        // forced-mode catalogParts is always all-stable (variable === "") —
        // the escalation rebuild pins a fully cache-stable prefix too.
        catalog = catalogParts({ forced: needed, excludeIds: cfg.excludeIds });
        blocks = buildSystemBlocks(cfg.variant.source, {
          schema: apiSchema(),
          catalog: catalog.stable,
          fewshots: fewshotsText(),
          exemplars: formatExemplars(pickExemplars(request, cfg.exemplars, cfg.bundledExemplars ?? [], 3)),
        });
        suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "");
        system = systemBlocks(blocks.prefix, suffixText);
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
        // An engine that cannot load becomes a validation error — repair can
        // switch template, or the round fails visibly (never a silent
        // fall-through render for a hand-authored spec).
        if (best.template) {
          await ensureEnginesForTemplate(best.template).catch((err) => {
            validation.errors.push(`engine load failed: ${(err as Error).message}`);
          });
        }
        try {
          lintIssues = [...layoutSpec(best, measure).issues, ...lintCommands(best)];
        } catch (err) {
          lintIssues = [];
          validation.errors.push(`layout failed: ${(err as Error).message}`);
        }
      }
      rounds.push({ label, spec: json, validationErrors: validation.errors, lintIssues, meta });

      if (!needsRepair(validation.errors, lintIssues) || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const lintWarnings = lintIssues.filter((i) => i.severity === "warn");
      // A repair round never fires for warns alone (needsRepair above), but
      // once one is running for a real problem, warn-severity lint rides
      // along too — free correction, not a reason to spend another round.
      const warningsBlock = lintWarnings.length > 0 ? `\n\nAlso worth fixing while you're at it (non-blocking):\n${lintReportText(lintWarnings)}` : "";
      const feedback =
        validation.errors.length > 0
          ? `The spec failed validation:\n${validation.errors.join("\n")}${warningsBlock}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON.`
          : `The rendered figure has visual problems:\n${lintReportText(lintErrors)}${warningsBlock}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON. Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return {
      spec: best,
      rounds,
      error: describeApiError(err),
      systemPromptChars: blocks.prefix.length + suffixText.length,
    };
  }

  // best-effort: `best` may still carry a template other than the forced
  // one (validation.ok is computed before the forced-template mismatch
  // string is appended, so a structurally valid wrong-template spec still
  // gets kept as `best`) — surface that as a top-level error rather than a
  // silent success with the wrong template.
  const forcedMismatch = cfg.forcedTemplate && best && best.template !== cfg.forcedTemplate;
  return {
    spec: best,
    rounds,
    error: forcedMismatch
      ? `The model never produced a spec using the required template "${cfg.forcedTemplate}" (returned "${best!.template}") — try again or drop the forced template.`
      : best
        ? undefined
        : "The model never produced a valid spec (see rounds).",
    systemPromptChars: blocks.prefix.length + suffixText.length,
  };
}

/** The outline call for #playlist / #parts=N. Throws on API errors; null when the model's outline is unusable. */
export async function generateOutline(
  request: string,
  cfg: { apiKey: string; model: string },
  parts: number | null,
  signal?: AbortSignal,
): Promise<Outline | null> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildOutlineMessages(request, parts);
  const { json } = await callForJson(client, cfg.model, system, [{ role: "user", content: user }], OUTLINE_SCHEMA as unknown as object, { signal });
  return normalizeOutline(json);
}
