// supply_demand's live drags (Hans 2026-09-26): the body's gesture → patch
// mapping, the curve hit by DISTANCE, and the host's live-drag path — with
// the other widgets' release-time drags left exactly as they were.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { exploreSurface } from "../src/ui/tray-model";
import type { Spec } from "../src/spec/types";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { SD_PARTS, dragPatch, supplyDemandWidget } from "../src/scenes/supply_demand/widget";
import { layoutSupplyDemand, type SupplyDemandParams } from "../src/scenes/supply_demand/layout";
import { interpolateAtX } from "../src/layout/curves";
import { nearestLine, pointInRing, polylineDistance } from "../src/ui/hit";
import { widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
import { INITIAL_STATE, type Plan } from "../src/render/plan";
import type { RenderHandle } from "../src/render";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";

const module = scenes["supply_demand"];
const sceneOf = (params: SupplyDemandParams): WidgetScene => buildWidgetScene(module, params as Record<string, unknown>)!;

/** The logical point `t` of the way along a part's drawn stroke. */
function along(sc: WidgetScene, id: string, t: number): Pt {
  const pts = sc.lines.get(id)![0];
  return pts[Math.round(t * (pts.length - 1))];
}
/** Logical p moved by (dq, dp) domain units. */
function by(sc: WidgetScene, p: Pt, dq: number, dp: number): Pt {
  const [x0, y0] = sc.toLogical([0, 0]);
  const [x1, y1] = sc.toLogical([dq, dp]);
  return [p[0] + x1 - x0, p[1] + y1 - y0];
}
/** The patch a drag of part `id` from logical `from` to `to` makes. */
function drag(params: SupplyDemandParams, id: string, from: Pt, to: Pt): Record<string, unknown> | null {
  const sc = sceneOf(params);
  return dragPatch(id, from, sc.toDomain(from)!, sc.toDomain(to)!, sc)?.patch ?? null;
}
/** A curve of the laid-out figure, in domain units. */
function domainCurve(params: SupplyDemandParams, id: string): Pt[] {
  const lay = layoutSupplyDemand(params);
  const f = lay.frame!;
  return lay.curveSamples![id].map(([x, y]): Pt => [((x - f.box.x0) / (f.box.x1 - f.box.x0)) * 100, ((y - f.box.y0) / (f.box.y1 - f.box.y0)) * 100]);
}

describe("the body: a drag's patch", () => {
  test("the scene reads the pointer in the template's own 0–100 domain (no spec domain needed)", () => {
    const sc = sceneOf({});
    const p = sc.toLogical([30, 70]);
    expect(sc.toDomain(p)![0]).toBeCloseTo(30, 6);
    expect(sc.toDomain(p)![1]).toBeCloseTo(70, 6);
  });

  test("a bare market: the middle of D pulls a shifted copy D′ off it; D stays as the reference", () => {
    const sc = sceneOf({});
    const from = along(sc, "demand_curve", 0.5);
    const patch = drag({}, "demand_curve", from, by(sc, from, 12, 0))!;
    expect(Object.keys(patch)).toEqual(["demand_shift"]);
    expect((patch.demand_shift as { amount: number }).amount).toBeCloseTo(12, 1);
  });

  test("…and the same for supply, leftwards", () => {
    const sc = sceneOf({});
    const from = along(sc, "supply_curve", 0.5);
    const patch = drag({}, "supply_curve", from, by(sc, from, -8, 3))!;
    expect((patch.supply_shift as { amount: number }).amount).toBeCloseTo(-8, 1);
  });

  test("dragging D′ moves it on from where it is, keeping its label and arrow", () => {
    const params: SupplyDemandParams = { demand_shift: { amount: 20, label: "D₂", arrow: "vertical" } };
    const sc = sceneOf(params);
    const from = along(sc, "demand_shift_curve", 0.5);
    const patch = drag(params, "demand_shift_curve", from, by(sc, from, 10, 0))!;
    expect(patch.demand_shift).toEqual({ amount: 30, label: "D₂", arrow: "vertical" });
  });

  test("with a tax on the figure, D ITSELF moves (its offset): the regions read off it", () => {
    const params: SupplyDemandParams = { tax: { amount: 18 }, regions: ["deadweight_loss"] };
    const sc = sceneOf(params);
    const from = along(sc, "demand_curve", 0.5);
    const patch = drag(params, "demand_curve", from, by(sc, from, 10, 0))!;
    expect(Object.keys(patch)).toEqual(["demand"]);
    expect((patch.demand as { offset: number }).offset).toBeCloseTo(10, 1);
    // and the market it describes really moved: more is traded
    const before = domainCurve(params, "demand_curve");
    const after = domainCurve({ ...params, ...(patch as SupplyDemandParams) }, "demand_curve");
    expect(interpolateAtX(after, 50)!).toBeGreaterThan(interpolateAtX(before, 50)!);
  });

  test("near an end, D turns about the equilibrium — and the new curve passes under the pointer", () => {
    const sc = sceneOf({});
    const from = along(sc, "demand_curve", 0.06);
    // (Leftward only a little: the grab is at q ≈ 8, and the plot starts at 2.)
    for (const [dq, dp] of [[8, 0], [-4, 0], [0, -12], [15, -10]] as const) {
      const to = by(sc, from, dq, dp);
      const patch = drag({}, "demand_curve", from, to)!;
      const e = (patch.demand as { elasticity: number }).elasticity;
      expect(e).toBeGreaterThanOrEqual(0.06);
      expect(e).toBeLessThanOrEqual(1.94);
      const [q, p] = sc.toDomain(to)!;
      const curve = domainCurve(patch as SupplyDemandParams, "demand_curve");
      expect(Math.abs(interpolateAtX(curve, q)! - p)).toBeLessThan(1.5);
    }
    // Toward the pivot is steeper (less elastic); away is flatter.
    const steeper = drag({}, "demand_curve", from, by(sc, from, 8, 0))!.demand as { elasticity: number };
    const flatter = drag({}, "demand_curve", from, by(sc, from, -8, 0))!.demand as { elasticity: number };
    expect(steeper.elasticity).toBeLessThan(1);
    expect(flatter.elasticity).toBeGreaterThan(1);
  });

  test("a turn never moves the equilibrium, and it clamps to the documented range", () => {
    const sc = sceneOf({});
    const from = along(sc, "supply_curve", 0.95);
    // Dragged past the pivot's vertical: as steep as it goes.
    const patch = drag({}, "supply_curve", from, by(sc, from, -80, 0))!;
    expect((patch.supply as { elasticity: number }).elasticity).toBe(0.06);
    const eq = (p: SupplyDemandParams) => layoutSupplyDemand(p).anchors["equilibrium_point"];
    expect(eq(patch as SupplyDemandParams)[0]).toBeCloseTo(eq({})[0], 6);
  });

  test("the price ceiling follows the pointer up and down, from its drawn level", () => {
    const params: SupplyDemandParams = { price_ceiling: { level: 30, label: "Cap" } };
    const sc = sceneOf(params);
    const from = along(sc, "ceiling_line", 0.5);
    expect(drag(params, "ceiling_line", from, by(sc, from, 5, 10))!.price_ceiling).toEqual({ level: 40, label: "Cap" });
    expect((drag(params, "ceiling_line", from, by(sc, from, 0, 200))!.price_ceiling as { level: number }).level).toBe(96);
    // No level written: it starts from where the default line is drawn.
    const bare: SupplyDemandParams = { price_ceiling: {} };
    const sb = sceneOf(bare);
    const f2 = along(sb, "ceiling_line", 0.5);
    const level0 = sb.toDomain(f2)![1];
    expect((drag(bare, "ceiling_line", f2, by(sb, f2, 0, 5))!.price_ceiling as { level: number }).level).toBeCloseTo(level0 + 5, 1);
  });

  test("the floor too", () => {
    const params: SupplyDemandParams = { price_floor: { level: 70 } };
    const sc = sceneOf(params);
    const from = along(sc, "floor_line", 0.3);
    expect((drag(params, "floor_line", from, by(sc, from, 0, -6))!.price_floor as { level: number }).level).toBeCloseTo(64, 1);
  });

  test("the taxed curve: up raises a seller's tax, down raises a buyer's; ad valorem moves the curve to the pointer", () => {
    const seller: SupplyDemandParams = { tax: { amount: 18 }, regions: ["deadweight_loss"] };
    const s1 = sceneOf(seller);
    const f1 = along(s1, "tax_supply_curve", 0.5);
    expect((drag(seller, "tax_supply_curve", f1, by(s1, f1, 0, 7))!.tax as { amount: number }).amount).toBeCloseTo(25, 1);
    const buyer: SupplyDemandParams = { tax: { amount: 18, side: "buyer" } };
    const s2 = sceneOf(buyer);
    const f2 = along(s2, "tax_demand_curve", 0.5);
    expect((drag(buyer, "tax_demand_curve", f2, by(s2, f2, 0, -7))!.tax as { amount: number }).amount).toBeCloseTo(25, 1);
    const adv: SupplyDemandParams = { tax: { kind: "ad_valorem", amount: 36 } };
    const s3 = sceneOf(adv);
    const f3 = along(s3, "tax_supply_curve", 0.5);
    const to = by(s3, f3, 0, 6);
    const patch = drag(adv, "tax_supply_curve", f3, to)!;
    const [q, p] = s3.toDomain(to)!;
    expect(Math.abs(interpolateAtX(domainCurve({ ...adv, ...(patch as SupplyDemandParams) }, "tax_supply_curve"), q)! - p)).toBeLessThan(0.5);
  });

  test("the whole gesture, not a step: every frame maps press → pointer on the PRESS-time params", () => {
    const sc = sceneOf({});
    const from = along(sc, "demand_curve", 0.5);
    const body = supplyDemandWidget();
    let state = body.init(sc);
    const amounts: number[] = [];
    for (const dq of [3, 6, 9]) {
      const r = stepWidget(body, state, dragMoveEvent("demand_curve", from, by(sc, from, dq, 0), sc), sc, ["demand_shift"]);
      state = r.state;
      amounts.push((r.effects[0].patch!.demand_shift as { amount: number }).amount);
    }
    expect(amounts.map((a) => Math.round(a))).toEqual([3, 6, 9]);
  });

  test("the caption says what the drag does once, not once a frame; a click does nothing", () => {
    const run = runWidget(module, {}, [
      "demand_curve",
      dragMoveEvent("demand_curve", along(sceneOf({}), "demand_curve", 0.5), by(sceneOf({}), along(sceneOf({}), "demand_curve", 0.5), 4, 0), sceneOf({})),
    ]);
    expect(run.errors).toEqual([]);
    expect(run.effects[0]).toEqual([]);
    expect(run.effects[1].map((e) => e.caption).filter(Boolean)).toEqual(["Shifting demand"]);
  });
});

describe("hit by distance: a thin curve is grabbable, its box is not", () => {
  test("polylineDistance / nearestLine", () => {
    expect(polylineDistance([[0, 0], [100, 0]], [50, 12])).toBe(12);
    expect(polylineDistance([[0, 0], [100, 0]], [130, 0])).toBe(30);
    const lines = new Map<string, Pt[][]>([["a", [[[0, 0], [100, 0]]]], ["b", [[[0, 10], [100, 10]]]]]);
    expect(nearestLine(lines, [50, 8], 16)).toBe("b");
    expect(nearestLine(lines, [50, 40], 16)).toBeNull();
    // A tie goes to the id listed first.
    const same = new Map<string, Pt[][]>([["under", [[[0, 0], [100, 0]]]], ["over", [[[0, 0], [100, 0]]]]]);
    expect(nearestLine(same, [50, 5], 16, ["over", "under"])).toBe("over");
  });

  test("near the curve hits it; inside its (huge) box but far from the ink does not", () => {
    const sc = sceneOf({});
    const on = along(sc, "demand_curve", 0.3);
    expect(partAt(sc, [on[0] + 12, on[1]], 18, SD_PARTS)).toBe("demand_curve");
    // Inside demand's box (it spans the plot) — but 60 units from demand's
    // ink and 20 from supply's, in domain terms.
    const blank = sc.toLogical([20, 40]);
    const b = sc.boxes.get("demand_curve")!;
    expect(blank[0] > b.x && blank[0] < b.x + b.w && blank[1] > b.y && blank[1] < b.y + b.h).toBe(true);
    expect(partAt(sc, blank, 18, SD_PARTS)).toBeNull();
  });

  test("a surplus region keeps its card: its inside is not the widget's", () => {
    const params: SupplyDemandParams = { tax: { amount: 18 }, regions: ["consumer_surplus", "deadweight_loss"] };
    const sc = sceneOf(params);
    const inside = sc.toLogical([10, 72]);
    expect(pointInRing(sc.rings.get("cs_region")![0], inside)).toBe(true);
    expect(partAt(sc, inside, 18, SD_PARTS)).toBeNull();
  });

  test("D′ pulled out at amount 0 lies on D — the press takes D′, the one on top", () => {
    const params: SupplyDemandParams = { demand_shift: { amount: 0 } };
    const sc = sceneOf(params);
    expect(partAt(sc, along(sc, "demand_curve", 0.5), 18, SD_PARTS)).toBe("demand_shift_curve");
  });
});

// ---- the host: live drags -------------------------------------------------

function fakePlan(visible: string[]): Plan {
  return { steps: [], states: [{ ...INITIAL_STATE, visible }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
}

function sdHandle(params: SupplyDemandParams = {}) {
  const spec = { template: "supply_demand", params, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const calls: string[] = [];
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    previewParams: (o: Record<string, unknown>) => {
      painted = layoutSpec({ ...spec, params: { ...params, ...o } } as unknown as RenderHandle["spec"]);
      calls.push(`preview ${JSON.stringify(o)}`);
    },
    paintedLayout: () => painted,
    glow: async () => undefined,
    tapAt: async () => undefined,
    caption: (t: string | null) => calls.push(`caption ${t}`),
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, plan: fakePlan(layout.order), timeline } as unknown as RenderHandle;
  const nudges: string[] = [];
  const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), nudge: (id, dx, dy) => nudges.push(`${id} ${dx} ${dy}`) })!;
  return { host, calls, nudges, sc: sceneOf(params) };
}

