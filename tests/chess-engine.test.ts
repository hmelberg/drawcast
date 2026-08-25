import { describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type ChessEngine } from "../src/scenes/engines";

async function chess(): Promise<ChessEngine> {
  await ensureEngines(["chess"]);
  return getLoadedEngines(["chess"]).chess as ChessEngine;
}

describe("chess engine (real load — node, no DOM)", () => {
  test("board() start position: white pawns on rank 2, black back rank on row 0", async () => {
    const eng = await chess();
    const b = eng.board();
    expect(b).toHaveLength(8);
    for (const row of b) expect(row).toHaveLength(8);
    // row 6 = rank 2 = white pawns, all of them.
    expect(b[6].every((c) => c && c.piece === "p" && c.color === "w")).toBe(true);
    // row 1 = rank 7 = black pawns.
    expect(b[1].every((c) => c && c.piece === "p" && c.color === "b")).toBe(true);
    // row 0 = rank 8 = black's back rank, a8 is a rook.
    expect(b[0][0]).toEqual({ piece: "r", color: "b" });
    // row 7 = rank 1 = white's back rank, a1 is a rook.
    expect(b[7][0]).toEqual({ piece: "r", color: "w" });
    // ranks 3-6 (rows 2-5) are empty.
    for (const row of b.slice(2, 6)) expect(row.every((c) => c === null)).toBe(true);
  });

  test("board(fen) places a lone king exactly where the FEN says", async () => {
    const eng = await chess();
    const b = eng.board("8/8/8/8/8/8/8/K7 w - - 0 1");
    expect(b[7][0]).toEqual({ piece: "k", color: "w" });
    const rest = b.flat().filter((_, i) => i !== 7 * 8 + 0);
    expect(rest.every((c) => c === null)).toBe(true);
  });

  test("board() rejects a genuinely malformed FEN", async () => {
    const eng = await chess();
    expect(() => eng.board("not a fen at all")).toThrow();
    expect(() => eng.board("8/8/8/8/8/8/8/KX6 w - - 0 1")).toThrow(); // invalid piece letter
  });

  test("replay(undefined, [e4, e5, Nf3]) returns one entry per ply, first is e2->e4", async () => {
    const eng = await chess();
    const plies = eng.replay(undefined, ["e4", "e5", "Nf3"]);
    expect(plies).toHaveLength(3);
    expect(plies[0]).toMatchObject({ san: "e4", from: "e2", to: "e4", piece: "p", capture: false, check: false, mate: false });
    expect(plies[1]).toMatchObject({ san: "e5", from: "e7", to: "e5", piece: "p" });
    expect(plies[2]).toMatchObject({ san: "Nf3", from: "g1", to: "f3", piece: "n" });
    // fenAfter reflects the running position, not just the final one.
    expect(plies[0].fenAfter).toMatch(/^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/);
    expect(plies[2].fenAfter).not.toBe(plies[0].fenAfter);
  });

  test("replay plays Scholar's mate through to a flagged checkmate", async () => {
    const eng = await chess();
    const sans = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
    const plies = eng.replay(undefined, sans);
    expect(plies).toHaveLength(7);
    const last = plies[plies.length - 1];
    expect(last.san).toBe("Qxf7#");
    expect(last.capture).toBe(true);
    expect(last.check).toBe(true);
    expect(last.mate).toBe(true);
    // no ply before the mating move was itself flagged as mate.
    expect(plies.slice(0, -1).every((p) => p.mate === false)).toBe(true);
  });

  test("replay throws on an illegal move, naming the offending SAN", async () => {
    const eng = await chess();
    expect(() => eng.replay(undefined, ["e5"])).toThrow(/e5/);
  });

  test("replay honors a supplied starting fen rather than always starting fresh", async () => {
    const eng = await chess();
    // White to move, one pawn already on e4 — Nf3 should be legal and not touch e-pawn squares.
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const plies = eng.replay(fen, ["e5", "Nf3"]);
    expect(plies).toHaveLength(2);
    expect(plies[0]).toMatchObject({ from: "e7", to: "e5" });
    expect(plies[1]).toMatchObject({ from: "g1", to: "f3" });
  });
});
