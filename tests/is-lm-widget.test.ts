// is_lm's free-play body (2026-09-27): paused, the viewer drags IS or LM and
// the equilibrium recomputes under the pointer. The body lives in the pack
// document (macro.yaml `widget:`), `free_play: true` — so it answers no ask.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { paramNamesOf } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";
import type { Pt } from "../src/layout/model";
import type { WidgetBody, WidgetScene } from "../src/scenes/widget-types";

beforeAll(async () => {
  await ensureEnabledPacks(["macro"]);
});

const mod = () => scenes["is_lm"];
const sceneOf = (params: Record<string, unknown>): WidgetScene => buildWidgetScene(mod(), params)!;
/** The logical point `t` of the way along a part's first stroke (its curve). */
const along = (sc: WidgetScene, id: string, t: number): Pt => {
  const pts = sc.lines.get(id)![0];
  return pts[Math.round(t * (pts.length - 1))];
};
/** Logical p moved by (dY, dr) domain units. */
const by = (sc: WidgetScene, p: Pt, dY: number, dr: number): Pt => {
  const [x0, y0] = sc.toLogical([0, 0]);
  const [x1, y1] = sc.toLogical([dY, dr]);
  return [p[0] + x1 - x0, p[1] + y1 - y0];
};
/** The body's effects for one live drag of `id` from `from` to `to`. */
function drag(params: Record<string, unknown>, id: string, from: Pt, to: Pt, state: unknown = { said: null }) {
  const sc = sceneOf(params);
  const body = mod().widget!();
  return stepWidget(body, state, dragMoveEvent(id, from, to, sc), sc, paramNamesOf(mod()));
}
const patchOf = (r: ReturnType<typeof drag>) => Object.assign({}, ...r.effects.filter((e) => e.patch).map((e) => e.patch));
// The layout's own lines.
const isR = (Y: number, s: number) => 9 - 0.08 * (Y - s);
const lmR = (Y: number, s: number) => 0.5 + 0.07 * (Y - s);

describe("is_lm: the document carries a free-play live body", () => {
  test("a live body with named parts; no manifest widget flag (free play answers no ask)", () => {
    const body: WidgetBody = mod().widget!();
    expect(body.live).toBe(true);
    expect(body.parts).toEqual(["is_shifted", "lm_shifted", "is_curve", "lm_curve"]);
    expect(mod().manifest.widget).toBeUndefined();
  });

  test("a press on a curve takes it; blank paper and the axes do not", () => {
    const sc = sceneOf({});
    const body = mod().widget!();
    expect(partAt(sc, along(sc, "is_curve", 0.3), 18, body.parts)).toBe("is_curve");
    expect(partAt(sc, along(sc, "lm_curve", 0.7), 18, body.parts)).toBe("lm_curve");
    expect(partAt(sc, sc.toLogical([20, 0.6]), 18, body.parts)).toBeNull();
  });
});

