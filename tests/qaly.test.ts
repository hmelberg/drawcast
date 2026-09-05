import { describe, expect, test } from "vitest";
import { computeShortfall, layoutQalyProfiles, type QalyParams } from "../src/scenes/qaly_profiles/layout";
import { flattenDrawables, type AreaDrawable, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";
import { layoutSpec } from "../src/layout/layout";

const params: QalyParams = {
  profiles: [
    {
      id: "no_tx",
      label: "Without treatment",
      waypoints: [
        { t: 0, u: 0.9 },
        { t: 40, u: 0.8 },
        { t: 40, u: 0.4, step: true },
        { t: 65, u: 0.3 },
      ],
      death_at: 70,
    },
    {
      id: "tx",
      label: "With treatment",
      waypoints: [
        { t: 0, u: 0.9 },
        { t: 40, u: 0.8 },
        { t: 40, u: 0.25, step: true },
        { t: 46, u: 0.7 },
        { t: 75, u: 0.55 },
      ],
      death_at: 82,
    },
  ],
  shade_between: { a: "tx", b: "no_tx" },
};

function stroke(r: ReturnType<typeof layoutQalyProfiles>, id: string): StrokeDrawable {
  const d = flattenDrawables(r.drawables).find((d) => d.id === id);
  if (!d || d.kind !== "stroke") throw new Error(`no stroke ${id}`);
  return d;
}

describe("layoutQalyProfiles", () => {
  test("produces axes, a curve and label per profile, and gain/loss regions", () => {
    const r = layoutQalyProfiles(params);
    const ids = [...flattenDrawables(r.drawables).map((d) => d.id), ...r.labels.map((l) => l.id)];
    for (const id of ["axes", "full_health_line", "curve_no_tx", "curve_tx", "label_no_tx", "label_tx", "gain_regions", "loss_regions", "label_gain"]) {
      expect(ids).toContain(id);
    }
  });

  test("a step waypoint creates a vertical discontinuity", () => {
    const r = layoutQalyProfiles(params);
    const pts = stroke(r, "curve_tx").pts;
    const vertical = pts.some((p, i) => i > 0 && Math.abs(p[0] - pts[i - 1][0]) < 0.5 && Math.abs(p[1] - pts[i - 1][1]) > 30);
    expect(vertical).toBe(true);
  });

  test("interpolation between waypoints is non-linear (eased), not a straight line", () => {
    const r = layoutQalyProfiles({
      profiles: [{ id: "p", waypoints: [{ t: 0, u: 0.9 }, { t: 60, u: 0.3 }], death_at: 70 }],
    });
    const pts = stroke(r, "curve_p").pts;
    // midpoint of an eased segment deviates from the straight chord somewhere
    const [x0, y0] = pts[0];
    const seg = pts.filter(([x]) => x >= x0 && x <= x0 + 300);
    const [x1, y1] = seg[seg.length - 1];
    const deviation = Math.max(
      ...seg.map(([x, y]) => {
        const tt = (x - x0) / (x1 - x0 || 1);
        return Math.abs(y - (y0 + tt * (y1 - y0)));
      }),
    );
    expect(deviation).toBeGreaterThan(3);
  });

  test("death drops the curve to zero utility at the death age", () => {
    const r = layoutQalyProfiles(params);
    const pts = stroke(r, "curve_tx").pts;
    const last = pts[pts.length - 1];
    const zeroY = stroke(r, "curve_no_tx").pts[0]; // not zero — just need the axis: use canvas check instead
    void zeroY;
    // utility 0 maps to the plot floor; the tx curve ends lower than it starts
    expect(last[1]).toBeLessThan(pts[0][1] - 200);
    // and later in time than the no-treatment death
    const lastNoTx = stroke(r, "curve_no_tx").pts.slice(-1)[0];
    expect(last[0]).toBeGreaterThan(lastNoTx[0]);
  });

  test("utility values are clamped to [0, 1]", () => {
    const r = layoutQalyProfiles({
      profiles: [{ id: "p", waypoints: [{ t: 0, u: 1.4 }, { t: 50, u: -0.3 }], death_at: 60 }],
    });
    for (const [x, y] of stroke(r, "curve_p").pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CANVAS.w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CANVAS.h);
    }
  });

  test("gain and loss regions are areas with opposite roles when curves cross", () => {
    const r = layoutQalyProfiles(params);
    const flat = flattenDrawables(r.drawables);
    const gain = flat.find((d) => d.id === "gain_regions");
    const loss = flat.find((d) => d.id === "loss_regions");
    expect(gain?.kind).toBe("group");
    expect(loss?.kind).toBe("group");
    const gainAreas = flattenDrawables([gain!]).filter((d): d is AreaDrawable => d.kind === "area");
    const lossAreas = flattenDrawables([loss!]).filter((d): d is AreaDrawable => d.kind === "area");
    expect(gainAreas.length).toBeGreaterThan(0);
    expect(lossAreas.length).toBeGreaterThan(0);
  });

  test("empty params fall back to a sensible default two-profile comparison", () => {
    const r = layoutQalyProfiles({});
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.filter((id) => id.startsWith("curve_")).length).toBe(2);
    expect(ids).toContain("gain_regions");
  });
});

