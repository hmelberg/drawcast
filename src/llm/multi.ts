// Multi-part generation, shared by #playlist (one drawcast of N parts) and the
// course runner (one lecture of N parts). One outline call, then one ordinary
// generateSpec per part — per-part generation stays inside the quality envelope
// tuned for single figures, which one giant completion would not.

import { generateOutline, generateSpec, type GenerateConfig, type GenerationOutcome } from "./compile";
import { buildPartRequest, type Outline } from "./outline";
import { generationGate } from "./limit";
import { authorOnDemand } from "./on-demand";
import type { Spec } from "../spec/types";
import type { TemplateDoc } from "../scenes/doc";

export interface PartsRequest {
  /** The request with tags already stripped. */
  request: string;
  parts: number | null;
  /** Directing brief built from #tags. */
  brief: string;
  /** Author-declared chapters; the outline distributes parts among them. */
  chapters?: string[];
}

export interface PartsResult {
  outline: Outline | null;
  specs: Spec[];
  /** The chapter each spec falls under, parallel to `specs`. */
  chapterOf: (string | undefined)[];
  /** 1-based numbers of the parts that produced no spec. */
  failed: number[];
  /** Why each of `failed` failed, in the same order. */
  errors?: string[];
  /** Set only when NO part produced a spec (the first part's error). */
  error?: string;
}

export interface PartsHooks {
  onOutline?: (outline: Outline) => void;
  onPart?: (done: number, total: number, index: number, outcome: GenerationOutcome) => void;
  /** A line for the status: "part 3: authoring a template", "part 5: redrawing with sailboat_anatomy". */
  onPhase?: (text: string) => void;
}

/**
 * Template on demand across the parts (cfg.templatesOnDemand): after the
 * parallel pass, every part the router found nothing for and the compiler
 * drew freehand is handled IN ORDER — first re-routed, because a template
 * authored for an earlier part may now fit (then it is simply regenerated
 * with the router's shortlist); otherwise a template is authored for it and
 * it is redrawn. Sequential on purpose: each template must be registered
 * before the next part is looked at, or two parts about the same figure get
 * two templates. Every authored document is reported to cfg.onTemplateAuthored
 * and embedded in every part that uses it, so the parts publish intact.
 */
async function authorTemplatesForParts(
  req: PartsRequest,
  plan: Outline,
  cfg: GenerateConfig,
  outcomes: GenerationOutcome[],
  hooks: PartsHooks,
): Promise<void> {
  const authored = new Map<string, TemplateDoc>();
  const embed = (spec: Spec | null): void => {
    const doc = spec?.template ? authored.get(spec.template) : undefined;
    if (spec && doc) spec.templates = [doc];
  };
  for (let i = 0; i < outcomes.length; i++) {
    if (cfg.signal?.aborted) return;
    const o = outcomes[i];
    if (!o.spec || o.spec.template || !o.route?.noneFits) continue;
    const request = buildPartRequest(req.request, plan, i, req.brief);
    const label = `part ${i + 1}`;
    // Re-route: an earlier part's template may fit this one.
    if (cfg.route && authored.size > 0) {
      hooks.onPhase?.(`${label}: looking for a template again`);
      const again = await cfg.route(request, cfg.signal).catch(() => null);
      if (again && again.ids.length > 0) {
        hooks.onPhase?.(`${label}: redrawing with ${again.ids[0]}`);
        const redo = await generateSpec(request, cfg);
        if (redo.spec) {
          embed(redo.spec);
          outcomes[i] = redo;
        }
        continue;
      }
    }
    hooks.onPhase?.(`${label}: authoring a template`);
    const r = await authorOnDemand(request, o.spec, {
      apiKey: cfg.apiKey,
      model: cfg.model,
      effort: cfg.effort,
      signal: cfg.signal,
      onProgress: ({ phase, round }) => hooks.onPhase?.(`${label}: ${phase === "brief" ? "writing the brief" : phase === "author" ? (round > 1 ? `authoring, repair ${round - 1}` : "authoring a template") : "redrawing with the new template"}`),
      generate: (r2, forced) => generateSpec(r2, { ...cfg, forcedTemplate: forced, route: undefined }),
    });
    if (r.doc && r.yaml) {
      authored.set(r.doc.template, r.doc);
      cfg.onTemplateAuthored?.({ id: r.doc.template, yaml: r.yaml, doc: r.doc });
    }
    if (r.outcome?.spec) outcomes[i] = r.outcome; // authorOnDemand embedded the document already
  }
}

