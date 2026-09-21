// Free-move chess model against the real chess.js — grabbed-piece turn
// flipping, legality, promotion, and the shown-position computation the
// explore tray starts from.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { flipTurn, freeMove, legalTargets, selectionTargets, shownFen, type ChessCtor } from "../src/ui/chessplay-model";

const C = Chess as unknown as ChessCtor;
const board = (fen: string | null) => fen?.split(" ")[0];
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
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

describe("legalTargets", () => {
  const START = shownFen(C, undefined, [], 0)!;

  test("a pawn's one-and-two-step start, a knight's hops", () => {
    expect(legalTargets(C, START, "e2").sort()).toEqual(["e3", "e4"]);
    expect(legalTargets(C, START, "g1").sort()).toEqual(["f3", "h3"]);
  });
  test("grabbing the side not to move still shows its moves", () => {
    expect(legalTargets(C, START, "e7").sort()).toEqual(["e5", "e6"]);
  });
  test("captures are included; empty squares yield nothing", () => {
    const pos = shownFen(C, undefined, ["e4", "d5"], 2)!;
    expect(legalTargets(C, pos, "e4")).toContain("d5");
    expect(legalTargets(C, START, "e5")).toEqual([]);
  });
  test("promotion squares are deduped", () => {
    const t = legalTargets(C, "8/P6k/8/8/8/8/8/7K w - - 0 1", "a7");
    expect(t).toEqual(["a8"]);
  });
});

describe("selectionTargets — what a grabbed piece marks", () => {
  // Hans, 2026-09-21: "when we click a piece in chess, the squares it is
  // allowed to go are marked. disable that by default and only make it
  // appear if we turn it on." The RING on the grabbed piece is not this —
  // that says what you picked up, not where it may go, and stays.
  test("marks nothing at all while the hints are off", () => {
    expect(selectionTargets(C, START, "e2", false)).toEqual([]);
  });

  test("with the hints on, a pawn's own squares — and nothing it cannot reach", () => {
    expect(selectionTargets(C, START, "e2", true).map((m) => m.sq).sort()).toEqual(["e3", "e4"]);
  });

  test("a square it would CAPTURE on is marked as one", () => {
    // Black knight on d5, White pawn on e4: e4 takes d5, and e5 is only a step.
    const fen = "4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1";
    const marks = selectionTargets(C, fen, "e4", true);
    expect(marks.find((m) => m.sq === "d5")?.capture).toBe(true);
    expect(marks.find((m) => m.sq === "e5")?.capture).toBe(false);
  });

  test("an empty square marks nothing, hints or no hints", () => {
    expect(selectionTargets(C, START, "e5", true)).toEqual([]);
    expect(selectionTargets(C, START, "e5", false)).toEqual([]);
  });

  test("a position chess.js cannot search marks nothing rather than throwing", () => {
    expect(selectionTargets(C, "not a fen", "e2", true)).toEqual([]);
  });
});
