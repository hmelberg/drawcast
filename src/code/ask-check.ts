// What a viewer's script ANSWERED — the one piece of judging an ask with a
// code widget adds, kept pure so the rule is testable without a browser.
//
// The contract the rest of the ask machinery already has is a STRING: the
// player compares what the gate returns against `answer` and runs its own
// retry/reveal/store/goto logic. So this module's whole job is to turn a run's
// envelope into that string — the value the author said to look at — or into
// an honest note about why there is nothing to compare yet.
//
// Three shapes, because they are the three ways a script can answer:
//   "stdout"      — what it printed (the default: a viewer prints their answer)
//   "figure"      — "1" when a plot appeared, "0" when none did
//   "<path>"      — a variable, harvested through the SAME data bridge the
//                   template tokens use ("total", "df.mean")

import type { CodeRunResult } from "./envelope";

/** The value as an author would have typed it: a number without trailing
 *  zeros, a string as itself, anything structured as JSON. */
export function formatAnswer(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value);
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** Paths the run must harvest for this expectation — none for the two words. */
export function askPaths(expect: string | undefined): string[] {
  const e = expect ?? "stdout";
  return e === "stdout" || e === "figure" ? [] : [e];
}

export interface CheckedAnswer {
  /** What to hand the ask machinery, or null when there is nothing yet. */
  text: string | null;
  /** Shown in the editor when text is null — why the run did not answer. */
  note?: string;
}

/**
 * Read the answer out of a finished run. A failed script, or a variable the
 * script never created, is NOT a wrong answer — it is an unfinished one, and
 * the editor says so and stays open rather than spending the viewer's attempt.
 */
export function checkedAnswer(env: CodeRunResult, expect: string | undefined): CheckedAnswer {
  const e = expect ?? "stdout";
  if (!env.ok) return { text: null, note: "The script did not run — see the panel." };
  if (e === "stdout") {
    const out = env.stdout.trim();
    return out === "" ? { text: null, note: "Nothing was printed yet — print your answer." } : { text: out };
  }
  if (e === "figure") return { text: env.figures.length > 0 ? "1" : "0" };
  const err = env.dataErrors?.[e];
  if (err !== undefined) return { text: null, note: `Could not read ${e}: ${err}` };
  if (!env.data || !(e in env.data)) return { text: null, note: `No ${e} yet — the script has to leave it behind.` };
  return { text: formatAnswer(env.data[e]) };
}
