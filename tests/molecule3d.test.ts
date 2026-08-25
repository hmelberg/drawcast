// kit.project3d and the molecule_3d core template, plus validity of the
// bundled offline examples (src/examples.json) through the real pipeline.

import { beforeAll, describe, expect, test } from "vitest";
import { kit } from "../src/scenes/kit";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import bundledExamples from "../src/examples.json";
import { PACK_DEFS, registerPack } from "../src/scenes/packs";
import { ensureEngines } from "../src/scenes/engines";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";

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

  describe("sphere shading (default on)", () => {
    const cam = { azimuth: 20, elevation: 15, distance: 10 };

    test("shaded sphere is ONE drawable with a radial-gradient fill — no __sh/__hl overlay pieces", () => {
      const { drawables, order, anchors } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, fill: "#bcd2e0" },
      ]);
      expect(order).toEqual(["s"]);
      expect(anchors["s"]).toBeDefined();
      const s = drawables[0];
      expect(s.style.fill).toBe("#bcd2e0");
      const grad = s.style.fillGradient!;
      expect(grad.stops).toHaveLength(3);
      expect(grad.stops[1].color).toBe("#bcd2e0"); // mid stop = the base color itself
      expect(grad.fx!).toBeLessThan(0.5); // highlight up-left (SVG y-down)
      expect(grad.fy!).toBeLessThan(0.5);
    });

    test("shade: false keeps a flat fill and no gradient", () => {
      const { drawables, order } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, fill: "#bcd2e0", shade: false },
      ]);
      expect(order).toEqual(["s"]);
      expect(drawables[0].style.fill).toBe("#bcd2e0");
      expect(drawables[0].style.fillGradient).toBeUndefined();
    });

    test("shaded sphere without an explicit fill shades a light tint of its stroke color", () => {
      const { drawables } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, color: "#5a544c" },
      ]);
      expect(drawables[0].style.fill).toBeDefined();
      expect(drawables[0].style.fillGradient).toBeDefined();
      expect(drawables[0].style.fillGradient!.stops[1].color).toBe(drawables[0].style.fill);
    });

    test("wire sphere: outline + solid front equator + dashed back equator, no fill", () => {
      const { drawables, order, anchors } = kit.project3d(cam, [
        { kind: "sphere", id: "s", c: [0, 0, 0], r: 1, style: "wire" },
      ]);
      expect(order).toContain("s");
      expect(order).toContain("s__eq");
      expect(order).toContain("s__eqb");
      // Painter's order (far → near): back half behind the circle, front half on top.
      expect(order.indexOf("s__eqb")).toBeLessThan(order.indexOf("s"));
      expect(order.indexOf("s")).toBeLessThan(order.indexOf("s__eq"));
      const outline = drawables.find((d) => d.id === "s")!;
      const front = drawables.find((d) => d.id === "s__eq")!;
      const back = drawables.find((d) => d.id === "s__eqb")!;
      expect(outline.style.fill).toBeUndefined();
      expect(outline.style.fillGradient).toBeUndefined();
      expect(front.style.dash).toBeFalsy();
      expect(back.style.dash).toBe(true);
      // Only the sphere itself gets an anchor.
      expect(anchors["s__eq"]).toBeUndefined();
      expect(anchors["s__eqb"]).toBeUndefined();
    });
  });

  describe("face3", () => {
    test("fill brightness differs between a camera-facing and an oblique face", () => {
      const cam = { azimuth: 0, elevation: 0, distance: 10 };
      const facing = kit.project3d(cam, [{ kind: "face3", id: "f", pts: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], fill: "#808080" }]);
      const oblique = kit.project3d(cam, [{ kind: "face3", id: "f", pts: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]], fill: "#808080" }]);
      const fillOf = (res: typeof facing) => {
        const area = flattenDrawables(res.drawables).find((d) => d.id === "f__area");
        return area?.kind === "area" ? area.style.fill : undefined;
      };
      expect(fillOf(facing)).not.toBe(fillOf(oblique));
    });
  });

  describe("box3", () => {
    const cam = { azimuth: 30, elevation: 20, distance: 8 };

    test("emits <=3 visible faces at a generic angle, plus dashed hidden edges when asked", () => {
      const { order, drawables } = kit.project3d(cam, [{ kind: "box3", id: "b", c: [0, 0, 0], size: [1, 1, 1], hidden_edges: true }]);
      const faceIds = order.filter((id) => /^b__f\d$/.test(id));
      expect(faceIds.length).toBeGreaterThan(0);
      expect(faceIds.length).toBeLessThanOrEqual(3);
      const edgeIds = order.filter((id) => /^b__e\d+$/.test(id));
      expect(edgeIds.length).toBeGreaterThan(0);
      const leaves = flattenDrawables(drawables);
      for (const id of edgeIds) {
        const d = leaves.find((l) => l.id === id);
        expect(d?.kind === "stroke" && d.style.dash).toBe(true);
      }
    });

    test("no hidden_edges flag emits no dashed edges", () => {
      const { order } = kit.project3d(cam, [{ kind: "box3", id: "b", c: [0, 0, 0], size: [1, 1, 1] }]);
      expect(order.filter((id) => /^b__e\d+$/.test(id))).toEqual([]);
    });

    test("deterministic", () => {
      const prims = [{ kind: "box3" as const, id: "b", c: [0, 0, 0] as [number, number, number], size: [1, 2, 1] as [number, number, number], hidden_edges: true }];
      expect(JSON.stringify(kit.project3d(cam, prims))).toBe(JSON.stringify(kit.project3d(cam, prims)));
    });

    test("anchors the projected box center, like every other prim kind", () => {
      const boxRes = kit.project3d(cam, [{ kind: "box3", id: "b", c: [0.4, -0.2, 0.1], size: [1, 1, 1] }]);
      // A near-zero-radius sphere at the same world point projects to (essentially) the same screen point.
      const sphereRes = kit.project3d(cam, [{ kind: "sphere", id: "s", c: [0.4, -0.2, 0.1], r: 0.001, shade: false }]);
      expect(boxRes.anchors.b).toBeDefined();
      expect(boxRes.anchors.b[0]).toBeCloseTo(sphereRes.anchors.s[0], 4);
      expect(boxRes.anchors.b[1]).toBeCloseTo(sphereRes.anchors.s[1], 4);
    });
  });

  describe("camera.fade with grouped (face3/box3) pieces", () => {
    test("fades a farther box's face-area opacity more than a nearer box's", () => {
      const near = kit.project3d(
        { azimuth: 25, elevation: 15, distance: 10, fade: 0.5 },
        [
          { kind: "box3", id: "near", c: [0, 0, 3], size: [1, 1, 1] },
          { kind: "box3", id: "far", c: [0, 0, -3], size: [1, 1, 1] },
        ],
      );
      const areaOpacity = (id: string) => {
        const face = flattenDrawables(near.drawables).find((d) => d.id.startsWith(`${id}__f`) && d.id.endsWith("__area"));
        return face?.kind === "area" ? face.style.opacity : undefined;
      };
      const nearOpacity = areaOpacity("near");
      const farOpacity = areaOpacity("far");
      expect(nearOpacity).toBeDefined();
      expect(farOpacity).toBeDefined();
      expect(farOpacity as number).toBeLessThan(nearOpacity as number);
    });
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
  // Pack-based examples: register their packs + engines up front (the app's
  // example loader does the same via ensureEnabledPacks; present() ensures
  // engines).
  beforeAll(async () => {
    const needsPacks = new Set(
      (bundledExamples as { packs?: string[] }[]).flatMap((e) => e.packs ?? []),
    );
    for (const id of needsPacks) {
      const def = PACK_DEFS[id];
      if (!def) throw new Error(`example declares unknown pack "${id}"`);
      registerPack(id, await def.load());
    }
    if (needsPacks.has("chemistry")) await ensureEngines(["smilesdrawer"]);
    if (needsPacks.has("mathlogic")) await ensureEngines(["mathjax"]);
    if (needsPacks.has("games")) await ensureEngines(["chess"]);
  });

  interface Entry {
    request: string;
    title?: string;
    spec?: Spec;
    playlist?: string;
    packs?: string[];
  }

  function checkSpec(spec: Spec, label: string): void {
    const v = validateSpec(spec);
    expect(v.errors, label).toEqual([]);
    const res = layoutSpec(spec);
    expect(res.warnings, label).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error"), label).toEqual([]);
    const known = new Set(flattenDrawables(res.drawables).map((d) => d.id));
    for (const cmd of spec.commands ?? []) {
      const drawn = (cmd as { draw?: string[] }).draw;
      for (const id of drawn ?? []) {
        expect(known.has(id), `${label} draws unknown id "${id}"`).toBe(true);
      }
    }
  }

  for (const ex of bundledExamples as Entry[]) {
    test(`"${ex.title ?? ex.spec?.title ?? ex.request}" validates, renders clean, and every drawn id exists`, () => {
      if (ex.playlist) {
        const playlist = parsePlaylistText(ex.playlist);
        const items = itemsOf(playlist);
        expect(items.length).toBeGreaterThan(0);
        items.forEach((item, i) => checkSpec(item.spec, `part ${i}`));
      } else {
        expect(ex.spec).toBeDefined();
        checkSpec(ex.spec!, "spec");
      }
    });
  }
});
