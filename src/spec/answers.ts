// The typed-ask helpers shared by the player, the gates, and the exporter:
// forgiving answer comparison, and {var} interpolation of stored responses
// into narration. Unknown braces are left untouched — only names a previous
// ask actually stored (or, in export, will store by default) are replaced.

// A token is a flat store name ({name}), a field of one ({name.secs},
// {name.ok}), or the player's own namespace ({_answers.3}, {_answers.last}):
// the leading underscore is what keeps the namespace out of every author's
// reach — a store name must start with a letter (schema.ts).
export const VAR_RE = /\{(_?[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}/gi;

/** Auto-maintained variables the player writes after every answered
 *  quiz/check-ask; ask.store may not claim them. */
export const RESERVED_VARS = ["score", "score_total"] as const;

/** The namespace every question is stored under automatically (spec
 *  2026-09-15): `_answers.N` (N-th question in playlist order), `.N.ok`,
 *  `.N.secs`, `_answers.last`, `_answers.count`. */
export const AUTO_NAMESPACE = "_answers";

/** The store name a token addresses: `age.secs` → `age`. */
export function baseName(name: string): string {
  const i = name.indexOf(".");
  return i < 0 ? name : name.slice(0, i);
}

/** True for names the player maintains itself — never flagged by the lint
 *  as "used before stored", never claimable by a store. */
export function isReservedVar(name: string): boolean {
  const base = baseName(name.toLowerCase());
  return (RESERVED_VARS as readonly string[]).includes(base) || base === AUTO_NAMESPACE;
}

export function answersMatch(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  // Numbers compare AS numbers: "45.0", "45" and "4.5e1" are one answer, and
  // a code widget's harvested value must not fail on the shape of its own
  // formatting. Everything else is the old forgiving text match.
  const nx = Number(x);
  const ny = Number(y);
  if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) {
    return nx === ny || Math.abs(nx - ny) <= 1e-9 * Math.max(Math.abs(nx), Math.abs(ny));
  }
  return x.toLowerCase() === y.toLowerCase();
}

export function subVars(text: string, vars: ReadonlyMap<string, string>): string {
  return text.replace(VAR_RE, (m, name: string) => vars.get(name.toLowerCase()) ?? m);
}
