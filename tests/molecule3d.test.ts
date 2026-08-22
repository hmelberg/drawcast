// kit.project3d and the molecule_3d core template, plus validity of the
// bundled offline examples (src/examples.json) through the real pipeline.

import { describe, expect, test } from "vitest";
import { kit } from "../src/scenes/kit";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import bundledExamples from "../src/examples.json";

describe("kit.project3d", () => {
  test("azimuth 0 / elevation 0: +x lands right of center, +y above, both scaled by fov/distance", () => {
    const { anchors } = kit.project3d({ azimuth: 0, elevation: 0, distance: 10, fov: 1000, cx: 500, cy: 375 }, [
      { kind: "sphere", id: "px", c: [1, 0, 0], r: 0.1 },
      { kind: "sphere", id: "py", c: [0, 1, 0], r: 0.1 },
    ]);
    expect(anchors.px[0]).toBeCloseTo(600, 0); // 500 + 1 * (1000/10)
    expect(anchors.px[1]).toBeCloseTo(375, 0);
    expect(anchors.py[1]).toBeCloseTo(475, 0); // y-up
  });

  test("painter's order: the farther sphere is drawn first", () => {
    const { order } = kit.project3d({ azimuth: 0, elevation: 0, distance: 10 }, [
      { kind: "sphere", id: "near", c: [0, 0, 2], r: 0.1 },
      { kind: "sphere", id: "far", c: [0, 0, -2], r: 0.1 },
    ]);
    expect(order.indexOf("far")).toBeLessThan(order.indexOf("near"));
  });

  test("perspective: the nearer sphere projects larger", () => {
    const { drawables } = kit.project3d({ azimuth: 0, elevation: 0, distance: 10 }, [
      { kind: "sphere", id: "near", c: [0, 0, 2], r: 0.5 },
      { kind: "sphere", id: "far", c: [0, 0, -2], r: 0.5 },
    ]);
    const radius = (id: string) => {
      const d = drawables.find((d) => d.id === id);
      return d?.kind === "stroke" && d.shapeHint?.type === "circle" ? d.shapeHint.r : 0;
    };
    expect(radius("near")).toBeGreaterThan(radius("far"));
  });

  test("segments split into two halves with trims shortening the stick", () => {
    const full = kit.project3d({ azimuth: 0, elevation: 0, distance: 10 }, [
      { kind: "seg", id: "b", a: [-1, 0, 0], b: [1, 0, 0] },
    ]);
    const trimmed = kit.project3d({ azimuth: 0, elevation: 0, distance: 10 }, [
      { kind: "seg", id: "b", a: [-1, 0, 0], b: [1, 0, 0], trimA: 0.4, trimB: 0.4 },
    ]);
    expect(full.drawables.map((d) => d.id).sort()).toEqual(["b", "b__f"]);
    const span = (r: typeof full) => {
      const xs = r.drawables.flatMap((d) => (d.kind === "stroke" ? d.pts.map((p) => p[0]) : []));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(trimmed)).toBeLessThan(span(full) - 10);
  });

  test("deterministic", () => {
    const prims = [{ kind: "sphere" as const, id: "s", c: [0.3, -0.2, 0.9] as [number, number, number], r: 0.25 }];
    const cam = { azimuth: 33, elevation: 12, distance: 8 };
    expect(JSON.stringify(kit.project3d(cam, prims))).toBe(JSON.stringify(kit.project3d(cam, prims)));
  });
});

describe("molecule_3d template", () => {
  test("registered as a ready core doc template", () => {
    expect(scenes.molecule_3d.manifest.status).toBe("ready");
    expect(scenes.molecule_3d.layout).toBeDefined();
  });

  test("every manifest example renders clean and in-bounds", () => {
    for (const ex of scenes.molecule_3d.manifest.examples) {
      const res = layoutSpec({ template: "molecule_3d", params: ex.params, elements: [] } as never);
      expect(res.warnings).toEqual([]);
      expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
      for (const d of flattenDrawables(res.drawables)) {
        if (d.kind === "stroke" || d.kind === "area") {
          for (const [x, y] of d.pts) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
            expect(Math.abs(x)).toBeLessThan(2000);
            expect(Math.abs(y)).toBeLessThan(2000);
          }
        }
      }
    }
  });

  test("methane has 1 carbon + 4 hydrogens + 8 bond halves", () => {
    const r = scenes.molecule_3d.layout!({ molecule: "methane" });
    const ids = r.drawables.map((d) => d.id);
    expect(ids.filter((id) => /^atom_\d$/.test(id))).toHaveLength(5);
    expect(ids.filter((id) => /^bond_\d(__f)?$/.test(id))).toHaveLength(8);
  });

  test("camera params change the projection deterministically", () => {
    const a = scenes.molecule_3d.layout!({ molecule: "methane", azimuth: 10 });
    const b = scenes.molecule_3d.layout!({ molecule: "methane", azimuth: 80 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(scenes.molecule_3d.layout!({ molecule: "methane", azimuth: 10 })));
  });
});

describe("bundled offline examples (src/examples.json)", () => {
  for (const ex of bundledExamples as { request: string; spec: Spec }[]) {
    test(`"${ex.spec.title ?? ex.request}" validates, renders clean, and every drawn id exists`, () => {
      const v = validateSpec(ex.spec);
      expect(v.errors).toEqual([]);
      const res = layoutSpec(ex.spec);
      expect(res.warnings).toEqual([]);
      expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
      const known = new Set(flattenDrawables(res.drawables).map((d) => d.id));
      for (const cmd of ex.spec.commands ?? []) {
        const drawn = (cmd as { draw?: string[] }).draw;
        for (const id of drawn ?? []) {
          expect(known.has(id), `example draws unknown id "${id}"`).toBe(true);
        }
      }
    });
  }
});
