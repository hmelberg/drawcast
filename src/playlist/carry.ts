// What one playlist carries from item to item (spec 2026-09-15-stored-answers
// §2, "two stores"): the variable map narration and `if` read. Each item is a
// fresh render with a fresh Player, so without this a name stored in part 1
// is empty in part 3. The question offsets are STATIC — computed from the
// specs, not from what was played — so a backward jump keeps every ordinal
// and {_answers.N} names the same question wherever the viewer is.

import type { Spec } from "../spec/types";

/** Quiz/ask commands in a spec — one plan step, one ordinal, each. */
export function questionCount(spec: Spec): number {
  return (spec.commands ?? []).filter((c) => c.quiz !== undefined || c.ask !== undefined).length;
}

/** offsets[i] = questions in the items before i. */
export function questionOffsets(specs: Spec[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const s of specs) {
    out.push(n);
    n += questionCount(s);
  }
  return out;
}

/** The map a playlist session seeds every item's player from and absorbs
 *  every item's player back into. Latest wins. */
export class AnswerCarry {
  readonly vars = new Map<string, string>();
  absorb(from: ReadonlyMap<string, string>): void {
    for (const [k, v] of from) this.vars.set(k, v);
  }
}
