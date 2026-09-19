// The value grammar, both directions. Parser and printer share it so they
// cannot drift: every test in tests/script-values.test.ts that reads a token
// also writes it back.

/** Split a direction's arguments on spaces, keeping "strings", [arrays] and {objects} whole. */
export function splitTokens(rest: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < rest.length) { cur += rest[++i]; continue; }
      if (c === '"') quote = false;
      continue;
    }
    if (c === '"') { quote = true; cur += c; continue; }
    if (c === "[" || c === "{") { depth++; cur += c; continue; }
    if (c === "]" || c === "}") { depth--; cur += c; continue; }
    if (c === " " && depth === 0) { if (cur !== "") out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur !== "") out.push(cur);
  return out;
}

const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A token as a value: quoted string, number, boolean, inline JSON, else a bare word. */
export function parseValue(token: string): unknown {
  if (token.startsWith('"')) return JSON.parse(token) as string;
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null") return null;
  if (NUMBER_RE.test(token)) return Number(token);
  if (token.startsWith("[") || token.startsWith("{")) return JSON.parse(token) as unknown;
  return token;
}

const BARE_RE = /^[^\s"[{][^\s]*$/;

/** A value as a token — quoted whenever a bare word would read back as something else. */
export function formatValue(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean" || v === null) return JSON.stringify(v);
  if (typeof v === "string") {
    const bare = BARE_RE.test(v) && parseValue(v) === v;
    return bare ? v : JSON.stringify(v);
  }
  return JSON.stringify(v);
}

const isScalar = (v: unknown): boolean => v === null || ["string", "number", "boolean"].includes(typeof v);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * True when every leaf of `v` is a scalar AND it has at least one — the only
 * shape that can be flattened to dotted lines and put back together again.
 * An EMPTY object has no leaves, so flattening would write nothing and the
 * field would vanish; `params: {supply: {}}` is a real corpus value.
 */
const SIMPLE_KEY_RE = /^[A-Za-z_][\w-]*$/;

function flattenable(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  // A key that is not a plain identifier cannot survive a dotted path: an
  // `animate` key IS a dot path ("demand_shift.amount"), and a math `colors`
  // key is a TeX snippet with spaces ("\\Delta C"). Both are written whole.
  if (!keys.every((k) => SIMPLE_KEY_RE.test(k))) return false;
  // An array or an empty object is a leaf: it prints as one JSON token
  // (`at [650,380]`) and reads back as itself. Only a non-empty object has
  // to be flattenable in its own right.
  return keys.every((k) => !isPlainObject(v[k]) || Object.keys(v[k]).length === 0 || flattenable(v[k]));
}

/** One printed line per scalar leaf, or one whole-value line for anything else. */
export function fieldLines(key: string, value: unknown): { path: string; token: string }[] {
  if (!isPlainObject(value) || !flattenable(value)) return [{ path: key, token: formatValue(value) }];
  const out: { path: string; token: string }[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out.push(...fieldLines(`${key}.${k}`, v));
  return out;
}

/** Write `value` at a dotted path, minting the objects on the way. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}