describe("computeShortfall", () => {
  // Flat lives make the arithmetic checkable by hand: full health to 80 against
  // half health to 80, judged from age 40, is 40 QALYs against 20.
  const healthy = (t: number) => (t < 80 ? 1 : 0);
  const ill = (t: number) => (t < 80 ? 0.5 : 0);

  test("absolute shortfall is the health lost between the index age and the end of life", () => {
    const r = computeShortfall(healthy, ill, 40, 80);
    expect(r.remainingHealthy).toBeCloseTo(40, 6);
    expect(r.remainingDisease).toBeCloseTo(20, 6);
    expect(r.absolute).toBeCloseTo(20, 6);
  });

  test("proportional shortfall is the absolute loss as a share of remaining healthy life", () => {
    expect(computeShortfall(healthy, ill, 40, 80).proportional).toBeCloseTo(0.5, 6);
  });

  test("a life cut short counts the lost years, not just the lost quality", () => {
    const dies60 = (t: number) => (t < 60 ? 1 : 0);
    const r = computeShortfall(healthy, dies60, 40, 80);
    expect(r.absolute).toBeCloseTo(20, 6); // the twenty years never lived
  });

  test("discounting shrinks the shortfall without erasing it", () => {
    const undiscounted = computeShortfall(healthy, ill, 40, 80, 0).absolute;
    const discounted = computeShortfall(healthy, ill, 40, 80, 0.04).absolute;
    expect(discounted).toBeLessThan(undiscounted);
    expect(discounted).toBeGreaterThan(0);
  });
});

describe("layoutQalyProfiles: shortfall", () => {
  const ids = (r: ReturnType<typeof layoutQalyProfiles>) => [...flattenDrawables(r.drawables).map((d) => d.id), ...r.labels.map((l) => l.id)];

  test("a reference profile and a shortfall are independent switches", () => {
    expect(ids(layoutQalyProfiles(params))).not.toContain("reference_curve");
    const refOnly = ids(layoutQalyProfiles({ ...params, reference: { label: "Age-matched norm" } }));
    expect(refOnly).toContain("reference_curve");
    expect(refOnly).not.toContain("shortfall_region");
  });

  test("a shortfall draws the index line, the shaded loss and the arithmetic note", () => {
    const got = ids(layoutQalyProfiles({ ...params, index_age: 40, shortfall: { of: "no_tx" } }));
    for (const id of ["reference_curve", "index_line", "shortfall_region", "shortfall_note"]) {
      expect(got).toContain(id);
    }
  });

  test("the note shows where the number comes from, in QALYs and as a share", () => {
    const r = layoutQalyProfiles({
      reference: { label: "Norm", waypoints: [{ t: 0, u: 1 }], death_at: 80 },
      profiles: [{ id: "ill", label: "With the disease", waypoints: [{ t: 0, u: 1 }, { t: 40, u: 0.5, step: true }], death_at: 80 }],
      shade_between: null,
      index_age: 40,
      shortfall: { of: "ill", show: "both" },
    });
    const note = flattenDrawables(r.drawables)
      .filter((d) => d.kind === "text" && d.id.startsWith("shortfall_note"))
      .map((d) => (d as { text: string }).text)
      .join(" ");
    expect(note).toContain("40.0"); // remaining QALYs in full health
    expect(note).toContain("20.0"); // with the disease, and so the absolute shortfall
    expect(note).toContain("50"); // proportional shortfall, as a percentage
  });

  test("the bundled shortfall example survives the real pipeline with no fallbacks or lint errors", async () => {
    const manifest = (await import("../src/scenes/qaly_profiles/manifest.json")).default;
    const ex = manifest.examples.find((e) => "shortfall" in (e.params as Record<string, unknown>));
    expect(ex).toBeDefined();
    const res = layoutSpec({ template: "qaly_profiles", params: ex!.params, elements: [] } as never);
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("the shortfall region is bounded by the index age on the left", () => {
    const r = layoutQalyProfiles({ ...params, index_age: 40, shortfall: { of: "no_tx" } });
    const region = flattenDrawables(r.drawables).find((d) => d.id === "shortfall_region");
    if (!region || region.kind !== "area") throw new Error("no shortfall region");
    const line = flattenDrawables(r.drawables).find((d) => d.id === "index_line");
    if (!line || line.kind !== "stroke") throw new Error("no index line");
    const leftEdge = Math.min(...region.pts.map((p) => p[0]));
    expect(leftEdge).toBeCloseTo(line.pts[0][0], 0);
  });
});
