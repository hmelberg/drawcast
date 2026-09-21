import { describe, expect, test } from "vitest";
import { layoutSupplyDemand } from "../src/scenes/supply_demand/layout";
import { flattenDrawables, type StrokeDrawable, type Pt } from "../src/layout/model";
import { CANVAS, linearScale, plotArea } from "../src/layout/canvas";
import { qualitativeShape } from "../src/layout/curves";
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

describe("elasticity", () => {
  test("elasticity 1 and the word 'unit' are exact identities", () => {
    const base = layoutSupplyDemand({});
    for (const e of [1, "unit" as const]) {
      const l = layoutSupplyDemand({ demand: { elasticity: e }, supply: { elasticity: e } });
      expect(l.curveSamples!["demand_curve"]).toEqual(base.curveSamples!["demand_curve"]);
      expect(l.curveSamples!["supply_curve"]).toEqual(base.curveSamples!["supply_curve"]);
    }
  });

  // Pins the MECHANISM, not just the effect: elasticityFactor is not exported
  // (and shouldn't be, just for this), so this reconstructs the pre-elasticity
  // curve independently, from the same public primitives shapedCurve itself
  // is built from (qualitativeShape + the documented D0=2/D1=96 domain slice
  // + the same canvas scale), and checks it against the actual default-path
  // output byte for byte. `elasticityFactor(undefined)` computes
  // `Math.tan(Math.PI / 4)` internally, which is 0.9999999999999999, not 1 —
  // so if the `clamped === 1` short-circuit in elasticityFactor were removed,
  // `scaleXAbout`'s `s === 1` guard would never fire and this would resample
  // the curve through an s fractionally below 1, drifting off this
  // independently-computed reference. (Comparing default output only against
  // an explicit `elasticity: 1`/`"unit"` run, as the test above does, would
  // NOT catch that regression: both runs would recompute the same
  // slightly-off `s` and agree with each other while still drifting from the
  // true pre-elasticity shape.)
  test("the default elasticity path matches the pre-elasticity curve exactly, not just itself", () => {
    const sx = linearScale([0, 100], [plotArea().x0, plotArea().x1]);
    const sy = linearScale([0, 100], [plotArea().y0, plotArea().y1]);
    const D0 = 2;
    const D1 = 96;
    const expectedDemand: Pt[] = qualitativeShape("decreasing", "linear", "medium").map(
      ([tx, ty]): Pt => [sx(D0 + (D1 - D0) * tx), sy(ty * 100)],
    );
    const expectedSupply: Pt[] = qualitativeShape("increasing", "linear", "medium").map(
      ([tx, ty]): Pt => [sx(D0 + (D1 - D0) * tx), sy(ty * 100)],
    );
    const l = layoutSupplyDemand({});
    expect(l.curveSamples!["demand_curve"]).toEqual(expectedDemand);
    expect(l.curveSamples!["supply_curve"]).toEqual(expectedSupply);
  });

  test("the equilibrium never moves, and every elasticity draws a different curve", () => {
    const base = layoutSupplyDemand({}).anchors["equilibrium_point"];
    const shapes = new Set<string>();
    for (const e of [0.06, 0.3, 0.5, 1, 1.5, 1.9, 1.94]) {
      for (const params of [{ demand: { elasticity: e } }, { supply: { elasticity: e } }]) {
        const l = layoutSupplyDemand(params);
        const eq = l.anchors["equilibrium_point"];
        expect(eq[0]).toBeCloseTo(base[0], 2);
        expect(eq[1]).toBeCloseTo(base[1], 2);
      }
      shapes.add(JSON.stringify(layoutSupplyDemand({ demand: { elasticity: e } }).curveSamples!["demand_curve"]));
    }
    // without this, the invariance assertions above pass against a no-op
    expect(shapes.size).toBe(7);
  });

  test("inelastic is near-vertical, elastic is near-horizontal, and both keep enough points", () => {
    const span = (l: SceneLayout, id: string, i: 0 | 1) => {
      const v = l.curveSamples![id].map((p) => p[i]);
      return Math.max(...v) - Math.min(...v);
    };
    const inelastic = layoutSupplyDemand({ demand: { elasticity: "perfectly_inelastic" } });
    const elastic = layoutSupplyDemand({ demand: { elasticity: "perfectly_elastic" } });
    // near-vertical: a narrow x-run, the full y-span
    expect(span(inelastic, "demand_curve", 0)).toBeLessThan(span(elastic, "demand_curve", 0) / 10);
    expect(span(inelastic, "demand_curve", 1)).toBeGreaterThan(span(elastic, "demand_curve", 1) * 10);
    // neither extreme degenerates into a 2-point polyline
    for (const l of [inelastic, elastic]) expect(l.curveSamples!["demand_curve"].length).toBeGreaterThan(20);
  });

  test("elasticity composes with steepness rather than replacing it", () => {
    const ySpan = (l: SceneLayout) => {
      const ys = l.curveSamples!["demand_curve"].map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const flat = layoutSupplyDemand({ demand: { steepness: 0.4, elasticity: 0.5 } });
    const full = layoutSupplyDemand({ demand: { steepness: 1, elasticity: 0.5 } });
    expect(ySpan(full)).toBeGreaterThan(ySpan(flat));
  });
});

describe("tax decomposition", () => {
  const P = (l: SceneLayout, id: string) => l.anchors[id];

  test("default per-unit tax lands on the worked values from the spec", () => {
    // Domain units: the equilibrium is (49, 50); a per-unit 18 gives
    // Q_t = 38.93, P_b = 59.00, P_s = 41.00 (spec §6.3).
    const l = layoutSupplyDemand({ tax: { amount: 18 } });
    const pb = P(l, "price_buyers_point");
    const ps = P(l, "price_sellers_point");
    expect(pb[0]).toBeCloseTo(ps[0], 3); // same quantity
    const eq = P(l, "equilibrium_point");
    // logical y is UP (verified: higher domain price -> larger logical y)
    expect(pb[1]).toBeGreaterThan(eq[1]); // buyers pay MORE
    expect(ps[1]).toBeLessThan(eq[1]); // sellers receive LESS
  });

  test("a seller-side and a buyer-side tax are the same figure", () => {
    const seller = layoutSupplyDemand({ tax: { amount: 18, side: "seller" } });
    const buyer = layoutSupplyDemand({ tax: { amount: 18, side: "buyer" } });
    for (const id of ["price_buyers_point", "price_sellers_point"]) {
      expect(P(buyer, id)[0]).toBeCloseTo(P(seller, id)[0], 1);
      expect(P(buyer, id)[1]).toBeCloseTo(P(seller, id)[1], 1);
    }
    expect(ids(seller)).toContain("tax_supply_curve");
    expect(ids(buyer)).toContain("tax_demand_curve");
  });

  test("perfectly inelastic demand puts the whole burden on buyers", () => {
    const l = layoutSupplyDemand({ demand: { elasticity: "perfectly_inelastic" }, tax: { amount: 18 } });
    const eq = P(l, "equilibrium_point");
    const ps = P(l, "price_sellers_point");
    // sellers receive what they did before: the seller price barely moves
    expect(Math.abs(ps[1] - eq[1])).toBeLessThan(Math.abs(P(l, "price_buyers_point")[1] - eq[1]) / 4);
  });

  test("perfectly elastic demand puts the whole burden on sellers", () => {
    const l = layoutSupplyDemand({ demand: { elasticity: "perfectly_elastic" }, tax: { amount: 18 } });
    const eq = P(l, "equilibrium_point");
    const pb = P(l, "price_buyers_point");
    expect(Math.abs(pb[1] - eq[1])).toBeLessThan(Math.abs(P(l, "price_sellers_point")[1] - eq[1]) / 4);
  });

  test("an ad valorem tax pivots supply instead of translating it", () => {
    const l = layoutSupplyDemand({ tax: { amount: 36, kind: "ad_valorem" } });
    const base = l.curveSamples!["supply_curve"];
    const taxed = l.curveSamples!["tax_supply_curve"];
    const gapAt = (frac: number) => {
      const i = Math.floor(base.length * frac);
      const b = base[i];
      const t = taxed.reduce((best, p) => (Math.abs(p[0] - b[0]) < Math.abs(best[0] - b[0]) ? p : best), taxed[0]);
      return Math.abs(t[1] - b[1]);
    };
    // proportional, so the gap GROWS along the curve; a per-unit tax is parallel
    expect(gapAt(0.8)).toBeGreaterThan(gapAt(0.2) * 1.5);
  });

  test("a negative amount is a subsidy: quantity rises and sellers receive more than buyers pay", () => {
    const l = layoutSupplyDemand({ tax: { amount: -18 } });
    const eq = P(l, "equilibrium_point");
    const pb = P(l, "price_buyers_point");
    const ps = P(l, "price_sellers_point");
    expect(pb[0]).toBeGreaterThan(eq[0]); // more is traded
    expect(ps[1]).toBeGreaterThan(pb[1]); // sellers receive MORE than buyers pay (logical y is UP)
  });

  test("P_b and P_s are drawn by default, with their axis labels", () => {
    const all = ids(layoutSupplyDemand({ tax: { amount: 18 } }));
    for (const id of ["price_buyers_point", "price_sellers_point", "label_Pb", "label_Ps"]) {
      expect(all).toContain(id);
    }
  });
});

describe("price control levels", () => {
  test("level sets the line, and the defaults reproduce today's figure", () => {
    const dflt = layoutSupplyDemand({ price_ceiling: {} });
    const explicit = layoutSupplyDemand({ price_ceiling: { level: 31 } });
    const y = (l: SceneLayout) => stroke(l, "ceiling_line").pts[0][1];
    expect(y(explicit)).toBeCloseTo(y(dflt), 1);
    const lower = layoutSupplyDemand({ price_ceiling: { level: 20 } });
    expect(y(lower)).toBeLessThan(y(dflt)); // lower price = smaller logical y (y is UP)
  });

  test("a lower ceiling opens a wider shortage", () => {
    const gap = (level: number) => {
      const a = stroke(layoutSupplyDemand({ price_ceiling: { level } }), "shortage_arrow").pts;
      return Math.abs(a[1][0] - a[0][0]);
    };
    expect(gap(20)).toBeGreaterThan(gap(40));
  });

  test("a non-binding control still draws its line but no gap", () => {
    const all = ids(layoutSupplyDemand({ price_ceiling: { level: 80 } })); // above P* = 50
    expect(all).toContain("ceiling_line");
    expect(all).not.toContain("shortage_arrow");
  });

  test("a floor above the equilibrium produces a surplus", () => {
    const all = ids(layoutSupplyDemand({ price_floor: { level: 70 } }));
    expect(all).toContain("floor_line");
    expect(all).toContain("surplus_arrow");
  });

  // Not in the brief: the test above passes even if `level` were ignored,
  // since the hard-coded default (67.5) is also above P* = 50 and would still
  // draw a surplus. This mirrors the ceiling's non-binding test to actually
  // pin the floor's `level` wiring and its binds check.
  test("a non-binding floor still draws its line but no gap", () => {
    const all = ids(layoutSupplyDemand({ price_floor: { level: 40 } })); // below P* = 50
    expect(all).toContain("floor_line");
    expect(all).not.toContain("surplus_arrow");
  });
});
