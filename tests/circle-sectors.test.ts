import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec, elementRings } from "../src/layout/layout";
import { sliderSpecs } from "../src/ui/tray-model";
import { validateSpec } from "../src/spec/schema";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"]);
});

const lay = (params: Record<string, unknown>) => layoutSpec({ template: "circle_sectors", params, elements: [] } as never);

describe("circle_sectors", () => {
  test("registers, with n and t as sliders", () => {
    expect(scenes.circle_sectors?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.circle_sectors.manifest.params_schema).map((s) => s.path).sort()).toEqual(["n", "t"]);
  });
  test("t = 0 is a circle of n outlined pieces around one centre; t = 1 zips them; both lint clean", () => {
    for (const t of [0, 0.5, 1]) {
      const out = lay({ n: 12, t });
      expect(out.warnings, `t=${t}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `t=${t}`).toEqual([]);
      for (let k = 1; k <= 12; k++) expect(out.order).toContain(`piece_${k}`);
      expect(elementRings(out).get("piece_1")?.length).toBeGreaterThan(0);
    }
    const circle = lay({ n: 12, t: 0 });
    const zipped = lay({ n: 12, t: 1 });
    const width = (o: ReturnType<typeof lay>) => {
      const xs = o.drawables.filter((d) => d.id.startsWith("piece_")).flatMap((d) => ("pts" in d ? (d.pts as [number, number][]) : []).map((p) => p[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(zipped)).toBeGreaterThan(width(circle) * 1.3); // the rectangle is ~πr wide, the circle 2r
  });
  test("a fractional n rounds and stays clean (animate interpolates n)", () => {
    const out = lay({ n: 23.4, t: 1 });
    expect(out.warnings).toEqual([]);
    expect(out.order.filter((id) => id.startsWith("piece_"))).toHaveLength(23);
  });
  test("radius_line/label_r track piece_1's own apex continuously — no t=0.5 jump — and stay clean through the tween", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const out = lay({ n: 12, t });
      expect(out.warnings, `t=${t}`).toEqual([]);
      expect(out.issues, `t=${t}`).toEqual([]);
    }
    const out = lay({ n: 12, t: 0.5 });
    // Derive piece_1's actual apex from the layout output (its body/edge
    // points start at the apex), not from a recomputed constant — a
    // hand-derived expected value could drift from the template's own math
    // the same way the bug did.
    const piece1 = out.drawables.find((d) => d.id === "piece_1") as { pts: [number, number][] } | undefined;
    const radiusLine = out.drawables.find((d) => d.id === "radius_line") as { pts: [number, number][] } | undefined;
    expect(piece1).toBeDefined();
    expect(radiusLine).toBeDefined();
    expect(radiusLine!.pts[0][0]).toBeCloseTo(piece1!.pts[0][0], 6);
    expect(radiusLine!.pts[0][1]).toBeCloseTo(piece1!.pts[0][1], 6);
  });
  test("both manifest examples lint clean and the bundled example validates", () => {
    for (const ex of scenes.circle_sectors.manifest.examples) {
      const out = layoutSpec({ template: "circle_sectors", params: ex.params, elements: [] } as never);
      expect(out.warnings, ex.request).toEqual([]);
      expect(out.issues.map((i) => i.message), ex.request).toEqual([]);
    }
    expect(validateSpec({ template: "circle_sectors", params: { n: 12, t: 0 }, commands: [{ draw: ["piece_1"] }, { animate: { t: 1 }, duration: 3 }] }).ok).toBe(true);
  });
});
