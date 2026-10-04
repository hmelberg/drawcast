// W25: drawing a template element brings its own label (and a number line its
// ticks) — not left for the final draw at the end.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"]);
});

function visibleAfter(spec: Spec): string[][] {
  const layout = layoutSpec(spec);
  const bboxes = elementBBoxes(layout);
  const p = planCommands(spec.commands!, layout.order, {
    bboxOf: (id: string) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    ...domainMapping(spec.domain, layout.fit),
    animateBase: spec.params ?? {},
    ...planOptionsFor(spec, layout),
  } as never);
  return p.states.map((s) => s.visible);
}

describe("a template element's own label comes with it", () => {
  test("number_line: a point's and an interval's label with them; the ticks with the line", () => {
    const spec = {
      template: "number_line",
      params: { min: -2, max: 6, points: [{ at: 1, label: "start", open: true }], intervals: [{ from: 1, to: 6, label: "x > 1" }] },
      commands: [{ draw: ["line"], speak: "A line." }, { draw: ["pt_0"], speak: "One." }, { draw: ["interval_0"], speak: "Above." }, { speak: "Done." }],
    } as unknown as Spec;
    const states = visibleAfter(spec);
    const at = (id: string) => states.findIndex((v) => v.includes(id));
    expect(at("tick_0")).toBe(at("line"));
    expect(at("pt_0_label")).toBe(at("pt_0"));
    expect(at("interval_0_label")).toBe(at("interval_0"));
    expect(at("pt_0")).toBeLessThan(at("interval_0"));
  });

  test("generic_axes_diagram: a vertical line's label with it", () => {
    const spec = {
      template: "generic_axes_diagram",
      params: { x_label: "score", y_label: "outcome", curves: [{ shape: "linear_up", label: "trend" }], vlines: [{ x: 50, label: "cutoff" }] },
      commands: [{ draw: ["axes"], speak: "Axes." }, { draw: ["vline_0"], speak: "Cutoff." }, { draw: ["curve_0"], speak: "Trend." }],
    } as unknown as Spec;
    const states = visibleAfter(spec);
    const at = (id: string) => states.findIndex((v) => v.includes(id));
    expect(at("label_vline_0")).toBe(at("vline_0"));
    expect(at("label_curve_0")).toBe(at("curve_0"));
    expect(at("vline_0")).toBeLessThan(at("curve_0"));
  });

  test("a label the cast draws itself is drawn where the cast says", () => {
    const spec = {
      template: "generic_axes_diagram",
      params: { x_label: "score", y_label: "outcome", curves: [{ shape: "linear_up" }], vlines: [{ x: 50, label: "cutoff" }] },
      commands: [{ draw: ["axes", "vline_0"], speak: "Cutoff." }, { draw: ["curve_0"], speak: "Trend." }, { draw: ["label_vline_0"], speak: "Named." }],
    } as unknown as Spec;
    const states = visibleAfter(spec);
    const at = (id: string) => states.findIndex((v) => v.includes(id));
    expect(at("label_vline_0")).toBeGreaterThan(at("curve_0"));
  });
});
