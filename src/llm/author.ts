// The template-authoring pipeline (spec §6): description and/or image →
// TemplateDoc, with the same call → validate → repair shape as generateSpec.
// The validation chain: doc validation → id collision → compile → run the
// first example → preview lint through the REAL layoutSpec (temporary
// registration, always restored).

import type Anthropic from "@anthropic-ai/sdk";
import { dump } from "js-yaml";
import { callForJson, describeApiError, makeClient, type JsonCallMeta } from "./client";
import { repairModelFor } from "./compile";
import { parseTemplateDoc, validateTemplateDoc, type TemplateDoc } from "../scenes/doc";
import { compileTemplateDoc } from "../scenes/compile";
import { ensureEngines } from "../scenes/engines";
import { scenes, type SceneModule } from "../scenes/registry";
import { isUserTemplateId } from "../scenes/my-templates";
import { layoutSpec } from "../layout/layout";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import { lintReportText, type LintIssue } from "../lint/lint";
import { makeBrowserMeasure } from "../render/svg-backend";
import kitSource from "../scenes/kit.ts?raw";
import exemplarYaml from "../scenes/cell_diagram/template.yaml?raw";
import authorPromptSource from "./prompts/author-v1.md?raw";

export interface AuthorImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataBase64: string;
}

export interface AuthorRound {
  label: "initial" | "repair";
  doc: unknown;
  errors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
}

export interface AuthorOutcome {
  doc: TemplateDoc | null;
  yaml: string | null;
  rounds: AuthorRound[];
  /** Full conversation (image included) — pass back for refine rounds. */
  history: Anthropic.MessageParam[];
  error?: string;
}

export interface AuthorConfig {
  apiKey: string;
  model: string;
  maxRepairs?: number;
  /** Improve mode: the current template's YAML. */
  existingYaml?: string;
  /** Refine mode: prior authoring conversation to continue. */
  history?: Anthropic.MessageParam[];
}

/** Closed shape for structured outputs; the open params object may 400 — callForJson falls back. */
export const TEMPLATE_DOC_API_SCHEMA = {
  type: "object",
  properties: {
    template: { type: "string" },
    title: { type: "string" },
    version: { type: "integer" },
    kit: { type: "integer" },
    status: { type: "string", enum: ["ready"] },
    description: { type: "string" },
    params: { type: "object" },
    element_ids: { type: "object" },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: { request: { type: "string" }, params: { type: "object" } },
        required: ["request", "params"],
      },
    },
    layout: { type: "string" },
  },
  required: ["template", "version", "kit", "status", "description", "params", "element_ids", "examples", "layout"],
} as const;

export function buildAuthorSystem(): Anthropic.TextBlockParam[] {
  const text = authorPromptSource
    .replaceAll("{{KIT_SOURCE}}", kitSource)
    .replaceAll("{{EXEMPLAR_YAML}}", exemplarYaml)
    .replaceAll("{{BUILTIN_IDS}}", Object.keys(scenes).sort().join(", "));
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export function buildAuthorUserContent(description: string, image: AuthorImage | null, existingYaml?: string): Anthropic.MessageParam["content"] {
  const text = existingYaml
    ? `${description}\n\nCurrent template to improve:\n\`\`\`yaml\n${existingYaml}\n\`\`\``
    : description;
  if (!image) return text;
  return [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.dataBase64 } },
    { type: "text", text },
  ];
}

/** Register the doc's compiled module, run fn, ALWAYS restore the previous registry state. */
function withPreviewRegistration<T>(doc: TemplateDoc, layout: NonNullable<SceneModule["layout"]>, fn: () => T): T {
  const id = doc.template;
  const prev = scenes[id];
  scenes[id] = { manifest: { name: id, status: "ready", description: doc.description, params_schema: doc.params, element_ids: doc.element_ids, examples: doc.examples }, layout };
  try {
    return fn();
  } finally {
    if (prev) scenes[id] = prev;
    else delete scenes[id];
  }
}

