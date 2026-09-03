// The accepts_data widening: one function a template manifest's params
// schema is run through when the template opts in via `accepts_data: true`
// (doc.ts / registry.ts). Hand-editing sixty schemas' numeric params with a
// oneOf branch would drift the moment a schema changes; this widens exactly
// the leaf shapes a harvested script variable, DataFrame column, or list can
// actually fill, and leaves modes, flags and prose alone — a token can
// supply data, never choose a mode.
//
// Widened: a bare number, an array of number, an array of string, and an
// array of array of number. Left untouched: booleans, anything carrying
// `enum` (at the leaf or its array items — a fixed set of choices is a
// mode, not data), and a plain (non-array) string — a token could
// syntactically fill a `title`, but that isn't what a data token is for.
//
// The walk follows `properties` (object schemas) and `items` (single-schema
// array bodies) to any depth, so a number nested inside an array of objects
// — e.g. a forest plot's `studies[].est`, a survival curve's
// `arms[].survival` — is reached exactly like a top-level one, and a number
// nested in a plain object property (a CEAC's `pooled.est`) the same way.
//
// Pure and dependency-free: no DOM, no registry access, safe to unit test
// directly. Never mutates its input; every return value is a fresh object.

export const DATA_TOKEN_PATTERN = "^\\{[A-Za-z][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_.]*\\}$";

const TOKEN_BRANCH = Object.freeze({ type: "string", pattern: DATA_TOKEN_PATTERN });

type SchemaNode = Record<string, unknown>;

function isPlainObject(v: unknown): v is SchemaNode {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The exact shape widenForDataTokens produces: a oneOf whose branches
 *  include the token string — so re-running the walk over its own output,
 *  or over a schema that hand-authored the identical oneOf (the data pack's
 *  own inline templates), is a no-op rather than a double wrap. */
function isTokenBranch(node: unknown): boolean {
  return isPlainObject(node) && node.type === "string" && node.pattern === DATA_TOKEN_PATTERN;
}

function alreadyWidened(node: SchemaNode): boolean {
  return Array.isArray(node.oneOf) && node.oneOf.some(isTokenBranch);
}

/** True for a bare number, array-of-number, array-of-string, or
 *  array-of-array-of-number leaf. False the instant `enum` appears anywhere
 *  in the shape (leaf or its items) — an enum names a fixed set of modes, a
 *  token can never stand in for one. */
function matchesLeafShape(node: SchemaNode): boolean {
  if ("enum" in node) return false;
  if (node.type === "number") return true;
  if (node.type !== "array") return false;

  const items = node.items;
  if (!isPlainObject(items) || "enum" in items) return false;
  if (items.type === "number" || items.type === "string") return true;

  if (items.type === "array") {
    const inner = items.items;
    if (isPlainObject(inner) && !("enum" in inner) && inner.type === "number") return true;
  }
  return false;
}

function widenNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(widenNode);
  if (!isPlainObject(node)) return node; // primitive (string/number/boolean/null) — copy by value

  if (alreadyWidened(node)) return structuredClone(node);
  if (matchesLeafShape(node)) return { oneOf: [structuredClone(node), { ...TOKEN_BRANCH }] };

  const out: SchemaNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && isPlainObject(value)) {
      const props: SchemaNode = {};
      for (const [propKey, propValue] of Object.entries(value)) props[propKey] = widenNode(propValue);
      out[key] = props;
    } else if (key === "items" && isPlainObject(value)) {
      out[key] = widenNode(value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

/**
 * Returns a deep copy of `schema` in which every leaf typed `number`, array
 * of number, array of string, or array of array of number also accepts the
 * data-token string (`DATA_TOKEN_PATTERN`) as an alternative — via a
 * `oneOf: [original, { type: "string", pattern: DATA_TOKEN_PATTERN }]`.
 * Booleans, enums (at any depth) and plain strings are left exactly as
 * given. Idempotent: widening an already-widened schema, or one that
 * already carries the identical oneOf by hand, returns it unchanged.
 */
export function widenForDataTokens(schema: object): object {
  return widenNode(schema) as object;
}
