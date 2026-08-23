import { describe, expect, test } from "vitest";
import { layoutSupplyDemand } from "../src/scenes/supply_demand/layout";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";
import type { SceneLayout } from "../src/scenes/types";

function ids(result: ReturnType<typeof layoutSupplyDemand>): string[] {
  return [
    ...flattenDrawables(result.drawables).map((d) => d.id),
    ...result.labels.map((l) => l.id),
  ];
}

function stroke(result: ReturnType<typeof layoutSupplyDemand>, id: string): StrokeDrawable {
  const d = flattenDrawables(result.drawables).find((d) => d.id === id);
  if (!d || d.kind !== "stroke") throw new Error(`no stroke drawable ${id}`);
  return d;
}

describe("layoutSupplyDemand", () => {
  test("default params produce axes, curves, and equilibrium elements", () => {
    const r = layoutSupplyDemand({});
    const all = ids(r);
    for (const id of ["axes", "demand_curve", "supply_curve", "equilibrium_point", "guide_lines", "label_D", "label_S"]) {
      expect(all).toContain(id);
    }
  });

  test("equilibrium point sits on both curves", () => {
    const r = layoutSupplyDemand({});
    const eq = stroke(r, "equilibrium_point");
    const [ex, ey] = eq.shapeHint && eq.shapeHint.type === "circle" ? eq.shapeHint.c : eq.pts[0];
    for (const curveId of ["demand_curve", "supply_curve"]) {
      const pts = stroke(r, curveId).pts;
      const nearest = Math.min(...pts.map(([x, y]) => Math.hypot(x - ex, y - ey)));
      expect(nearest).toBeLessThan(15);
    }
  });

  test("all geometry stays inside the logical canvas", () => {
    const r = layoutSupplyDemand({ tax: { show_deadweight_loss: true }, price_ceiling: { show_shortage: true } });
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS.w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(CANVAS.h);
        }
      }
    }
  });

  test("price ceiling sits below equilibrium and produces shortage elements", () => {
    const r = layoutSupplyDemand({ price_ceiling: { show_shortage: true } });
    const all = ids(r);
    expect(all).toContain("ceiling_line");
    expect(all).toContain("shortage_arrow");
    const eq = stroke(r, "equilibrium_point");
    const eqY = eq.shapeHint && eq.shapeHint.type === "circle" ? eq.shapeHint.c[1] : eq.pts[0][1];
    const ceilingY = stroke(r, "ceiling_line").pts[0][1];
    expect(ceilingY).toBeLessThan(eqY);
  });

  test("tax adds a shifted supply curve above the original and a deadweight-loss region", () => {
    const r = layoutSupplyDemand({ tax: { show_deadweight_loss: true } });
    const all = ids(r);
    expect(all).toContain("tax_supply_curve");
    expect(all).toContain("dwl_region");
    const base = stroke(r, "supply_curve").pts;
    const taxed = stroke(r, "tax_supply_curve").pts;
    const midBase = base[Math.floor(base.length / 2)];
    const midTaxed = taxed.find(([x]) => Math.abs(x - midBase[0]) < 20);
    expect(midTaxed).toBeDefined();
    expect(midTaxed![1]).toBeGreaterThan(midBase[1]);
    const dwl = flattenDrawables(r.drawables).find((d) => d.id === "dwl_region");
    expect(dwl?.kind).toBe("area");
  });

  test("demand shift produces a second curve and a shift arrow", () => {
    const r = layoutSupplyDemand({ demand_shift: { direction: "right", label: "D'" } });
    const all = ids(r);
    expect(all).toContain("demand_shift_curve");
    expect(all).toContain("demand_shift_arrow");
    expect(all).toContain("label_D_shift");
  });

  test("surplus regions are areas placed behind strokes (lower z)", () => {
    const r = layoutSupplyDemand({ regions: ["consumer_surplus", "producer_surplus"] });
    const flat = flattenDrawables(r.drawables);
    const cs = flat.find((d) => d.id === "cs_region");
    const demand = flat.find((d) => d.id === "demand_curve");
    expect(cs?.kind).toBe("area");
    expect(cs!.z).toBeLessThan(demand!.z);
  });
});

