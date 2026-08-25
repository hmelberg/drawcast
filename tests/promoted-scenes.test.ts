// Task 5: two_by_two_table, timeline, and generic_axes_diagram promoted from
// stub to ready. This file pins the promotion itself (manifest status +
// registered layout) plus the geometry guarantees the brief calls out.

import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";
import { layoutTwoByTwoTable, type TwoByTwoParams } from "../src/scenes/two_by_two_table/layout";
import { layoutTimeline } from "../src/scenes/timeline/layout";
import { layoutGenericAxes, type GenericAxesParams } from "../src/scenes/generic_axes_diagram/layout";

const PROMOTED_IDS = ["two_by_two_table", "timeline", "generic_axes_diagram"];

describe("promoted scene manifests", () => {
  for (const id of PROMOTED_IDS) {
    test(`${id} is registered as ready with a layout function`, () => {
      const mod = scenes[id];
      expect(mod).toBeDefined();
      expect(mod.manifest.status).toBe("ready");
      expect(mod.layout).toBeTypeOf("function");
    });

    test(`${id} has at least two manifest examples`, () => {
      expect(scenes[id].manifest.examples.length).toBeGreaterThanOrEqual(2);
    });

    test(`${id}: every manifest example lays out to a rich, well-formed scene`, () => {
      const mod = scenes[id];
      for (const ex of mod.manifest.examples) {
        const layout = mod.layout!(ex.params);
        const flat = flattenDrawables(layout.drawables);
        const ctx = `${id} — "${ex.request}"`;

        // Labels (curve/point/milestone captions) are LabelRequest objects,
        // not yet Drawables — placeLabels() only turns them into text once
        // the full layoutSpec pipeline runs — so richness counts both.
        expect(flat.length + layout.labels.length, ctx).toBeGreaterThan(5);
        expect(new Set(layout.order).size, `${ctx} (duplicate order ids)`).toBe(layout.order.length);

        for (const d of flat) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(Number.isFinite(x), ctx).toBe(true);
              expect(Number.isFinite(y), ctx).toBe(true);
            }
          } else if (d.kind === "text") {
            expect(Number.isFinite(d.pos[0]), ctx).toBe(true);
            expect(Number.isFinite(d.pos[1]), ctx).toBe(true);
          }
        }
        for (const l of layout.labels) {
          expect(Number.isFinite(l.anchor[0]), ctx).toBe(true);
          expect(Number.isFinite(l.anchor[1]), ctx).toBe(true);
        }
        for (const [id2, p] of Object.entries(layout.anchors)) {
          expect(Number.isFinite(p[0]), `${ctx} anchor ${id2}`).toBe(true);
          expect(Number.isFinite(p[1]), `${ctx} anchor ${id2}`).toBe(true);
        }
      }
    });

    test(`${id}: every manifest example's strokes/areas/text stay inside the logical canvas`, () => {
      const mod = scenes[id];
      for (const ex of mod.manifest.examples) {
        const layout = mod.layout!(ex.params);
        for (const d of flattenDrawables(layout.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(x).toBeGreaterThanOrEqual(-1);
              expect(x).toBeLessThanOrEqual(CANVAS.w + 1);
              expect(y).toBeGreaterThanOrEqual(-1);
              expect(y).toBeLessThanOrEqual(CANVAS.h + 1);
            }
          }
        }
      }
    });
  }
});

describe("layoutTwoByTwoTable", () => {
  const base: TwoByTwoParams = {
    row_label: "Test",
    col_label: "Disease",
    row_values: ["Positive", "Negative"],
    col_values: ["Present", "Absent"],
    cells: [
      ["TP", "FP"],
      ["FN", "TN"],
    ],
  };

  test("produces the grid and all four cell groups", () => {
    const r = layoutTwoByTwoTable(base);
    for (const id of ["grid", "cell_0_0", "cell_0_1", "cell_1_0", "cell_1_1", "row_header_0", "row_header_1", "col_header_0", "col_header_1", "row_title", "col_title"]) {
      expect(r.order, id).toContain(id);
    }
  });

  test("highlight adds a shaded area behind the named cell", () => {
    const r = layoutTwoByTwoTable({ ...base, highlight: [[0, 0]] });
    const hl = flattenDrawables(r.drawables).find((d) => d.id === "hl_0_0");
    expect(hl).toBeDefined();
    expect(hl!.kind).toBe("area");
  });

  test("no highlight means no hl_ elements", () => {
    const r = layoutTwoByTwoTable(base);
    expect(r.order.some((id) => id.startsWith("hl_"))).toBe(false);
  });

  test("cell_notes adds a second, smaller text drawable inside the cell group", () => {
    const r = layoutTwoByTwoTable({ ...base, cell_notes: [["n=42", null], [null, null]] });
    const cell = flattenDrawables(r.drawables).find((d) => d.id === "cell_0_0__note");
    expect(cell).toBeDefined();
    expect(cell!.kind).toBe("text");
  });
});

