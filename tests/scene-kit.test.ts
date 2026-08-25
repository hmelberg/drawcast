import { describe, expect, test } from "vitest";
import { kit, KIT_VERSION, shadeColor } from "../src/scenes/kit";
import type { Pt } from "../src/layout/model";

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

  test("ellipse returns n points on the rx/ry ellipse", () => {
    const pts = kit.ellipse([10, 20], 30, 15, 40);
    expect(pts).toHaveLength(40);
    for (const [x, y] of pts) expect(Math.hypot((x - 10) / 30, (y - 20) / 15)).toBeCloseTo(1, 6);
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

describe("shadeColor", () => {
  test("factor 1 is lighter than factor 0.55, which is lighter than factor 0", () => {
    const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(channel(shadeColor("#808080", 1.0))).toBeGreaterThan(channel(shadeColor("#808080", 0.55)));
    expect(channel(shadeColor("#808080", 0.55))).toBeGreaterThan(channel(shadeColor("#808080", 0.0)));
  });

  test("factor 1 is pure white, factor 0 is pure black", () => {
    expect(shadeColor("#204060", 1.0)).toBe("#ffffff");
    expect(shadeColor("#204060", 0.0)).toBe("#000000");
  });

  test("non-6-digit-hex input returns unchanged", () => {
    expect(shadeColor("red", 0.8)).toBe("red");
    expect(shadeColor("#abc", 0.8)).toBe("#abc");
  });
});

test("KIT_VERSION is 2 and constants ride on the kit", () => {
  expect(KIT_VERSION).toBe(2);
  expect(kit.CANVAS.w).toBe(1000);
  expect(kit.COLORS.ink).toBeDefined();
  expect(kit.SKETCH_MS.stroke).toBeGreaterThan(0);
});

// M1 review finding #1: `kit` is one live, shared object handed to every
// compiled template body. Without a runtime freeze, a body could do
// `kit.COLORS.ink = "red"` or `kit.stroke = ...` and poison every later
// render app-wide (COLORS/CANVAS/SKETCH_MS are the same objects the rest
// of the app imports — `as const` only prevents this at the type level).
describe("kit and its constants are frozen against mutation", () => {
  test("kit itself is frozen: reassigning a factory throws and leaves it unchanged", () => {
    expect(Object.isFrozen(kit)).toBe(true);
    const before = kit.stroke;
    expect(() => {
      (kit as any).stroke = () => {
        throw new Error("a poisoned kit.stroke must never run");
      };
    }).toThrow();
    expect(kit.stroke).toBe(before);
  });

  test("kit.COLORS, kit.CANVAS, kit.SKETCH_MS are frozen: mutating a member throws and the value is unchanged", () => {
    expect(Object.isFrozen(kit.COLORS)).toBe(true);
    expect(Object.isFrozen(kit.CANVAS)).toBe(true);
    expect(Object.isFrozen(kit.SKETCH_MS)).toBe(true);

    const ink = kit.COLORS.ink;
    expect(() => {
      (kit.COLORS as any).ink = "red";
    }).toThrow();
    expect(kit.COLORS.ink).toBe(ink);

    const w = kit.CANVAS.w;
    expect(() => {
      (kit.CANVAS as any).w = 1;
    }).toThrow();
    expect(kit.CANVAS.w).toBe(w);

    const stroke = kit.SKETCH_MS.stroke;
    expect(() => {
      (kit.SKETCH_MS as any).stroke = 0;
    }).toThrow();
    expect(kit.SKETCH_MS.stroke).toBe(stroke);
  });
});

// ---- kit v2 -----------------------------------------------------------

describe("kit.expr", () => {
  test("compiles and evaluates an arithmetic expression string", () => {
    const f = kit.expr("100 - 0.5*x", ["x"]);
    expect(f({ x: 20 })).toBeCloseTo(90);
    expect(f({ x: 0 })).toBeCloseTo(100);
  });
});

describe("kit.sample", () => {
  test("samples fn(x) over [x0,x1] into n finite points, first at x0", () => {
    const pts = kit.sample((x) => x * x, 0, 2);
    expect(pts).toHaveLength(60);
    expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(2);
    expect(pts[pts.length - 1][1]).toBeCloseTo(4);
  });

  test("skips non-finite outputs (e.g. a pole) instead of emitting NaN/Infinity points", () => {
    const pts = kit.sample((x) => 1 / x, -1, 1, 11);
    expect(pts.length).toBeLessThan(11);
    expect(pts.every(([, y]) => Number.isFinite(y))).toBe(true);
  });
});

describe("kit.table", () => {
  test("2x2 with headers: grid + 4 cell anchors at centers, row 0 on top", () => {
    const t = kit.table("t", {
      x: 100, y: 100, w: 200, h: 100, rows: 2, cols: 2,
      cells: [["a", "b"], ["c", null]],
      rowHeaders: ["R0", "R1"],
      colHeaders: ["C0", "C1"],
    });
    expect(t.order).toContain("t__grid");
    const grid = t.drawables.find((d) => d.id === "t__grid");
    expect(grid?.kind).toBe("group");

    for (const id of ["t__c0_0", "t__c0_1", "t__c1_0", "t__c1_1"]) {
      expect(t.anchors[id]).toBeDefined();
    }
    // row 0 is the TOP row: y-up means a higher y value.
    expect(t.anchors["t__c0_0"][1]).toBeGreaterThan(t.anchors["t__c1_0"][1]);
    // columns still line up left-to-right.
    expect(t.anchors["t__c0_0"][0]).toBeLessThan(t.anchors["t__c0_1"][0]);

    // non-null cells get text drawables...
    expect(t.drawables.some((d) => d.id === "t__c0_0" && d.kind === "text")).toBe(true);
    // ...null cells stay anchor-only, no drawable.
    expect(t.drawables.some((d) => d.id === "t__c1_1")).toBe(false);

    // headers are drawn outside the grid box.
    const rh0 = t.drawables.find((d) => d.id === "t__rh0") as any;
    expect(rh0.pos[0]).toBeLessThan(100); // left of x
    const ch0 = t.drawables.find((d) => d.id === "t__ch0") as any;
    expect(ch0.pos[1]).toBeGreaterThan(200); // above y+h
  });
});

describe("kit.layoutNodes", () => {
  test("chain of 3 is evenly spaced and inside the box", () => {
    const pos = kit.layoutNodes(["a", "b", "c"], [], { style: "chain", x: 0, y: 0, w: 300, h: 100 });
    const xs = ["a", "b", "c"].map((n) => pos[n][0]);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1]);
    for (const n of ["a", "b", "c"]) {
      const [x, y] = pos[n];
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(300);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
  });

  test("layered puts a node's successor strictly to its right", () => {
    const pos = kit.layoutNodes(
      ["a", "b", "c"],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }],
      { style: "layered", x: 0, y: 0, w: 300, h: 150 },
    );
    expect(pos.b[0]).toBeGreaterThan(pos.a[0]);
    expect(pos.c[0]).toBeGreaterThan(pos.b[0]);
  });

  test("circle places nodes on a ring around the box center", () => {
    const pos = kit.layoutNodes(["a", "b", "c", "d"], [], { style: "circle", x: 0, y: 0, w: 200, h: 200 });
    const c: Pt = [100, 100];
    const radii = Object.values(pos).map(([x, y]) => Math.hypot(x - c[0], y - c[1]));
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 6);
  });
});

