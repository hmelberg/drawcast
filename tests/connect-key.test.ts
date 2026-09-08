import { beforeAll, describe, expect, it } from "vitest";
import { connectKey } from "../src/render/widgets";

const box = (x: number, y: number) => ({ x: x - 2, y: y - 2, w: 4, h: 4 });

describe("connectKey", () => {
  it("reads a figure's edges off its drawn polylines", () => {
    const leaves = [
      { id: "con_tst__0", pts: [[10, 10], [20, 20], [30, 10]] as [number, number][] },
      { id: "con_tst__1", pts: [[30, 10], [40, 30]] as [number, number][] },
      { id: "alnitak", pts: undefined },
    ];
    const boxes = new Map([
      ["alnitak", box(10, 10)],
      ["hip_2", box(20, 20)],
      ["hip_3", box(30, 10)],
      ["hip_4", box(40, 30)],
      ["label_alnitak", box(10, 14)],
    ]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.unmatched).toBe(0);
    expect(k.stars.map((s) => s.id).sort()).toEqual(["alnitak", "hip_2", "hip_3", "hip_4"]);
    expect(k.edges).toEqual([
      ["alnitak", "hip_2"],
      ["hip_2", "hip_3"],
      ["hip_3", "hip_4"],
    ]);
  });

  it("never names a label, and counts a vertex with no star under it", () => {
    const leaves = [{ id: "con_tst__0", pts: [[10, 10], [99, 99]] as [number, number][] }];
    const boxes = new Map([["alnitak", box(10, 10)], ["label_alnitak", box(10, 10)]]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.unmatched).toBe(1);
    expect(k.edges).toEqual([]);
    expect(k.stars.map((s) => s.id)).toEqual(["alnitak"]);
  });

  it("gives one edge per pair however many segments repeat it", () => {
    const leaves = [
      { id: "con_tst__0", pts: [[10, 10], [20, 20]] as [number, number][] },
      { id: "con_tst__1", pts: [[20, 20], [10, 10]] as [number, number][] },
    ];
    const boxes = new Map([["a", box(10, 10)], ["b", box(20, 20)]]);
    expect(connectKey(leaves, boxes, "con_tst").edges).toEqual([["a", "b"]]);
  });

  it("is empty for a constellation that is not drawn", () => {
    expect(connectKey([], new Map(), "con_ori")).toEqual({ stars: [], edges: [], unmatched: 0 });
  });

  describe("against a real focused chart", () => {
    // Mirrors tests/sky-template.test.ts's own setup: the engines it awaits,
    // how it re-registers the pack from the file on disk (so this file is not
    // at the mercy of whatever another test file left registered), and the
    // spec shape it builds. elementBBoxes is called with no measure argument
    // there too, so the default (heuristicMeasure) is what this test uses.
    let layoutSpec: typeof import("../src/layout/layout").layoutSpec;
    let elementBBoxes: typeof import("../src/layout/layout").elementBBoxes;
    let leafDrawables: typeof import("../src/layout/model").leafDrawables;

    beforeAll(async () => {
      const spaceYaml = (await import("../src/scenes/packs/space.yaml?raw")).default;
      const { registerPack, unregisterPack } = await import("../src/scenes/packs");
      const { ensureEngines } = await import("../src/scenes/engines");
      const layout = await import("../src/layout/layout");
      const model = await import("../src/layout/model");
      layoutSpec = layout.layoutSpec;
      elementBBoxes = layout.elementBBoxes;
      leafDrawables = model.leafDrawables;
      await ensureEngines(["space", "sky"]);
      unregisterPack("space");
      registerPack("space", spaceYaml);
    });

    it("recovers Orion's 24 edges from a real focused chart", () => {
      const spec = {
        template: "sky_map",
        params: { focus: "con_ori", time: "2026-01-15T22:00:00+01:00" },
        elements: [],
      };
      const lay = layoutSpec(spec as never);
      const k = connectKey(leafDrawables(lay.drawables), elementBBoxes(lay), "con_ori");
      expect(k.unmatched).toBe(0);
      expect(k.edges.length).toBe(24);
      expect(k.stars.length).toBe(23);
    });
  });
});
