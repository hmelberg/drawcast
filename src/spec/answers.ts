// The typed-ask helpers shared by the player, the gates, and the exporter:
// forgiving answer comparison, and {var} interpolation of stored responses
// into narration. Unknown braces are left untouched — only names a previous
// ask actually stored (or, in export, will store by default) are replaced.

export const VAR_RE = /\{([a-z][a-z0-9_]*)\}/gi;

/** Auto-maintained variables the player writes after every answered
 *  quiz/check-ask; ask.store may not claim them. */
export const RESERVED_VARS = ["score", "score_total"] as const;

export function answersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function subVars(text: string, vars: ReadonlyMap<string, string>): string {
  return text.replace(VAR_RE, (m, name: string) => vars.get(name.toLowerCase()) ?? m);
}
