// Validate a spec's params against its template's params_schema — the check
// the wire schema never does (params is additionalProperties: true there).
// Used at authoring time after data tokens have been substituted, so the
// model hears "values: expected numbers, got strings" in the repair round.
// Strict = errors; lenient = warnings (pre-existing templates fed by hand,
// where a stricter reading must not regress a bundled example).

import AjvModule, { type ValidateFunction } from "ajv";
import { scenes } from "./registry";

const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;
const ajv = new AjvCtor({ allErrors: true, strict: false });
const compiled = new Map<string, { schema: object; validate: ValidateFunction }>();

export function templateParamErrors(templateId: string, params: unknown): string[] {
  const scene = scenes[templateId];
  if (!scene || scene.manifest.status !== "ready") return [];
  const schema = scene.manifest.params_schema;
  let entry = compiled.get(templateId);
  if (!entry || entry.schema !== schema) {
    entry = { schema, validate: ajv.compile(schema) };
    compiled.set(templateId, entry);
  }
  if (entry.validate(params ?? {})) return [];
  return (entry.validate.errors ?? []).map(
    (e) => `params${e.instancePath || ""} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

export function templateParamIssues(templateId: string, params: unknown, strict: boolean): { errors: string[]; warnings: string[] } {
  const problems = templateParamErrors(templateId, params).map((p) => `template "${templateId}": ${p}`);
  return strict ? { errors: problems, warnings: [] } : { errors: [], warnings: problems };
}
