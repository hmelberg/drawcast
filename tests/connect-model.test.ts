import { describe, it, expect } from "vitest";
import {
  CONNECT_MAX_EDGES, connectOpens, connectProgress, connectSummary, edgeAt,
  escapeSelectorValue, gradeConnect, hiddenLeafSelector, makeEdge,
  medianNearestNeighbour, restoreOpacity, snapRadiusFor, snapStar, toggleEdge,
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
  it("never mutates its input — the gate holds this same array across pointer events", () => {
    const input = [makeEdge("a", "b")];
    toggleEdge(input, makeEdge("b", "c")); // an add
    expect(input.length).toBe(1);
    expect(input).toEqual([["a", "b"]]);
    toggleEdge(input, makeEdge("a", "b")); // a remove
    expect(input.length).toBe(1);
    expect(input).toEqual([["a", "b"]]);
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

describe("medianNearestNeighbour", () => {
  it("is each star's closest OTHER star, at the middle of the sorted list", () => {
    // a-b: 10, b-c: 10, a-c: 10√2 — every nearest neighbour is 10.
    expect(medianNearestNeighbour(stars)).toBeCloseTo(10);
  });
  it("takes the average of the two middle values on an even count", () => {
    const four = [
      { id: "a", at: [0, 0] as [number, number] },
      { id: "b", at: [1, 0] as [number, number] }, // a's nearest: 1
      { id: "c", at: [1, 100] as [number, number] }, // nearest is d, 5 away
      { id: "d", at: [1, 105] as [number, number] }, // nearest is c, 5 away
    ];
    // nearest-neighbour distances: a→1, b→1, c→5, d→5; sorted [1,1,5,5]; median (1+5)/2 = 3
    expect(medianNearestNeighbour(four)).toBeCloseTo(3);
  });
  it("is not a finite distance for zero or one star — nothing else is close enough to measure to", () => {
    // Empty: the median of nothing is NaN. One star: Infinity (no other star
    // exists to be its neighbour). Neither is finite — which is exactly what
    // snapRadiusFor's own fallback checks for, rather than one specific value.
    expect(Number.isFinite(medianNearestNeighbour([]))).toBe(false);
    expect(medianNearestNeighbour([stars[0]])).toBe(Infinity);
  });
});

describe("snapRadiusFor", () => {
  it("scales with the figure's own spacing, clamped to a sane range", () => {
    // median NN 10 * 0.4 = 4, clamped up to the 12 floor.
    expect(snapRadiusFor(stars)).toBe(12);
    const wide = [
      { id: "a", at: [0, 0] as [number, number] },
      { id: "b", at: [1000, 0] as [number, number] },
    ];
    // median NN 1000 * 0.4 = 400, clamped down to the 40 ceiling.
    expect(snapRadiusFor(wide)).toBe(40);
  });
  it("falls back to the ceiling rather than NaN or zero when there's nothing to measure", () => {
    expect(snapRadiusFor([])).toBe(40);
    expect(snapRadiusFor([stars[0]])).toBe(40);
  });
});

describe("escapeSelectorValue / hiddenLeafSelector", () => {
  it("escapes a quote and a backslash even with no CSS global (this repo's own vitest)", () => {
    expect(typeof CSS).toBe("undefined"); // pins which branch node actually exercises
    expect(escapeSelectorValue("con_ori")).toBe("con_ori");
    expect(escapeSelectorValue('a"b')).toBe('a\\"b');
    expect(escapeSelectorValue("a\\b")).toBe("a\\\\b");
  });
  it("prefers CSS.escape when the runtime has it", () => {
    (globalThis as { CSS?: { escape(s: string): string } }).CSS = { escape: (s: string) => `ESC(${s})` };
    try {
      expect(escapeSelectorValue('a"b')).toBe('ESC(a"b)');
    } finally {
      delete (globalThis as { CSS?: unknown }).CSS;
    }
  });
  it("matches the leaf itself and every child of its group", () => {
    expect(hiddenLeafSelector("con_ori")).toBe('[data-leaf-id="con_ori"], [data-leaf-id^="con_ori__"]');
  });
  it("stays a well-formed selector (no unescaped quote) for an id carrying one", () => {
    const sel = hiddenLeafSelector('a"b');
    expect(sel).toBe('[data-leaf-id="a\\"b"], [data-leaf-id^="a\\"b__"]');
  });
});

describe("restoreOpacity", () => {
  it("puts back every saved id, including one whose saved value was empty", () => {
    const saved = new Map([
      ["con_ori__0", "1"],
      ["con_ori__1", ""], // no inline opacity at all — must be restored too, not skipped
    ]);
    const set: [string, string][] = [];
    restoreOpacity(saved, (id, value) => set.push([id, value]));
    expect(set).toEqual([
      ["con_ori__0", "1"],
      ["con_ori__1", ""],
    ]);
  });
  it("is a no-op on an empty map", () => {
    let calls = 0;
    restoreOpacity(new Map(), () => calls++);
    expect(calls).toBe(0);
  });
});
