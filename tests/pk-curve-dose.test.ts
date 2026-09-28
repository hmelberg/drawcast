import { beforeAll, describe, expect, test } from "vitest";
import medicineYaml from "../src/scenes/packs/medicine.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import type { SceneLayout } from "../src/scenes/types";
import type { Spec } from "../src/spec/types";

const pk = (p: Record<string, unknown>) => scenes.pk_curve.layout!(p) as SceneLayout;
const leaf = (r: SceneLayout, id: string) => flattenDrawables(r.drawables).find((d) => d.id === id);
const curve = (r: SceneLayout) => (leaf(r, "curve") as StrokeDrawable).pts;
const ys = (r: SceneLayout) => curve(r).map((p) => p[1]);

beforeAll(() => registerPack("medicine", medicineYaml));

describe("pk_curve: dose size, a pinned axis, the average line", () => {
  test("dose defaults to 1: the curve is exactly the old one", () => {
    const base = { doses: 8, dose_interval: 12, half_life: 12, show_window: true, window_low: 1.7, window_high: 2.8 };
    expect(curve(pk({ ...base, dose: 1 }))).toEqual(curve(pk(base)));
    expect(pk(base).frame).toEqual(pk({ ...base, dose: 1 }).frame);
  });

  test("dose scales the concentration; with y_max the axis holds still", () => {
    const base = { doses: 20, dose_interval: 6, half_life: 12, t_max: 96, y_max: 6 };
    const full = pk({ ...base, dose: 1 });
    const quarter = pk({ ...base, dose: 0.25 });
    expect(full.frame!.y).toEqual([0, 6]);
    expect(quarter.frame!.y).toEqual([0, 6]);
    const y0 = full.frame!.box.y0;
    // The same axis: a quarter dose is a quarter the height above the axis, point for point.
    ys(quarter).forEach((y, i) => expect(y - y0).toBeCloseTo((ys(full)[i] - y0) / 4, 6));
    // Without y_max, the axis refits to each curve (the old behaviour).
    expect(pk({ ...base, y_max: undefined, dose: 0.25 }).frame!.y[1]).toBeLessThan(pk({ ...base, y_max: undefined, dose: 1 }).frame!.y[1]);
  });

  test("a y_max too small for the curve gives way instead of clipping it", () => {
    const r = pk({ doses: 8, dose_interval: 12, half_life: 12, y_max: 0.5 });
    const top = r.frame!.box.y1;
    expect(Math.max(...ys(r))).toBeLessThan(top);
  });

  test("doses beyond t_max are not drawn, and many doses fill a fixed window", () => {
    const r = pk({ doses: 40, dose_interval: 6, half_life: 12, t_max: 96 });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("dose_14"); // t = 84: the last one clear of the axis caption
    expect(ids).not.toContain("dose_15");
    expect(ids).toContain("ss_line");
  });

  test("the average line: the same daily amount, however split, gives the same average", () => {
    const once = pk({ doses: 5, dose_interval: 24, dose: 1, half_life: 12, t_max: 120, y_max: 3, show_average: true });
    const split = pk({ doses: 20, dose_interval: 6, dose: 0.25, half_life: 12, t_max: 120, y_max: 3, show_average: true });
    const yA = (r: SceneLayout) => (leaf(r, "avg_line") as StrokeDrawable).pts[0][1];
    expect(yA(split)).toBeCloseTo(yA(once), 6);
    expect(r_labels(split)).toContain("label_avg");
    expect(split.drawnWith?.avg_line).toEqual(["label_avg"]);
    // Split small doses swing less: the peak is lower, the trough higher, around the same average.
    const late = (r: SceneLayout) => curve(r).filter((p) => p[0] > r.frame!.box.x0 + 0.8 * (r.frame!.box.x1 - r.frame!.box.x0)).map((p) => p[1]);
    expect(Math.max(...late(split))).toBeLessThan(Math.max(...late(once)));
    expect(Math.min(...late(split))).toBeGreaterThan(Math.min(...late(once)));
    // The average sits between the steady-state trough and peak.
    expect(yA(once)).toBeGreaterThan(Math.min(...late(once)));
    expect(yA(once)).toBeLessThan(Math.max(...late(once)));
    // A single dose has no average line.
    expect(leaf(pk({ show_average: true }), "avg_line")).toBeUndefined();
  });

  test("the steady-state line says it marks the peak, sits at the plateau's top, and comes with its line", () => {
    const r = pk({ doses: 8, dose_interval: 12, half_life: 12 });
    const text = r.labels.find((l) => l.id === "label_ss")!;
    expect(text.text).toMatch(/peak/i);
    expect(text.side).toBe("above-right"); // above the line the peaks touch from below
    expect(text.fontSize).toBeGreaterThanOrEqual(24);
    const ss = (leaf(r, "ss_line") as StrokeDrawable).pts[0][1];
    expect(Math.abs(ss - Math.max(...ys(r)))).toBeLessThan(5); // 7 half-lives in: within 1 % of the plateau
    expect(r.drawnWith?.ss_line).toEqual(["label_ss"]);
    const win = pk({ show_window: true }).labels.find((l) => l.id === "window__t")!;
    expect(pk({ show_window: true }).drawnWith?.window).toEqual(["window__t"]);
    expect(win.fontSize).toBeGreaterThanOrEqual(24);
  });

  test("an animate of dose and dose_interval together, with y_max, lints clean", () => {
    const spec: Spec = {
      template: "pk_curve",
      params: { doses: 24, dose_interval: 24, dose: 1, half_life: 12, t_max: 120, y_max: 2.6, show_average: true },
      commands: [
        { draw: ["axes", "curve", "avg_line"] },
        { animate: { dose: 0.25, dose_interval: 6 }, duration: 3 },
      ],
    } as Spec;
    for (const params of [spec.params, { ...spec.params, dose: 0.25, dose_interval: 6 }, { ...spec.params, dose: 0.6, dose_interval: 14 }]) {
      const l = layoutSpec({ ...spec, params } as Spec);
      expect(l.frame?.y).toEqual([0, 2.6]);
      const issues = l.issues.map((i) => `[${i.severity}] ${i.message}`);
      expect(issues).toEqual([]);
    }
  });
});

function r_labels(r: SceneLayout): string[] {
  return r.labels.map((l) => l.id);
}
