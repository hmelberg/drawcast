// Stock pictures for cards (2026-10-05): when a poster frame is too detailed
// for a card — a chess position's drawn men, a skeleton's 206 bones — the card
// shows a stock picture of its topic instead: a few shapes and named icons,
// a few hundred bytes. The cast's own heading and marks stay. Hans: "an image
// of a chess board and pieces (not care about position, just an example)".

import { encodePts } from "./points";
import type { CardItem } from "./types";

/** A card losing more than this share of its items to the cap gets a stock picture, when one fits its topic. */
export const STOCK_WHEN_DROPPED = 0.25;

interface Stock {
  /** Matched against the cast's title and tags. */
  match: RegExp;
  items(): CardItem[];
}

const DARK = "#7d9b62";
const LIGHT = "#eee6cf";
/** One fixed position from the middle of a game (file 0–7 = a–h, rank 0–7 = 1–8): never a real line, just a game in play. */
const IN_PLAY: [number, number, "white" | "black", string][] = [
  [6, 0, "white", "king"], [5, 0, "white", "rook"], [5, 1, "white", "pawn"], [6, 1, "white", "pawn"], [7, 2, "white", "pawn"],
  [3, 3, "white", "pawn"], [2, 2, "white", "knight"], [4, 3, "white", "bishop"], [3, 0, "white", "queen"], [0, 1, "white", "pawn"],
  [6, 7, "black", "king"], [5, 7, "black", "rook"], [5, 6, "black", "pawn"], [6, 5, "black", "pawn"], [7, 6, "black", "pawn"],
  [3, 4, "black", "pawn"], [5, 5, "black", "knight"], [2, 5, "black", "bishop"], [4, 6, "black", "queen"], [0, 5, "black", "pawn"],
];

/** An 8 × 8 board with a game in play: squares drawn, men as OpenMoji icons by name. */
function chess(): CardItem[] {
  const cell = 66;
  const x0 = 500 - 4 * cell;
  const y0 = 50;
  const out: CardItem[] = [{ k: "s", p: "", c: "#3d3a33", w: 3, r: 0, sd: 1, rc: [x0, y0, 8 * cell, 8 * cell], f: LIGHT }];
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++)
      if ((r + f) % 2 === 0) out.push({ k: "a", p: encodePts([[x0 + f * cell, y0 + r * cell], [x0 + (f + 1) * cell, y0 + r * cell], [x0 + (f + 1) * cell, y0 + (r + 1) * cell], [x0 + f * cell, y0 + (r + 1) * cell]]), f: DARK, o: 1, r: 0, sd: 1, x: 1 });
  for (const [f, r, side, kind] of IN_PLAY) out.push({ k: "i", x: x0 + f * cell + cell / 2, y: y0 + r * cell + cell / 2, w: cell - 8, h: cell - 8, n: side === "black" && kind === "pawn" ? "openmoji:chess-pawn" : `openmoji:${side}-chess-${kind}` });
  return out;
}

/** A colour X-ray of a chest — bones as a picture. */
function bones(): CardItem[] {
  return [{ k: "i", x: 500, y: 340, w: 520, h: 520, n: "twemoji:x-ray" }];
}

export const STOCK: readonly Stock[] = [
  { match: /\bchess|sjakk|scholar'?s mate|checkmate\b/i, items: chess },
  { match: /\bbones?\b|skeleton|skjelett/i, items: bones },
];

/** The stock picture for a cast's title and tags, or null when none fits. */
export function stockFor(title: string, tags: readonly string[] = []): CardItem[] | null {
  const hay = `${title} ${tags.join(" ")}`;
  const s = STOCK.find((x) => x.match.test(hay));
  return s ? s.items() : null;
}