/** The full authoring validation chain. Pure of API concerns; DOM-free by default. */
export function processAuthorDoc(json: unknown, measure: MeasureFn = heuristicMeasure): { doc: TemplateDoc | null; errors: string[]; lintIssues: LintIssue[] } {
  const v = validateTemplateDoc(json);
  if (!v.doc) return { doc: null, errors: v.errors, lintIssues: [] };
  const doc = v.doc;

  if (scenes[doc.template] && !isUserTemplateId(doc.template)) {
    return { doc, errors: [`the id "${doc.template}" is a built-in template — return the document with a different template id`], lintIssues: [] };
  }

  const compiled = compileTemplateDoc(doc);
  if (!compiled.module?.layout) {
    return { doc, errors: compiled.errors.length > 0 ? compiled.errors : ["the document compiled to a stub (no layout)"], lintIssues: [] };
  }

  const params = doc.examples[0]?.params ?? {};
  try {
    compiled.module.layout(params);
  } catch (err) {
    return { doc, errors: [`the layout failed on examples[0].params: ${(err as Error).message}`], lintIssues: [] };
  }

  // Preview through the REAL layoutSpec (collision-solved labels, lint) —
  // this is the same pipeline a rendered scene goes through, not a re-implementation.
  const result = withPreviewRegistration(doc, compiled.module.layout, () => layoutSpec({ template: doc.template, params, elements: [] }, measure));
  if (result.warnings.length > 0) {
    // layoutSpec's warnings (unknown/stub template, layout threw) signal a
    // pipeline-level problem, not a LintIssue.rule the lint module knows about —
    // treat them as blocking errors rather than inventing a fake lint rule.
    return { doc, errors: result.warnings.map((w) => `template preview: ${w}`), lintIssues: [] };
  }
  return { doc, errors: [], lintIssues: result.issues };
}

const YAML_OPTS = { lineWidth: -1, noRefs: true } as const;

/** Serialize + round-trip guard: never hand the user YAML that will not parse back. */
export function templateDocToYaml(doc: TemplateDoc): { yaml: string | null; error?: string } {
  const yaml = dump(doc, YAML_OPTS);
  const back = parseTemplateDoc(yaml);
  if (!back.doc) return { yaml: null, error: `serialized YAML failed to re-parse: ${back.errors[0]}` };
  return { yaml };
}

function needsAuthorRepair(errors: string[], lintIssues: LintIssue[]): boolean {
  return errors.length > 0 || lintIssues.some((i) => i.severity === "error");
}

export async function generateTemplate(description: string, image: AuthorImage | null, cfg: AuthorConfig): Promise<AuthorOutcome> {
  const client = makeClient(cfg.apiKey);
  const system = buildAuthorSystem();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;
  const messages: Anthropic.MessageParam[] = [
    ...(cfg.history ?? []),
    { role: "user", content: buildAuthorUserContent(description, image, cfg.existingYaml) },
  ];
  const rounds: AuthorRound[] = [];
  let best: { doc: TemplateDoc; yaml: string } | null = null;
  let repairsUsed = 0;

  try {
    while (true) {
      const roundModel = rounds.length === 0 ? cfg.model : repairModelFor(cfg.model);
      const { json, raw, meta } = await callForJson(client, roundModel, system, messages, TEMPLATE_DOC_API_SCHEMA as unknown as object);
      // Validate first (cheap), await any declared engines BEFORE the full
      // validate+collision+compile+run chain — processAuthorDoc's own layout
      // call needs the engine already loaded (getLoadedEngines is sync).
      // processAuthorDoc re-validates internally; that second pass is cheap.
      const preValidate = validateTemplateDoc(json);
      const engineErrors: string[] = [];
      if (preValidate.doc?.engines && preValidate.doc.engines.length > 0) {
        await ensureEngines(preValidate.doc.engines).catch((err) => {
          engineErrors.push(`engine load failed: ${(err as Error).message}`);
        });
      }
      const { doc, errors: rawDocErrors, lintIssues } = processAuthorDoc(json, measure);
      // When the engine itself failed to load, processAuthorDoc's own layout
      // run typically fails too (the layout body needs that engine) — drop
      // that redundant "layout failed" wording rather than showing the same
      // underlying failure twice.
      const docErrors =
        engineErrors.length > 0 ? rawDocErrors.filter((e) => !e.startsWith("the layout failed on examples[0].params")) : rawDocErrors;
      const errors = [...engineErrors, ...docErrors];
      rounds.push({ label: rounds.length === 0 ? "initial" : "repair", doc: json, errors, lintIssues, meta });

      if (doc && errors.length === 0) {
        const y = templateDocToYaml(doc);
        if (y.yaml) best = { doc, yaml: y.yaml };
        else errors.push(y.error!);
      }

      if (!needsAuthorRepair(errors, lintIssues) || repairsUsed >= maxRepairs) {
        messages.push({ role: "assistant", content: raw });
        break;
      }
      repairsUsed++;
      const lintErrors = lintIssues.filter((i) => i.severity === "error");
      const feedback =
        errors.length > 0
          ? `The template document has problems:\n${errors.join("\n")}\n\nReturn the corrected COMPLETE template document as minified JSON.`
          : `The template renders with visual problems:\n${lintReportText(lintErrors)}\n\nReturn the corrected COMPLETE template document as minified JSON.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return { doc: best?.doc ?? null, yaml: best?.yaml ?? null, rounds, history: messages, error: describeApiError(err) };
  }

  return {
    doc: best?.doc ?? null,
    yaml: best?.yaml ?? null,
    rounds,
    history: messages,
    error: best ? undefined : "The model never produced a working template (see rounds).",
  };
}
