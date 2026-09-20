// The openings drill's pure half: the shipped set, what a custom set must
// survive, and the one prefix query the whole drill is built on.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { BUILT_IN_OPENINGS, matchingOpenings, plyList, validateSet, type Opening } from "../src/ui/chess-openings";
import type { ChessCtor } from "../src/ui/chessplay-model";

const Ctor = Chess as unknown as ChessCtor;

describe("the built-in set", () => {
  // THE test of this task. Shipped data with a bad SAN would throw on a
  // viewer's machine at click time, and nothing else in the suite looks.
  test("every line is legal, replayed move by move through the engine", () => {
    for (const o of BUILT_IN_OPENINGS) {
      expect(() => plyList(Ctor, o), `${o.name}: ${o.moves.join(" ")}`).not.toThrow();
      expect(plyList(Ctor, o), o.name).toHaveLength(o.moves.length);
    }
  });

  test("is a dozen openings, 3-6 plies each, with both sides represented", () => {
    expect(BUILT_IN_OPENINGS.length).toBeGreaterThanOrEqual(10);
    for (const o of BUILT_IN_OPENINGS) {
      expect(o.moves.length, o.name).toBeGreaterThanOrEqual(3);
      expect(o.moves.length, o.name).toBeLessThanOrEqual(6);
    }
    expect(BUILT_IN_OPENINGS.some((o) => o.side === "white")).toBe(true);
    expect(BUILT_IN_OPENINGS.some((o) => o.side === "black")).toBe(true);
  });

  test("names are unique — the miss store keys on them", () => {
    const names = BUILT_IN_OPENINGS.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // The set earns its keep by its members being each other's likely mistakes:
  // playing Nc3 when you meant the Italian's Nf3 must land on a named opening.
  test("a plausible mistake lands on another opening in the set", () => {
    const italian = BUILT_IN_OPENINGS.find((o) => o.name === "Italian Game")!;
    const slip = [...italian.moves.slice(0, 2), "Nc3"]; // 1.e4 e5 2.Nc3
    const hit = matchingOpenings(BUILT_IN_OPENINGS, slip);
    expect(hit.map((o) => o.name)).toContain("Vienna Game");
  });
});

describe("matchingOpenings", () => {
  const set: Opening[] = [
    { name: "A", side: "white", moves: ["e4", "e5", "Nf3"] },
    { name: "B", side: "white", moves: ["e4", "e5", "Nc3"] },
    { name: "C", side: "black", moves: ["d4", "d5"] },
  ];

  test("an empty prefix matches everything", () => {
    expect(matchingOpenings(set, []).map((o) => o.name)).toEqual(["A", "B", "C"]);
  });

  test("an ambiguous prefix matches several", () => {
    expect(matchingOpenings(set, ["e4", "e5"]).map((o) => o.name)).toEqual(["A", "B"]);
  });

  test("a full line matches exactly its own", () => {
    expect(matchingOpenings(set, ["e4", "e5", "Nf3"]).map((o) => o.name)).toEqual(["A"]);
  });

  test("a prefix longer than any line matches nothing", () => {
    expect(matchingOpenings(set, ["e4", "e5", "Nf3", "Nc6"])).toEqual([]);
  });

  test("a prefix that diverges matches nothing", () => {
    expect(matchingOpenings(set, ["e4", "c5"])).toEqual([]);
  });
});

describe("validateSet", () => {
  test("keeps good rows and canonicalises their SAN to the engine's own spelling", () => {
    const { set, dropped } = validateSet(Ctor, [
      { name: "Vienna Game", side: "white", moves: ["e4", "e5", "Nc3"] },
    ]);
    expect(dropped).toEqual([]);
    expect(set[0].moves).toEqual(["e4", "e5", "Nc3"]);
  });

  test("drops a row with an illegal move and names it, rather than throwing", () => {
    const { set, dropped } = validateSet(Ctor, [
      { name: "Good", side: "white", moves: ["e4", "e5", "Nf3"] },
      { name: "Bad", side: "white", moves: ["e4", "e9"] },
    ]);
    expect(set.map((o) => o.name)).toEqual(["Good"]);
    expect(dropped).toEqual(["Bad"]);
  });

  test("drops rows that are not the right shape at all, without throwing", () => {
    const { set, dropped } = validateSet(Ctor, [
      null,
      { name: "No moves", side: "white" },
      { moves: ["e4"] },
      "nonsense",
      { name: "Fine", side: "white", moves: ["e4", "e5", "Nf3"] },
    ]);
    expect(set.map((o) => o.name)).toEqual(["Fine"]);
    expect(dropped.length).toBe(4);
  });

  // The miss store keys on the name. A blank name would let two rows share
  // one history and silently defeats the built-in set's own uniqueness test.
  test("drops a row with an empty or whitespace-only name, named as row N", () => {
    const { set, dropped } = validateSet(Ctor, [
      { name: "", side: "white", moves: ["e4", "e5", "Nf3"] },
      { name: "   ", side: "white", moves: ["e4", "e5", "Nf3"] },
    ]);
    expect(set).toEqual([]);
    expect(dropped).toEqual(["row 1", "row 2"]);
  });

  test("defaults side to white, and keeps an explicit black", () => {
    const { set } = validateSet(Ctor, [
      { name: "X", moves: ["e4", "e5", "Nf3"] },
      { name: "Y", side: "black", moves: ["e4", "c5", "Nf3"] },
    ]);
    expect(set[0].side).toBe("white");
    expect(set[1].side).toBe("black");
  });

  test("a non-array, an empty array, and an array of junk all yield an empty set", () => {
    expect(validateSet(Ctor, undefined).set).toEqual([]);
    expect(validateSet(Ctor, []).set).toEqual([]);
    expect(validateSet(Ctor, [null, 3]).set).toEqual([]);
  });
});

describe("plyList", () => {
  test("gives from/to/san per ply, so judging never compares SAN strings", () => {
    const plies = plyList(Ctor, { name: "X", side: "white", moves: ["e4", "e5", "Nf3"] });
    expect(plies[0]).toMatchObject({ from: "e2", to: "e4", san: "e4" });
    expect(plies[2]).toMatchObject({ from: "g1", to: "f3", san: "Nf3" });
  });
});
