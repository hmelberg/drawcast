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
 * than advisory (warnings). Two conditions, both necessary:
 *
 * 1. Something must put this spec in scope at all — either it referenced
 *    code data (`tokens`) or it names one of the data pack's own templates
 *    (`dataPack`, where a schema mismatch is never someone else's
 *    pre-existing hand-fed content).
 * 2. If it DID reference code data, that reference must have been judged
 *    (`substituted`): a check that never ran, timed out (NO_CODE_CHECK) or
 *    met an unavailable runtime leaves its tokens unresolved, and the
 *    resolver deletes an unjudged token's whole property. Reading that
 *    strictly blames the spec twice over — once for the raw token string
 *    the schema never wanted ("expected number, got string"), once for the
 *    hole the deletion left, which in a data-pack template can trip the
 *    pack's own `required`/`oneOf`. A data-pack template fed by tokens
 *    whose script could not be judged (offline, timeout) may therefore
 *    only warn, exactly like any other template in that position.
 */
export function paramsStrictness(opts: { tokens: boolean; substituted: boolean; dataPack: boolean }): boolean {
  return (opts.dataPack || opts.tokens) && (!opts.tokens || opts.substituted);
}
