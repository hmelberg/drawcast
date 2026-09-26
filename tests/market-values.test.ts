// supply_demand's computed values (SceneLayout.values), its readout panel and
// the `{market.<key>}` text tokens (Hans 2026-09-26: a deadweight-loss lesson
// where the viewer changes the market and SEES the numbers).
import { describe, expect, test } from "vitest";
import { layoutSupplyDemand, READOUT_KEYS } from "../src/scenes/supply_demand/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { setFigureLocale } from "../src/scenes/kit";
import { CANVAS, plotArea } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";

const units = { price: [0, 20] as [number, number], quantity: [0, 1000] as [number, number], price_unit: "kr", quantity_unit: "flats" };

describe("supply_demand values", () => {
  test("a free market: equilibrium in real units, no deadweight loss, CS + PS is the whole triangle", () => {
    const v = layoutSupplyDemand({ units }).values!;
    // The default straight curves cross at domain (49, 50).
    expect(v.price).toBeCloseTo(10, 6);
    expect(v.quantity).toBeCloseTo(490, 6);
    expect(v.dwl).toBeCloseTo(0, 6);
    expect(v.revenue).toBeUndefined();
    expect(v.shortage).toBeUndefined();
    // The default pair is a mirror image, so the two surpluses are equal.
    expect(v.cs).toBeGreaterThan(0);
    expect(v.cs).toBeCloseTo(v.ps, 3);
  });

  test("a per-unit tax: DWL is ½ · t · ΔQ, revenue is t · Q_traded, the wedge is the tax", () => {
    const free = layoutSupplyDemand({ units }).values!;
    const v = layoutSupplyDemand({ units, tax: { amount: 18 } }).values!;
    const t = 18 * 0.2; // 18 on the 0–100 price axis is 3.6 kr
    expect(v.price_buyers - v.price_sellers).toBeCloseTo(t, 6);
    expect(v.quantity_traded).toBeLessThan(free.quantity);
    expect(v.dwl).toBeCloseTo(0.5 * t * (free.quantity - v.quantity_traded), 3);
    expect(v.revenue).toBeCloseTo(t * v.quantity_traded, 3);
    // The welfare identity: what the tax did not take as revenue or destroy stays as surplus.
    expect(v.cs + v.ps + v.revenue + v.dwl).toBeCloseTo(free.cs + free.ps, 2);
  });

  test("a subsidy's revenue is negative (a cost), and it still has a deadweight loss", () => {
    const v = layoutSupplyDemand({ units, tax: { amount: -10 } }).values!;
    expect(v.revenue).toBeLessThan(0);
    expect(v.dwl).toBeGreaterThan(0);
  });

  test("a binding ceiling: qd > qs, the shortage is the gap, the traded quantity is qs", () => {
    const v = layoutSupplyDemand({ units, price_ceiling: { level: 30 } }).values!;
    expect(v.qd).toBeGreaterThan(v.qs);
    expect(v.shortage).toBeCloseTo(v.qd - v.qs, 6);
    expect(v.quantity_traded).toBeCloseTo(v.qs, 6);
    expect(v.price_buyers).toBeCloseTo(6, 6);
    expect(v.dwl).toBeGreaterThan(0);
    expect(v.transfer).toBeCloseTo((v.price - 6) * v.qs, 2);
  });

  test("a ceiling above equilibrium does not bind: the lines stay, at zero gap", () => {
    const v = layoutSupplyDemand({ units, price_ceiling: { level: 80 } }).values!;
    expect(v.shortage).toBe(0);
    expect(v.qd).toBeCloseTo(v.qs, 6);
    expect(v.dwl).toBeCloseTo(0, 6);
  });

  test("a binding floor: qs > qd, the surplus is the gap", () => {
    const v = layoutSupplyDemand({ units, price_floor: { level: 70 } }).values!;
    expect(v.qs).toBeGreaterThan(v.qd);
    expect(v.surplus).toBeCloseTo(v.qs - v.qd, 6);
    expect(v.shortage).toBeUndefined();
  });

  test("a single shift gives the new equilibrium", () => {
    const v = layoutSupplyDemand({ units, demand_shift: { amount: 15 } }).values!;
    expect(v.quantity_new).toBeGreaterThan(v.quantity);
    expect(v.price_new).toBeGreaterThan(v.price);
  });

  test("without units the values are on the raw 0–100 axes", () => {
    const v = layoutSupplyDemand({}).values!;
    expect(v.price).toBeCloseTo(50, 6);
    expect(v.quantity).toBeCloseTo(49, 6);
  });
});

