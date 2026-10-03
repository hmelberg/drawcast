// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, callForText, describeApiError, isOutputLimitError, planningModelFor, repairModelFor, type Effort, type JsonCallMeta } from "./client";
import { buildOutlineMessages, normalizeOutline, outlineSchemaFor, type Outline } from "./outline";
import { buildStoryboardMessages, storyboardSchemaFor, type Approach } from "./storyboard";
import { buildSystemBlocks, formatExemplars, missingPlaceholders, stripFence, styleBlock, systemBlocks, wantsC64, wantsCode, wantsSound, OPTIONAL_PROMPT_PLACEHOLDERS, PROMPT_PLACEHOLDERS, type Exemplar } from "./prompt";
import { pickExemplars } from "./exemplars";
import { catalogIndexText, catalogIsTwoLevel, catalogParts, detectNeedTemplate, fullEntryIds, isReadyTemplate, selectTemplates, storyTemplateLines, HOT_SHORTLIST } from "../scenes/catalog";
import {
  buildTreatmentSystem,
  buildTreatmentUser,
  stagingNote,
  takeTemplateGaps,
  treatmentTemplate,
  DEFAULT_TREATMENT_EFFORT,
  type TemplateGap,
} from "./treatment";
import type { RouteResult } from "./router";
import type { OnDemandRun } from "./on-demand-run";
import type { describeTemplateFor } from "./on-demand";
import type { TemplateDoc } from "../scenes/doc";
import { ensureEnginesForSpecs } from "../scenes/engines";
import { specSchema, validateSpec, C64_FRAME_CLAUSE, C64_LANGUAGE_CLAUSE, CODE_ONLY_ELEMENT_PROPS, SOUND_ONLY_COMMAND_PROPS, SOUND_ONLY_ELEMENT_PROPS } from "../spec/schema";
import { paramsWithAssets } from "../spec/assets";
import { attachSeedCredit, type SeedBlock } from "./seed";
import { visualRepairMessages, wantsVisualRepair } from "./visual";
import { LOOK_PROMPT_SOURCE, applySpecEditsLenient, isEditsReply, lookFixPrompt, lookFoundNothing, lookUserContent, type LookImage } from "./look";
import type { Spec } from "../spec/types";
import { layoutAsSeen } from "../lint/at-scale";
import { expandSpec } from "../spec/expand";
import { lintCommands, lintReportText, type LintIssue } from "../lint/lint";
import { lintCrowding } from "../lint/crowding";
import { makeBrowserMeasure } from "../render/svg-backend";
import { codeExecutionErrors, type CodeCheckOutcome } from "../code/check";
import type { CodeRunRequest, CodeRunResult } from "../code/run";
import { paramsStrictness, templateParamIssues } from "../scenes/params-check";
import { isPackTemplateId, packTemplateIds } from "../scenes/packs";
import { scanDataTokens } from "../code/tokens";
import { checkMappedPictures, picturesInRequest, withMapCheck, type PictureMap } from "./picture-map";
import fewshots from "./prompts/fewshots.json";
import codeMd from "./prompts/compiler-v1-code.md?raw";
import c64Md from "./prompts/compiler-v1-c64.md?raw";
import soundMd from "./prompts/compiler-v1-sound.md?raw";

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
  /** The THING the figure is about (router.ts's RouteResult.subject); "" when the router had none to offer. Feeds the icon seed. */
  subject: string;
  ms: number;
  /** Set when the router call failed; the keyword selector took over. */
  error?: string;
}

export interface PromptVariant {
  name: string;
  source: string;
}

