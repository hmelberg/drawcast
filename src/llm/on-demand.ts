// Template on demand (roadmap "Template on demand", step 3). When the router
// said no template draws a request and the compiler drew it freehand, the
// app OFFERS to author one. On yes, three calls in a row:
//
//   1. the BRIEF — a fast model reads the request and the freehand spec and
//      writes what a template author needs (an id, the parts, the params,
//      the requests to catch);
//   2. the AUTHOR — the shipped authoring pipeline (llm/author.ts) turns the
//      brief into a template document, validated, compiled, previewed and
//      repaired;
//   3. the REDRAW — the same request compiled again with the new template
//      forced, through the app's own generateSpec.
//
// The template is registered as a user template, saved to My templates by
// the caller (Hans's ruling, 2026-09-07: always, no keep/discard prompt),
// and EMBEDDED in the resulting spec (`spec.templates`) so the cast renders
// for a viewer who has none of the author's templates.

import { callForJson, makeClient, repairModelFor, type Effort, type JsonCallMeta } from "./client";
import { generateTemplate, type AuthorConfig, type AuthorOutcome } from "./author";
import type { GenerationOutcome } from "./compile";
import type { Spec } from "../spec/types";
import type { TemplateDoc } from "../scenes/doc";
import { scenes } from "../scenes/registry";
import { registerUserTemplateYaml } from "../scenes/my-templates";
import { MIN_PARTS, NEVER_A_PART } from "../ui/parts-model";
import { meaningfulName } from "../ui/card-model";

/**
 * The parts a FREEHAND figure names: the distinct drawables its authored
 * labels attach to. The same reading the identify drill (ui/parts-model.ts)
 * gives an authored label — a meaningful name, on a drawable that is not
 * itself words, never a sub-drawable — minus the drill's other sources:
 * a node's own words name a box in a flowchart, not a part of a thing, and a
 * template for "the flowchart about X" would be worth nothing.
 */
export function namedParts(spec: Spec): string[] {
  const typeOf = new Map<string, string>();
  for (const el of spec.elements ?? []) if (typeof el.id === "string") typeOf.set(el.id, el.type);
  const ids = new Set<string>();
  for (const el of spec.elements ?? []) {
    if (el.type !== "label" || typeof el.text !== "string" || typeof el.attach_to !== "string") continue;
    const target = typeOf.get(el.attach_to);
    if (!target || NEVER_A_PART.has(target) || el.attach_to.includes("__") || !meaningfulName(el.text)) continue;
    ids.add(el.attach_to);
  }
  return [...ids];
}

/**
 * The trigger for template on demand (Hans, 2026-09-09): the figure was drawn
 * freehand and names at least MIN_PARTS parts — whatever the router said.
 * The compiler saw the shortlisted templates in full and still composed
 * freehand; that is a stronger "none fits" than the router's guess, which on
 * a Norwegian "vis delene i en symaskin" offered the violin. The parts rule
 * keeps an arrow or a text card from costing four minutes of authoring.
 */
export function templateWorthy(spec: Spec): boolean {
  return !spec.template && namedParts(spec).length >= MIN_PARTS;
}

export interface TemplateBrief {
  id: string;
  description: string;
}

/** Closed shape: structured outputs hold the model to it. */
export const BRIEF_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" }, description: { type: "string" } },
  required: ["id", "description"],
  additionalProperties: false,
} as const;

const ID_RE = /^[a-z][a-z0-9_]*$/;

/** What the compiler drew freehand, compactly: the named things it invented are the parts a template should have. */
export function freehandSummary(spec: Spec): string {
  const els = (spec.elements ?? []).slice(0, 40).map((e) => {
    const text = typeof e.text === "string" ? ` "${e.text.slice(0, 40)}"` : "";
    const attach = typeof e.attach_to === "string" ? ` → ${e.attach_to}` : "";
    return `- ${e.id} (${e.type})${text}${attach}`;
  });
  return `${spec.title ? `Title: ${spec.title}\n` : ""}Elements the freehand drawing used:\n${els.join("\n") || "- (none)"}`;
}

export function buildBriefMessages(request: string, spec: Spec, takenIds: readonly string[]): { system: string; user: string } {
  const system = `You are drawcast's compiler. drawcast turns a short teaching request into an animated, narrated figure, preferring a scene TEMPLATE — a reusable, parametrized figure generator with named parts — and drawing freehand only when no template fits. The request below had no template, so it was drawn freehand; the app will now author a template for this KIND of figure. Write the brief the template author needs.

Reply with JSON only: {"id": "<snake_case template id, unique, not in the taken list>", "description": "<the brief>"}.

The brief is 4–8 sentences of plain prose that says:
1. what the figure IS (the kind of thing, its viewpoint or cross-section) and the reusable STRUCTURE: the meaningful parts, by name — each becomes its own outlined, labelled element. At most TEN parts: a template is a floor for many drawcasts, and a figure of thirty strokes is one the author cannot finish;
2. which things are PARAMETERS: counts, toggles, which parts to label, an optional highlight, notation where a standard one exists — content only, never coordinates, sizes or colours;
3. which REQUESTS it should catch: the concept, its synonyms, typical phrasings, so future requests route to it;
4. what to leave OUT (a template is a floor for many drawcasts, not this one figure's narration).

Taken ids: ${takenIds.join(", ")}`;
  const user = `Request: ${request}\n\n${freehandSummary(spec)}`;
  return { system, user };
}

