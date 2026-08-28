// The identify quiz, pure half (interactivity spec §9 "identify" + §13):
// generators, not fixed questions — the template's interaction kind owns a
// data space (64 squares, the drawn keys), so every quiz is a fresh random
// sample from it. The DOM loop (ui/quiz.ts) judges clicks with the same
// widget geometry the ask gates use.

import { pianoNotes } from "../render/widgets";

/** A named activity a scene's interactions imply — rendered as a tray pill
 *  (and, by construction, reachable from right-click, which opens the tray:
 *  two doors, one registry — spec §13's scheduled convergence). */
export interface Activity {
  kind: "chess" | "piano";
  id: string;
  label: string;
}

/** The activities a scene's manifest interactions imply. The kind IS the
 *  data space: declaring `chess` buys free play AND its drills — no
 *  per-activity manifest vocabulary. */
export function activitiesFor(interactions: readonly string[]): Activity[] {
  const out: Activity[] = [];
  if (interactions.includes("chess")) out.push({ kind: "chess", id: "square_quiz", label: "🎯 Find the square" });
  if (interactions.includes("piano")) out.push({ kind: "piano", id: "note_quiz", label: "🎯 Find the note" });
  return out;
}

/** n distinct random picks from pool (all of it, shuffled, when n ≥ pool). */
function sample<T>(pool: readonly T[], n: number, rng: () => number): T[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

const ALL_SQUARES: string[] = [];
for (const f of "abcdefgh") for (let r = 1; r <= 8; r++) ALL_SQUARES.push(`${f}${r}`);

/** Distinct random algebraic squares — the square-naming drill. */
export function chessQuizTargets(n: number, rng: () => number = Math.random): string[] {
  return sample(ALL_SQUARES, n, rng);
}

/** Distinct random notes drawn on this keyboard — the note-finding drill. */
export function pianoQuizTargets(n: number, octaves: 1 | 2, rng: () => number = Math.random): string[] {
  return sample(pianoNotes(octaves), n, rng);
}

/** The question line for one target ("♯" for humans, "#" stays on the wire). */
export function quizPrompt(kind: "chess" | "piano", target: string): string {
  return kind === "chess" ? `Click square ${target}` : `Click ${target.replace("#", "♯")}`;
}