const variantModules = import.meta.glob("./prompts/compiler-*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * The code block of the compiler prompt, kept in its own file and filled into
 * {{CODE}} only for a request that wants a running script (prompt.ts's
 * wantsCode): 15k chars every other request used to pay for and never use.
 */
export const CODE_PROMPT_SOURCE = codeMd;

/**
 * The Commodore 64 part of the code block — BASIC, the game catalogue and the
 * c64 frame — kept in its own file and appended to {{CODE}} only for a
 * request that names the machine (prompt.ts's wantsC64).
 */
export const C64_PROMPT_SOURCE = c64Md;

/** What fills {{CODE}}: nothing, the code block, or the code block and the C64 part. */
export function codePromptFor(code: boolean, c64: boolean): string {
  if (!code) return "";
  return c64 ? `${CODE_PROMPT_SOURCE.trimEnd()}\n${C64_PROMPT_SOURCE}` : CODE_PROMPT_SOURCE;
}

/**
 * The `play` verb, kept in its own file and filled into {{SOUND}} only for a
 * request about sound or music (prompt.ts's wantsSound): 1.4k chars of note
 * notation and ABC that the prompt already gated in prose, so every other
 * request was paying to be told the verb does not apply to it.
 */
export const SOUND_PROMPT_SOURCE = soundMd;

export function promptVariants(): PromptVariant[] {
  return Object.entries(variantModules)
    // compiler-v1-code.md, -c64.md and -sound.md are FRAGMENTS of compiler-v1, not
    // variants of their own — the glob above would otherwise offer them in
    // the prompt picker. Every conditional block added later goes here too.
    .filter(([path]) => !/-(code|sound|c64)\.md$/.test(path))
    .map(([path, source]) => ({
      name: path.replace(/^.*compiler-/, "").replace(/\.md$/, ""),
      source,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The bundled fewshots as prompt text. `code: false` drops the ones that
 * carry a code element (review 2026-09-23): they follow the same boolean
 * that gates the code block and the code half of the schema, or a code-less
 * request is shown a worked code example beside a schema with no code
 * element in it. Omitted means all of them.
 */
export function fewshotsText(opts: { code?: boolean } = {}): string {
  const hasCode = (spec: unknown): boolean => ((spec as { elements?: { type?: string }[] }).elements ?? []).some((e) => e.type === "code");
  return (fewshots as { request: string; spec: unknown }[])
    .filter((ex) => opts.code !== false || !hasCode(ex.spec))
    .map((ex, i) => `### Example ${i + 1}\nRequest: ${ex.request}\nSpec:\n\`\`\`json\n${JSON.stringify(ex.spec, null, 1)}\n\`\`\``)
    .join("\n\n");
}

/**
 * Schema copy for the API's structured-output constraint, and for the
 * prompt's {{SCHEMA}}.
 *
 * `code` and `sound` are the SAME two booleans that already gate {{CODE}}
 * and {{SOUND}} (llm/prompt.ts's wantsCode / wantsSound); `c64` the one that
 * appends compiler-v1-c64.md to {{CODE}} (wantsC64). Omitted means the
 * full schema, so every caller that does not care is unaffected. Both blocks
 * sit before {{EXEMPLARS}}, so the cached prefix already forks four ways on
 * these two — gating the schema too adds no fifth cache entry.
 *
 * generateSpec and reviseDocument each hoist ONE pair of these booleans and
 * pass the resulting schema to every call site that needs it, so the prompt's
 * {{SCHEMA}} and the copy handed to callForJson can never disagree.
 *
 * Note what that copy is NOT (review 2026-09-23): this schema never reaches
 * the API as a structured-output constraint — client.ts
 * structuredOutputSupported rejects it (open `params`, open `animate`), so
 * every spec call runs as plain JSON. The gate is therefore prose-only: it
 * changes what the model READS, and Ajv still validates the reply against
 * the full specSchema, so a request the gate misjudged is not rejected for
 * writing a code element anyway.
 */
export function apiSchema(opts: { code?: boolean; sound?: boolean; c64?: boolean } = {}): object {
  const copy = JSON.parse(JSON.stringify(specSchema)) as Record<string, unknown>;
  delete copy.$schema;
  const props = copy.properties as Record<string, any>;
  // Internal fields a formula ask's expansion writes (spec/expand.ts
  // expandFormulaTiles): Ajv knows them; the model never writes them.
  delete props.elements.items.properties.fill;
  // …and the player's: the answer shown in each \blank box.
  delete props.elements.items.properties.fills;
  const itemObject = (props.elements.items.properties.items?.items?.anyOf as any[] | undefined)?.find((b) => b?.type === "object");
  if (itemObject?.properties) delete itemObject.properties.blank;
  if (opts.code === false) {
    const el = props.elements.items.properties;
    for (const k of CODE_ONLY_ELEMENT_PROPS) delete el[k];
    el.type.enum = el.type.enum.filter((t: string) => t !== "code");
    delete props.commands.items.properties.explore.properties.game;
  } else if (opts.c64 === false) {
    // A code request that does not name the Commodore 64 (prompt.ts's
    // wantsC64): the same gate as compiler-v1-c64.md, for the schema half.
    const el = props.elements.items.properties;
    delete el.game;
    el.language.enum = el.language.enum.filter((l: string) => l !== "basic");
    el.language.description = el.language.description.replace(C64_LANGUAGE_CLAUSE, "");
    el.frame.enum = el.frame.enum.filter((f: string) => f !== "c64");
    el.frame.description = el.frame.description.replace(C64_FRAME_CLAUSE, "");
    delete props.commands.items.properties.explore.properties.game;
  }
  if (opts.sound === false) {
    const cmd = props.commands.items.properties;
    for (const k of SOUND_ONLY_COMMAND_PROPS) delete cmd[k];
    const el = props.elements.items.properties;
    for (const k of SOUND_ONLY_ELEMENT_PROPS) delete el[k];
    el.type.enum = el.type.enum.filter((t: string) => t !== "music");
  }
  return copy;
}

export interface GenerationRound {
  label: "initial" | "schema-repair" | "lint-repair" | "template-fetch" | "pedagogy" | "visual" | "look";
  spec: unknown;
  validationErrors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
  /** Pedagogy, visual and look rounds only: whether the revision replaced the delivered spec. */
  adopted?: boolean;
  /** Look rounds only: what the critic said about the rendered frames. */
  critique?: string;
  /** Look rounds only: why the fix was not adopted, or which edits were skipped. */
  note?: string;
  /**
   * The reply hit the output ceiling and never parsed (spec is null,
   * validationErrors carries the client's message). Logged as a round because
   * the call was spent; the round after it is the compact retry.
   */
  cutOff?: true;
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
  /** True when an icon seed (cfg.fetchSeed) was fetched and sent with the request — independent of whether any seed path survived into the delivered spec. */
  seeded: boolean;
  /** The plain-text plan the spec was staged from (cfg.treatment only). */
  treatment?: string;
  /** Why the plan call failed, when it did — generation then ran without one. */
  treatmentError?: string;
  /** How long the plan call took (ms), when one ran. */
  treatmentMs?: number;
  /** The template the storyline named on its TEMPLATE line (v3), when it named one. */
  treatmentTemplate?: string;
  /**
   * Staging's notes on templates that could not do what the storyline needed
   * (treatment.ts takeTemplateGaps): taken off the reply before validation,
   * so the spec never carries them. For the owner — which templates to extend.
   */
  templateGaps?: TemplateGap[];
  /** Non-fatal notes for the author — a picture in the request that could not be mapped (cfg.mapPictures). */
  warnings?: string[];
}

export interface GenerateConfig {
  /**
   * Story first (llm/treatment.ts): before the JSON call the creative model
   * writes a plain-text storyline — question, insight, example, figure,
   * beats — and the compiler stages it. The app's single-cast default under
   * Settings.approach "storyboard" (treatment.ts singleCastTreatment): the
   * storyline rules, the shortlist with each template's interactions, and
   * the library index so the story can name a template the shortlist
   * missed. Absent or false: the one-shot call. The teaching (pedagogy)
   * pass never runs on a staged storyline — its narration was authored.
   */
  treatment?: boolean;
  /** Effort for the storyline call (default treatment.ts DEFAULT_TREATMENT_EFFORT, medium). Staging keeps `effort`. */
  treatmentEffort?: Effort;
  /**
   * The look pass (src/llm/look.ts): renders a spec's frames — one per spoken
   * line — for a critic who sees them and lists the page's problems; a fix
   * round applies the list (as edits), and the critic looks again, up to
   * `lookRounds` times (default 2) or until it answers NONE. Injected by the
   * app, since frames need a browser. Absent means no look pass.
   */
  look?: (spec: Spec) => Promise<LookImage[] | null>;
  lookRounds?: number;
  /**
   * Called once the first valid spec is in hand, BEFORE the look pass — so
   * the app can show it while the pass improves it (a minute or two).
   */
  onDraft?: (spec: Spec) => void;
  /**
   * After a structurally clean spec lands, run one teaching-quality pass: the
   * model re-reads the spec against the pedagogy rubric (situate, hook on
   * ink, one surprise, aha, no signposting) and may return an improved
   * version — adopted only if it stays valid, keeps the template, and lints
   * no worse. Off by default; the app turns it on.
   */
  pedagogyReview?: boolean;
  /**
   * Visual repair (freehand-figures Task 14), injected by the app: after the
   * pedagogy pass, renders the delivered spec's last frame (src/export/
   * snapshot.ts's snapshotPng) and hands back a PNG data URL (or null on
   * failure) — one extra call, only for a freehand spec with a group
   * (wantsVisualRepair). Absent (tests, Settings off) means the round never
   * runs. Off by default; the app turns it on from Settings → Advanced.
   */
  visualRepair?: (spec: Spec) => Promise<string | null>;
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
  /** The canonical #tag ids behind `brief` (src/llm/tags.ts). */
  tags?: string[];
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
  /**
   * The icon seed (src/llm/seed.ts), injected by the app: when the router
   * names a subject but no template fits, resolves that subject to a small
   * icon and returns its outlines as ready path elements riding the user
   * turn — a starting shape the compiler may keep, edit, rename, extend or
   * drop. Absent (tests, embeds without a key) means no seed is ever sent;
   * a lookup failure (network, no icon found) resolves to null rather than
   * throwing, so it never costs the generation.
   */
  fetchSeed?: (subject: string, signal?: AbortSignal) => Promise<SeedBlock | null>;
  /**
   * Picture mapping (picture-map.ts makeMapPictures, spec 2026-09-30-picture-
   * regions §14), injected by the app: a picture URL in the request is mapped
   * before the storyline; its part NAMES ride the storyline's and the
   * compiler's user turns, and after each reply the boxes of the names the
   * spec uses are filled in before validation. Absent (tests, embeds without
   * a key) or null (no picture in the request) means no call and no note; a
   * failure degrades to no map.
   */
  mapPictures?: (request: string, signal?: AbortSignal) => Promise<{ maps: Map<string, PictureMap>; note: string; warnings: string[] } | null>;
  /** Effort for the creative round (Settings). Repairs and the pedagogy pass always run low; omitted = the API default (high). */
  effort?: Effort;
  /** Named phases the status line can show between deltas: "routing", "writing the spec", "checking the code", "teaching pass". */
  onPhase?: (phase: string) => void;
  /**
   * Multi-part generation only (llm/multi.ts): after the parts land, every
   * part the compiler drew freehand with named parts (on-demand.ts
   * templateWorthy — whatever the router said) that SHARES its on-demand
   * brief's template id with another such part gets a template authored and
   * is redrawn with it (spec §5.5 — a lone freehand part, in a run of one or
   * of many, stays freehand and is never auto-authored). Read nowhere in
   * generateSpec itself; the single-figure path OFFERS instead, always.
   */
  templatesOnDemand?: boolean;
  /** Test seam for llm/multi.ts's per-part brief step (on-demand.ts describeTemplateFor by default). */
  describe?: typeof describeTemplateFor;
  /** The app's hook to keep a template authored on demand (My templates + panels). */
  onTemplateAuthored?: (t: { id: string; yaml: string; doc: TemplateDoc }) => void;
  /** Cap on templates authored in one multi-part run (Settings; default DEFAULT_ON_DEMAND_MAX, 0 = none). Read only when no onDemandRun is given. */
  templatesOnDemandMax?: number;
  /** The shared state of one run's authoring (on-demand-run.ts): a course hands every lecture the same object, so parallel lectures share the cap, the lock and the authored documents. */
  onDemandRun?: OnDemandRun;
  /**
   * How a multi-part drawcast or a lecture is planned (llm/multi.ts;
   * docs/2026-09-19-storyboard-approach.md). "storyboard" (the default):
   * one call writes the whole series' narration and names each part's
   * figure, then every part is drawn to its script. "independent": the
   * outline names the parts and each is written on its own, knowing the
   * others only by title — the pre-2026-09-19 pipeline, kept selectable.
   * Read nowhere in generateSpec itself; a single figure has no parts.
   */
  approach?: Approach;
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
    `- Preserve these placeholders EXACTLY as written, each on its own line where they appear now: ${[...PROMPT_PLACEHOLDERS, ...OPTIONAL_PROMPT_PLACEHOLDERS].join(", ")}. They are substituted at runtime; a prompt without them is broken.`,
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
8. NAMED PARTS — if the figure is a thing rather than a plot, its parts are named elements the narration points at, not anonymous strokes.
9. WALKED LIST — peers (kinds of bridge, types of cell) drawn one at a time sit in a group with "walk": true, so each explained one fades as the next arrives and all come back for a comparison ("zoom" also frames each with the camera); alternatives shown one after another in the same place use "walk": "replace". Not for parts the narration still builds on (a chain of steps, a mechanism).
If the spec already does all of this, reply with exactly {"unchanged": true} and nothing else. Otherwise return the improved COMPLETE spec — SAME template, params and figure; better narration, ordering and staging — as minified JSON.`;

/**
 * The adoption rule shared by every optional improvement round (pedagogy,
 * visual repair): a candidate replaces `current` only when it validates,
 * keeps the same template (no new engines), lints no worse than `current`
 * already does, and actually differs — a finished spec is never traded for
 * a worse or merely-identical one. `lintOf` is the caller's own
 * layoutSpec+lintCommands closure (it needs `measure`, which lives in
 * generateSpec), so this stays a pure function of its arguments.
 */
function adoptIfNoWorse(
  current: Spec,
  candidateJson: unknown,
  baseLint: LintIssue[],
  lintOf: (spec: Spec) => LintIssue[] | null,
  warnsMayRise = false,
  maps?: Map<string, PictureMap>,
): { spec: Spec; adopted: boolean; lintIssues: LintIssue[]; validationErrors: string[] } {
  // The mapped pictures' boxes for the names this candidate uses, filled
  // before it is judged — as for the compiler's own rounds (§14).
  const pics = checkMappedPictures(candidateJson, maps);
  const v = validateSpec(candidateJson);
  if (!v.ok || pics.errors.length > 0) return { spec: current, adopted: false, lintIssues: baseLint, validationErrors: withMapCheck(v.errors, pics) };
  const candidate = candidateJson as Spec;
  if (candidate.template !== current.template) return { spec: current, adopted: false, lintIssues: baseLint, validationErrors: [] };
  const candidateLint = lintOf(candidate);
  if (candidateLint === null) return { spec: current, adopted: false, lintIssues: baseLint, validationErrors: [] };
  const count = (issues: LintIssue[], sev: string) => issues.filter((i) => i.severity === sev).length;
  const noWorse = count(candidateLint, "error") <= count(baseLint, "error") && (warnsMayRise || count(candidateLint, "warn") <= count(baseLint, "warn"));
  const changed = JSON.stringify(candidate) !== JSON.stringify(current);
  if (noWorse && changed) return { spec: candidate, adopted: true, lintIssues: candidateLint, validationErrors: [] };
  return { spec: current, adopted: false, lintIssues: baseLint, validationErrors: [] };
}

// The pedagogy pass used to have the model echo the whole spec back to say
// "no changes" — several thousand output tokens at $25/M for nothing
// (2026-09-18). Now a pass verdict is this one small object instead; true
// for any plain object with `unchanged === true` (nothing else required).
export function isUnchangedReply(json: unknown): boolean {
  return typeof json === "object" && json !== null && !Array.isArray(json) && (json as { unchanged?: unknown }).unchanged === true;
}

export async function generateSpec(request: string, cfg: GenerateConfig): Promise<GenerationOutcome> {
  const client = makeClient(cfg.apiKey);
  // Prompt caching: the schema/catalog/fewshots prefix is sent as a
  // cache_control block, so repair rounds (and any generation within the TTL)
  // skip re-processing ~10k tokens of prompt. Below the catalog's two-level
  // threshold (src/scenes/catalog.ts) catalogParts().variable is always "",
  // so the prefix is byte-stable across requests. At or above it, catalogParts
  // splits {{CATALOG}} itself: `stable` (index + forced/priority hot set
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
      route = { ids: r.ids, noneFits: r.noneFits, subject: r.subject, ms: performance.now() - t0 };
      if (r.ids.length > 0) shortlist = r.ids;
    } catch (err) {
      if (cfg.signal?.aborted) throw err;
      route = { ids: [], noneFits: false, subject: "", ms: performance.now() - t0, error: describeApiError(err) };
    }
  }
  // ---- icon seed (Task 13b): the router named a subject but no template
  // fits — resolve it to an icon and let its outlines ride the request. ----
  const seed = route?.noneFits && route.subject && cfg.fetchSeed ? await cfg.fetchSeed(route.subject, cfg.signal).catch(() => null) : null;
  const seeded = seed !== null;
  // ---- end icon seed ----
  // ---- picture mapping (§14): the parts of a picture the request links. ----
  let mapped: { maps: Map<string, PictureMap>; note: string; warnings: string[] } | null = null;
  const warnings: string[] = [];
  if (cfg.mapPictures) {
    if (picturesInRequest(request).length > 0) cfg.onPhase?.("looking at the picture");
    try {
      mapped = await cfg.mapPictures(request, cfg.signal);
    } catch (err) {
      if (cfg.signal?.aborted) throw err;
      warnings.push(`Could not map the pictures in the request (${describeApiError(err)}); regions are left to the compiler.`);
    }
    if (mapped) warnings.push(...mapped.warnings);
  }
  const mapNoteText = mapped?.note.trim() ? mapped.note : undefined;
  // ---- end picture mapping ----
  let catalog = catalogParts({ request, forced: cfg.forcedTemplate, priorityIds: cfg.priorityIds, excludeIds: cfg.excludeIds, shortlist });
  // One pair of booleans, read three times below: the prose gate ({{CODE}}/
  // {{SOUND}}), the schema built for the prompt's {{SCHEMA}}, and the same
  // schema reused as the structured-output constraint (and again at the
  // template-fetch escalation rebuild further down). Hoisted once so those
  // three reads can never disagree.
  const wantCode = wantsCode(request);
  const wantSound = wantsSound(request);
  const wantC64 = wantsC64(request);
  // The code block rides along only for a request that wants a script; every
  // other request keeps 15k chars out of its (cached) prefix. Its C64 part
  // only when the request names the machine.
  const code = codePromptFor(wantCode, wantC64);
  const sound = wantSound ? SOUND_PROMPT_SOURCE : "";
  const schema = apiSchema({ code: wantCode, sound: wantSound, c64: wantC64 });
  // The compiler's system prompt from the CURRENT catalog — rebuilt when the
  // storyline names a template the shortlist missed, and at the
  // need_template escalation below.
  const buildSystem = () => {
    const b = buildSystemBlocks(cfg.variant.source, {
      schema,
      catalog: catalog.stable,
      fewshots: fewshotsText({ code: wantCode }),
      exemplars: formatExemplars(pickExemplars(request, cfg.exemplars, cfg.bundledExemplars ?? [], 3)),
      code,
      sound,
    });
    const suffixText = b.suffix + (catalog.variable ? "\n\n" + catalog.variable : "") + styleBlock(cfg.styleText);
    return { blocks: b, suffixText, system: systemBlocks(b.prefix, suffixText) as Anthropic.TextBlockParam[] };
  };
  let { blocks, suffixText, system } = buildSystem();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;

  // ---- the story step (cfg.treatment) ----
  let treatment: string | undefined;
  let treatmentError: string | undefined;
  let treatmentMs: number | undefined;
  let namedTemplate: string | undefined;
  if (cfg.treatment) {
    cfg.onPhase?.("writing the story");
    const twoLevel = catalogIsTwoLevel(cfg.excludeIds);
    const ids = shortlist ?? (route?.noneFits ? [] : selectTemplates(request, HOT_SHORTLIST));
    // The templates the staging step will see in full (the router's picks
    // filled up by keyword, exactly catalogParts' shortlist), one story line
    // each with its interactions, and — unless a template is forced — the
    // library's one-line index.
    const shown = cfg.forcedTemplate ? [cfg.forcedTemplate] : twoLevel ? fullEntryIds(catalog.variable) : ids;
    const lines = storyTemplateLines(shown, { excludeIds: cfg.excludeIds });
    const index = !cfg.forcedTemplate && twoLevel ? catalogIndexText({ excludeIds: cfg.excludeIds }) : undefined;
    try {
      const out = await callForText(makeClient(cfg.apiKey), cfg.model, buildTreatmentSystem(lines, index), [{ role: "user", content: [buildTreatmentUser(request, cfg.brief), mapNoteText].filter(Boolean).join("\n\n") }], {
        signal: cfg.signal,
        effort: cfg.treatmentEffort ?? DEFAULT_TREATMENT_EFFORT,
      });
      treatment = out.text.trim() || undefined;
      treatmentMs = Math.round(out.ms);
    } catch (err) {
      if (cfg.signal?.aborted) throw err;
      treatmentError = describeApiError(err);
    }
    // The story named a template the shortlist missed (mirrors the
    // need_template escalation, without its extra call): its full entry
    // joins the shortlist before staging.
    const named = treatment ? treatmentTemplate(treatment) : null;
    if (named && isReadyTemplate(named) && !(cfg.excludeIds ?? []).includes(named)) {
      namedTemplate = named;
      if (!cfg.forcedTemplate && twoLevel && !shown.includes(named)) {
        catalog = catalogParts({ request, priorityIds: cfg.priorityIds, excludeIds: cfg.excludeIds, shortlist: [named, ...shown] });
        ({ blocks, suffixText, system } = buildSystem());
      }
    }
  }
  // ---- end story step ----
  const gaps: TemplateGap[] = [];
  const userContent = [request, cfg.brief, seed?.text, mapNoteText, treatment ? stagingNote(treatment) : undefined].filter(Boolean).join("\n\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent }];
  const rounds: GenerationRound[] = [];
  let best: Spec | null = null;
  let lastRaw = "";
  let repairsUsed = 0;
  let escalated = false;
  let cutRetried = false;

  try {
    while (true) {
      const prevRound = rounds[rounds.length - 1];
      const label: GenerationRound["label"] =
        rounds.length === 0
          ? "initial"
          : prevRound.label === "template-fetch" || prevRound.cutOff
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
      const t0 = performance.now();
      let call: Awaited<ReturnType<typeof callForJson>>;
      try {
        call = await callForJson(client, roundModel, system, messages, schema, {
          signal: cfg.signal,
          effort: label === "initial" ? cfg.effort : "low",
          onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label, round, text })),
        });
      } catch (err) {
        // A creative reply that ran past the output ceiling is not a failed
        // figure, it is an over-long one — 9 of 10 lectures in a real course
        // died on this with no retry (Hans 2026-09-18). Once: ask for a more
        // compact spec of the SAME figure. The cut-off reply never reached
        // `messages`, so the note rides on the last user turn rather than on
        // a new one (turns must alternate) — the same device author.ts uses.
        // The spent call is logged as a round of its own, so the record shows
        // it and the retry reads as "attempt 2". A repair round is never
        // retried: it is already the compact form of an earlier reply.
        if (label === "initial" && !cutRetried && isOutputLimitError(err)) {
          cutRetried = true;
          rounds.push({
            label,
            spec: null,
            validationErrors: [(err as Error).message],
            lintIssues: [],
            meta: { ms: performance.now() - t0, structuredOutput: false },
            cutOff: true,
          });
          const last = messages[messages.length - 1];
          const note =
            "\n\nYour previous reply was cut off at the output limit. Reply again with a more COMPACT spec of the SAME figure: fewer and shorter speak lines, fewer commands, no comments in code — do not change what is drawn.";
          last.content = typeof last.content === "string" ? last.content + note : [...last.content, { type: "text", text: note.trim() }];
          continue;
        }
        throw err;
      }
      const { json, raw, meta } = call;
      // Staging's template-gap notes ride the reply as a top-level field the
      // spec schema does not have: off before anything reads the spec.
      for (const g of takeTemplateGaps(json)) {
        if (!gaps.some((x) => x.template === g.template && x.missing === g.missing)) gaps.push(g);
      }

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
        ({ blocks, suffixText, system } = buildSystem());
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: `Full definition of "${needed}" is now in your instructions. Return the complete spec using it.` },
        );
        rounds.push({ label: "template-fetch", spec: json, validationErrors: [], lintIssues: [], meta });
        continue;
      }

      // The mapped pictures' boxes, for the names this reply uses (§14); a
      // name the map lacks is reported with the real ones for the repair, and
      // a part name aimed into a picture nothing mapped is reported as guessed.
      const pics = checkMappedPictures(json, mapped?.maps);
      const checked = validateSpec(json);
      const validation = { ok: checked.ok && pics.errors.length === 0, errors: withMapCheck(checked.errors, pics) };
      if (cfg.forcedTemplate && (json as Spec)?.template !== cfg.forcedTemplate) {
        validation.errors.push(`the request requires template "${cfg.forcedTemplate}" — set "template" to it and use its params`);
      }
      let lintIssues: LintIssue[] = [];
      if (validation.ok) {
        best = json as Spec;
        // An engine that cannot load becomes a validation error — repair can
        // switch template, or the round fails visibly (never a silent
        // fall-through render for a hand-authored spec).
        // The spec's own engines too, not just its template's: a freehand
        // `math` element must lint against real glyphs, not against the
        // "engine not loaded" fall-through.
        await ensureEnginesForSpecs([best]).catch((err) => {
          validation.errors.push(`engine load failed: ${(err as Error).message}`);
        });
        try {
          const expanded = expandSpec(best);
          const laid = layoutAsSeen(expanded, measure); // at the cast's text scale, as drawn
          lintIssues = [...laid.issues, ...lintCommands(expanded), ...lintCrowding(laid, expanded)];
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
            // Through paramsWithAssets, never raw: authoring-time validation
            // does not go through normalizeSpec, so an unresolved "@openings"
            // would read as "expected array, got string" and the repair round
            // would answer it by INVENTING data (design 2026-09-20 §4.3).
            paramsWithAssets({ assets: best.assets, params: check.resolvedParams ?? best.params }),
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
    if (seed && best) attachSeedCredit(best, seed);
    return {
      spec: best,
      rounds,
      error: describeApiError(err),
      systemPromptChars: blocks.prefix.length + suffixText.length,
      route,
      seeded,
      treatment,
      treatmentError,
      treatmentMs,
      treatmentTemplate: namedTemplate,
      templateGaps: gaps.length ? gaps : undefined,
      warnings: warnings.length ? warnings : undefined,
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
  // never costs the spec we already have. `lintOf` is shared with the visual
  // repair round just below — both score a candidate against the same
  // closure (it needs `measure`, which only exists inside this function).
  const lintOf = (spec: Spec): LintIssue[] | null => {
    try {
      const expanded = expandSpec(spec);
      const laid = layoutAsSeen(expanded, measure); // at the cast's text scale, as drawn
      return [...laid.issues, ...lintCommands(expanded), ...lintCrowding(laid, expanded)];
    } catch {
      return null;
    }
  };

  // Never over a staged storyline: its narration was authored, and a pass
  // that rewrites it undoes what the story step bought (as for parts).
  if (best && !forcedMismatch && cfg.pedagogyReview && !treatment) {
    try {
      const baseLint = lintOf(best) ?? [];
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
      if (isUnchangedReply(json)) {
        rounds.push({ label: "pedagogy", spec: best, validationErrors: [], lintIssues: baseLint, meta, adopted: false });
      } else {
        const result = adoptIfNoWorse(best, json, baseLint, lintOf, false, mapped?.maps);
        if (result.adopted) best = result.spec;
        rounds.push({ label: "pedagogy", spec: json, validationErrors: result.validationErrors, lintIssues: result.lintIssues, meta, adopted: result.adopted });
      }
    } catch {
      /* best-effort by design */
    }
  }

  // The visual repair round (Task 14b): after everything else, let the model
  // see its own last frame once — off by default (cfg.visualRepair is
  // undefined unless Settings → Advanced turns it on), and only for a
  // freehand spec with a group (wantsVisualRepair) — a templated figure has
  // no loose parts for a snapshot to catch that text-only lint could not
  // already. Same adoption rule as the pedagogy pass above. best-effort by
  // design, same as pedagogy: a snapshot or API failure never costs the spec
  // already in hand.
  if (best && cfg.visualRepair && wantsVisualRepair(best)) {
    const png = await cfg.visualRepair(best).catch(() => null);
    if (png) {
      try {
        const baseLint = lintOf(best) ?? [];
        const round = rounds.length + 1;
        const { json, meta } = await callForJson(
          client,
          cfg.model,
          system,
          [
            ...messages,
            { role: "assistant", content: JSON.stringify(best) },
            ...visualRepairMessages(png.replace(/^data:image\/png;base64,/, ""), baseLint),
          ],
          schema,
          {
            signal: cfg.signal,
            effort: "low",
            onDelta: cfg.onProgress && ((_delta, text) => cfg.onProgress!({ label: "visual", round, text })),
          },
        );
        const result = adoptIfNoWorse(best, json, baseLint, lintOf, false, mapped?.maps);
        if (result.adopted) best = result.spec;
        rounds.push({ label: "visual", spec: json, validationErrors: result.validationErrors, lintIssues: result.lintIssues, meta, adopted: result.adopted });
      } catch {
        /* best-effort by design */
      }
    }
  }

  // The look pass: a critic sees the rendered frames; a fix round applies its
  // list; look again. Its fixes are judged by the eye, not by lint warnings,
  // so warnings may rise — never errors, never an invalid spec, never another
  // template. A fix that breaks the spec gets one repair round on the SAME
  // model (the cheaper repair model lost fixes through the API — prompt lab
  // run 3), and edits that name nothing are skipped, not fatal.
  if (best && cfg.look) {
    cfg.onDraft?.(best);
    for (let i = 0; i < (cfg.lookRounds ?? 2); i++) {
      try {
        cfg.onPhase?.(i === 0 ? "looking at the frames" : "looking again");
        const images = await cfg.look(best);
        if (!images || images.length === 0) break;
        const t0 = performance.now();
        const { text: critique } = await callForText(client, cfg.model, LOOK_PROMPT_SOURCE, [{ role: "user", content: lookUserContent(images, treatment ?? request) }], {
          signal: cfg.signal,
          effort: cfg.effort,
        });
        const baseLint = lintOf(best) ?? [];
        if (lookFoundNothing(critique)) {
          rounds.push({ label: "look", spec: best, validationErrors: [], lintIssues: baseLint, meta: { ms: performance.now() - t0, structuredOutput: false }, adopted: false, critique, note: "nothing to fix" });
          break;
        }
        cfg.onPhase?.("fixing what it saw");
        const fixTurns: Anthropic.MessageParam[] = [
          ...messages,
          { role: "assistant", content: JSON.stringify(best) },
          { role: "user", content: lookFixPrompt(critique, best as unknown as Record<string, unknown>) },
        ];
        // The edits reply answers against a looser shape than the spec schema.
        let { json, raw, meta } = await callForJson(client, cfg.model, system, fixTurns, { type: "object" }, { signal: cfg.signal, effort: cfg.effort });
        let note = "";
        if (isEditsReply(json)) {
          const applied = applySpecEditsLenient(best as unknown as Record<string, unknown>, json.edits);
          json = applied.spec;
          raw = JSON.stringify(json);
          if (applied.skipped.length) note = `skipped edits: ${applied.skipped.join("; ")}`;
        }
        const firstPics = checkMappedPictures(json, mapped?.maps);
        const firstChecked = validateSpec(json);
        const firstTry = { ok: firstChecked.ok && firstPics.errors.length === 0, errors: withMapCheck(firstChecked.errors, firstPics) };
        const errs = firstTry.ok ? (lintOf(json as Spec) ?? []).filter((x) => x.severity === "error") : [];
        if (!firstTry.ok || errs.length > baseLint.filter((x) => x.severity === "error").length) {
          const feedback = !firstTry.ok
            ? `The spec failed validation:\n${firstTry.errors.join("\n")}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON. Keep the designer's fixes.`
            : `The rendered figure has visual problems:\n${lintReportText(errs)}\n\nReturn the corrected COMPLETE spec (not a diff), as minified JSON. Keep the designer's fixes.`;
          cfg.onPhase?.("repairing the fix");
          ({ json, raw, meta } = await callForJson(client, cfg.model, system, [...fixTurns, { role: "assistant", content: raw }, { role: "user", content: feedback }], schema, {
            signal: cfg.signal,
            effort: "medium",
          }));
        }
        const result = adoptIfNoWorse(best, json, baseLint, lintOf, true, mapped?.maps);
        if (result.adopted) best = result.spec;
        else note = [note, result.validationErrors.length ? `invalid: ${result.validationErrors.slice(0, 3).join("; ")}` : "no better than before (errors, template or unchanged)"].filter(Boolean).join(" · ");
        rounds.push({ label: "look", spec: json as Spec, validationErrors: result.validationErrors, lintIssues: result.lintIssues, meta, adopted: result.adopted, critique, note: note || undefined });
        if (!result.adopted) break;
      } catch (err) {
        if (cfg.signal?.aborted) throw err;
        break;
      }
    }
  }

  // best is final now (the pedagogy pass and the visual round, if they ran,
  // have already adopted or discarded their candidates) — credit whichever
  // seed paths survived into it.
  if (seed && best) attachSeedCredit(best, seed);
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
    seeded,
    treatment,
    treatmentError,
    treatmentMs,
    treatmentTemplate: namedTemplate,
    templateGaps: gaps.length ? gaps : undefined,
    warnings: warnings.length ? warnings : undefined,
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
  // Low effort: four titles and one-line briefs need no deliberation, and at
  // the API default the model thought for thousands of tokens over a reply
  // of a hundred (cost round 2026-09-18). The parts themselves keep the
  // author's effort dial; this is the plan, not the teaching.
  const { json } = await callForJson(client, planningModelFor(cfg.model), system, [{ role: "user", content: user }], outlineSchemaFor(parts), { signal, effort: "low" });
  return normalizeOutline(json, chapters, parts);
}

/**
 * The storyboard call (docs/2026-09-19-storyboard-approach.md): the outline
 * AND the whole series' narration in one reply. The creative model at the
 * author's effort — this is where the teaching is written now — with the
 * author's style. Throws on API errors; null when the reply is unusable.
 */
export async function generateStoryboard(
  request: string,
  cfg: { apiKey: string; model: string; effort?: Effort; styleText?: string },
  parts: number | null,
  signal?: AbortSignal,
  opts: { chapters?: string[]; brief?: string; templateLines?: string; index?: string } = {},
): Promise<Outline | null> {
  const client = makeClient(cfg.apiKey);
  const { system, user } = buildStoryboardMessages(request, parts, { ...opts, styleText: cfg.styleText });
  const { json } = await callForJson(client, planningModelFor(cfg.model), system, [{ role: "user", content: user }], storyboardSchemaFor(parts), {
    signal,
    ...(cfg.effort ? { effort: cfg.effort } : {}),
  });
  return normalizeOutline(json, opts.chapters, parts);
}