describe("is_lm: a drag's patch", () => {
  test("the middle of IS dragged right pulls IS′ off it: fiscal expansion", () => {
    const sc = sceneOf({});
    const from = along(sc, "is_curve", 0.5);
    const r = drag({}, "is_curve", from, by(sc, from, 12, 0));
    expect(r.errors).toEqual([]);
    expect(patchOf(r).is_shift).toBeCloseTo(12, 1);
    expect(r.effects.some((e) => e.caption === "Shifting IS: fiscal policy")).toBe(true);
  });

  test("the curve follows the pointer: the shifted IS passes under it, whichever way it moved", () => {
    const sc = sceneOf({});
    const from = along(sc, "is_curve", 0.4);
    for (const [dY, dr] of [[8, 0], [0, 1], [5, -0.5], [-6, 0.3]] as const) {
      const to = by(sc, from, dY, dr);
      const s = patchOf(drag({}, "is_curve", from, to)).is_shift as number;
      const [Y, r] = sc.toDomain(to)!;
      expect(Math.abs(isR(Y, s) - r)).toBeLessThan(0.02);
    }
  });

  test("LM shifts the same way, and says it is monetary policy", () => {
    const sc = sceneOf({});
    const from = along(sc, "lm_curve", 0.5);
    const to = by(sc, from, -10, 0);
    const r = drag({}, "lm_curve", from, to);
    const s = patchOf(r).lm_shift as number;
    expect(s).toBeCloseTo(-10, 1);
    const [Y, rr] = sc.toDomain(to)!;
    expect(Math.abs(lmR(Y, s) - rr)).toBeLessThan(0.02);
    expect(r.effects.some((e) => e.caption === "Shifting LM: monetary policy")).toBe(true);
  });

  test("IS′ moves on from where it is; the original pulls a fresh copy from zero", () => {
    const params = { is_shift: 20 };
    const sc = sceneOf(params);
    const fromCopy = along(sc, "is_shifted", 0.3);
    expect(patchOf(drag(params, "is_shifted", fromCopy, by(sc, fromCopy, 5, 0))).is_shift).toBeCloseTo(25, 1);
    const fromOrig = along(sc, "is_curve", 0.3);
    expect(patchOf(drag(params, "is_curve", fromOrig, by(sc, fromOrig, 5, 0))).is_shift).toBeCloseTo(5, 1);
  });

  test("a press on IS′'s arrow tail — on the original — means the original", () => {
    const params = { is_shift: 20 };
    const sc = sceneOf(params);
    const arrowTail = sc.lines.get("is_shifted")![1][0];
    const r = drag(params, "is_shifted", arrowTail, by(sc, arrowTail, 4, 0));
    expect(patchOf(r).is_shift).toBeCloseTo(4, 1);
  });

  test("shifts clamp to the documented ±30", () => {
    const sc = sceneOf({});
    const from = along(sc, "is_curve", 0.5);
    expect(patchOf(drag({}, "is_curve", from, by(sc, from, 90, 0))).is_shift).toBe(30);
    expect(patchOf(drag({}, "is_curve", from, by(sc, from, -90, 0))).is_shift).toBe(-30);
  });

  test("the caption is said once per gesture, not once a frame", () => {
    const sc = sceneOf({});
    const from = along(sc, "is_curve", 0.5);
    const r = drag({}, "is_curve", from, by(sc, from, 3, 0), { said: "is" });
    expect(r.effects.some((e) => e.caption !== undefined)).toBe(false);
  });

  test("taps, keys and parts it does not own pass through untouched", () => {
    const sc = sceneOf({});
    const body = mod().widget!();
    const names = paramNamesOf(mod());
    const tap = stepWidget(body, { said: null }, { type: "click", id: "is_curve", point: along(sc, "is_curve", 0.5), domain: null }, sc, names);
    expect(tap.effects).toEqual([]);
    const other = stepWidget(body, { said: null }, dragMoveEvent("axes", [200, 200], [260, 200], sc), sc, names);
    expect(other.effects).toEqual([]);
  });
});

describe("is_lm: live recompute and values", () => {
  test("a drag sequence through the harness moves the new equilibrium right and up (crowding out)", () => {
    const sc = sceneOf({});
    const from = along(sc, "is_curve", 0.5);
    const run = runWidget(mod(), {}, [dragMoveEvent("is_curve", from, by(sc, from, 20, 0), sc)]);
    expect(run.errors).toEqual([]);
    expect(run.params.is_shift).toBeCloseTo(20, 1);
    const v = mod().layout!(run.params).values!;
    expect(v.output_new).toBeGreaterThan(v.output);
    // Crowding out: output rises by less than the shift.
    expect(v.output_new - v.output).toBeLessThan(20);
    expect(v.rate_new).toBeGreaterThan(v.rate);
  });

  test("values are the equilibrium the layout draws; {is_lm.output} reads them in cast text", () => {
    const v = mod().layout!({}).values!;
    expect(v.output).toBeCloseTo(8.5 / 0.15, 1);
    expect(v.rate).toBeCloseTo(isR(8.5 / 0.15, 0), 1);
    expect(v.output_new).toBeUndefined();
    const spec = {
      title: "t",
      template: "is_lm",
      params: { is_shift: 20 },
      elements: [{ id: "note", type: "text", text: "Y = {is_lm.output_new:0}", at: { x: 800, y: 700 } }],
      commands: [{ draw: ["is_curve", "note"] }],
    } as unknown as Spec;
    const lay = layoutSpec(spec);
    const texts = JSON.stringify(lay.drawables);
    expect(texts).toContain("Y = 67");
  });

  test("an explore beat naming nothing counts the body as something to do; an ask may not bind to it", () => {
    // tray.ts counts the BODY (scenes[t].widget), not the manifest flag.
    expect(scenes["is_lm"].widget).toBeDefined();
    const ask = lintCommands({ title: "t", template: "is_lm", params: {}, commands: [{ ask: { question: "?", widget: "is_lm", answer: "x" } }] } as unknown as Spec);
    expect(ask.some((i) => i.rule === "widget" && /free play only/.test(i.message))).toBe(true);
  });
});
