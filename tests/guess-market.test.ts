import { describe, expect, test } from "vitest";
import { directionOf, gapsOf, impliedEquilibrium, marketCurve, marketMove, marketRight, marketWhy, shapeOf, skOf } from "../src/guess/market";

const base = { demand: { steepness: "medium" }, supply: { steepness: "medium" }, tax: { amount: 0, side: "seller", kind: "per_unit" } };

describe("market handle", () => {
  test("what moves the curve", () => {
    expect(marketMove("supply_curve", base, { "tax.amount": 20 })).toEqual({ axis: "price", truthId: "tax_supply_curve" });
    expect(marketMove("demand_curve", { ...base, demand_shift: { amount: 0 } }, { "demand_shift.amount": 20 })).toEqual({ axis: "quantity", truthId: "demand_shift_curve" });
    expect(marketMove("supply_curve", base, { "supply.elasticity": 1.5 })).toEqual({ axis: "quantity", truthId: "supply_curve" });
    expect(typeof marketMove("demand_curve", base, { "tax.amount": 20 })).toBe("string"); // a seller tax does not move demand
  });

  test("per-unit tax: equal gaps, a shift up", () => {
    const m = marketCurve(base, { ...base, tax: { ...base.tax, amount: 20 } }, "supply_curve", { "tax.amount": 20 });
    if (typeof m === "string") throw new Error(m);
    expect(m.truth[0]).toBeCloseTo(m.truth[1], 0);
    expect(shapeOf(m.truth, 100)).toBe("shift");
    expect(directionOf(m.truth)).toBe(1);
  });

  test("percent tax: growing gaps, a turn", () => {
    const pct = { ...base, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
    const m = marketCurve(pct, { ...pct, tax: { ...pct.tax, amount: 40 } }, "supply_curve", { "tax.amount": 40 });
    if (typeof m === "string") throw new Error(m);
    expect(m.truth[1]).toBeGreaterThan(m.truth[0] * 1.3);
    expect(shapeOf(m.truth, 100)).toBe("turn");
  });

  test("(s, k) ↔ gaps round-trip; s and k reach the truth", () => {
    const pct = { ...base, tax: { amount: 0, side: "seller", kind: "ad_valorem" } };
    const m = marketCurve(pct, { ...pct, tax: { ...pct.tax, amount: 40 } }, "supply_curve", { "tax.amount": 40 }) as Exclude<ReturnType<typeof marketCurve>, string>;
    const { s, k } = skOf(m, m.truth);
    const v = gapsOf(m, s, k);
    expect(v[0]).toBeCloseTo(m.truth[0], 5);
    expect(v[1]).toBeCloseTo(m.truth[1], 5);
  });

  test("checks", () => {
    const m = marketCurve(base, { ...base, tax: { ...base.tax, amount: 20 } }, "supply_curve", { "tax.amount": 20 }) as Exclude<ReturnType<typeof marketCurve>, string>;
    const t = m.truth;
    const evenLow: [number, number] = [t[0] * 0.5, t[1] * 0.5];
    const turned: [number, number] = [t[0] * 0.3, t[1] * 1.6];
    const down: [number, number] = [-t[0], -t[1]];
    expect(marketRight(m, evenLow, "direction", 0.08)).toBe(true);
    expect(marketRight(m, evenLow, "shape", 0.08)).toBe(true);
    expect(marketRight(m, evenLow, "size", 0.08)).toBe(false);
    expect(marketRight(m, turned, "shape", 0.08)).toBe(false);
    expect(marketRight(m, down, "direction", 0.08)).toBe(false);
    expect(marketWhy(m, turned, "tax", false)).toMatch(/same amount/);
    expect(marketWhy(m, down, "tax", false)).toMatch(/moves up, not down/);
  });

  test("percent tax or subsidy: the why says steeper or flatter for the curve asked", () => {
    const why = (side: string, curve: string, amount: number, kind: "tax" | "subsidy") => {
      const pct = { ...base, tax: { amount: 0, side, kind: "ad_valorem" } };
      const m = marketCurve(pct, { ...pct, tax: { ...pct.tax, amount } }, curve, { "tax.amount": amount }) as Exclude<ReturnType<typeof marketCurve>, string>;
      const even = (m.truth[0] + m.truth[1]) / 2;
      return marketWhy(m, [even, even], kind, false);
    };
    // Sellers: price × (1 + a) — a tax steepens supply, a subsidy flattens it.
    expect(why("seller", "supply_curve", 40, "tax")).toMatch(/steeper/);
    expect(why("seller", "supply_curve", -20, "subsidy")).toMatch(/flatter/);
    // Buyers: price ÷ (1 + a) — a tax flattens demand, a subsidy steepens it.
    expect(why("buyer", "demand_curve", 40, "tax")).toMatch(/flatter/);
    expect(why("buyer", "demand_curve", -20, "subsidy")).toMatch(/steeper/);
  });

  test("a turn the wrong way (flatter for steeper, or steeper for flatter) is wrong under shape and size", () => {
    const pctOf = (side: string, curve: string) => {
      const pct = { ...base, tax: { amount: 0, side, kind: "ad_valorem" } };
      return marketCurve(pct, { ...pct, tax: { ...pct.tax, amount: 40 } }, curve, { "tax.amount": 40 }) as Exclude<ReturnType<typeof marketCurve>, string>;
    };
    // Sellers' percent tax: supply turns up and steeper (the far gap larger).
    const supply = pctOf("seller", "supply_curve");
    const t = supply.truth;
    const flatter: [number, number] = [t[1], t[0] * 0.5];
    expect(shapeOf(flatter, 100)).toBe("turn");
    expect(directionOf(flatter)).toBe(directionOf(t));
    expect(marketRight(supply, flatter, "direction", 0.08)).toBe(true);
    expect(marketRight(supply, flatter, "shape", 0.08)).toBe(false);
    expect(marketRight(supply, flatter, "size", 1)).toBe(false);
    expect(marketRight(supply, [t[0] * 0.9, t[1] * 1.1], "shape", 0.08)).toBe(true);
    expect(marketWhy(supply, flatter, "tax", false, "shape")).toBe("You turned it flatter. A percent tax adds more where prices are high, so the curve gets steeper.");
    // Buyers' percent tax: demand turns flatter; a steeper turn is the mirror.
    const demand = pctOf("buyer", "demand_curve");
    const d = demand.truth;
    const steeper: [number, number] = [d[1] * 0.5, d[0]];
    expect(shapeOf(steeper, 100)).toBe("turn");
    expect(marketRight(demand, steeper, "shape", 0.08)).toBe(false);
    expect(marketWhy(demand, steeper, "tax", false, "shape")).toBe("You turned it steeper. A percent tax takes more off where prices are high, so the curve gets flatter.");
  });

  test("implied equilibrium", () => {
    const e = impliedEquilibrium([[0, 0], [100, 100]], [[0, 100], [100, 0]]);
    expect(e![0]).toBeCloseTo(50);
    expect(e![1]).toBeCloseTo(50);
  });
});
