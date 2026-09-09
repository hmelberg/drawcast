// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, callForText, describeApiError, repairModelFor, type Effort, type JsonCallMeta } from "./client";
import { buildOutlineMessages, normalizeOutline, OUTLINE_SCHEMA, type Outline } from "./outline";
import { buildSystemBlocks, formatExemplars, missingPlaceholders, stripFence, styleBlock, systemBlocks, PROMPT_PLACEHOLDERS, type Exemplar } from "./prompt";
import { pickExemplars } from "./exemplars";
import { catalogIsTwoLevel, catalogParts, detectNeedTemplate } from "../scenes/catalog";
import type { RouteResult } from "./router";
import type { OnDemandRun } from "./on-demand-run";
import type { TemplateDoc } from "../scenes/doc";
import { ensureEnginesForTemplate } from "../scenes/engines";
import { specSchema, validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { layoutSpec } from "../layout/layout";
import { lintCommands, lintReportText, type LintIssue } from "../lint/lint";
import { makeBrowserMeasure } from "../render/svg-backend";
import { codeExecutionErrors, type CodeCheckOutcome } from "../code/check";
import type { CodeRunRequest, CodeRunResult } from "../code/run";
import { paramsStrictness, templateParamIssues } from "../scenes/params-check";
import { isPackTemplateId, packTemplateIds } from "../scenes/packs";
import { scanDataTokens } from "../code/tokens";
import fewshots from "./prompts/fewshots.json";

/** Budget for the authoring-time code-execution check (real pyodide WASM in
 *  a hidden run). The underlying run cannot be cancelled once started (no
 *  interrupt without SharedArrayBuffer/COOP/COEP — see src/code/pyodide.ts),
 *  so this only unblocks GENERATION on expiry/abort; the abandoned run keeps
 *  going in the background and still warms the cache for the real render. */
const AUTHORING_CODE_CHECK_MS = 60_000;

const NO_CODE_CHECK: CodeCheckOutcome = { errors: [], warnings: [] };

/** The router's verdict as logged on an outcome: its picks, its "none fits", its cost. */
export interface RouteInfo {
  ids: string[];
  noneFits: boolean;
  ms: number;
  /** Set when the router call failed; the keyword selector took over. */
  error?: string;
}

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
  label: "initial" | "schema-repair" | "lint-repair" | "template-fetch" | "pedagogy";
  spec: unknown;
  validationErrors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
  /** Pedagogy round only: whether the revision replaced the delivered spec. */
  adopted?: boolean;
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
  /** What the template router said for this request (two-level catalog only); absent when no router ran. */
  route?: RouteInfo;
  /** Set when no usable spec was produced. */
  error?: string;
  systemPromptChars: number;
}

export interface GenerateConfig {
  /**
   * After a structurally clean spec lands, run one teaching-quality pass: the
   * model re-reads the spec against the pedagogy rubric (situate, hook on
   * ink, one surprise, aha, no signposting) and may return an improved
   * version — adopted only if it stays valid, keeps the template, and lints
   * no worse. Off by default; the app turns it on.
   */
  pedagogyReview?: boolean;
  apiKey: string;
  model: string;
  variant: PromptVariant;
  /** The author's active style profile (B5) — appended after everything, so it wins. */
  styleText?: string;
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
  /**
   * The template router (src/llm/router.ts), injected by the app: in the
   * two-level catalog regime it names the templates to show in full for
   * THIS request. Absent (tests, embeds without a key) means the keyword
   * selector, exactly as before; a router failure degrades to the same.
   */
  route?: (request: string, signal?: AbortSignal) => Promise<RouteResult>;
  /** Effort for the creative round (Settings). Repairs and the pedagogy pass always run low; omitted = the API default (high). */
  effort?: Effort;
  /** Named phases the status line can show between deltas: "routing", "writing the spec", "checking the code", "teaching pass". */
  onPhase?: (phase: string) => void;
  /**
   * Multi-part generation only (llm/multi.ts): after the parts land, every
   * part the compiler drew freehand with named parts (on-demand.ts
   * templateWorthy — whatever the router said) gets a template authored and
   * is redrawn with it, one part after another, each new template in the
   * registry before the next part is looked at. Read nowhere in generateSpec
   * itself; the single-figure path OFFERS instead.
   */
  templatesOnDemand?: boolean;
  /** The app's hook to keep a template authored on demand (My templates + panels). */
  onTemplateAuthored?: (t: { id: string; yaml: string; doc: TemplateDoc }) => void;
  /** Cap on templates authored in one multi-part run (Settings; default DEFAULT_ON_DEMAND_MAX, 0 = none). Read only when no onDemandRun is given. */
  templatesOnDemandMax?: number;
  /** The shared state of one run's authoring (on-demand-run.ts): a course hands every lecture the same object, so parallel lectures share the cap, the lock and the authored documents. */
  onDemandRun?: OnDemandRun;
  /** Cancels the generation, whichever round is in flight. */
  signal?: AbortSignal;
  /** Called as the model writes, once per streamed delta. */
  onProgress?: (progress: GenerationProgress) => void;
  /** Run python code elements during validation and feed failures to repair (default on; node/test contexts inject codeRunner or set false). */
  executeCode?: boolean;
  /** Injected runner for the execution check; defaults to the real runCode. */
  codeRunner?: (req: CodeRunRequest) => Promise<CodeRunResult>;
}