describe("kit.edgeArrow", () => {
  test("default head draws an arrowhead on the main stroke", () => {
    const { drawables, order } = kit.edgeArrow("e", [0, 0], [100, 0]);
    expect(order).toEqual(["e"]);
    expect((drawables[0] as any).arrowhead).toBe("end");
  });

  test("head: 'bar' emits a __head drawable", () => {
    const { drawables, order } = kit.edgeArrow("e", [0, 0], [100, 0], { head: "bar" });
    expect(order).toContain("e__head");
    expect(drawables.some((d) => d.id === "e__head")).toBe(true);
  });

  test("shorten moves both endpoints inward", () => {
    const { drawables } = kit.edgeArrow("e", [0, 0], [100, 0], { shorten: 10, head: "none" });
    const s = drawables[0] as any;
    expect(s.pts[0]).toEqual([10, 0]);
    expect(s.pts[s.pts.length - 1]).toEqual([90, 0]);
  });

  test("curve bows the path off the straight line", () => {
    const { drawables } = kit.edgeArrow("e", [0, 0], [100, 0], { curve: 0.25, head: "none" });
    const s = drawables[0] as any;
    const midY = s.pts[Math.floor(s.pts.length / 2)][1];
    expect(Math.abs(midY)).toBeGreaterThan(1);
  });
});