export const EMPTY_PARTS: PartsResult = { outline: null, specs: [], chapterOf: [], failed: [] };

/**
 * Phase one, on its own so a batch can run every outline first and then pour
 * all the parts into one pool. Outlines are small and independent; doing them
 * inside each lecture's turn leaves the generation gate idle while they run.
 */
export async function outlineParts(req: PartsRequest, cfg: GenerateConfig): Promise<{ outline: Outline | null; error?: string }> {
  let outline: Outline | null;
  try {
    outline = await generationGate(() =>
      // Same guard the parts have: an outline still queued when the run was
      // cancelled must not spend a call on its way out.
      cfg.signal?.aborted
        ? Promise.resolve(null)
        : generateOutline(req.request, { apiKey: cfg.apiKey, model: cfg.model }, req.parts, cfg.signal, req.chapters),
    );
  } catch (err) {
    return { outline: null, error: (err as Error).message };
  }
  if (!outline) return { outline: null, error: "the model could not outline this into parts" };
  if (!outline.title) outline.title = req.request;
  return { outline };
}

/** Phase two: the parts of one already-planned drawcast. */
export async function generateFromOutline(
  req: PartsRequest,
  plan: Outline,
  cfg: GenerateConfig,
  hooks: PartsHooks = {},
): Promise<PartsResult> {
  // Parts depend only on the outline (bridging uses outline titles, not each
  // other's specs), so they generate in parallel — the gate caps how many.
  const n = plan.parts.length;
  let finished = 0;
  const outcomes = await Promise.all(
    plan.parts.map((_, i) =>
      generationGate(() =>
        // A queued task whose run was cancelled while it waited must not spend
        // a call: after a cancel, dozens of doomed requests could still be
        // holding gate slots.
        cfg.signal?.aborted
          ? Promise.resolve({ spec: null, rounds: [], error: "cancelled", systemPromptChars: 0 } satisfies GenerationOutcome)
          : generateSpec(buildPartRequest(req.request, plan, i, req.brief), cfg),
      ).then((outcome) => {
        finished++;
        hooks.onPart?.(finished, n, i, outcome);
        return outcome;
      }),
    ),
  );

  if (cfg.templatesOnDemand && !cfg.signal?.aborted) await authorTemplatesForParts(req, plan, cfg, outcomes, hooks);

  const specs: Spec[] = [];
  const chapterOf: (string | undefined)[] = [];
  const failed: number[] = [];
  const errors: string[] = [];
  outcomes.forEach((outcome, i) => {
    if (!outcome.spec) {
      failed.push(i + 1);
      errors.push(outcome.error ?? "no spec");
      return;
    }
    outcome.spec.title ??= plan.parts[i].title;
    outcome.spec.level ??= plan.parts[i].level ?? undefined;
    specs.push(outcome.spec);
    chapterOf.push(plan.parts[i].chapter);
  });
  return {
    outline: plan,
    specs,
    chapterOf,
    failed,
    errors,
    error: specs.length === 0 ? (outcomes[0]?.error ?? "no spec") : undefined,
  };
}

/** Both phases, for the single-drawcast path (#playlist / #parts=N). */
export async function generateParts(req: PartsRequest, cfg: GenerateConfig, hooks: PartsHooks = {}): Promise<PartsResult> {
  const { outline, error } = await outlineParts(req, cfg);
  if (!outline) return { ...EMPTY_PARTS, error };
  hooks.onOutline?.(outline);
  return generateFromOutline(req, outline, cfg, hooks);
}
