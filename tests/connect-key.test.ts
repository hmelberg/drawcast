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

  // Final whole-branch review, F3: the three candidate exclusions
  // (`label_…`, a `__`-suffixed leaf id, `conId` itself) passed the full
  // suite with any one of them removed — the existing fixtures never put a
  // decoy in a position where it would actually WIN a vertex. Each test
  // below puts the excluded candidate at the exact vertex AND first in the
  // Map, so only its own guard clause can stop it from winning the tie
  // (ties go to whichever candidate is seen first — see the tie-break note
  // in connectKey's own doc comment).
  it("without the label_ guard, a name at the vertex would steal it from its star", () => {
    const leaves = [{ id: "con_tst__0", pts: [[10, 10], [20, 20]] as [number, number][] }];
    const boxes = new Map([
      ["label_alnitak", box(10, 10)], // first in the Map, sits exactly on the vertex
      ["alnitak", box(10, 10)], // the real star, same point, second
      ["hip_2", box(20, 20)],
    ]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.stars.map((s) => s.id)).toEqual(["alnitak", "hip_2"]);
    expect(k.edges).toEqual([["alnitak", "hip_2"]]);
  });

  it("without the __ guard, a group's own sub-leaf id at the vertex would steal it from the star", () => {
    const leaves = [{ id: "con_tst__0", pts: [[10, 10], [20, 20]] as [number, number][] }];
    const boxes = new Map([
      ["other__3", box(10, 10)], // another group's own sub-leaf id, first in the Map, exactly on the vertex
      ["alnitak", box(10, 10)],
      ["hip_2", box(20, 20)],
    ]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.stars.map((s) => s.id)).toEqual(["alnitak", "hip_2"]);
    expect(k.edges).toEqual([["alnitak", "hip_2"]]);
  });

  it("without the conId guard, the figure's own bounding box would steal a vertex from the star", () => {
    const leaves = [{ id: "con_tst__0", pts: [[10, 10], [20, 20]] as [number, number][] }];
    const boxes = new Map([
      ["con_tst", box(10, 10)], // the group's own box, first in the Map, exactly on the vertex
      ["alnitak", box(10, 10)],
      ["hip_2", box(20, 20)],
    ]);
    const k = connectKey(leaves, boxes, "con_tst");
    expect(k.stars.map((s) => s.id)).toEqual(["alnitak", "hip_2"]);
    expect(k.edges).toEqual([["alnitak", "hip_2"]]);
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

  // Round 1 review, finding 1: the candidate filter lets `stars`, `frame`,
  // `figures`, a body — anything that is not `label_…`, the group id itself,
  // or a `__`-suffixed sub-element — compete for a vertex. Nothing stops a
  // gap (a vertex no real star sits under, like the one above) from being
  // claimed by whichever OTHER element happens to sit within `eps` of it,
  // and the wide old default (2 logical units) was exactly the width that
  // let that happen. The true match distance is floating-point noise — the
  // template builds a vertex and its star's box from the SAME projection
  // call — so there is no legitimate match this tight tolerance could miss,
  // only illegitimate ones it now excludes.
  it("a decoy near a gap cannot win it at the tight default, though the old wide one let it", () => {
    const leaves = [{ id: "con_tst__0", pts: [[100, 100], [110, 100]] as [number, number][] }];
    const boxes = new Map([
      ["star", box(100, 100)], // sits exactly on the first vertex
      ["decoy", box(111, 100)], // 1 unit from the SECOND vertex — no real star sits there
    ]);
    const tight = connectKey(leaves, boxes, "con_tst"); // the new default, eps = 0.25
    expect(tight.unmatched).toBe(1);
    expect(tight.edges).toEqual([]);
    expect(tight.stars.map((s) => s.id)).toEqual(["star"]);

    const wide = connectKey(leaves, boxes, "con_tst", 2); // the OLD default
    expect(wide.unmatched).toBe(0);
    expect(wide.edges).toEqual([["decoy", "star"]]); // the decoy wins a vertex it has no business claiming
  });

  // Finding 2: two candidates at exactly equal distance used to resolve to
  // whichever the boxes map handed out last — Map iteration order, which is
  // element/draw order — a coin-flip nobody had decided on purpose. `<`
  // makes the FIRST-seen candidate win a tie, deterministically.
  it("an exact tie goes to whichever candidate is seen first, not last", () => {
    const leaves = [{ id: "con_tst__0", pts: [[50, 50], [50, 50]] as [number, number][] }];
    const boxes = new Map([
      ["first", box(50, 50)],
      ["second", box(50, 50)], // the same exact point — a genuine tie
    ]);
    expect(connectKey(leaves, boxes, "con_tst").stars.map((s) => s.id)).toEqual(["first"]);
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

    // The Orion test above proves the tight default (eps = 0.25) matches ONE
    // figure. This proves it is not Orion being kind: a dozen more, each its
    // own portrait, each a real focused sky_map layout — and if even one of
    // them came back with unmatched > 0, that would mean a polyline vertex
    // and its star's box centre are NOT the same point after all, which is a
    // fact worth stopping for rather than a number worth loosening.
    it("the tight default matches every vertex of a dozen real figures, not just Orion", () => {
      const SEASONS = ["2026-03-20T21:00:00Z", "2026-06-21T01:00:00Z", "2026-09-22T21:00:00Z", "2026-12-20T21:00:00Z"];
      // Scorpius never clears Oslo's horizon at any of the four seasonal
      // moments above — the same four months, seen from Sydney instead, are
      // what put it overhead as a portrait.
      const SCO_SYDNEY = { lat: -33.87, lon: 151.21, place: "Sydney" };
      const SCO_TIMES = ["2026-06-15T12:00:00Z", "2026-07-15T12:00:00Z", "2026-08-15T12:00:00Z", "2026-09-15T12:00:00Z"];
      const abbrs = ["Ori", "UMa", "Cas", "Cyg", "Leo", "Sco", "Lyr", "CMa", "Tau", "Gem", "Aur", "Boo"];
      let checked = 0;
      for (const abbr of abbrs) {
        const extra = abbr === "Sco" ? SCO_SYDNEY : {};
        const times = abbr === "Sco" ? SCO_TIMES : SEASONS;
        let portrait: ReturnType<typeof layoutSpec> | null = null;
        for (const time of times) {
          const r = layoutSpec({ template: "sky_map", params: { focus: abbr, time, ...extra }, elements: [] } as never);
          if (r.order.includes("frame")) {
            portrait = r;
            break;
          }
        }
        expect(portrait, `${abbr} never became a portrait at any of the swept moments`).not.toBeNull();
        const conId = "con_" + abbr.toLowerCase();
        const k = connectKey(leafDrawables(portrait!.drawables), elementBBoxes(portrait!), conId);
        expect(k.unmatched, `${abbr}: ${JSON.stringify(k)}`).toBe(0);
        expect(k.edges.length, abbr).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBe(abbrs.length);
    });
  });
});
