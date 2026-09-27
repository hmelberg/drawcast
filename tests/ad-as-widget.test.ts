// ad_as's free-play body (2026-09-27): paused, the viewer drags AD or AS — a
// demand or a supply shock — and the equilibrium recomputes under the
// pointer. The body lives in the pack document (macro.yaml `widget:`),
// `free_play: true`. The host half runs here too: a DOCUMENT's live body
// takes the same live path as supply_demand's built-in one.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene, paramNamesOf } from "../src/scenes/widget-scene";
import { dragMoveEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
import { INITIAL_STATE, type Plan } from "../src/render/plan";
import type { RenderHandle } from "../src/render";
import type { Pt } from "../src/layout/model";
import type { WidgetScene } from "../src/scenes/widget-types";

beforeAll(async () => {
  await ensureEnabledPacks(["macro"]);
});

const mod = () => scenes["ad_as"];
const sceneOf = (params: Record<string, unknown>): WidgetScene => buildWidgetScene(mod(), params)!;
const along = (sc: WidgetScene, id: string, t: number): Pt => {
  const pts = sc.lines.get(id)![0];
  return pts[Math.round(t * (pts.length - 1))];
};
const by = (sc: WidgetScene, p: Pt, dx: number, dy: number): Pt => {
  const [x0, y0] = sc.toLogical([0, 0]);
  const [x1, y1] = sc.toLogical([dx, dy]);
  return [p[0] + x1 - x0, p[1] + y1 - y0];
};
function drag(params: Record<string, unknown>, id: string, from: Pt, to: Pt, state: unknown = { said: null }) {
  const sc = sceneOf(params);
  return stepWidget(mod().widget!(), state, dragMoveEvent(id, from, to, sc), sc, paramNamesOf(mod()));
}
const shiftOf = (r: ReturnType<typeof drag>) => r.effects.find((e) => e.patch)?.patch?.shift as { curve: string; direction: string; amount: number } | undefined;

describe("ad_as: the document carries a free-play live body", () => {
  test("live, named parts, no manifest widget flag", () => {
    const body = mod().widget!();
    expect(body.live).toBe(true);
    expect(body.parts).toEqual(["ad_shifted", "as_shifted", "ad", "as"]);
    expect(mod().manifest.widget).toBeUndefined();
  });

  test("a press takes the curve under it; the LRAS guide and blank paper stay the card's", () => {
    const sc = sceneOf({ show_lras: true });
    const parts = mod().widget!().parts;
    expect(partAt(sc, along(sc, "ad", 0.2), 18, parts)).toBe("ad");
    expect(partAt(sc, along(sc, "as", 0.8), 18, parts)).toBe("as");
    expect(partAt(sc, sc.toLogical([50, 90]), 18, parts)).toBeNull();
  });
});

describe("ad_as: a drag's patch", () => {
  test("AD dragged right: a demand shock — AD′ pulled off AD, and it passes under the pointer", () => {
    const sc = sceneOf({});
    const from = along(sc, "ad", 0.3);
    const to = by(sc, from, 10, 2);
    const r = drag({}, "ad", from, to);
    expect(r.errors).toEqual([]);
    const s = shiftOf(r)!;
    expect(s.curve).toBe("ad");
    expect(s.direction).toBe("right");
    expect(s.amount).toBeCloseTo(12, 1);
    // AD′: y = 100 - (x - dx)
    const [x, y] = sc.toDomain(to)!;
    expect(Math.abs(100 - (x - s.amount) - y)).toBeLessThan(0.1);
    expect(r.effects.some((e) => e.caption === "Shifting AD: a demand shock")).toBe(true);
  });

  test("AS dragged left: a supply shock, direction left", () => {
    const sc = sceneOf({});
    const from = along(sc, "as", 0.5);
    const s = shiftOf(drag({}, "as", from, by(sc, from, -8, 0)))!;
    expect(s).toEqual({ curve: "as", direction: "left", amount: 8 });
  });

  test("the shifted copy moves on from where it is, keeping the sign through zero", () => {
    const params = { shift: { curve: "ad", direction: "right", amount: 10 } };
    const sc = sceneOf(params);
    const from = along(sc, "ad_shifted", 0.5);
    expect(shiftOf(drag(params, "ad_shifted", from, by(sc, from, 5, 0)))).toEqual({ curve: "ad", direction: "right", amount: 15 });
    expect(shiftOf(drag(params, "ad_shifted", from, by(sc, from, -16, 0)))).toEqual({ curve: "ad", direction: "left", amount: 6 });
  });

  test("taking hold of the OTHER original swaps which curve is shifted", () => {
    const params = { shift: { curve: "ad", direction: "right", amount: 10 } };
    const sc = sceneOf(params);
    const from = along(sc, "as", 0.5);
    expect(shiftOf(drag(params, "as", from, by(sc, from, 4, 0)))).toEqual({ curve: "as", direction: "right", amount: 4 });
  });

  test("the shift clamps to the documented 0–30 each way", () => {
    const sc = sceneOf({});
    const from = along(sc, "ad", 0.5);
    expect(shiftOf(drag({}, "ad", from, by(sc, from, 80, 0)))!.amount).toBe(30);
    expect(shiftOf(drag({}, "ad", from, by(sc, from, -80, 0)))).toEqual({ curve: "ad", direction: "left", amount: 30 });
  });

  test("taps and other parts pass through", () => {
    const sc = sceneOf({});
    const body = mod().widget!();
    const names = paramNamesOf(mod());
    expect(stepWidget(body, { said: null }, { type: "click", id: "ad", point: along(sc, "ad", 0.5), domain: null }, sc, names).effects).toEqual([]);
    expect(stepWidget(body, { said: null }, dragMoveEvent("eq", [300, 300], [340, 300], sc), sc, names).effects).toEqual([]);
  });
});

describe("ad_as: live recompute and values", () => {
  test("a supply shock (AS left) through the harness: prices up, output down — stagflation", () => {
    const sc = sceneOf({ show_lras: true });
    const from = along(sc, "as", 0.5);
    const run = runWidget(mod(), { show_lras: true }, [dragMoveEvent("as", from, by(sc, from, -12, 0), sc)]);
    expect(run.errors).toEqual([]);
    const v = mod().layout!(run.params).values!;
    expect(v.output).toBe(50);
    expect(v.price).toBe(50);
    expect(v.output_new).toBeCloseTo(44, 1);
    expect(v.price_new).toBeCloseTo(56, 1);
    expect(v.gap).toBeCloseTo(-6, 1);
  });

  test("no gap without the LRAS; no _new without a shift", () => {
    const v = mod().layout!({}).values!;
    expect(v).toEqual({ output: 50, price: 50 });
  });
});

// ---- the host: a document's live body ------------------------------------

function fakePlan(visible: string[]): Plan {
  return { steps: [], states: [{ ...INITIAL_STATE, visible }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
}

describe("the host drives a DOCUMENT's live body like a built-in's", () => {
  test("press, move, release: previewParams per frame, one caption, a tap passes through", () => {
    const spec = { template: "ad_as", params: {}, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const calls: string[] = [];
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => calls.push(`preview ${JSON.stringify(o)}`),
      paintedLayout: () => null,
      glow: async () => undefined,
      tapAt: async () => undefined,
      caption: (t: string | null) => calls.push(`caption ${t}`),
      getParamOverrides: () => ({}),
    };
    const hd = { spec, layout, plan: fakePlan(layout.order), timeline } as unknown as RenderHandle;
    const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined) })!;
    expect(host.live).toBe(true);
    // The scene as the host sees it: the laid-out page, fit and all.
    const sc = buildWidgetScene(mod(), {}, { layout })!;
    const from = along(sc, "ad", 0.3);
    expect(host.grabbable(from)).toBe(true);
    expect(host.over(from)).toBe(false);
    expect(host.press(from)).toBe(true);
    host.move(by(sc, from, 5, 0));
    host.move(by(sc, from, 9, 0));
    const previews = calls.filter((c) => c.startsWith("preview"));
    expect(previews).toHaveLength(2);
    expect(previews[1]).toContain('"shift":{"curve":"ad","direction":"right","amount":9}');
    expect(calls.filter((c) => c.startsWith("caption"))).toEqual(["caption Shifting AD: a demand shock"]);
    expect(host.release(by(sc, from, 9, 0))).toBe("drag");
    const tapAt = along(sc, "as", 0.5);
    const before = calls.length;
    host.press(tapAt);
    expect(host.release(tapAt)).toBe("pass");
    expect(calls.length).toBe(before);
  });
});

describe("ad_as: every figure a drag can reach is lint-clean", () => {
  const lintAt = (params: Record<string, unknown>): string[] => {
    const l = layoutSpec({ title: "t", template: "ad_as", params, commands: [] } as unknown as RenderHandle["spec"]);
    return [...l.warnings, ...l.issues.map((i) => `[${i.severity}] ${i.message}`)];
  };
  test.each(["ad", "as"])("%s shifted across its range, with and without the LRAS", (curve) => {
    for (const d of [-30, -14, -3, 0, 3, 14, 30])
      for (const show_lras of [false, true]) {
        expect(lintAt({ shift: { curve, direction: d < 0 ? "left" : "right", amount: Math.abs(d) }, show_lras })).toEqual([]);
      }
  });
});
