// Stock pictures for cards too detailed to draw (src/card/stock.ts, 2026-10-05).
import { expect, test } from "vitest";
import { stockFor } from "../src/card/stock";

test("chess and bones casts get a stock picture; other topics none", () => {
  const chess = stockFor("Scholar's Mate: the four-move trap")!;
  const icons = chess.filter((i) => i.k === "i").map((i) => (i as { n: string }).n);
  expect(icons).toContain("openmoji:white-chess-king");
  expect(icons).toContain("openmoji:chess-pawn");
  expect(icons.every((n) => n.startsWith("openmoji:"))).toBe(true);
  expect(chess.filter((i) => i.k === "a")).toHaveLength(32);
  expect(stockFor("Where the 206 bones are")).toEqual([expect.objectContaining({ k: "i", n: "twemoji:x-ray" })]);
  expect(stockFor("Hvor er skjelettet")).not.toBeNull();
  expect(stockFor("Why the Moon never lands")).toBeNull();
  expect(stockFor("A tricky position", ["chess"])).not.toBeNull();
});

test("the stock chess picture is small", () => {
  expect(JSON.stringify(stockFor("chess")).length).toBeLessThan(5000);
});
