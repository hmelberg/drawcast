// The built-in opponent against the real chess.js: takes hanging material,
// prefers mate in one, refuses poisoned captures, and returns null when the
// game is over.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { bestReply, type AiChessCtor } from "../src/ui/chess-ai";

const C = Chess as unknown as AiChessCtor;

describe("bestReply", () => {
  test("takes a hanging queen", () => {
    // Black queen undefended on d5; White rook on d1 can take it.
    const m = bestReply(C, "4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1");
    expect(m).toMatchObject({ from: "d1", to: "d5" });
  });

  test("prefers mate in one over winning material", () => {
    // White: Ra1-a8 is back-rank mate; Rxb7 would merely win a pawn.
    const m = bestReply(C, "6k1/1p3ppp/8/8/8/8/8/R5K1 w - - 0 1");
    expect(m?.san).toBe("Ra8#");
  });

  test("refuses a poisoned capture when a quiet move is safer", () => {
    // The pawn on d5 is defended by the e6-pawn: QxP loses 9 for 1.
    const m = bestReply(C, "4k3/8/4p3/3p4/8/8/3Q4/4K3 w - - 0 1", () => 0);
    expect(`${m?.from}${m?.to}`).not.toBe("d2d5");
  });

  test("checkmate and stalemate yield null", () => {
    expect(bestReply(C, "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toBeNull(); // stalemated black
    expect(bestReply(C, "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1")).toBeNull(); // back-rank mated
  });

  test("deterministic under an injected rng", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(bestReply(C, fen, () => 0.4)).toEqual(bestReply(C, fen, () => 0.4));
  });
});