describe("the host: a live body drags the figure itself", () => {
  test("a live host: the curve is grabbable but not 'over' (a tap on it stays the card's)", () => {
    const { host, sc } = sdHandle();
    const p = along(sc, "demand_curve", 0.5);
    expect(host.live).toBe(true);
    expect(host.grabbable(p)).toBe(true);
    expect(host.over(p)).toBe(false);
    expect(host.grabbable([5, 5])).toBe(false);
  });

  test("each move repaints the market through previewParams — no ghost — and the release lands the last word", () => {
    const { host, calls, nudges, sc } = sdHandle();
    const from = along(sc, "demand_curve", 0.5);
    expect(host.press(from)).toBe(true);
    host.move(by(sc, from, 5, 0));
    host.move(by(sc, from, 10, 0));
    expect(host.dragging()).toBe(true);
    const previews = calls.filter((c) => c.startsWith("preview"));
    expect(previews).toHaveLength(2);
    expect(previews[1]).toContain('"demand_shift":{"amount":10}');
    expect(calls.filter((c) => c.startsWith("caption"))).toEqual(["caption Shifting demand"]);
    expect(nudges).toEqual([]);
    expect(host.release(by(sc, from, 12, 0))).toBe("drag");
    expect(calls.at(-1)).toContain('"demand_shift":{"amount":12}');
  });

  test("a tap passes through: nothing runs, the caller lets the click go on", () => {
    const { host, calls, sc } = sdHandle();
    const p = along(sc, "supply_curve", 0.5);
    expect(host.press(p)).toBe(true);
    expect(host.release(p)).toBe("pass");
    expect(host.clickAt(p)).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a cancelled live drag puts back what was there before the press", () => {
    const { host, calls, sc } = sdHandle({ price_ceiling: { level: 30 } });
    const from = along(sc, "ceiling_line", 0.5);
    host.press(from);
    host.move(by(sc, from, 0, 10));
    host.cancel();
    expect(calls.filter((c) => c.startsWith("preview")).at(-1)).toBe("preview {}");
    expect(host.dragging()).toBe(false);
  });

  test("a second drag starts from the first one's result (patches accumulate across gestures)", () => {
    const { host, calls, sc } = sdHandle({ price_ceiling: { level: 30 } });
    const from = along(sc, "ceiling_line", 0.5);
    host.press(from);
    host.move(by(sc, from, 0, 10));
    host.release(by(sc, from, 0, 10));
    // the line is now drawn at 40: grab it there
    const sc2 = sceneOf({ price_ceiling: { level: 40 } });
    const from2 = along(sc2, "ceiling_line", 0.5);
    expect(host.press(from2)).toBe(true);
    host.move(by(sc2, from2, 0, 5));
    expect(calls.at(-1)).toContain('"level":45');
    host.release(by(sc2, from2, 0, 5));
  });

  test("the frame clock throttles: moves inside one frame paint once, with the latest point", () => {
    const spec = { template: "supply_demand", params: {}, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: string[] = [];
    const timeline = { state: "paused", position: 1, vars: new Map(), callbacks: {}, previewParams: (o: unknown) => previews.push(JSON.stringify(o)), paintedLayout: () => null, caption: () => undefined, getParamOverrides: () => ({}) };
    const hd = { spec, layout, plan: fakePlan(layout.order), timeline } as unknown as RenderHandle;
    let booked: (() => void) | null = null;
    const host = widgetHostFor(hd, { frame: (fn) => ((booked = fn), () => (booked = null)) })!;
    const sc = sceneOf({});
    const from = along(sc, "demand_curve", 0.5);
    host.press(from);
    host.move(by(sc, from, 4, 0));
    host.move(by(sc, from, 8, 0));
    expect(previews).toEqual([]);
    booked!();
    expect(previews).toHaveLength(1);
    expect(previews[0]).toContain('"amount":8');
  });
});

describe("wiring: free play, not an ask device", () => {
  test("supply_demand carries a body but no manifest `widget` flag (that flag offers asks)", () => {
    expect(module.widget).toBeDefined();
    expect(module.manifest.widget).toBeUndefined();
    expect(module.widget!().live).toBe(true);
  });

  test("an ask bound to supply_demand is a lint error that says it is free play", () => {
    const spec = { title: "t", template: "supply_demand", params: {}, commands: [{ ask: { question: "?", widget: "supply_demand", answer: "x" } }] } as unknown as Spec;
    const issues = lintCommands(spec).filter((i) => i.rule === "widget");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/free play only/);
  });

  test("an explore beat naming nothing counts the body as something to do ON the figure", () => {
    const tray = readFileSync("src/ui/tray.ts", "utf8");
    expect(tray).toContain("scenes[hd.spec.template]?.widget !== undefined");
    expect(exploreSurface({}, [], { onFigure: true, sliders: true })).toBe("shut");
  });

  test("the stage: a live tap lets its click through, a drag's click stands even the card's listener down", () => {
    const src = readFileSync("src/ui/widget-host.ts", "utf8");
    expect(src).toContain('if (read === "pass") swallowClick = false;');
    expect(src).toContain("if (swallowAll) e.stopImmediatePropagation();");
    // controls.ts attaches the widget host BEFORE the info cards — the order
    // stopImmediatePropagation relies on.
    const controls = readFileSync("src/ui/controls.ts", "utf8");
    expect(controls.indexOf("attachWidgetHost(stage, hd)")).toBeLessThan(controls.indexOf("attachInfoCards(stage, hd, widgetHost)"));
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".cs-stage.cs-draggable { cursor: grab; }");
    expect(css.indexOf(".cs-stage.cs-draggable {")).toBeLessThan(css.indexOf(".cs-stage.cs-grabbing,"));
  });
});