/** A repair round is warranted only for real problems — warn-level lint is cosmetic. */
export function needsRepair(validationErrors: string[], lintIssues: LintIssue[]): boolean {
  return validationErrors.length > 0 || lintIssues.some((i) => i.severity === "error");
}

// Repairs are mechanical ("here are the errors, return the corrected spec") —
// a fast model does them as well as Opus. The chooser lives beside the call
// layer now, so callForJson's JSON repair round picks the same model.
export { repairModelFor };

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

/**
 * The teaching rubric — the distilled STYLE.md ledger the pedagogy pass
 * holds a finished spec against. Update it when STYLE.md graduates new rules.
 */
export const PEDAGOGY_RUBRIC = `The spec is structurally correct and renders cleanly. Before delivering, re-read it as a TEACHER against this checklist:
1. SITUATED — the opening states or hints why this matters (the decision it informs, the mistake it prevents) before any mechanics begin.
2. HOOK ON INK — the opening line rides the first draw command; at most one short standalone speak before ink.
3. SOMETHING INTERESTING — does it offer one genuinely interesting thing beyond the mechanics: a surprising conclusion or implication, an unexpected true fact, a scrap of history or biography, a reframing interpretation, a good tidbit? The kind should fit THIS topic (variation between figures is a quality, not a defect). Only well-established facts — a plain clean explanation beats a forced or invented tidbit, so absence can be correct.
4. AHA — every beat converges on one insight, and the closing line names what the viewer can now see.
5. IN PASSING — explanations live inside working sentences; no "note that", "it is important", or lecture signposting.
6. INTELLIGENT VIEWER — no words spent on the self-evident; the emphasis lands on the non-intuitive.
7. MOMENTS MARKED — highlight/focus/annotation sit at the moments of meaning (the reveal, the contrast), never as decoration.
If the spec already does all of this, return it EXACTLY unchanged. Otherwise return the improved COMPLETE spec — SAME template, params and figure; better narration, ordering and staging — as minified JSON.`;

