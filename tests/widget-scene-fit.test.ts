import { beforeAll, describe, expect, test } from "vitest";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { plotArea } from "../src/layout/canvas";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence"]);
});

describe("widget scene — a fitted layout's coordinate converters compose the fit", () => {
  test("toLogical of the domain centre is the fitted plot centre, and toDomain inverts it", () => {
    const domain = { x: [0, 100] as [number, number], y: [0, 100] as [number, number] };
    const layout = layoutSpec({ template: "sir_compartments", params: { box: "right" }, domain } as Spec);
    expect(layout.fit).toBeDefined();
    const sc = buildWidgetScene(scenes.sir_compartments, { box: "right" }, { domain, layout })!;
    const { s, dx, dy } = layout.fit!;
    const plot = plotArea();
    const cx = (plot.x0 + plot.x1) / 2, cy = (plot.y0 + plot.y1) / 2;
    const p = sc.toLogical([50, 50]);
    expect(p[0]).toBeCloseTo(cx * s + dx, 6);
    expect(p[1]).toBeCloseTo(cy * s + dy, 6);
    const d = sc.toDomain(p)!;
    expect(d[0]).toBeCloseTo(50, 6);
    expect(d[1]).toBeCloseTo(50, 6);
  });

  test("boxes come from the layout on screen — the fitted one — not the module's own full-canvas layout", () => {
    const layout = layoutSpec({ template: "sir_compartments", params: { box: "right" } } as Spec);
    const sc = buildWidgetScene(scenes.sir_compartments, { box: "right" }, { layout })!;
    for (const [id, b] of sc.boxes) expect(b.x, id).toBeGreaterThanOrEqual(layout.fit!.box.x - 20);
  });
});
