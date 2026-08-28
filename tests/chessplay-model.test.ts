// Free-move chess model against the real chess.js — grabbed-piece turn
// flipping, legality, promotion, and the shown-position computation the
// explore tray starts from.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { flipTurn, freeMove, shownFen, type ChessCtor } from "../src/ui/chessplay-model";

const C = Chess as unknown as ChessCtor;
const board = (fen: string | null) => fen?.split(" ")[0];
const turn = (fen: string | null) => fen?.split(" ")[1];

describe("shownFen", () => {
  test("no fen, no moves: the standard starting position", () => {
    expect(board(shownFen(C, undefined, [], 0))).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
  });
  test("plies floors and clamps", () => {
    const after1 = shownFen(C, undefined, ["e4", "e5"], 1);
    expect(board(after1)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
    expect(shownFen(C, undefined, ["e4", "e5"], 1.7)).toBe(after1);
    expect(board(shownFen(C, undefined, ["e4", "e5"], 99))).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR");
  });
  test("an illegal SAN yields null, not a throw", () => {
    expect(shownFen(C, undefined, ["e5"], 1)).toBeNull();
  });
});

describe("flipTurn", () => {
  test("flips the side to move and clears en passant", () => {
    expect(flipTurn("rnbqkbnr/pppppppp/8/8/4P3/8/8/RNBQKBNR b KQkq e3 0 1")).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/8/RNBQKBNR w KQkq - 0 1",
    );
  });
});

describe("freeMove", () => {
  const START = shownFen(C, undefined, [], 0)!;

  test("a legal move by the side to move", () => {
    const next = freeMove(C, START, "e2", "e4");
    expect(board(next)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
    expect(turn(next)).toBe("b");
  });
  test("grabbing the other side's piece flips the turn first", () => {
    const next = freeMove(C, START, "e7", "e5");
    expect(board(next)).toBe("rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR");
    expect(turn(next)).toBe("w");
  });
  test("an illegal move and an empty square yield null", () => {
    expect(freeMove(C, START, "e2", "e5")).toBeNull();
    expect(freeMove(C, START, "e4", "e5")).toBeNull();
  });
  test("captures work", () => {
    const pos = shownFen(C, undefined, ["e4", "d5"], 2)!;
    const next = freeMove(C, pos, "e4", "d5");
    expect(board(next)).toBe("rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR");
  });
  test("promotions auto-queen", () => {
    const next = freeMove(C, "1k6/P7/8/8/8/8/8/1K6 w - - 0 1", "a7", "a8");
    expect(board(next)).toBe("Qk6/8/8/8/8/8/8/1K6");
  });
});
