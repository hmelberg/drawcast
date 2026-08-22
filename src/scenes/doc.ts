// TemplateDoc — the one document format every template uses (spec §1),
// whether bundled, in a pack, or user-created.

import { CORE_SCHEMA, load } from "js-yaml";
import { KIT_VERSION } from "./kit";
import { KNOWN_ENGINES } from "./engines";
import type { SceneManifest } from "./types";

export interface TemplateDoc {
  template: string;
  title?: string;
  version: number;
  kit: number;
  status: "ready" | "stub";
  description: string;
  /** JSON schema for params — content only, never coordinates. */
  params: object;
  element_ids: Record<string, string>;
  examples: { request: string; params: Record<string, unknown> }[];
  engines?: string[];
  /** JS function body: (params, kit, engines) => SceneLayout. Required when ready. */
  layout?: string;
}

export interface DocResult {
  doc?: TemplateDoc;
  errors: string[];
}

export function parseTemplateDoc(yamlText: string): DocResult {
  let raw: unknown;
  try {
    raw = load(yamlText, { schema: CORE_SCHEMA });
  } catch (err) {
    return { errors: [`YAML: ${(err as Error).message}`] };
  }
  return validateTemplateDoc(raw);
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function validateTemplateDoc(raw: unknown): DocResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { errors: ["document must be a YAML mapping"] };
  }
  const d = raw as Record<string, unknown>;

  if (typeof d.template !== "string" || !ID_RE.test(d.template)) {
    errors.push(`template id must match ${ID_RE} — got ${JSON.stringify(d.template)}`);
  }
  if (!Number.isInteger(d.version) || (d.version as number) < 1) errors.push("version must be a positive integer");
  if (!Number.isInteger(d.kit) || (d.kit as number) < 1) {
    errors.push("kit must be a positive integer");
  } else if ((d.kit as number) > KIT_VERSION) {
    errors.push(`written for a newer kit (${d.kit} > ${KIT_VERSION}) — update the app`);
  }
  if (d.status !== "ready" && d.status !== "stub") errors.push('status must be "ready" or "stub"');
  if (typeof d.description !== "string" || d.description.trim() === "") errors.push("description is required");
  if (typeof d.params !== "object" || d.params === null) errors.push("params must be an object (JSON schema)");
  if (typeof d.element_ids !== "object" || d.element_ids === null || Object.values(d.element_ids as object).some((v) => typeof v !== "string")) {
    errors.push("element_ids must map ids to doc strings");
  }
  if (!Array.isArray(d.examples)) {
    errors.push("examples must be an array");
  } else {
    d.examples.forEach((ex, i) => {
      const e = ex as Record<string, unknown>;
      if (typeof e?.request !== "string" || typeof e?.params !== "object" || e.params === null) {
        errors.push(`example ${i} must have a request string and a params object`);
      }
    });
  }
  if (d.engines !== undefined) {
    if (!Array.isArray(d.engines) || !d.engines.every((e) => typeof e === "string")) {
      errors.push("engines must be an array of strings");
    } else {
      for (const e of d.engines as string[]) {
        if (!(KNOWN_ENGINES as readonly string[]).includes(e)) {
          errors.push(`unknown engine "${e}" — known engines: ${KNOWN_ENGINES.join(", ")}`);
        }
      }
    }
  }
  if (d.status === "ready" && (typeof d.layout !== "string" || d.layout.trim() === "")) {
    errors.push("a ready template needs a layout function body");
  }
  if (d.title !== undefined && typeof d.title !== "string") errors.push("title must be a string");

  return errors.length > 0 ? { errors } : { doc: d as unknown as TemplateDoc, errors: [] };
}

export function docToManifest(doc: TemplateDoc): SceneManifest {
  return {
    name: doc.template,
    status: doc.status,
    description: doc.description,
    params_schema: doc.params,
    element_ids: doc.element_ids,
    examples: doc.examples,
    ...(doc.engines && doc.engines.length > 0 ? { engines: doc.engines } : {}),
  };
}
