// Free-move chess, the pure half (interactivity spec §13): the shown position
// is a function of the template's params; a user move is validated by chess.js
// and yields the next FEN. The Chess constructor is INJECTED — chess.js stays
// a lazy chunk (the engines discipline), and node tests pass the real one in.
//
// skipValidation mirrors the chess engine's own load: the template deliberately
// allows kingless teaching diagrams, and chess.js may throw from deeper calls
// on such positions — every entry point catches and returns null instead.

export interface ChessLike {
  move(m: { from: string; to: string; promotion?: string }): unknown;
  fen(): string;
  get(square: string): { color: "w" | "b" } | null | undefined;
}
export type ChessCtor = new (fen?: string, opts?: { skipValidation?: boolean }) => ChessLike;

interface ChessWithSan extends ChessLike {
  move(m: { from: string; to: string; promotion?: string } | string): unknown;
}

/** The FEN actually on the board at `plies` (floored, clamped) of `moves`
 *  from `fen` — what free play starts from. Null when the position or a
 *  SAN move is invalid (the template would have thrown at layout already). */
export function shownFen(Chess: ChessCtor, fen: string | undefined, moves: readonly string[], plies: number): string | null {
  try {
    const game = (fen === undefined ? new Chess() : new Chess(fen, { skipValidation: true })) as ChessWithSan;
    const n = Math.max(0, Math.min(Math.floor(plies), moves.length));
    for (let i = 0; i < n; i++) game.move(moves[i]);
    return game.fen();
  } catch {
    return null;
  }
}

/** FEN with the side to move flipped (and the en-passant field cleared —
 *  it can only be stale after a turn handed over without a move). */
export function flipTurn(fen: string): string {
  const f = fen.split(" ");
  f[1] = f[1] === "w" ? "b" : "w";
  if (f.length > 3) f[3] = "-";
  return f.join(" ");
}

interface ChessWithMoves extends ChessLike {
  moves(opts: { square: string; verbose: true }): { to: string }[];
}

/**
 * The squares the piece on `from` may move to — free-play semantics, so
 * grabbing either side's piece works (turn flips like freeMove). Deduped
 * (promotions repeat their target); empty for a vacant square or a
 * position chess.js cannot search.
 */
export function legalTargets(Chess: ChessCtor, fen: string, from: string): string[] {
  try {
    let game = new Chess(fen, { skipValidation: true });
    const piece = game.get(from);
    if (!piece) return [];
    if (piece.color !== fen.split(" ")[1]) game = new Chess(flipTurn(fen), { skipValidation: true });
    return [...new Set((game as ChessWithMoves).moves({ square: from, verbose: true }).map((m) => m.to))];
  } catch {
    return [];
  }
}

/**
 * A free move: whichever piece the viewer grabs, it is that side's turn —
 * the fen's turn field flips if needed, then the move must be legal.
 * Promotions auto-queen. Returns the next FEN, or null (empty square,
 * illegal move, broken position).
 */
export function freeMove(Chess: ChessCtor, fen: string, from: string, to: string): string | null {
  try {
    let game = new Chess(fen, { skipValidation: true });
    const piece = game.get(from);
    if (!piece) return null;
    if (piece.color !== fen.split(" ")[1]) game = new Chess(flipTurn(fen), { skipValidation: true });
    game.move({ from, to, promotion: "q" });
    return game.fen();
  } catch {
    return null;
  }
}
