// The identify quiz, pure half (interactivity spec §9 "identify" + §13):
// generators, not fixed questions — the template's interaction kind owns a
// data space (64 squares, the drawn keys), so every quiz is a fresh random
// sample from it. The DOM loop (ui/quiz.ts) judges clicks with the same
// widget geometry the ask gates use.

import { pianoNotes } from "../render/widgets";
import { MIN_PARTS } from "./parts-model";
import type { ChemElement, ElementCategory } from "../scenes/elements/types";

/** A named activity a scene's interactions imply — rendered as a tray pill
 *  (and, by construction, reachable from right-click, which opens the tray:
 *  two doors, one registry — spec §13's scheduled convergence). */
export interface Activity {
  kind: "chess" | "piano" | "periodic" | "parts";
  id: string;
  label: string;
}

/** The activities a scene's manifest interactions imply. The kind IS the
 *  data space: declaring `chess` buys free play AND its drills — no
 *  per-activity manifest vocabulary. A figure that declares nothing but
 *  has named parts (`partsCount`, see parts-model.ts) gets the generic
 *  identify drill instead — never alongside a bespoke one, so the row
 *  never offers two ways to ask "click the ___". */
export function activitiesFor(interactions: readonly string[], partsCount = 0): Activity[] {
  const out: Activity[] = [];
  if (interactions.length === 0 && partsCount >= MIN_PARTS) return [{ kind: "parts", id: "parts_quiz", label: "🎯 Find the part" }];
  if (interactions.includes("chess")) {
    out.push({ kind: "chess", id: "square_quiz", label: "🎯 Find the square" });
    out.push({ kind: "chess", id: "vs_computer", label: "♟ Play the computer" });
  }
  if (interactions.includes("piano")) out.push({ kind: "piano", id: "note_quiz", label: "🎯 Find the note" });
  if (interactions.includes("periodic")) {
    out.push({ kind: "periodic", id: "element_quiz", label: "🎯 Find the element" });
    out.push({ kind: "periodic", id: "group_quiz", label: "🔎 Find the family" });
  }
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

// ---- the periodic table ----------------------------------------------------
// The richest data space any interaction here owns: 118 elements, each with a
// name in three languages, an atomic number, a category and a shelf of
// measured properties. Two drills come out of it, and both sample only what
// the FIGURE DREW — a lesson about the halogens quizzes five halogens, not the
// whole table (the same rule pianoQuizTargets follows for the drawn keys).

/** What the drill asks and what counts as an answer. A category question has
 *  several right answers, so the accepted set is a list rather than one
 *  symbol, and a miss rings every cell that would have counted. */
export interface PeriodicTarget {
  prompt: string;
  /** Symbols that count as correct. */
  accepts: string[];
  /** Cells to ring when the answer was wrong — the whole right answer. */
  reveal: string[];
}

const CATEGORY_ASK: Record<ElementCategory, string> = {
  "alkali-metal": "an alkali metal",
  "alkaline-earth-metal": "an alkaline earth metal",
  "transition-metal": "a transition metal",
  "post-transition-metal": "a post-transition metal",
  metalloid: "a metalloid",
  nonmetal: "a non-metal",
  halogen: "a halogen",
  "noble-gas": "a noble gas",
  lanthanide: "a lanthanide",
  actinide: "an actinide",
};

/**
 * "Click iron" / "Click Z = 26" / "Click Fe" — one drawn element per question,
 * the three phrasings rotating so the drill exercises the name, the number and
 * the symbol rather than one of them five times.
 */
export function periodicElementTargets(n: number, drawn: readonly ChemElement[], rng: () => number = Math.random): PeriodicTarget[] {
  return sample(drawn, n, rng).map((e, i) => {
    const ask = i % 3 === 0 ? e.name.en : i % 3 === 1 ? `Z = ${e.z}` : e.symbol;
    return { prompt: `Click ${ask}`, accepts: [e.symbol], reveal: [e.symbol] };
  });
}

/**
 * "Click a halogen" — the family drill. Only categories the figure actually
 * drew can be asked, and a category is only worth asking when the drawn table
 * holds at least two of it: on a figure showing one lone noble gas, "click a
 * noble gas" is the same question as "click helium".
 */
export function periodicGroupTargets(n: number, drawn: readonly ChemElement[], rng: () => number = Math.random): PeriodicTarget[] {
  const byCat = new Map<ElementCategory, string[]>();
  for (const e of drawn) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e.symbol]);
  const askable = [...byCat.entries()].filter(([, syms]) => syms.length >= 2);
  return sample(askable, n, rng).map(([cat, syms]) => ({
    prompt: `Click ${CATEGORY_ASK[cat]}`,
    accepts: syms,
    reveal: syms,
  }));
}

/** The drill behind one activity id, or an empty list when the figure cannot
 *  support it (too few elements drawn, or no category with two members). */
export function periodicQuizTargets(
  id: string,
  n: number,
  drawn: readonly ChemElement[],
  rng: () => number = Math.random,
): PeriodicTarget[] {
  return id === "group_quiz" ? periodicGroupTargets(n, drawn, rng) : periodicElementTargets(n, drawn, rng);
}
