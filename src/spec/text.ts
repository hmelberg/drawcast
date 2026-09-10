// Spec text in two formats: JSON (the engine/LLM wire format) and YAML (the
// human format — indentation, few quotes, comments). Parsing is tolerant and
// auto-detecting so external sources (Google Docs, uploads, pasted text) can
// use either; the engine only ever sees the parsed object.

import { CORE_SCHEMA, dump, load, YAMLException } from "js-yaml";
import { desmartenJson, extractJson } from "./extract";
import { specForDump } from "./assets";

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
  return dumpSpecYaml(spec);
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
/** `- - 10\n  - 20` (a pair nested in a list) → `- [10, 20]`, unless a third item follows. */
const PAIR_IN_LIST = new RegExp(String.raw`^([ \t]*)- - (${NUM})\n\1  - (${NUM})\n(?!\1  - )`, "gm");
/** `key:\n  - 10\n  - 20` (a two-number list under a key) → `key: [10, 20]`, unless a third item follows. */
const PAIR_UNDER_KEY = new RegExp(String.raw`^([ \t]*)([A-Za-z_][\w-]*):\n\1  - (${NUM})\n\1  - (${NUM})\n(?!\1  - )`, "gm");

/**
 * Two-number lists on one line: js-yaml writes every list as a block, so a
 * path of forty points ran to eighty lines, a domain to three (Hans
 * 2026-09-10: "lange path definisjoner gjør det vanskelig å orientere seg").
 * Only pairs of plain numbers are touched — YAML reads `[10, 20]` and the
 * block form as the same value, so the round trip is exact.
 */
export function compactPointPairs(yaml: string): string {
  return yaml.replace(PAIR_IN_LIST, "$1- [$2, $3]\n").replace(PAIR_UNDER_KEY, "$1$2: [$3, $4]\n");
}

/**
 * A spec as YAML for the editor: `assets` last (spec/assets.ts) and number
 * pairs on one line. lineWidth -1: never wrap narration sentences (or a
 * base64 payload); noRefs: no YAML anchors.
 */
export function dumpSpecYaml(spec: unknown): string {
  const ordered = typeof spec === "object" && spec !== null && !Array.isArray(spec) ? specForDump(spec as { assets?: unknown }) : spec;
  return compactPointPairs(dump(ordered, { lineWidth: -1, noRefs: true }));
}
