// The drill's miss history (design §7). Deliberately NOT render/record.ts:
// that store is per cast, shaped around plan steps, and is what a Submit
// sends to a teacher — forty drill attempts would drown the real answers, and
// misses would not follow a viewer between casts even though the built-in set
// is the SAME set on every chess board. So: keyed by opening, across casts.
//
// Storage can be absent or throw (private mode) and then the drill goes on
// unweighted — the same rule render/record.ts, views.ts and learn.ts follow.

import type { Opening } from "./chess-openings";

export const OPENINGS_RECORD_KEY = "drawcast.openings";

/** How many recent attempts count. The window IS the cap: a line you have
 *  since fixed decays back to weight 1 on its own, with no separate clamp. */
export const WINDOW = 3;

/** localStorage when this browser offers one, else null — never a throw. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Opening name -> its attempts, newest last. Empty when storage is dead. */
export function readHistory(): Record<string, boolean[]> {
  const s = storage();
  if (!s) return {};
  try {
    const raw = s.getItem(OPENINGS_RECORD_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean[]> = {};
    for (const [name, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) out[name] = v.filter((x): x is boolean => typeof x === "boolean").slice(-WINDOW);
    }
    return out;
  } catch {
    return {};
  }
}

/** Append an attempt. Silent on a dead store. */
export function recordAttempt(name: string, hit: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    const history = readHistory();
    history[name] = [...(history[name] ?? []), hit].slice(-WINDOW);
    s.setItem(OPENINGS_RECORD_KEY, JSON.stringify(history));
  } catch {
    // A full or refusing store must not interrupt a drill.
  }
}

/** 1, plus 2 for each miss in the last WINDOW attempts: 1 to 7. */
export function weightFor(attempts: readonly boolean[] | undefined): number {
  const recent = (attempts ?? []).slice(-WINDOW);
  return 1 + 2 * recent.filter((hit) => !hit).length;
}

/** A weighted random opening. `rng` returns [0, 1); inject it for tests. */
export function pickOpening(set: readonly Opening[], history: Record<string, boolean[]>, rng: () => number): Opening {
  // Object.hasOwn, not `history[o.name]` alone: a custom opening named
  // `constructor`, `toString` or `valueOf` would otherwise hand weightFor an
  // INHERITED FUNCTION from Object.prototype instead of undefined — on a
  // completely fresh browser with no stored history, `history` is just `{}`.
  const weights = set.map((o) => weightFor(Object.hasOwn(history, o.name) ? history[o.name] : undefined));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (const [i, w] of weights.entries()) {
    r -= w;
    if (r < 0) return set[i];
  }
  return set[set.length - 1];
}