export async function generateSpec(request: string, cfg: GenerateConfig): Promise<GenerationOutcome> {
  const client = makeClient(cfg.apiKey);
  // Prompt caching: the schema/catalog/fewshots prefix is sent as a
  // cache_control block, so repair rounds (and any generation within the TTL)
  // skip re-processing ~10k tokens of prompt. Below the catalog's two-level
  // threshold (src/scenes/catalog.ts) catalogParts().variable is always "",
  // so the prefix is byte-stable across requests. At or above it, catalogParts
  // splits {{CATALOG}} itself: `stable` (index + forced/priority/core hot set
  // + stubs + pack lines + escalation, NEVER the free-text request) goes into
  // the cache_control prefix, while `variable` (the shortlist — the router's
  // picks filled up with selectTemplates(request, …), minus anything in `stable`) is
  // appended to the request-dependent SUFFIX instead — so a stable preference
  // (forced template / priority packs) still pins a stable prefix and full
  // cache reuse, while a free-form request's shortlist no longer busts that
  // cache at all (a strict improvement over the pre-split tradeoff, spec §5a).
  //
  // In the two-level regime the shortlist comes from the ROUTER when the app
  // injects one (src/llm/router.ts): a cheap model reads the index and names
  // the templates worth showing in full. Its picks replace the keyword
  // shortlist in `variable`; the stable prefix is untouched either way. A
  // forced template needs no shortlist, and a router failure (or an empty
  // answer) leaves the keyword selector in charge — never index-only.
  let route: RouteInfo | undefined;
  let shortlist: string[] | undefined;
  if (cfg.route && !cfg.forcedTemplate && catalogIsTwoLevel(cfg.excludeIds)) {
    cfg.onPhase?.("choosing templates");
    const t0 = performance.now();
    try {
      const r = await cfg.route(request, cfg.signal);
      route = { ids: r.ids, noneFits: r.noneFits, ms: performance.now() - t0 };
      if (r.ids.length > 0) shortlist = r.ids;
    } catch (err) {
      if (cfg.signal?.aborted) throw err;
      route = { ids: [], noneFits: false, ms: performance.now() - t0, error: describeApiError(err) };
    }
  }
  let catalog = catalogParts({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds, excludeIds: cfg.excludeIds, shortlist });
  let blocks = buildSystemBlocks(cfg.variant.source, {
    schema: apiSchema(),
    catalog: catalog.stable,
    fewshots: fewshotsText(),
    exemplars: formatExemplars(pickExemplars(request, cfg.exemplars, cfg.bundledExemplars ?? [], 3)),
  });
  let suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "") + styleBlock(cfg.styleText);
  let system: Anthropic.TextBlockParam[] = systemBlocks(blocks.prefix, suffixText);
  const schema = apiSchema();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;

  const userContent = cfg.brief ? `${request}\n\n${cfg.brief}` : request;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  const rounds: GenerationRound[] = [];
  let best: Spec | null = null;
  let lastRaw = "";
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
      cfg.onPhase?.(label === "initial" ? (round > 1 ? `writing the spec, attempt ${round}` : "writing the spec") : `repairing (${label === "schema-repair" ? "schema" : "layout"})`);
      const { json, raw, meta } = await callForJson(client, roundModel, system, messages, schema, {
        signal: cfg.signal,
        effort: label === "initial" ? cfg.effort : "low",
        onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label, round, text })),
      });

      lastRaw = raw;
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
        suffixText = blocks.suffix + (catalog.variable ? "\n\n" + catalog.variable : "") + styleBlock(cfg.styleText);
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
        let check: CodeCheckOutcome = NO_CODE_CHECK;
        if (cfg.executeCode !== false && !cfg.signal?.aborted && (best.elements ?? []).some((e) => e.type === "code")) {
          const run = cfg.codeRunner ?? (await import("../code/run")).runCode;
          // Race the real check against a budget/abort: generation must never
          // hang on the WASM runtime. On expiry the check is abandoned (not
          // cancelled) and generation proceeds without its errors/warnings —
          // render still executes the code for real, later.
          let budgetTimer: ReturnType<typeof setTimeout> | undefined;
          let onAbort: (() => void) | undefined;
          const budget = new Promise<CodeCheckOutcome>((resolve) => {
            budgetTimer = setTimeout(() => resolve(NO_CODE_CHECK), AUTHORING_CODE_CHECK_MS);
            onAbort = () => resolve(NO_CODE_CHECK);
            cfg.signal?.addEventListener("abort", onAbort, { once: true });
          });
          check = await Promise.race<CodeCheckOutcome>([codeExecutionErrors(best, run), budget]);
          if (budgetTimer) clearTimeout(budgetTimer);
          if (onAbort) cfg.signal?.removeEventListener("abort", onAbort);
          validation.errors.push(...check.errors);
          for (const w of check.warnings) {
            lintIssues.push({ rule: "code-use", ids: [], message: w, severity: "warn" });
          }
        }
        // Params against the template's own schema, AFTER substitution (spec
        // §9.2): strict for a spec that carries data tokens and for the data
        // pack's templates; advisory for a hand-fed pre-existing template.
        if (best.template) {
          const tokens = scanDataTokens(best.params).length > 0;
          const dataPack = isPackTemplateId(best.template) && packTemplateIds("data").includes(best.template);
          // A check that never ran or timed out (NO_CODE_CHECK) leaves raw
          // token strings in params — only warnings can be honest about them.
          // Same for an unavailable runtime: it leaves its tokens unjudged
          // (dropped from resolvedParams, never actually harvested or
          // failed), so deleting an unjudged token must not turn into a
          // schema error either.
          const substituted = check.resolvedParams !== undefined && (check.unresolvedTokens ?? 0) === 0;
          const issues = templateParamIssues(
            best.template,
            check.resolvedParams ?? best.params,
            paramsStrictness({ tokens, substituted, dataPack }),
          );
          validation.errors.push(...issues.errors);
          for (const w of issues.warnings) lintIssues.push({ rule: "template-params", ids: [], message: w, severity: "warn" });
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
      route,
    };
  }

  // best-effort: `best` may still carry a template other than the forced
  // one (validation.ok is computed before the forced-template mismatch
  // string is appended, so a structurally valid wrong-template spec still
  // gets kept as `best`) — surface that as a top-level error rather than a
  // silent success with the wrong template.
  const forcedMismatch = cfg.forcedTemplate && best && best.template !== cfg.forcedTemplate;

  // The teaching-quality pass: geometry has its lint, this is the pedagogy's.
  // One extra round at low effort; the revision is adopted only when it stays
  // valid, keeps the same template (no new engines), and lints no worse —
  // a finished spec is never traded for a worse one, and an API hiccup here
  // never costs the spec we already have.
  if (best && !forcedMismatch && cfg.pedagogyReview) {
    try {
      const lintOf = (spec: Spec): LintIssue[] | null => {
        try {
          return [...layoutSpec(spec, measure).issues, ...lintCommands(spec)];
        } catch {
          return null;
        }
      };
      const baseLint = lintOf(best) ?? [];
      const count = (issues: LintIssue[], sev: string) => issues.filter((i) => i.severity === sev).length;
      const round = rounds.length + 1;
      const { json, meta } = await callForJson(
        client,
        cfg.model,
        system,
        [...messages, { role: "assistant", content: lastRaw }, { role: "user", content: PEDAGOGY_RUBRIC }],
        schema,
        {
          signal: cfg.signal,
          effort: "low",
          onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label: "pedagogy", round, text })),
        },
      );
      const v = validateSpec(json);
      // Recorded lint must always describe the DELIVERED spec (`best` after
      // this block), not whichever candidate the model proposed: default to
      // the base spec's lint, and only swap in the candidate's when it is
      // actually adopted below — a rejected (invalid, wrong-template, or
      // worse-linting) candidate must never overwrite this round's signal.
      let lintIssues: LintIssue[] = baseLint;
      let adopted = false;
      if (v.ok && (json as Spec).template === best.template) {
        const revised = json as Spec;
        const revisedLint = lintOf(revised);
        if (revisedLint !== null) {
          const noWorse =
            count(revisedLint, "error") <= count(baseLint, "error") && count(revisedLint, "warn") <= count(baseLint, "warn");
          const changed = JSON.stringify(revised) !== JSON.stringify(best);
          if (noWorse && changed) {
            best = revised;
            adopted = true;
            lintIssues = revisedLint;
          }
        }
      }
      rounds.push({ label: "pedagogy", spec: json, validationErrors: v.ok ? [] : v.errors, lintIssues, meta, adopted });
    } catch {
      /* best-effort by design */
    }
  }
  return {
    spec: best,
    rounds,
    error: forcedMismatch
      ? `The model never produced a spec using the required template "${cfg.forcedTemplate}" (returned "${best!.template}") — try again or drop the forced template.`
      : best
        ? undefined
        : "The model never produced a valid spec (see rounds).",
    systemPromptChars: blocks.prefix.length + suffixText.length,
    route,
  };
}

/** The outline call for #playlist / #parts=N. Throws on API errors; null when the model's outline is unusable. */
export async function generateOutline(
  request: string,
  cfg: { apiKey: string; model: string },
  parts: number | null,
  signal?: AbortSignal,
  chapters?: string[],
): Promise<Outline | null> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildOutlineMessages(request, parts, chapters);
  const { json } = await callForJson(client, cfg.model, system, [{ role: "user", content: user }], OUTLINE_SCHEMA as unknown as object, { signal });
  return normalizeOutline(json, chapters);
}
