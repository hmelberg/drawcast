import { describe, expect, test } from "vitest";
import { dragSummary, humanLabel, judgeDrop, normalizeItems, resolveDragTargets } from "../src/ui/drag-model";

// The drag question's rules, DOM-free: targets, judging, words.

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const square: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe("labels", () => {
  test("humanLabel: underscores to spaces, first letter up", () => {
    expect(humanLabel("kidney_left")).toBe("Kidney left");
    expect(humanLabel("C4")).toBe("C4");
    expect(humanLabel("country_norway")).toBe("Country norway");
  });
  test("normalizeItems keeps given labels and fills the rest", () => {
    expect(normalizeItems(["heart", { id: "kidney_left", label: "Left kidney" }, { id: "liver" }])).toEqual([
      { id: "heart", label: "Heart" },
      { id: "kidney_left", label: "Left kidney" },
      { id: "liver", label: "Liver" },
    ]);
  });
});

describe("resolveDragTargets", () => {
  const boxes = new Map([
    ["heart", box(10, 10, 20, 20)],
    ["liver", box(0, 0, 50, 30)],
  ]);
  const rings = new Map([["heart", [square]]]);
  test("element ids take their box and rings; a ringless element is box-only", () => {
    const { targets, missing } = resolveDragTargets(normalizeItems(["heart", "liver"]), { boxes, rings });
    expect(missing).toEqual([]);
    expect(targets.map((t) => t.id)).toEqual(["heart", "liver"]);
    expect(targets[0].rings).toEqual([square]);
    expect(targets[0].element).toBe(true);
    expect(targets[1].rings).toBeUndefined();
    expect(targets[1].element).toBe(true);
  });
  test("a note or a square falls through to the widget geometry, not an element", () => {
    const { targets } = resolveDragTargets(normalizeItems(["C4", "e4"]), {
      boxes,
      rings,
      noteBox: (n) => (n === "C4" ? box(1, 1, 5, 5) : null),
      squareBox: (s) => (s === "e4" ? box(7, 7, 8, 8) : null),
    });
    expect(targets.map((t) => [t.id, t.element, t.box.x])).toEqual([
      ["C4", false, 1],
      ["e4", false, 7],
    ]);
  });
  test("what nothing locates is reported missing, in order, and left out", () => {
    const { targets, missing } = resolveDragTargets(normalizeItems(["heart", "spleen", "X9"]), { boxes, rings });
    expect(targets.map((t) => t.id)).toEqual(["heart"]);
    expect(missing).toEqual(["spleen", "X9"]);
  });
});

describe("judgeDrop", () => {
  const target = { box: box(0, 0, 100, 100), rings: [square] };
  test("inside the outline: in, distance 0, hit", () => {
    expect(judgeDrop([50, 50], target, 0.25)).toEqual({ hit: true, grade: "in", distance: 0 });
  });
  test("just outside within tolerance: near, hit; distance is a fraction of the diagonal", () => {
    const j = judgeDrop([110, 50], target, 0.25); // 10 units off a 141-unit diagonal
    expect(j.grade).toBe("near");
    expect(j.hit).toBe(true);
    expect(j.distance).toBeCloseTo(10 / Math.hypot(100, 100), 5);
  });
  test("far outside: far, no hit", () => {
    const j = judgeDrop([200, 200], target, 0.25);
    expect(j.grade).toBe("far");
    expect(j.hit).toBe(false);
    expect(j.distance).toBeCloseTo(1, 5); // one diagonal away
  });
  test("tolerance 0 means inside only", () => {
    expect(judgeDrop([101, 50], target, 0).hit).toBe(false);
  });
  test("a target without rings is judged on its box", () => {
    expect(judgeDrop([5, 5], { box: box(0, 0, 10, 10) }, 0.25).grade).toBe("in");
    expect(judgeDrop([12, 5], { box: box(0, 0, 10, 10) }, 0.25).grade).toBe("near"); // 2 off a 14.1 diagonal
    expect(judgeDrop([30, 5], { box: box(0, 0, 10, 10) }, 0.25).grade).toBe("far");
  });
  test("a hole in the outline counts as outside (even-odd)", () => {
    const hole: [number, number][] = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
    ];
    expect(judgeDrop([50, 50], { box: box(0, 0, 100, 100), rings: [square, hole] }, 0).grade).toBe("far");
    expect(judgeDrop([50, 50], { box: box(0, 0, 100, 100), rings: [square, hole] }, 0.1).grade).toBe("near");
  });
});

describe("dragSummary", () => {
  const j = (grade: "in" | "near" | "far") => ({ hit: grade !== "far", grade, distance: 0 });
  test("counts hits", () => {
    expect(dragSummary([j("in"), j("in"), j("in")])).toBe("All 3 in place");
    expect(dragSummary([j("in"), j("near"), j("far")])).toBe("2 of 3 in place");
    expect(dragSummary([j("in")])).toBe("In place");
    expect(dragSummary([j("far")])).toBe("Not quite");
  });
});
