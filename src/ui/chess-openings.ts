// The openings drill's pure half (design 2026-09-20-chess-openings-drill §4-6,
// §9): the shipped set, what a custom set must survive to be used, and the one
// prefix query the whole drill is built on.
//
// Nothing here touches the DOM, the registry or localStorage. The drill takes
// clicks while a cast is paused, and "nothing may ever throw into playback"
// (the rule render/record.ts states for itself) — so validation happens ONCE,
// up front, and every bad row is dropped rather than raised.

import type { ChessCtor } from "./chessplay-model";

export interface Opening {
  name: string;
  /** Labelling only. Unverifiable by tests — see the design's §6. */
  eco?: string;
  /** Who the viewer drills as. NOT inferrable: the Sicilian is Black's
   *  opening but its line still begins 1. e4 c5. */
  side: "white" | "black";
  /** SAN, canonicalised to the engine's own spelling by validateSet. */
  moves: string[];
  idea?: string;
}

/**
 * The shipped set. Chosen so its members are each other's LIKELY CONFUSIONS —
 * the Vienna is here because it is what you play when you mean the Italian,
 * and that is what makes a wrong move nameable instead of merely wrong.
 *
 * The move lists are proved by the legality test in tests/chess-openings.test.ts.
 * The ECO codes are not, and cannot be — they are labelling, verified by hand
 * against a reference when this set was written.
 */
export const BUILT_IN_OPENINGS: readonly Opening[] = [
  { name: "Italian Game", eco: "C50", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"], idea: "The bishop eyes f7, Black's weakest square." },
  { name: "Ruy Lopez", eco: "C60", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"], idea: "Pressure on the knight that defends e5." },
  { name: "Scotch Game", eco: "C44", side: "white", moves: ["e4", "e5", "Nf3", "Nc6", "d4"], idea: "Open the centre at once, before Black is ready." },
  { name: "Vienna Game", eco: "C25", side: "white", moves: ["e4", "e5", "Nc3"], idea: "A quieter cousin of the Italian — develop first, commit later." },
  { name: "Queen's Gambit", eco: "D06", side: "white", moves: ["d4", "d5", "c4"], idea: "Offer a pawn to pull Black's centre off the d-file." },
  { name: "English Opening", eco: "A21", side: "white", moves: ["c4", "e5", "Nc3"], idea: "A Sicilian with colours reversed, and a move in hand." },
  { name: "Sicilian Defence", eco: "B50", side: "black", moves: ["e4", "c5", "Nf3", "d6"], idea: "Answer a king's-side opening with a queen's-side counter." },
  { name: "French Defence", eco: "C00", side: "black", moves: ["e4", "e6", "d4", "d5"], idea: "Challenge the centre immediately, and accept a cramped bishop." },
  { name: "Caro-Kann Defence", eco: "B12", side: "black", moves: ["e4", "c6", "d4", "d5"], idea: "The French's solid cousin, with the light bishop free." },
  { name: "Queen's Gambit Declined", eco: "D30", side: "black", moves: ["d4", "d5", "c4", "e6"], idea: "Hold the centre rather than take the pawn." },
  { name: "King's Indian Defence", eco: "E60", side: "black", moves: ["d4", "Nf6", "c4", "g6"], idea: "Give up the centre, then attack it from a distance." },
  { name: "Nimzo-Indian Defence", eco: "E20", side: "black", moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"], idea: "Pin the knight that guards e4." },
];

/** Every ply of an opening as the engine sees it. Throws on an illegal line —
 *  which is why validateSet calls it behind a try, and the drill never does. */
export function plyList(Chess: ChessCtor, o: Opening): { from: string; to: string; san: string }[] {
  const game = new Chess() as unknown as {
    move(san: string): { from: string; to: string; san: string } | null;
  };
  const out: { from: string; to: string; san: string }[] = [];
  for (const san of o.moves) {
    const m = game.move(san);
    if (!m) throw new Error(`illegal move "${san}"`);
    out.push({ from: m.from, to: m.to, san: m.san });
  }
  return out;
}

/**
 * A set that is safe to drill: bad rows dropped and named, SAN canonicalised
 * to the engine's own spelling so judging never has to reconcile two
 * spellings of one move. Runs once when a session opens.
 */
export function validateSet(Chess: ChessCtor, rows: unknown): { set: Opening[]; dropped: string[] } {
  const set: Opening[] = [];
  const dropped: string[] = [];
  if (!Array.isArray(rows)) return { set, dropped };
  for (const [i, raw] of rows.entries()) {
    const row = raw as Partial<Opening> | null;
    const label = (row && typeof row === "object" && typeof row.name === "string" && row.name.trim() && row.name) || `row ${i + 1}`;
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !Array.isArray(row.moves) ||
      row.moves.length === 0
    ) {
      dropped.push(label);
      continue;
    }
    const o: Opening = {
      name: row.name,
      ...(typeof row.eco === "string" ? { eco: row.eco } : {}),
      side: row.side === "black" ? "black" : "white",
      moves: [],
      ...(typeof row.idea === "string" ? { idea: row.idea } : {}),
    };
    try {
      o.moves = row.moves.map(String);
      o.moves = plyList(Chess, o).map((p) => p.san);
    } catch {
      dropped.push(label);
      continue;
    }
    set.push(o);
  }
  return { set, dropped };
}

/**
 * THE query the drill is built on: which openings begin with this line?
 *
 * It judges a move (does the line so far still match what is being drilled),
 * names a wrong one (does it match some OTHER opening — "that's the Vienna"),
 * and classifies a free-play line. One function, three jobs.
 */
export function matchingOpenings(set: readonly Opening[], prefix: readonly string[]): Opening[] {
  return set.filter((o) => prefix.length <= o.moves.length && prefix.every((san, i) => o.moves[i] === san));
}
