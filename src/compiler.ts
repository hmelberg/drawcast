// Compiler entry — drawcast's request→spec pipeline for host apps, built to
// dist-engine/compiler.js. Separate from engine.js so the rendering path
// never loads the Anthropic SDK. Anthropic-direct from the browser (BYOK or
// vended key), exactly like the drawcast app itself.
import bundledExamples from "./examples.json";
import { DEFAULT_MODEL } from "./llm/client";
import { generateSpec, promptVariants, type GenerationOutcome } from "./llm/compile";
import { usableExemplars, type ExemplarCandidate } from "./llm/exemplars";
import { isReadyTemplate } from "./scenes/catalog";
import { PACK_DEFS, ensureEnabledPacks } from "./scenes/packs";
import { formatSpec } from "./spec/text";
import type { Spec } from "./spec/types";

export { MODELS, DEFAULT_MODEL, describeApiError } from "./llm/client";
export { generateSpec };
export type { GenerationOutcome };

/** Templates host apps never see: the 3D molecule modal needs drawcast's app UI. */
const HOST_EXCLUDED_TEMPLATES = ["molecule_3d"];

export interface CompileFigureOptions {
  apiKey: string;
  model?: string;
  maxRepairs?: number;
}

export interface CompiledFigure {
  yaml: string | null;
  spec: Spec | null;
  error?: string;
  outcome: GenerationOutcome;
}

/**
 * One figure from one request, with drawcast's full quality loop
 * (schema-constrained call → validate → visual lint → capped repairs on a
 * downshifted model). The exemplar well is the bundled showcases only — a
 * host app has no drawcast library to promote from.
 */
export async function compileFigure(request: string, opts: CompileFigureOptions): Promise<CompiledFigure> {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  const bundledPool: ExemplarCandidate[] = (bundledExamples as { request: string; spec?: Spec }[]).map((e) => ({
    prompt: e.request,
    spec: e.spec,
  }));
  const outcome = await generateSpec(request, {
    apiKey: opts.apiKey,
    model: opts.model ?? DEFAULT_MODEL,
    variant: promptVariants()[0],
    exemplars: [],
    bundledExemplars: usableExemplars(bundledPool, isReadyTemplate),
    maxRepairs: opts.maxRepairs,
    excludeIds: HOST_EXCLUDED_TEMPLATES,
  });
  if (!outcome.spec) return { yaml: null, spec: null, error: outcome.error ?? "no spec produced", outcome };
  return { yaml: formatSpec(outcome.spec, "yaml"), spec: outcome.spec, outcome };
}