describe("supply_demand readout", () => {
  const texts = (l: ReturnType<typeof layoutSupplyDemand>) =>
    flattenDrawables(l.drawables).filter((d): d is TextDrawable => d.kind === "text");

  test("one line per requested key, each its own id, all named by `readout`", () => {
    const keys = ["price_buyers", "price_sellers", "quantity_traded", "revenue", "dwl"];
    const l = layoutSupplyDemand({ units, tax: { amount: 18 }, readout: keys });
    expect(l.groups!.readout).toEqual(keys.map((k) => `readout_${k}`));
    for (const k of keys) expect(l.order).toContain(`readout_${k}`);
    const dwl = texts(l).find((t) => t.id === "readout_dwl_value")!;
    expect(dwl.text).toMatch(/ kr$/);
    expect(texts(l).find((t) => t.id === "readout_quantity_traded_value")!.text).toMatch(/ flats$/);
  });

  test("the numbers follow the params — the same ids, new text", () => {
    const a = layoutSupplyDemand({ units, tax: { amount: 0 }, readout: ["dwl"] });
    const b = layoutSupplyDemand({ units, tax: { amount: 18 }, readout: ["dwl"] });
    const val = (l: typeof a) => texts(l).find((t) => t.id === "readout_dwl_value")!.text;
    expect(val(a)).toBe("0 kr");
    expect(val(b)).not.toBe(val(a));
  });

  test("a key with no value right now keeps its line, with a dash; unknown keys are ignored", () => {
    const l = layoutSupplyDemand({ readout: ["shortage", "nonsense"] });
    expect(l.groups!.readout).toEqual(["readout_shortage"]);
    expect(texts(l).find((t) => t.id === "readout_shortage_value")!.text).toBe("—");
  });

  test("the panel gets rows above the plot, which gives up that height (not its width); without one the plot is untouched", () => {
    const plain = layoutSupplyDemand({ units, tax: { amount: 18 } });
    const l = layoutSupplyDemand({ units, tax: { amount: 18 }, readout: ["price_buyers", "price_sellers", "quantity_traded", "revenue", "dwl"] });
    expect(plain.frame!.box.y1).toBe(plotArea().y1);
    const box = l.frame!.box;
    // Full width kept — a column beside the plot made the market a tall strip (Hans 2026-09-26).
    expect(box.x0).toBe(plotArea().x0);
    expect(box.x1).toBe(plotArea().x1);
    expect(box.y1).toBeLessThan(plotArea().y1);
    const lines = texts(l).filter((t) => t.id.startsWith("readout_"));
    for (const t of lines) {
      // Above the plot, inside its width, clear of the y-axis name at the left, on the canvas.
      expect(t.pos[1]).toBeGreaterThan(box.y1);
      expect(t.pos[1]).toBeLessThanOrEqual(plotArea().y1 + 10);
      expect(t.pos[0]).toBeGreaterThan(box.x0 + 100);
      expect(t.pos[0]).toBeLessThanOrEqual(CANVAS.w);
    }
  });

  test("a Norwegian cast gets Norwegian names and a decimal comma", () => {
    setFigureLocale({ lang: "nb", decimalComma: true });
    try {
      const l = layoutSupplyDemand({ units, tax: { amount: 18 }, readout: ["dwl", "price_buyers"] });
      expect(texts(l).find((t) => t.id === "readout_dwl_name")!.text).toBe("Dødvektstap");
      expect(texts(l).find((t) => t.id === "readout_price_buyers_value")!.text).toMatch(/^\d+,\d+ kr$/);
    } finally {
      setFigureLocale({ lang: "en", decimalComma: false });
    }
  });

  test("every key has a line name", () => {
    const l = layoutSupplyDemand({ readout: [...READOUT_KEYS] });
    expect(l.groups!.readout).toHaveLength(READOUT_KEYS.length);
  });
});

describe("{market.<key>} tokens in a cast's own text", () => {
  test("resolve from the template's values, in the cast's number format", () => {
    const spec = {
      template: "supply_demand",
      params: { units, tax: { amount: 18 } },
      elements: [{ id: "note", type: "text", x: 500, y: 700, text: "DWL = {market.dwl:1} kr, P = {market.price}" }],
      commands: [],
    } as unknown as Spec;
    const l = layoutSpec(spec, heuristicMeasure);
    const v = layoutSupplyDemand({ units, tax: { amount: 18 } }).values!;
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable;
    expect(note.text).toBe(`DWL = ${v.dwl.toFixed(1)} kr, P = 10`);
  });

  test("an unknown value stays as written and warns", () => {
    const spec = {
      template: "supply_demand",
      params: {},
      elements: [{ id: "note", type: "text", x: 500, y: 700, text: "{market.nope}" }],
      commands: [],
    } as unknown as Spec;
    const l = layoutSpec(spec, heuristicMeasure);
    const note = flattenDrawables(l.drawables).find((d) => d.id === "note") as TextDrawable;
    expect(note.text).toBe("{market.nope}");
    expect(l.warnings.join(" ")).toMatch(/market\.nope/);
  });
});
