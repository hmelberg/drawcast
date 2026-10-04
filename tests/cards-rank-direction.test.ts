// A rank grows left → right (polish 2026-10-04 A1): magnitude ends put the
// most on the right of a row and on top of a column; other ends stay literal.
import { describe, expect, test } from "vitest";
import { cardsGeometry, expandCards, rankFlipped, type CardsElementLike } from "../src/spec/cards";

const rank = (ends: string[], arrange?: "row" | "column"): CardsElementLike => ({
  id: "r",
  type: "cards",
  items: ["Mosquito", "Snake", "Dog", "Shark"],
  ends,
  ...(arrange ? { arrange } : {}),
});

describe("rankFlipped", () => {
  test("most first in a row flips; least first does not", () => {
    expect(rankFlipped(rank(["most", "least"]))).toBe(true);
    expect(rankFlipped(rank(["least", "most"]))).toBe(false);
    expect(rankFlipped(rank(["deadliest", "least deadly"]))).toBe(true);
  });
  test("a column keeps the most on top", () => {
    expect(rankFlipped(rank(["most", "least"], "column"))).toBe(false);
    expect(rankFlipped(rank(["least", "most"], "column"))).toBe(true);
  });
  test("order words stay literal", () => {
    expect(rankFlipped(rank(["first", "last"]))).toBe(false);
    expect(rankFlipped(rank(["earliest", "latest"]))).toBe(false);
  });
});

describe("geometry", () => {
  test("row: the first item (the most) stands rightmost", () => {
    const g = cardsGeometry(rank(["most", "least"]));
    const xs = g.truth.map((p) => p[0]);
    expect(xs[0]).toBe(Math.max(...xs));
    expect(xs[3]).toBe(Math.min(...xs));
  });
  test("end words: most over the right card with an outward arrow", () => {
    const spec = { canvas: { width: 1000, height: 750 }, elements: [rank(["most", "least"], "row")], commands: [] } as never;
    const out = (expandCards(spec) as { elements: { id: string; text?: string; x?: number }[] }).elements;
    const e1 = out.find((e) => e.id === "r_end_1")!;
    const e2 = out.find((e) => e.id === "r_end_2")!;
    expect(e1.text).toBe("most →");
    expect(e2.text).toBe("← least");
    expect(e1.x!).toBeGreaterThan(e2.x!);
  });
});

describe("arrange auto (A2): a ranking alone takes the arrangement with the larger cards", () => {
  test("four cards alone: a column, the most on top, cards wider than the row's", () => {
    const spec = { title: "Q", canvas: { width: 1000, height: 750 }, elements: [rank(["most", "least"])], commands: [{ card: { title: "Q" } }, { draw: ["r"] }] } as never;
    const out = (expandCards(spec) as { elements: { id: string; text?: string; y?: number; width?: number; arrange?: string }[] }).elements;
    const group = out.find((e) => e.id === "r")!;
    expect(group.arrange).toBe("column");
    const top = out.find((e) => e.id === "r_end_1")!;
    expect(top.text).toBe("↑ most");
    const rowSpec = { title: "Q", canvas: { width: 1000, height: 750 }, elements: [rank(["most", "least"], "row")], commands: [{ card: { title: "Q" } }, { draw: ["r"] }] } as never;
    const rowOut = (expandCards(rowSpec) as { elements: { id: string; width?: number }[] }).elements;
    expect(out.find((e) => e.id === "r_1")!.width!).toBeGreaterThan(rowOut.find((e) => e.id === "r_1")!.width!);
  });
  test("a plain row of cards (no ends) stays a row", () => {
    const el = { id: "r", type: "cards", items: ["A", "B", "C"] } as CardsElementLike;
    const spec = { title: "Q", canvas: { width: 1000, height: 750 }, elements: [el], commands: [{ draw: ["r"] }] } as never;
    const out = (expandCards(spec) as { elements: { id: string; arrange?: string }[] }).elements;
    expect(out.find((e) => e.id === "r")!.arrange).toBeUndefined();
  });
});
