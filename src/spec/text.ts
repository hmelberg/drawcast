// Spec text in two formats: JSON (the engine/LLM wire format) and YAML (the
// human format — indentation, few quotes, comments). Parsing is tolerant and
// auto-detecting so external sources (Google Docs, uploads, pasted text) can
// use either; the engine only ever sees the parsed object.

import { CORE_SCHEMA, dump, load, YAMLException } from "js-yaml";
import { desmartenJson, extractJson } from "./extract";

export type SpecFormat = "yaml" | "json";

export interface ParsedSpecText {
  value: unknown;
  /** The format the text was recognized as. */
  format: SpecFormat;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse spec text in either format.
 *
 * Detection order matters: a YAML document may contain small JSON-parseable
 * fragments (e.g. `params: {}`), so the whole-document readings run before the
 * embedded-JSON fallback:
 *   1. the whole text is JSON (after smart-quote repair),
 *   2. the whole text is YAML (raw, then smart-quote-repaired — Google Docs
 *      curls quoted strings there too),
 *   3. a JSON object embedded in surrounding prose (the classic gdoc case).
 */
export function parseSpecText(text: string): ParsedSpecText {
  const desmartened = desmartenJson(text);

  try {
    const value = JSON.parse(desmartened.trim()) as unknown;
    if (isPlainObject(value)) return { value, format: "json" };
  } catch {
    /* not whole-document JSON */
  }

  let yamlError: unknown = null;
  for (const candidate of [text, desmartened]) {
    try {
      // CORE_SCHEMA keeps every value a JSON type (no implicit Date parsing).
      const value = load(candidate, { schema: CORE_SCHEMA });
      if (isPlainObject(value)) return { value, format: "yaml" };
      // Parsed but not a mapping (a bare string/number/list) — remember why.
      yamlError ??= new Error("the document is not a mapping (an object with keys)");
    } catch (err) {
      yamlError ??= err;
    }
  }

  try {
    return { value: extractJson(desmartened), format: "json" };
  } catch {
    /* no embedded JSON either — report the YAML reading, it's the most informative */
  }

  if (yamlError instanceof YAMLException) {
    const line = yamlError.mark ? ` (line ${yamlError.mark.line + 1})` : "";
    throw new Error(`not JSON, and not valid YAML${line}: ${yamlError.reason ?? yamlError.message}`);
  }
  throw new Error(`could not read the text as JSON or YAML: ${(yamlError as Error | null)?.message ?? "empty document"}`);
}

/** Serialize a spec for display/download in the given format. */
export function formatSpec(spec: unknown, format: SpecFormat): string {
  if (format === "json") return JSON.stringify(spec, null, 2);
  // lineWidth -1: never wrap narration sentences; noRefs: no YAML anchors.
  return dump(spec, { lineWidth: -1, noRefs: true });
}