describe("kit.angleMark", () => {
  test("arc variant follows the arc from a0 to a1", () => {
    const m = kit.angleMark("m", [0, 0], 0, Math.PI / 2, 20);
    expect(m.pts.length).toBeGreaterThan(3);
    expect(m.pts[0][0]).toBeCloseTo(20);
    expect(m.pts[m.pts.length - 1][1]).toBeCloseTo(20);
  });

  test("right-angle variant returns a 3-pt polyline forming the square corner", () => {
    const m = kit.angleMark("m", [0, 0], 0, Math.PI / 2, 20, { right: true });
    expect(m.pts).toHaveLength(3);
    expect(m.pts[0]).toEqual([20, 0]);
    expect(m.pts[2][0]).toBeCloseTo(0, 6);
    expect(m.pts[2][1]).toBeCloseTo(20, 6);
  });
});

describe("kit.tickMarks", () => {
  test("n ticks cross the midpoint region, perpendicular to the segment", () => {
    const segs = kit.tickMarks([0, 0], [100, 0], 3);
    expect(segs).toHaveLength(3);
    for (const [p0, p1] of segs) {
      // perpendicular to a horizontal line means the tick is vertical.
      expect(p0[0]).toBeCloseTo(p1[0]);
      expect(Math.abs(p0[1] - p1[1])).toBeGreaterThan(0);
      // clustered near the midpoint (x = 50).
      expect(p0[0]).toBeGreaterThan(30);
      expect(p0[0]).toBeLessThan(70);
    }
  });
});

describe("kit.stamp and kit.STAMPS", () => {
  test("resistor returns drawables within the unit box scaled, and both anchors", () => {
    const at: Pt = [500, 400];
    const scale = 40;
    const r = kit.stamp("resistor", at, { scale });
    expect(r.anchors.left).toBeDefined();
    expect(r.anchors.right).toBeDefined();
    expect(r.anchors.left[0]).toBeLessThan(r.anchors.right[0]);
    for (const d of r.drawables) {
      if (d.kind !== "stroke") continue;
      for (const [x, y] of d.pts) {
        expect(Math.abs(x - at[0])).toBeLessThanOrEqual(scale + 1e-6);
        expect(Math.abs(y - at[1])).toBeLessThanOrEqual(scale + 1e-6);
      }
    }
  });

  test("every STAMPS name round-trips through stamp() with finite coordinates", () => {
    for (const name of Object.keys(kit.STAMPS)) {
      const r = kit.stamp(name, [500, 400]);
      expect(r.drawables.length).toBeGreaterThan(0);
      expect(Object.keys(r.anchors).length).toBeGreaterThan(0);
      for (const d of r.drawables) {
        if (d.kind !== "stroke") continue;
        for (const [x, y] of d.pts) {
          expect(Number.isFinite(x)).toBe(true);
          expect(Number.isFinite(y)).toBe(true);
        }
      }
      for (const p of Object.values(r.anchors)) {
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Number.isFinite(p[1])).toBe(true);
      }
    }
  });

  test("STAMPS is frozen", () => {
    expect(Object.isFrozen(kit.STAMPS)).toBe(true);
  });
});
