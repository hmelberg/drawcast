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
// validate: null marks a template whose params_schema is not itself valid
// JSON Schema — cached so a broken schema is compiled (and thrown) at most
// once, not on every round.
const compiled = new Map<string, { schema: object; validate: ValidateFunction | null }>();

export function templateParamErrors(templateId: string, params: unknown): string[] {
  const scene = scenes[templateId];
  if (!scene || scene.manifest.status !== "ready") return [];
  const schema = scene.manifest.params_schema;
  let entry = compiled.get(templateId);
  if (!entry || entry.schema !== schema) {
    let validate: ValidateFunction | null;
    try {
      validate = ajv.compile(schema);
    } catch {
      // validateTemplateDoc only requires params to be an object — it never
      // checks that it's valid JSON Schema, so a broken schema is a
      // template-authoring defect, not this spec's fault. Schema validity
      // belongs to validateTemplateDoc, not here: report nothing, the same
      // "no verdict" treatment an unknown or stub template already gets,
      // rather than letting the throw reject the whole generation.
      validate = null;
    }
    entry = { schema, validate };
    compiled.set(templateId, entry);
  }
  if (!entry.validate || entry.validate(params ?? {})) return [];
  return (entry.validate.errors ?? []).map(
    (e) => `params${e.instancePath || ""} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

export function templateParamIssues(templateId: string, params: unknown, strict: boolean): { errors: string[]; warnings: string[] } {
  const problems = templateParamErrors(templateId, params).map((p) => `template "${templateId}": ${p}`);
  return strict ? { errors: problems, warnings: [] } : { errors: [], warnings: problems };
}

/**
 * Whether a post-substitution params check may be strict (errors) rather
 * than advisory (warnings). `dataPack` always forces strict — those
 * templates are the bridge's own, so a schema mismatch is never someone
 * else's pre-existing content. Otherwise strict requires BOTH `tokens`
 * (the spec actually referenced code data) AND `substituted` (the check
 * that resolves those tokens actually ran to completion): a check that
 * never ran or timed out (NO_CODE_CHECK) leaves raw token strings in
 * params — only warnings can be honest about them, since the mismatch
 * a strict read would report ("expected number, got string") is an
 * artifact of the unresolved token, not a real problem with the spec.
 */
export function paramsStrictness(opts: { tokens: boolean; substituted: boolean; dataPack: boolean }): boolean {
  return (opts.tokens && opts.substituted) || opts.dataPack;
}
