// Data tokens: a template param whose value is exactly "{<codeId>.<path>}"
// names a variable (or a DataFrame column / dict key / attribute walk) that a
// code element's script leaves behind. The spec is the one place that says
// what crosses the bridge — scanning params is both the request list for the
// runtime and the substitution map for the resolver.
//
// Dependency-free on purpose: imported by the resolver (render/), the lint
// (spec/), the translator (spec/i18n.ts) and the authoring-time check.

/** "{sim.y}", "{gdp.df.country}" — id, dot, one or more path segments. */
export const DATA_TOKEN_RE = /^\{([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/;

/** Brace + dot but not a token ("{sim.}", "{.y}", "{a..b}") — a typo the
 *  lint should name rather than let pass as prose. Matches valid tokens too;
 *  callers test DATA_TOKEN_RE first. */
export const MALFORMED_TOKEN_RE = /^\{[^{}\s]*\.[^{}\s]*\}$/;

export interface DataToken {
  codeId: string;
  path: string;
  /** Where in params the token sits: object keys and array indices, root first. */
  at: (string | number)[];
}

export function parseDataToken(s: unknown): { codeId: string; path: string } | null {
  if (typeof s !== "string") return null;
  const m = DATA_TOKEN_RE.exec(s);
  return m ? { codeId: m[1], path: m[2] } : null;
}

export function isDataToken(s: unknown): boolean {
  return parseDataToken(s) !== null;
}

/** Every token in params, depth-first in document order. */
export function scanDataTokens(params: unknown): DataToken[] {
  const out: DataToken[] = [];
  const walk = (v: unknown, at: (string | number)[]): void => {
    const tok = parseDataToken(v);
    if (tok) {
      out.push({ ...tok, at });
      return;
    }
    if (Array.isArray(v)) v.forEach((item, i) => walk(item, [...at, i]));
    else if (v && typeof v === "object") {
      for (const [k, item] of Object.entries(v as Record<string, unknown>)) walk(item, [...at, k]);
    }
  };
  walk(params, []);
  return out;
}

/** Paths per code element id — sorted and deduplicated, so the same set of
 *  tokens always yields the same request (and the same cache key). */
export function pathsByCodeId(tokens: DataToken[]): Record<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const t of tokens) {
    if (!sets.has(t.codeId)) sets.set(t.codeId, new Set());
    sets.get(t.codeId)!.add(t.path);
  }
  const out: Record<string, string[]> = {};
  for (const [id, set] of sets) out[id] = [...set].sort();
  return out;
}

export type TokenLookup = (codeId: string, path: string) => { value: unknown } | { error: string };

export interface SubstituteResult {
  params: Record<string, unknown>;
  failures: { token: DataToken; error: string }[];
}

/**
 * A deep copy of params with every token replaced by its looked-up value. A
 * token the lookup cannot serve is REMOVED — the nearest enclosing object
 * property is deleted, so the template's own default applies — and reported.
 * Never mutates its input.
 */
export function substituteDataTokens(params: Record<string, unknown> | undefined, lookup: TokenLookup): SubstituteResult {
  const copy = (params ? JSON.parse(JSON.stringify(params)) : {}) as Record<string, unknown>;
  const failures: SubstituteResult["failures"] = [];
  // Delete deepest-first so an index removal never shifts a path we still
  // have to visit: tokens are scanned in document order, so reverse it.
  const tokens = scanDataTokens(copy).reverse();
  for (const token of tokens) {
    const r = lookup(token.codeId, token.path);
    if ("value" in r) {
      setAt(copy, token.at, r.value);
    } else {
      deleteNearestProperty(copy, token.at);
      failures.push({ token, error: r.error });
    }
  }
  failures.reverse();
  return { params: copy, failures };
}

function setAt(root: Record<string, unknown>, at: (string | number)[], value: unknown): void {
  let host: unknown = root;
  for (let i = 0; i < at.length - 1; i++) host = (host as Record<string | number, unknown>)[at[i]];
  (host as Record<string | number, unknown>)[at[at.length - 1]] = value;
}

/** Delete the property named by the LAST string segment of `at` (an array
 *  element's token takes its whole array with it). */
function deleteNearestProperty(root: Record<string, unknown>, at: (string | number)[]): void {
  let last = at.length - 1;
  while (last >= 0 && typeof at[last] !== "string") last--;
  if (last < 0) return;
  let host: unknown = root;
  for (let i = 0; i < last; i++) host = (host as Record<string | number, unknown>)[at[i]];
  delete (host as Record<string, unknown>)[at[last] as string];
}
