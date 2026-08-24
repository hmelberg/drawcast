// The exemplar pool behind {{EXEMPLARS}}: which past figures the compiler is
// shown as "here is how this was done before". Two pools feed it — the user's
// own promoted references ("👍 Learn from this") and the curated bundled
// showcases in src/examples.json — and the user's always win the slots.

import { selectExemplars, type Exemplar } from "./prompt";
import type { Spec } from "../spec/types";

/** An exemplar-shaped thing that may not carry a usable spec (a bundled playlist example doesn't). */
export interface ExemplarCandidate {
  prompt: string;
  spec?: Spec;
}

/**
 * The candidates the model can actually reproduce right now: it must have a
 * spec, and if that spec names a template, the template must be registered and
 * ready. Showing an exemplar built on a template that is absent from the
 * catalog (a pack switched off since it was promoted) invites the model to
 * imitate a template id it was never offered.
 */
export function usableExemplars(pool: ExemplarCandidate[], isReady: (id: string) => boolean): Exemplar[] {
  return pool.filter((e): e is Exemplar => !!e.spec && (!e.spec.template || isReady(e.spec.template)));
}

/**
 * Up to n exemplars for this request: the user's own references first (their
 * promotions are the strongest signal there is), bundled showcases only in the
 * slots left over — so a fresh library still gets worked examples instead of
 * "(none yet)", and a stocked one is never crowded out by them.
 */
export function pickExemplars(request: string, user: Exemplar[], bundled: Exemplar[], n: number): Exemplar[] {
  const picked = selectExemplars(request, user, n);
  if (picked.length >= n) return picked;
  const seen = new Set(picked.map((e) => e.prompt));
  const fill = selectExemplars(request, bundled, n).filter((e) => !seen.has(e.prompt));
  return [...picked, ...fill].slice(0, n);
}