describe("numeric curve params (animate prerequisites)", () => {
  test("numeric steepness: larger k spans more of the y range, enum words unchanged", () => {
    const flat = layoutSupplyDemand({ demand: { steepness: 0.4 } });
    const steep = layoutSupplyDemand({ demand: { steepness: 2 } });
    const enumSteep = layoutSupplyDemand({ demand: { steepness: "steep" } });
    const numSteep = layoutSupplyDemand({ demand: { steepness: 1.5 } });
    const ySpan = (l: SceneLayout) => {
      const pts = l.curveSamples!["demand_curve"];
      const ys = pts.map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(ySpan(steep)).toBeGreaterThan(ySpan(flat));
    expect(ySpan(numSteep)).toBeCloseTo(ySpan(enumSteep), 5);
  });

  test("shift amount: signed domain-unit shift, direction fallback intact", () => {
    const byAmount = layoutSupplyDemand({ demand_shift: { amount: 20 } });
    const byDirection = layoutSupplyDemand({ demand_shift: { direction: "right" } });
    const left = layoutSupplyDemand({ demand_shift: { amount: -10 } });
    const base = (l: SceneLayout) => l.curveSamples!["demand_curve"];
    const shifted = (l: SceneLayout) => l.curveSamples!["demand_shift_curve"];
    // logical dx for a 20-domain-unit shift = 20 * (plot width / 100); compare
    // via a base point: the shifted curve's first point x minus the matching
    // base point x must be positive for amount 20 / direction right, negative for -10.
    expect(shifted(byAmount)[0][0]).toBeGreaterThan(base(byAmount)[0][0]);
    expect(shifted(byDirection)[0][0]).toBeGreaterThan(base(byDirection)[0][0]);
    expect(shifted(left)[0][0]).toBeLessThan(base(left)[0][0]);
  });

  test("amount 0: shifted curve coincides with base; arrow exists WITHOUT arrowhead", () => {
    const l = layoutSupplyDemand({ demand_shift: { amount: 0 } });
    expect(l.curveSamples!["demand_shift_curve"]).toEqual(l.curveSamples!["demand_curve"]);
    const arrow = flattenDrawables(l.drawables).find((d) => d.id === "demand_shift_arrow");
    expect(arrow).toBeDefined();
    expect((arrow as StrokeDrawable).arrowhead).toBeUndefined();
    const arrow15 = flattenDrawables(layoutSupplyDemand({ demand_shift: { amount: 15 } }).drawables).find(
      (d) => d.id === "demand_shift_arrow",
    );
    expect((arrow15 as StrokeDrawable).arrowhead).toBe("end");
  });

  test("shift equilibrium: exists for a single shift, glides with amount, absent when both shift", () => {
    const at0 = layoutSupplyDemand({ demand_shift: { amount: 0 } });
    const at20 = layoutSupplyDemand({ demand_shift: { amount: 20 } });
    const both = layoutSupplyDemand({ demand_shift: { amount: 10 }, supply_shift: { amount: 10 } });
    const dot = (l: SceneLayout) => flattenDrawables(l.drawables).find((d) => d.id === "shift_equilibrium_point");
    expect(dot(at0)).toBeDefined();
    expect(dot(at20)).toBeDefined();
    // at amount 0, E' sits on E
    const eq = (l: SceneLayout) => l.anchors["equilibrium_point"];
    const eqS = (l: SceneLayout) => l.anchors["shift_equilibrium_point"];
    expect(eqS(at0)[0]).toBeCloseTo(eq(at0)[0], 3);
    expect(eqS(at0)[1]).toBeCloseTo(eq(at0)[1], 3);
    // demand shifted right: new equilibrium at higher Q and higher P
    expect(eqS(at20)[0]).toBeGreaterThan(eq(at20)[0]);
    expect(eqS(at20)[1]).toBeGreaterThan(eq(at20)[1]);
    expect(dot(both)).toBeUndefined();
    // labels E'/P*'/Q*' + guides exist for the single-shift case
    for (const id of ["shift_guide_lines", "label_E_shift", "label_P_shift", "label_Q_shift"]) {
      expect(at20.order).toContain(id);
    }
  });

  test("extreme shift amounts are clamped, not dropped: layout never throws and the shift curve survives", () => {
    for (const amount of [150, -150]) {
      let l: SceneLayout | undefined;
      expect(() => {
        l = layoutSupplyDemand({ demand_shift: { amount } });
      }).not.toThrow();
      const shifted = l!.curveSamples!["demand_shift_curve"];
      expect(shifted).toBeDefined();
      expect(shifted!.length).toBeGreaterThan(0);
    }
  });
});
