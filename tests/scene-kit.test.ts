import { describe, expect, test } from "vitest";
import { kit, KIT_VERSION } from "../src/scenes/kit";

describe("kit factories", () => {
  test("stroke applies house defaults and options", () => {
    const s = kit.stroke("a", [[0, 0], [10, 0]], { color: "red", dash: true, closed: true });
    expect(s.kind).toBe("stroke");
    expect(s.id).toBe("a");
    expect(s.style.color).toBe("red");
    expect(s.style.dash).toBe(true);
    expect(s.closed).toBe(true);
    expect(s.drawOpts.mode).toBe("sketch");
  });

  test("area fills, text positions, label builds a LabelRequest", () => {
    const a = kit.area("r", [[0, 0], [10, 0], [10, 10]], "gold");
    expect(a.style.fill).toBe("gold");
    const t = kit.text("t", [5, 5], "H₂O", { fontSize: 30 });
    expect(t.text).toBe("H₂O");
    expect(t.drawOpts.mode).toBe("instant");
    const l = kit.label("l", [1, 2], "above", "Nucleus");
    expect(l.side).toBe("above");
    expect(l.anchor).toEqual([1, 2]);
  });

  test("group wraps children", () => {
    const g = kit.group("g", [kit.stroke("g_1", [[0, 0], [1, 1]])]);
    expect(g.kind).toBe("group");
    expect(g.children).toHaveLength(1);
  });
});

describe("kit geometry", () => {
  test("polygon returns n vertices at radius r", () => {
    const pts = kit.polygon([0, 0], 10, 6);
    expect(pts).toHaveLength(6);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(10, 6);
  });

  test("arc spans a0..a1", () => {
    const pts = kit.arc([0, 0], 5, 0, Math.PI, 10);
    expect(pts[0][0]).toBeCloseTo(5);
    expect(pts[pts.length - 1][0]).toBeCloseTo(-5);
  });

  test("blob is closed-ish, deterministic, and wobbles around the ellipse", () => {
    const a = kit.blob([100, 100], 50, 40);
    const b = kit.blob([100, 100], 50, 40);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const [x, y] of a) {
      const rr = Math.hypot((x - 100) / 50, (y - 100) / 40);
      expect(rr).toBeGreaterThan(0.85);
      expect(rr).toBeLessThan(1.15);
    }
  });

  test("parallelOffset keeps distance d on a straight line", () => {
    const off = kit.parallelOffset([[0, 0], [10, 0]], 3);
    expect(off[0][1]).toBeCloseTo(3);
    expect(off[1][1]).toBeCloseTo(3);
  });

  test("blockArrow is a closed 7-point polygon ending at the tip", () => {
    const poly = kit.blockArrow([0, 0], [100, 0], 20, 40, 30);
    expect(poly).toHaveLength(7);
    expect(poly[3]).toEqual([100, 0]);
  });

  test("hatch returns n segments along the line", () => {
    const segs = kit.hatch([0, 0], [100, 0], 10, 15, -1);
    expect(segs).toHaveLength(10);
    expect(segs[0][1][1]).toBeCloseTo(-15 * Math.SQRT1_2, 1);
  });

  test("wave oscillates around the baseline", () => {
    const pts = kit.wave([0, 100], 92, 30, 46);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys)).toBeGreaterThan(125);
    expect(Math.min(...ys)).toBeLessThan(75);
  });

  test("smooth interpolates through the input points", () => {
    const out = kit.smooth([[0, 0], [50, 100], [100, 0]], 8);
    expect(out.length).toBeGreaterThan(10);
    expect(out[out.length - 1]).toEqual([100, 0]);
  });

  test("jitter is deterministic and in (-1, 1)", () => {
    expect(kit.jitter(7)).toBe(kit.jitter(7));
    for (let i = 0; i < 50; i++) expect(Math.abs(kit.jitter(i))).toBeLessThan(1);
  });
});

describe("kit parsers", () => {
  test("parseSS turns runs into segments", () => {
    expect(kit.parseSS("CCHHHHHCCEEEECC")).toEqual([
      { kind: "loop", length: 2 },
      { kind: "helix", length: 5 },
      { kind: "loop", length: 2 },
      { kind: "sheet", length: 4 },
      { kind: "loop", length: 2 },
    ]);
  });

  test("parseNewick builds the tree with names and branch lengths", () => {
    const t = kit.parseNewick("((A:1,B:2)AB:0.5,C);");
    expect(t.children).toHaveLength(2);
    expect(t.children[0].name).toBe("AB");
    expect(t.children[0].children.map((c) => c.name)).toEqual(["A", "B"]);
    expect(t.children[0].children[1].length).toBe(2);
    expect(t.children[1].name).toBe("C");
  });

  test("parseEdgeList reads ->, -| and =>", () => {
    expect(kit.parseEdgeList("EGFR -> RAS; RAS -| p53\nX => Y")).toEqual([
      { from: "EGFR", to: "RAS", effect: "activates" },
      { from: "RAS", to: "p53", effect: "inhibits" },
      { from: "X", to: "Y", effect: "converts" },
    ]);
  });
});

test("KIT_VERSION is 1 and constants ride on the kit", () => {
  expect(KIT_VERSION).toBe(1);
  expect(kit.CANVAS.w).toBe(1000);
  expect(kit.COLORS.ink).toBeDefined();
  expect(kit.SKETCH_MS.stroke).toBeGreaterThan(0);
});
