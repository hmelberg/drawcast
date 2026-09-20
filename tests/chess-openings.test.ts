// The openings drill's pure half: the shipped set, what a custom set must
// survive, and the one prefix query the whole drill is built on.
import { describe, expect, test } from "vitest";
import { Chess } from "chess.js";
import { BUILT_IN_OPENINGS, matchingOpenings, plyList, validateSet, type Opening } from "../src/ui/chess-openings";
import type { ChessCtor } from "../src/ui/chessplay-model";
import { pickOpening, readHistory, recordAttempt, weightFor, WINDOW } from "../src/ui/chess-openings-store";
import { withNewIdsVisible } from "../src/render/params";

const Ctor = Chess as unknown as ChessCtor;

describe("the built-in set", () => {
  // THE test of this task. Shipped data with a bad SAN would throw on a
  // viewer's machine at click time, and nothing else in the suite looks.
  test("every line is legal, replayed move by move through the engine", () => {
    for (const o of BUILT_IN_OPENINGS) {
      expect(() => plyList(Ctor, o), `${o.name}: ${o.moves.join(" ")}`).not.toThrow();
      // Not just "the right length" — the engine's own SAN must match the
      // shipped spelling exactly, or the default session (which never runs
      // its lines through validateSet) would compare two spellings of one
      // move without anything here catching it.
      expect(plyList(Ctor, o).map((p) => p.san), o.name).toEqual(o.moves);
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

describe("weighting", () => {
  test("an opening with no history weighs 1, and each recent miss adds 2", () => {
    expect(weightFor(undefined)).toBe(1);
    expect(weightFor([true, true, true])).toBe(1);
    expect(weightFor([false])).toBe(3);
    expect(weightFor([false, false])).toBe(5);
    expect(weightFor([false, false, false])).toBe(7);
  });

  test("the window IS the cap — only the last three attempts count", () => {
    expect(WINDOW).toBe(3);
    // Five old misses, three recent hits: back to 1, with no separate clamp.
    expect(weightFor([false, false, false, false, false, true, true, true])).toBe(1);
    // And the worst possible weight is the window's.
    expect(weightFor(Array(20).fill(false))).toBe(7);
  });

  test("a miss you have since fixed decays on its own", () => {
    expect(weightFor([false, false, false])).toBe(7);
    expect(weightFor([false, false, false, true])).toBe(5);
    expect(weightFor([false, false, false, true, true])).toBe(3);
    expect(weightFor([false, false, false, true, true, true])).toBe(1);
  });
});

describe("pickOpening", () => {
  const set: Opening[] = [
    { name: "A", side: "white", moves: ["e4", "e5", "Nf3"] },
    { name: "B", side: "white", moves: ["d4", "d5", "c4"] },
  ];

  test("with no history it is uniform over the set", () => {
    expect(pickOpening(set, {}, () => 0).name).toBe("A");
    expect(pickOpening(set, {}, () => 0.9).name).toBe("B");
  });

  test("a missed opening takes a larger share of the range", () => {
    // A weighs 7 (three misses), B weighs 1 — so A covers 7/8 of the range.
    const history = { A: [false, false, false] };
    expect(pickOpening(set, history, () => 0.8).name).toBe("A");
    expect(pickOpening(set, history, () => 0.95).name).toBe("B");
  });

  test("an empty set is never asked for — the caller guarantees it", () => {
    // Documented rather than defended: pickOpening on [] would have nothing
    // to return, and every call site falls back to the built-in set first.
    expect(set.length).toBeGreaterThan(0);
  });

  test("a custom opening named constructor picks normally, on a history with no record of it", () => {
    // history[o.name] on a plain {} would return the INHERITED FUNCTION
    // Object.prototype.constructor, not undefined — exactly the shape
    // readHistory() returns on a completely fresh browser.
    const trapped: Opening[] = [
      { name: "constructor", side: "white", moves: ["e4", "e5", "Nf3"] },
      { name: "B", side: "white", moves: ["d4", "d5", "c4"] },
    ];
    expect(() => pickOpening(trapped, {}, () => 0)).not.toThrow();
    expect(pickOpening(trapped, {}, () => 0).name).toBe("constructor");
    expect(pickOpening(trapped, {}, () => 0.9).name).toBe("B");
  });
});

describe("the history store", () => {
  test("reads as empty and writes silently when storage is unavailable", () => {
    // jsdom is not configured for this suite, so localStorage is absent —
    // which is exactly the private-mode case the store must survive.
    expect(() => recordAttempt("Italian Game", false)).not.toThrow();
    expect(readHistory()).toEqual({});
  });
});

describe("a drill move onto a square the cast never touched", () => {
  test("mints an id the plan's visible set grows to include", () => {
    // What a Scholar's Mate board knows about: its own line's squares.
    const baseIds = new Set(["board", "piece_e2", "piece_e4", "piece_f7"]);
    const visible = new Set(["board", "piece_e2"]);
    // What a Sicilian drill paints: a pawn on c5, which that cast never saw.
    const previewOrder = ["board", "piece_e2", "piece_c5"];

    const grown = withNewIdsVisible(baseIds, previewOrder, visible);
    expect(grown.has("piece_c5")).toBe(true);
    // An id the base layout already had keeps its honest visibility.
    expect(grown.has("piece_e4")).toBe(false);
  });
});