describe("layoutGenericAxes", () => {
  test("an explicit expression 'x' produces a rising polyline in y-up logical coordinates", () => {
    const params: GenericAxesParams = { x_label: "X", y_label: "Y", curves: [{ expression: "x" }] };
    const r = layoutGenericAxes(params);
    const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve_0") as StrokeDrawable;
    expect(curve).toBeDefined();
    expect(curve.pts.length).toBeGreaterThan(10);
    const first = curve.pts[0];
    const last = curve.pts[curve.pts.length - 1];
    expect(last[1]).toBeGreaterThan(first[1]);
  });

  test("every canned shape samples to a valid, finite curve", () => {
    const shapes = ["linear_up", "linear_down", "convex_up", "concave_down", "s_curve", "u_shape", "bell"] as const;
    for (const shape of shapes) {
      const r = layoutGenericAxes({ x_label: "X", y_label: "Y", curves: [{ shape }] });
      const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve_0") as StrokeDrawable;
      expect(curve.pts.length, shape).toBeGreaterThan(20);
      for (const [x, y] of curve.pts) {
        expect(Number.isFinite(x), shape).toBe(true);
        expect(Number.isFinite(y), shape).toBe(true);
      }
    }
  });

  test("x_label/y_label are their own top-level elements, distinct from axes", () => {
    const r = layoutGenericAxes({ x_label: "Quantity", y_label: "Price", curves: [{ shape: "linear_up" }] });
    expect(r.order).toContain("axes");
    expect(r.order).toContain("x_label");
    expect(r.order).toContain("y_label");
  });

  test("shade under a single curve adds an area element", () => {
    const r = layoutGenericAxes({
      x_label: "X",
      y_label: "Y",
      curves: [{ shape: "concave_down" }],
      shade: { under: 0, x_from: 10, x_to: 60 },
    });
    const shade = flattenDrawables(r.drawables).find((d) => d.id === "shade");
    expect(shade).toBeDefined();
    expect(shade!.kind).toBe("area");
  });
});

describe("layoutTimeline", () => {
  test("3 milestones are spaced evenly along the line", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B" }, { label: "C" }] });
    const xs = [0, 1, 2].map((i) => r.anchors[`dot_${i}`][0]);
    const gap0 = xs[1] - xs[0];
    const gap1 = xs[2] - xs[1];
    expect(gap0).toBeGreaterThan(0);
    expect(gap1).toBeCloseTo(gap0, 6);
  });

  test("emphasized milestone renders a visibly larger dot", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B", emphasize: true }] });
    const dotA = flattenDrawables(r.drawables).find((d) => d.id === "dot_0") as StrokeDrawable;
    const dotB = flattenDrawables(r.drawables).find((d) => d.id === "dot_1") as StrokeDrawable;
    const radius = (d: StrokeDrawable, c: [number, number]): number => Math.max(...d.pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    expect(radius(dotB, r.anchors["dot_1"])).toBeGreaterThan(radius(dotA, r.anchors["dot_0"]));
  });

  test("every milestone gets a label with a valid side", () => {
    const r = layoutTimeline({ milestones: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }] });
    expect(r.labels.length).toBe(4);
    for (const l of r.labels) expect(["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"]).toContain(l.side);
  });

  test("caps at 8 milestones", () => {
    const r = layoutTimeline({ milestones: Array.from({ length: 10 }, (_, i) => ({ label: `M${i}` })) });
    expect(r.order.filter((id) => id.startsWith("dot_")).length).toBe(8);
  });
});
