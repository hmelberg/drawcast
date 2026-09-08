import { describe, it, expect } from "vitest";
import {
  CONNECT_MAX_EDGES, connectOpens, connectProgress, connectSummary, edgeAt,
  gradeConnect, makeEdge, snapStar, toggleEdge,
} from "../src/ui/connect-model";

const stars = [
  { id: "a", at: [0, 0] as [number, number] },
  { id: "b", at: [10, 0] as [number, number] },
  { id: "c", at: [10, 10] as [number, number] },
];

describe("snapStar", () => {
  it("takes the nearest star inside the radius", () => {
    expect(snapStar([1, 1], stars, 5)?.id).toBe("a");
    expect(snapStar([9, 1], stars, 5)?.id).toBe("b");
  });
  it("is null when nothing is close enough", () => {
    expect(snapStar([5, 5], stars, 2)).toBeNull();
  });
});

describe("edges", () => {
  it("sorts its ends, so a line drawn backwards is the same line", () => {
    expect(makeEdge("b", "a")).toEqual(["a", "b"]);
  });
  it("toggles: drawing an existing line removes it", () => {
    const one = toggleEdge([], makeEdge("a", "b"));
    expect(one).toEqual([["a", "b"]]);
    expect(toggleEdge(one, makeEdge("b", "a"))).toEqual([]);
  });
  it("finds the segment under a click, and nothing off it", () => {
    const drawn = [makeEdge("a", "b")];
    expect(edgeAt([5, 0.5], drawn, stars, 2)).toEqual(["a", "b"]);
    expect(edgeAt([5, 9], drawn, stars, 2)).toBeNull();
    // Past the end of the segment is off it, however near the infinite line.
    expect(edgeAt([-5, 0], drawn, stars, 2)).toBeNull();
  });
});

describe("gradeConnect", () => {
  const key = [makeEdge("a", "b"), makeEdge("b", "c")];
  it("passes on the exact figure", () => {
    const g = gradeConnect([makeEdge("b", "a"), makeEdge("c", "b")], key);
    expect(g.pass).toBe(true);
    expect(g.missing).toEqual([]);
    expect(g.strays).toEqual([]);
  });
  it("fails on one extra line — the interface already let the viewer remove it", () => {
    const g = gradeConnect([...key, makeEdge("a", "c")], key);
    expect(g.pass).toBe(false);
    expect(g.strays).toEqual([["a", "c"]]);
    expect(g.missing).toEqual([]);
  });
  it("fails when a line of the figure is missing, however few strays", () => {
    const g = gradeConnect([makeEdge("a", "b")], key);
    expect(g.pass).toBe(false);
    expect(g.missing).toEqual([["b", "c"]]);
  });
  it("fails an empty drawing", () => {
    expect(gradeConnect([], key).pass).toBe(false);
  });
});

describe("words", () => {
  it("counts up while drawing", () => {
    expect(connectProgress(3, 24)).toBe("3 / 24 lines");
  });
  it("says what was right and what was extra", () => {
    const key = [makeEdge("a", "b"), makeEdge("b", "c")];
    expect(connectSummary(gradeConnect(key, key))).toBe("2 of 2 lines, none extra");
    expect(connectSummary(gradeConnect([makeEdge("a", "b"), makeEdge("a", "c")], key)))
      .toBe("1 of 2 lines, 1 extra");
  });
});

it("caps the exercise at Orion's own size", () => {
  expect(CONNECT_MAX_EDGES).toBe(24);
});

describe("connectOpens", () => {
  const key = (n: number) => ({ stars: Array(n + 1).fill(0), edges: Array(n).fill(0) });
  it("opens on a figure that can be drawn", () => {
    expect(connectOpens(key(24))).toBe(true);
    expect(connectOpens(key(1))).toBe(true);
  });
  it("refuses a figure over the cap — Eridanus is 26, Sagittarius 29", () => {
    expect(connectOpens(key(25))).toBe(false);
    expect(connectOpens(key(29))).toBe(false);
  });
  it("refuses a figure that is not there", () => {
    expect(connectOpens({ stars: [], edges: [] })).toBe(false);
    expect(connectOpens({ stars: [1, 2], edges: [] })).toBe(false);
  });
});