/** The reply, made safe: a legal, untaken id and a non-empty brief, or null. */
export function parseBrief(json: unknown, takenIds: readonly string[]): TemplateBrief | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_RE.test(r.id) || takenIds.includes(r.id)) return null;
  if (typeof r.description !== "string" || r.description.trim().length < 40) return null;
  return { id: r.id, description: r.description.trim() };
}

export async function describeTemplateFor(
  request: string,
  spec: Spec,
  cfg: { apiKey: string; model: string; signal?: AbortSignal },
): Promise<{ brief: TemplateBrief | null; meta: JsonCallMeta }> {
  const client = makeClient(cfg.apiKey);
  const taken = Object.keys(scenes).sort();
  const { system, user } = buildBriefMessages(request, spec, taken);
  // A brief is a fast model's job (the repair model), and needs no dial.
  const { json, meta } = await callForJson(client, repairModelFor(cfg.model), system, [{ role: "user", content: user }], BRIEF_SCHEMA as unknown as object, {
    signal: cfg.signal,
    maxTokens: 1500,
  });
  return { brief: parseBrief(json, taken), meta };
}

export type OnDemandPhase = "brief" | "author" | "compile";

export interface OnDemandConfig {
  apiKey: string;
  model: string;
  /** Effort for the authoring round (Settings); the redraw takes its own from `generate`. */
  effort?: Effort;
  signal?: AbortSignal;
  onProgress?: (p: { phase: OnDemandPhase; round: number; text: string }) => void;
  /** The app's own generateSpec with its usual config, the new template forced. */
  generate: (request: string, forcedTemplate: string) => Promise<GenerationOutcome>;
  /** Test seams — the real pipeline pieces by default. */
  describe?: typeof describeTemplateFor;
  author?: (description: string, cfg: AuthorConfig) => Promise<AuthorOutcome>;
  register?: (yaml: string) => { ok: boolean; id?: string; errors: string[] };
}

export interface OnDemandOutcome {
  brief: TemplateBrief | null;
  doc: TemplateDoc | null;
  yaml: string | null;
  /** Authoring rounds used (initial + repairs). */
  authorRounds: number;
  /** The redraw; null when authoring failed. Its spec carries the template. */
  outcome: GenerationOutcome | null;
  error?: string;
}

/** Brief → author → register → redraw; the template ends up IN the spec. */
export async function authorOnDemand(request: string, freehand: Spec, cfg: OnDemandConfig): Promise<OnDemandOutcome> {
  const describe = cfg.describe ?? describeTemplateFor;
  const author = cfg.author ?? ((description, acfg) => generateTemplate(description, null, acfg));
  const register = cfg.register ?? registerUserTemplateYaml;

  cfg.onProgress?.({ phase: "brief", round: 1, text: "" });
  const { brief } = await describe(request, freehand, { apiKey: cfg.apiKey, model: cfg.model, signal: cfg.signal });
  if (!brief) return { brief: null, doc: null, yaml: null, authorRounds: 0, outcome: null, error: "The brief for the template author did not come back usable." };

  const a = await author(`Use the template id "${brief.id}".\n\n${brief.description}`, {
    apiKey: cfg.apiKey,
    model: cfg.model,
    effort: cfg.effort,
    signal: cfg.signal,
    onProgress: ({ round, text }) => cfg.onProgress?.({ phase: "author", round, text }),
  });
  if (!a.doc || !a.yaml) {
    return { brief, doc: null, yaml: null, authorRounds: a.rounds.length, outcome: null, error: a.error ?? "The author produced no working template." };
  }
  const reg = register(a.yaml);
  if (!reg.ok) {
    return { brief, doc: a.doc, yaml: a.yaml, authorRounds: a.rounds.length, outcome: null, error: `The template could not be registered: ${reg.errors.join("; ")}` };
  }

  cfg.onProgress?.({ phase: "compile", round: 1, text: "" });
  const outcome = await cfg.generate(request, a.doc.template);
  if (outcome.spec) {
    // The cast carries its template: whoever opens it can render it.
    outcome.spec.templates = [a.doc];
  }
  return { brief, doc: a.doc, yaml: a.yaml, authorRounds: a.rounds.length, outcome, error: outcome.spec ? undefined : (outcome.error ?? "The redraw produced no spec.") };
}
