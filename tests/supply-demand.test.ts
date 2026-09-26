import { describe, expect, test } from "vitest";
import { layoutSupplyDemand, type SupplyDemandParams } from "../src/scenes/supply_demand/layout";
import { flattenDrawables, type StrokeDrawable, type Pt } from "../src/layout/model";
import { CANVAS, linearScale, plotArea } from "../src/layout/canvas";
import { interpolateAtX, qualitativeShape, solveForX } from "../src/layout/curves";
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

  // Superseded by "every combination stays inside the logical canvas" below
  // (describe("welfare regions")), which covers this case plus tax extremes,
  // price-control extremes and elasticity extremes — removed rather than left
  // to rot beside a comment claiming it was already gone.

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
    const r = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["deadweight_loss"] });
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
    const demandShapes = new Set<string>();
    const supplyShapes = new Set<string>();
    for (const e of [0.06, 0.3, 0.5, 1, 1.5, 1.9, 1.94]) {
      for (const params of [{ demand: { elasticity: e } }, { supply: { elasticity: e } }]) {
        const l = layoutSupplyDemand(params);
        const eq = l.anchors["equilibrium_point"];
        expect(eq[0]).toBeCloseTo(base[0], 2);
        expect(eq[1]).toBeCloseTo(base[1], 2);
      }
      demandShapes.add(JSON.stringify(layoutSupplyDemand({ demand: { elasticity: e } }).curveSamples!["demand_curve"]));
      supplyShapes.add(JSON.stringify(layoutSupplyDemand({ supply: { elasticity: e } }).curveSamples!["supply_curve"]));
    }
    // Without these, the invariance assertions above pass against a no-op —
    // and BOTH sides must be swept: with the distinctness check on demand
    // only, making `supply.elasticity` a complete no-op left the whole suite
    // green (whole-branch review, Gap D).
    expect(demandShapes.size).toBe(7);
    expect(supplyShapes.size).toBe(7);
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
  // Logical → internal domain: the exact inverse of the scales layout.ts
  // builds, so the worked numbers below can be asserted in the units the
  // spec states them in (0–100 × 0–100) rather than in canvas pixels.
  const toQ = linearScale([plotArea().x0, plotArea().x1], [0, 100]);
  const toP = linearScale([plotArea().y0, plotArea().y1], [0, 100]);

  test("the spec's worked tax numbers, pinned in domain units", () => {
    // The welfare identity CANNOT catch a wrong traded quantity: with
    // pB = D(q) and pS = S(q), CS + PS + wedge = ∫(D − S) over the interval
    // for ANY q, so identity + DWL is identically CS₀ + PS₀ — the
    // whole-branch reviewer halved the tax shift and all 37 tests stayed
    // green. These values (hand-verified four times, spec §6.3) are what
    // actually pins Q_t, so treat them as a ratchet, not as a snapshot.
    const near = (actual: number, expected: number, what: string) => {
      expect(Math.abs(actual - expected), `${what}: ${actual.toFixed(4)} vs ${expected}`).toBeLessThanOrEqual(0.01);
    };
    // the anchor of every number below: the default equilibrium is (49, 50)
    const eq = layoutSupplyDemand({}).anchors["equilibrium_point"];
    near(toQ(eq[0]), 49, "Q*");
    near(toP(eq[1]), 50, "P*");

    const worked = (params: SupplyDemandParams) => {
      const l = layoutSupplyDemand(params);
      const pb = P(l, "price_buyers_point");
      const ps = P(l, "price_sellers_point");
      expect(pb[0]).toBeCloseTo(ps[0], 6); // one quantity, two prices
      return { q: toQ(pb[0]), pB: toP(pb[1]), pS: toP(ps[1]) };
    };

    const perUnit = worked({ tax: { amount: 18 } });
    near(perUnit.q, 38.93, "per-unit 18 Q_t");
    near(perUnit.pB, 59.0, "per-unit 18 P_b");
    near(perUnit.pS, 41.0, "per-unit 18 P_s");

    const subsidy = worked({ tax: { amount: -18 } });
    near(subsidy.q, 59.07, "subsidy 18 Q_t");
    near(subsidy.pB, 41.0, "subsidy 18 P_b");
    near(subsidy.pS, 59.0, "subsidy 18 P_s");

    const adValorem = worked({ tax: { amount: 36, kind: "ad_valorem" } });
    near(adValorem.q, 40.46, "ad valorem 36 Q_t");
    near(adValorem.pB, 57.63, "ad valorem 36 P_b");
    near(adValorem.pS, 42.37, "ad valorem 36 P_s");
  });

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

  // Looped over `kind` rather than duplicated: ad_valorem × buyer-side is the
  // ONLY caller of the division branch of layout.ts's `shift`
  // (y / (1 + amount/100)) and had zero coverage before this loop
  // (whole-branch review, Gap C).
  test("a seller-side and a buyer-side tax are the same figure, for both kinds", () => {
    for (const [kind, amount] of [["per_unit", 18], ["ad_valorem", 36]] as const) {
      const seller = layoutSupplyDemand({ tax: { amount, kind, side: "seller" } });
      const buyer = layoutSupplyDemand({ tax: { amount, kind, side: "buyer" } });
      for (const id of ["price_buyers_point", "price_sellers_point"]) {
        expect(P(buyer, id)[0], `${kind} ${id} x`).toBeCloseTo(P(seller, id)[0], 1);
        expect(P(buyer, id)[1], `${kind} ${id} y`).toBeCloseTo(P(seller, id)[1], 1);
      }
      expect(ids(seller)).toContain("tax_supply_curve");
      expect(ids(buyer)).toContain("tax_demand_curve");
      // ...and the buyer-side curve really did move: equal-to-seller alone
      // would also hold if the shift were a no-op on both sides.
      const moved = buyer.curveSamples!["tax_demand_curve"];
      const base = buyer.curveSamples!["demand_curve"];
      expect(moved).toBeDefined();
      expect(JSON.stringify(moved)).not.toBe(JSON.stringify(base));
    }
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

/** Polygon area by the shoelace formula, in logical units. */
function polyArea(l: SceneLayout, id: string): number {
  const d = flattenDrawables(l.drawables).find((x) => x.id === id);
  if (!d || (d.kind !== "area" && d.kind !== "stroke")) return 0;
  const p = d.pts;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** A region's own polygon. `.pts` is not on every Drawable variant — narrow first. */
function areaPts(l: SceneLayout, id: string): Pt[] {
  const d = flattenDrawables(l.drawables).find((x) => x.id === id);
  if (!d || d.kind !== "area") throw new Error(`no area drawable ${id}`);
  return d.pts;
}

const ALL_REGIONS = ["consumer_surplus", "producer_surplus", "deadweight_loss", "government_revenue", "transfer"] as const;

describe("welfare regions", () => {
  test("a bare tax shades nothing", () => {
    const all = ids(layoutSupplyDemand({ tax: { amount: 18 } }));
    for (const id of ["cs_region", "ps_region", "dwl_region", "wedge_region"]) {
      expect(all).not.toContain(id);
    }
  });

  test("the welfare identity holds for every intervention, at every elasticity", () => {
    // Each CONTEXT brings its own baseline, and every case in it is measured
    // against that baseline. This is not optional bookkeeping: the regions
    // share one left edge (layout.ts `qLeft`) and that edge moves with
    // elasticity, so a 0.5-elasticity case measured against the DEFAULT
    // baseline compares two regions that span different intervals and reports
    // the test's own artifact. Measured both ways on the unfixed code, the
    // same defect read 7.4 % (mismatched baseline) and 9.2 % (matched); only
    // the matched number is the layout's error.
    const contexts: { name: string; ctx: SupplyDemandParams; cases: SupplyDemandParams[] }[] = [
      {
        name: "unit elasticity",
        ctx: {},
        cases: [
          { tax: { amount: 18 } },
          { tax: { amount: 18, side: "buyer" } },
          { tax: { amount: 36, kind: "ad_valorem" } },
          { tax: { amount: 36, kind: "ad_valorem", side: "buyer" } },
          { tax: { amount: -18 } },
          { price_ceiling: { level: 32 } },
          { price_floor: { level: 68 } },
        ],
      },
      // elasticity < 1 shrinks a curve's x-run about the equilibrium, so the
      // curve no longer reaches the price axis — the case the identity was
      // blind to until it was swept here.
      {
        name: "inelastic demand (0.5)",
        ctx: { demand: { elasticity: 0.5 } },
        // the ceiling case traded LEFT of where demand exists — 2-point
        // zero-area "regions" before the fix
        cases: [{ tax: { amount: 18 } }, { tax: { amount: -18 } }, { price_ceiling: { level: 32 } }],
      },
      {
        name: "perfectly inelastic demand",
        ctx: { demand: { elasticity: "perfectly_inelastic" } },
        cases: [{ tax: { amount: 18 } }, { price_ceiling: { level: 32 } }],
      },
      // the mirror: an inelastic SUPPLY with a binding floor
      {
        name: "inelastic supply (0.5)",
        ctx: { supply: { elasticity: 0.5 } },
        cases: [{ tax: { amount: 18 } }, { price_floor: { level: 68 } }],
      },
      // The case that proves the left edge must be SHARED rather than taken
      // per curve: with different elasticities the two curves start at
      // different x, so per-region edges would stop the areas tiling one
      // interval and the identity would not close.
      {
        name: "mixed elasticities (D 0.5, S 1.5)",
        ctx: { demand: { elasticity: 0.5 }, supply: { elasticity: 1.5 } },
        cases: [{ tax: { amount: 18 } }, { tax: { amount: -18 } }, { price_ceiling: { level: 32 } }],
      },
      {
        name: "mixed elasticities (D 1.5, S 0.5)",
        ctx: { demand: { elasticity: 1.5 }, supply: { elasticity: 0.5 } },
        cases: [{ tax: { amount: 18 } }, { price_floor: { level: 68 } }],
      },
      // The narrowest traded span in the sweep: no curve sample lands
      // between the shared left edge and Q, so a polygon that closes on its
      // last sample instead of on Q loses a big share of its own area (12 %
      // of base surplus, measured).
      {
        name: "perfectly inelastic demand, elastic supply",
        ctx: { demand: { elasticity: "perfectly_inelastic" }, supply: { elasticity: 1.5 } },
        cases: [{ price_floor: { level: 68 } }, { price_floor: { level: 90 } }],
      },
    ];
    for (const { name, ctx, cases } of contexts) {
      const base = layoutSupplyDemand({ ...ctx, regions: [...ALL_REGIONS] });
      const cs0 = polyArea(base, "cs_region");
      const ps0 = polyArea(base, "ps_region");
      // a context whose own baseline shades nothing would make every
      // comparison below 0 ≈ 0
      expect(cs0, `${name} baseline CS`).toBeGreaterThan(0);
      expect(ps0, `${name} baseline PS`).toBeGreaterThan(0);
      for (const c of cases) {
        const l = layoutSupplyDemand({ ...ctx, ...c, regions: [...ALL_REGIONS] });
        const dCS = polyArea(l, "cs_region") - cs0;
        const dPS = polyArea(l, "ps_region") - ps0;
        // the wedge is a TRANSFER out of the two surpluses for a tax, and INTO
        // them for a subsidy, so it enters the identity with the sign of the tax
        const wedge = polyArea(l, "wedge_region") * (c.tax && (c.tax.amount ?? 0) < 0 ? -1 : 1);
        const dwl = polyArea(l, "dwl_region");
        // RELATIVE tolerance: these are logical pixels squared, order 1e5, and
        // CS/PS are built from the 61-point curves while betweenRegion resamples
        // at 24 — an absolute tolerance would be tighter than the sampling. 2% of
        // total surplus still catches any sign error, wrong bound or missing region.
        const residual = Math.abs(dCS + dPS + wedge + dwl);
        expect(
          residual,
          `${name} / ${JSON.stringify(c)}: residual ${((residual / (cs0 + ps0)) * 100).toFixed(1)}% of base surplus`,
        ).toBeLessThan((cs0 + ps0) * 0.02);
      }
    }
  });

  // The identity above is algebraically blind to WHERE the common interval
  // starts, so it can only see this defect through the baseline comparison.
  // This pins the geometry itself: no region may close to the price axis
  // across ground no curve covers, and none may ship as a degenerate polygon.
  test("regions start where the curves do, not at the axis", () => {
    const l = layoutSupplyDemand({ demand: { elasticity: 0.5 }, tax: { amount: 18 }, regions: [...ALL_REGIONS] });
    // demand.elasticity 0.5 leaves demand defined over roughly [29.5, 68.5]
    // of the [2, 96] plot; supply still starts at D0 = 2, so the SHARED left
    // edge is demand's start.
    const dStart = l.curveSamples!["demand_curve"][0][0];
    const sStart = l.curveSamples!["supply_curve"][0][0];
    const qLeft = Math.max(dStart, sStart);
    expect(qLeft).toBeCloseTo(dStart, 6);
    // not vacuous: the shared edge is far to the right of the price axis
    expect(qLeft).toBeGreaterThan(plotArea().x0 + 100);
    for (const id of ["cs_region", "ps_region", "wedge_region"]) {
      const pts = areaPts(l, id);
      expect(pts.length, `${id} is a real polygon`).toBeGreaterThanOrEqual(3);
      expect(Math.min(...pts.map(([x]) => x)), `${id} left edge`).toBeCloseTo(qLeft, 6);
      // ...and that edge is an EDGE, not a corner: the polygon meets the
      // curve AT qLeft (two vertices there), rather than cutting the corner
      // off to the curve's first sample inside it.
      expect(
        pts.filter(([x]) => Math.abs(x - qLeft) < 1e-6).length,
        `${id} left edge is vertical`,
      ).toBeGreaterThanOrEqual(2);
    }

    // And when the traded quantity falls LEFT of that edge there is nothing
    // to shade at all — before the fix this shipped a 2-point, zero-area
    // "area" that rendered as a line.
    const ceiling = layoutSupplyDemand({
      demand: { elasticity: 0.5 },
      price_ceiling: { level: 32 },
      regions: [...ALL_REGIONS],
    });
    expect(ceiling.anchors["ceiling_line"]).toBeDefined(); // the control itself still draws
    const floor = layoutSupplyDemand({
      supply: { elasticity: 0.5 },
      price_floor: { level: 68 },
      regions: [...ALL_REGIONS],
    });
    expect(floor.anchors["floor_line"]).toBeDefined();
    for (const l2 of [ceiling, floor]) {
      for (const id of ["cs_region", "ps_region", "transfer_region", "wedge_region"]) {
        expect(ids(l2)).not.toContain(id);
      }
      // the whole of [qLeft, Q*] is deadweight loss instead, and it is drawn
      expect(polyArea(l2, "dwl_region")).toBeGreaterThan(0);
    }
  });

  // The RIGHT edge has the same failure mode as the left one, and only a
  // price control exposes it: under a tax the closing price IS the curve's
  // own value at Q_t, so the corner already sits on the curve, but a control
  // price does not lie on the short side's curve. The polygon then closed
  // with a chord from the last sample INSIDE the interval — worth up to 12 %
  // of total surplus when the interval is narrower than the sample spacing.
  test("a price control's surplus polygon meets the curve at Q, not at the last sample before it", () => {
    const l = layoutSupplyDemand({
      demand: { elasticity: "perfectly_inelastic" },
      supply: { elasticity: 1.5 },
      price_floor: { level: 68 },
      regions: [...ALL_REGIONS],
    });
    const supply = l.curveSamples!["supply_curve"];
    const qLeft = Math.max(l.curveSamples!["demand_curve"][0][0], supply[0][0]);
    const pf = l.anchors["floor_line"][1];
    const qd = solveForX(l.curveSamples!["demand_curve"], pf); // the short side sets Q
    if (qd === null) throw new Error("no traded quantity at the floor price");
    // Not vacuous: the traded span is narrower than the supply curve's own
    // sampling, so the cut corner was a large share of the region.
    expect(supply.filter(([x]) => x > qLeft && x < qd).length).toBeLessThanOrEqual(1);
    const pts = areaPts(l, "ps_region");
    expect(pts.filter(([x]) => Math.abs(x - qd) < 1e-6).length, "ps right edge is vertical").toBeGreaterThanOrEqual(2);
    // and the area is the honest trapezoid, rebuilt from the curve samples
    // rather than read back off the region
    const sLeft = interpolateAtX(supply, qLeft);
    const sRight = interpolateAtX(supply, qd);
    if (sLeft === null || sRight === null) throw new Error("supply does not span the traded interval");
    expect(polyArea(l, "ps_region")).toBeCloseTo((qd - qLeft) * (pf - (sLeft + sRight) / 2), 0);

    // ...while the FREE MARKET figure keeps exactly the vertices it always
    // had: every demand sample up to Q*, plus the closing corner and the
    // left-edge corner. Q* lands one ulp off the sample that sits on it, so
    // the two are near-identical but not identical — the de-duplication that
    // cleans up the corner fix must compare exactly, or it eats that
    // pre-existing vertex and shifts the label's centroid anchor.
    const free = layoutSupplyDemand({ regions: ["consumer_surplus"] });
    const onCurve = free.curveSamples!["demand_curve"].filter(([x]) => x <= free.anchors["equilibrium_point"][0]).length;
    // +3 since 2026-09-26: the areas start AT the price axis when the curves
    // only stop short of it by the margin, so the curve's straight
    // continuation adds one vertex there (Hans: the revenue stopped short).
    expect(areaPts(free, "cs_region").length).toBe(onCurve + 3);

    // And a TAX figure keeps its old vertex count too, from the other side:
    // there the closing corner IS the curve's value at Q_t — the same
    // interpolation, bit for bit — so the corner point the fix adds is the
    // corner that was already there and must not ship twice.
    const taxed = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["consumer_surplus"] });
    const qT = taxed.anchors["price_buyers_point"][0];
    const onCurveTaxed = taxed.curveSamples!["demand_curve"].filter(([x]) => x <= qT).length;
    expect(areaPts(taxed, "cs_region").length).toBe(onCurveTaxed + 3);
  });

  test("the wedge rectangle spans the two prices and ends at the traded quantity", () => {
    const l = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["government_revenue"] });
    const pb = l.anchors["price_buyers_point"];
    const ps = l.anchors["price_sellers_point"];
    // NB: `.pts` is not on every Drawable variant (TextDrawable has none), so
    // narrow before reading it — a bare `.find(...)!.pts` does not compile here.
    const wedge = flattenDrawables(l.drawables).find((d) => d.id === "wedge_region");
    if (!wedge || wedge.kind !== "area") throw new Error("wedge_region missing or not an area");
    const pts = wedge.pts;
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    // a true rectangle: its height IS the price gap and its right edge IS Q_t
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(Math.abs(pb[1] - ps[1]), 1);
    expect(Math.max(...xs)).toBeCloseTo(pb[0], 1);
    expect(polyArea(l, "wedge_region")).toBeCloseTo(
      (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)),
      0,
    );
  });

  // `area > 0` alone pins nothing: it survives both dropping the iv.kind
  // guard (a tax would also draw a bogus transfer) and swapping qTraded for
  // qStar in the rectangle's right edge. So the expected area is rebuilt
  // independently here — (P* − P_control) · (Q_short − D0) — from anchors
  // and curveSamples the regions block never touches, not read back off
  // transfer_region itself.
  test("a price control has no wedge, and its transfer rectangle is pinned to (P* − P_control)·(Q_short − 0)", () => {
    const expectedTransferArea = (l: SceneLayout, controlPriceLogical: number, shortSideCurve: "supply_curve" | "demand_curve") => {
      const pStarLogical = l.anchors["equilibrium_point"][1];
      // From the price axis (quantity 0) since 2026-09-26 — every unit traded.
      const d0Logical = l.frame!.box.x0;
      const qShortLogical = solveForX(l.curveSamples![shortSideCurve], controlPriceLogical);
      if (qShortLogical === null) throw new Error(`could not solve ${shortSideCurve} for the control price`);
      return Math.abs(pStarLogical - controlPriceLogical) * Math.abs(qShortLogical - d0Logical);
    };

    // Ceiling: the SHORT side is supply (less is supplied at the lower price).
    const ceiling = layoutSupplyDemand({ price_ceiling: { level: 32 }, regions: ["government_revenue", "transfer"] });
    expect(ids(ceiling)).not.toContain("wedge_region");
    const pc = ceiling.anchors["ceiling_line"][1];
    expect(polyArea(ceiling, "transfer_region")).toBeCloseTo(expectedTransferArea(ceiling, pc, "supply_curve"), 0);

    // Floor: the SHORT side is demand (less is demanded at the higher price).
    const floor = layoutSupplyDemand({ price_floor: { level: 68 }, regions: ["government_revenue", "transfer"] });
    expect(ids(floor)).not.toContain("wedge_region");
    // A tax asking for `transfer` gets none: both sides face DIFFERENT prices,
    // so the guard that lets a control through must exclude it — caught a
    // mutation that dropped the guard down to bare `want.has("transfer")`.
    expect(ids(layoutSupplyDemand({ tax: { amount: 18 }, regions: ["transfer"] }))).not.toContain("transfer_region");
    const pf = floor.anchors["floor_line"][1];
    expect(polyArea(floor, "transfer_region")).toBeCloseTo(expectedTransferArea(floor, pf, "demand_curve"), 0);
  });

  test("consumer surplus follows the intervention rather than the free market", () => {
    const free = layoutSupplyDemand({ regions: ["consumer_surplus"] });
    const taxed = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["consumer_surplus"] });
    expect(polyArea(taxed, "cs_region")).toBeLessThan(polyArea(free, "cs_region") * 0.95);
  });

  test("a subsidy costs the government more than the two sides gain", () => {
    const base = layoutSupplyDemand({ regions: [...ALL_REGIONS] });
    const sub = layoutSupplyDemand({ tax: { amount: -18 }, regions: [...ALL_REGIONS] });
    const gain =
      polyArea(sub, "cs_region") - polyArea(base, "cs_region") +
      (polyArea(sub, "ps_region") - polyArea(base, "ps_region"));
    expect(polyArea(sub, "wedge_region")).toBeGreaterThan(gain);
  });

  test("every combination stays inside the logical canvas", () => {
    // spec §10.8 — replaces the narrower pre-existing bounds test
    const combos: SupplyDemandParams[] = [
      { tax: { amount: 18 }, regions: [...ALL_REGIONS] },
      { tax: { amount: -40 }, regions: [...ALL_REGIONS] },
      { tax: { amount: 200, kind: "ad_valorem" }, regions: [...ALL_REGIONS] },
      { tax: { amount: 18, side: "buyer" }, regions: [...ALL_REGIONS] },
      { price_ceiling: { level: 4 }, regions: [...ALL_REGIONS] },
      { price_floor: { level: 94 }, regions: [...ALL_REGIONS] },
      { demand: { elasticity: 0.06 }, supply: { elasticity: 1.94 }, tax: { amount: 18 }, regions: [...ALL_REGIONS] },
      { demand: { elasticity: 1.94 }, supply: { elasticity: 0.06 }, tax: { amount: 18 }, regions: [...ALL_REGIONS] },
    ];
    for (const c of combos) {
      for (const d of flattenDrawables(layoutSupplyDemand(c).drawables)) {
        if (d.kind !== "stroke" && d.kind !== "area") continue;
        for (const [x, y] of d.pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS.w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(CANVAS.h);
        }
      }
    }
  });

  test("a tax outranks a price control set alongside it (tax > ceiling > floor)", () => {
    // Task 3 coded this precedence but nothing consumed `iv` downstream yet, so
    // it has been unverifiable until now. This is where it gets pinned.
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1);
    const taxOnly = layoutSupplyDemand({ tax: { amount: 18 }, regions: ["consumer_surplus"] });
    const ceilingOnly = layoutSupplyDemand({ price_ceiling: { level: 32 }, regions: ["consumer_surplus"] });
    const both = layoutSupplyDemand({
      tax: { amount: 18 },
      price_ceiling: { level: 32 },
      regions: ["consumer_surplus"],
    });
    // the ceiling still draws its line...
    expect(ids(both)).toContain("ceiling_line");
    // ...but the welfare maths is the TAX's, not the ceiling's
    expect(rel(polyArea(both, "cs_region"), polyArea(taxOnly, "cs_region"))).toBeLessThan(0.001);
    // and the two interventions genuinely differ, so the check above is not vacuous
    expect(rel(polyArea(taxOnly, "cs_region"), polyArea(ceilingOnly, "cs_region"))).toBeGreaterThan(0.01);

    // ceiling > floor: with both binding at once, the ceiling (processed
    // first) claims `iv` and the floor block's `iv.kind === "none"` guard
    // never fires.
    const floorOnly = layoutSupplyDemand({ price_floor: { level: 68 }, regions: ["consumer_surplus"] });
    const ceilingAndFloor = layoutSupplyDemand({
      price_ceiling: { level: 32 },
      price_floor: { level: 68 },
      regions: ["consumer_surplus"],
    });
    // the floor still draws its line...
    expect(ids(ceilingAndFloor)).toContain("floor_line");
    // ...but the welfare maths is the CEILING's, not the floor's
    expect(rel(polyArea(ceilingAndFloor, "cs_region"), polyArea(ceilingOnly, "cs_region"))).toBeLessThan(0.001);
    // and the two interventions genuinely differ, so the check above is not vacuous
    expect(rel(polyArea(ceilingOnly, "cs_region"), polyArea(floorOnly, "cs_region"))).toBeGreaterThan(0.01);
  });

  test("the wedge is labelled a cost when the tax is negative", () => {
    const sub = layoutSupplyDemand({ tax: { amount: -18 }, regions: ["government_revenue"] });
    expect(sub.labels.find((l) => l.id === "label_wedge")!.text).toMatch(/cost/i);
  });
});
