// The built-in chess opponent (interactivity spec §13): deliberately small.
// Two plies of material — my capture/promotion gain minus the opponent's
// best material answer, mate preferred, allowing mate forbidden — with
// random tie-breaks for variety. Beginner strength is the point: a
// teaching app wants an opponent that punishes blunders, not one that
// wins. The Chess constructor is injected (chess.js stays a lazy chunk).

export interface AiMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
}

interface VerboseMove {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  captured?: string;
}

interface ChessForAi {
  moves(opts: { verbose: true }): VerboseMove[];
  move(m: { from: string; to: string; promotion?: string }): unknown;
  undo(): unknown;
  isCheckmate(): boolean;
}
export type AiChessCtor = new (fen?: string, opts?: { skipValidation?: boolean }) => ChessForAi;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3.25, r: 5, q: 9 };
const MATE = 1000;

function gain(m: VerboseMove): number {
  return (m.captured ? (VALUE[m.captured] ?? 0) : 0) + (m.promotion ? (VALUE[m.promotion] ?? 0) - 1 : 0);
}

/**
 * The reply the computer plays from `fen` (the side to move), or null when
 * there is none (mate, stalemate, or a position chess.js cannot search).
 */
export function bestReply(Chess: AiChessCtor, fen: string, rng: () => number = Math.random): AiMove | null {
  try {
    const game = new Chess(fen, { skipValidation: true });
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) return null;
    let best: VerboseMove[] = [];
    let bestScore = -Infinity;
    for (const m of moves) {
      game.move({ from: m.from, to: m.to, promotion: m.promotion });
      let score: number;
      if (game.isCheckmate()) {
        score = MATE;
      } else {
        const replies = game.moves({ verbose: true });
        let opp = 0;
        for (const r of replies) {
          game.move({ from: r.from, to: r.to, promotion: r.promotion });
          const rScore = game.isCheckmate() ? MATE : gain(r);
          game.undo();
          if (rScore > opp) opp = rScore;
        }
        score = gain(m) - opp;
      }
      game.undo();
      if (score > bestScore) {
        bestScore = score;
        best = [m];
      } else if (score === bestScore) {
        best.push(m);
      }
    }
    const pick = best[Math.floor(rng() * best.length)] ?? best[0];
    return { from: pick.from, to: pick.to, san: pick.san, ...(pick.promotion ? { promotion: pick.promotion } : {}) };
  } catch {
    return null;
  }
}
