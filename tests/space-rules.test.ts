import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable, Body } from "../src/scenes/space/types";
import {
  AU_KM, DWARF_IDS, FRAME, MIN_BODY_PX, PLANET_IDS, circle, clipRingToBox, drawnRadii, expandBodies, indexBodies,
  labelTiers, logRadius, moonsOf, orbitRadii, satellitesFor, scaleBar, scaleNote, sunSegment,
} from "../src/scenes/space/rules";

const table = bodiesJson as unknown as BodiesTable;
const all = indexBodies(table);
const B = (id: string): Body => all[id];
const sorted = (ids: readonly string[]): Body[] => ids.map(B).sort((a, b) => a.a_km - b.a_km);

describe("the bodies table", () => {
  test("has the 35 bodies of the spec, with unique lower-case ids and a source line", () => {
    expect(table.bodies).toHaveLength(35);
    expect(typeof table.source).toBe("string");
    const ids = table.bodies.map((b) => b.id);
    expect(new Set(ids).size).toBe(35);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
  });

  test("one star, eight planets, five dwarfs, twenty-one moons", () => {
    const count = (k: string) => table.bodies.filter((b) => b.kind === k).length;
    expect(count("star")).toBe(1);
    expect(count("planet")).toBe(8);
    expect(count("dwarf")).toBe(5);
    expect(count("moon")).toBe(21);
  });

  test("every parent exists; the Sun has none; planets and dwarfs orbit the Sun; moons orbit a planet or dwarf", () => {
    for (const b of table.bodies) {
      if (b.id === "sun") { expect(b.parent).toBeNull(); continue; }
      expect(b.parent && all[b.parent], b.id).toBeTruthy();
      if (b.kind === "planet" || b.kind === "dwarf") expect(b.parent).toBe("sun");
      if (b.kind === "moon") expect(["planet", "dwarf"]).toContain(all[b.parent!].kind);
    }
  });

  test("units are sane: Earth at 1 AU, a year of 365 days, 6 371 km", () => {
    expect(B("earth").a_km / AU_KM).toBeCloseTo(1, 3);
    expect(B("earth").period_d).toBeCloseTo(365.256, 2);
    expect(B("earth").r_km).toBe(6371);
    expect(B("jupiter").r_km / B("earth").r_km).toBeGreaterThan(10.9);
  });

  test("every body has a 6-digit colour, both names and both Wikipedia titles", () => {
    for (const b of table.bodies) {
      expect(b.color, b.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(b.name.en && b.name.nb, b.id).toBeTruthy();
      expect(b.wiki.en && b.wiki.nb, b.id).toBeTruthy();
    }
    expect(B("saturn").ring).toEqual({ inner: 1.24, outer: 2.27, color: "#d8c9a3" });
    expect(B("neptune").name.nb).toBe("Neptun");
    expect(B("ganymede").wiki.nb).toBe("Ganymedes");
  });
});

describe("expandBodies", () => {
  test("group words expand in place, in the table's order", () => {
    expect(expandBodies(all, ["planets"]).ids).toEqual([...PLANET_IDS]);
    expect(expandBodies(all, ["inner"]).ids).toEqual(["mercury", "venus", "earth", "mars"]);
    expect(expandBodies(all, ["outer"]).ids).toEqual(["jupiter", "saturn", "uranus", "neptune"]);
    expect(expandBodies(all, ["all"]).ids).toEqual([...PLANET_IDS, ...DWARF_IDS]);
    expect(expandBodies(all, ["inner", "jupiter"]).ids).toEqual(["mercury", "venus", "earth", "mars", "jupiter"]);
  });

  test("ids and names match case-insensitively, in either language; duplicates collapse", () => {
    expect(expandBodies(all, ["Mars", "JUPITER", "Jorden", "mars"])).toEqual({ ids: ["mars", "jupiter", "earth"], missing: [] });
  });

  test("unknown names are reported, never thrown; moons are known", () => {
    expect(expandBodies(all, ["krypton", "io"])).toEqual({ ids: ["io"], missing: ["krypton"] });
    expect(expandBodies(all, [])).toEqual({ ids: [], missing: [] });
  });
});

describe("moons and satellites", () => {
  test("moonsOf lists a body's children innermost first", () => {
    expect(moonsOf(all, "jupiter").map((b) => b.id)).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(moonsOf(all, "saturn")).toHaveLength(7);
    expect(moonsOf(all, "venus")).toEqual([]);
  });

  test("a focus draws all its moons by default; `moons` filters, by moon id or the parent's id", () => {
    expect(satellitesFor(all, "jupiter", undefined).ids).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(satellitesFor(all, "jupiter", ["jupiter"]).ids).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(satellitesFor(all, "jupiter", ["europa", "io"]).ids).toEqual(["io", "europa"]);
    expect(satellitesFor(all, "jupiter", ["titan"])).toEqual({ ids: [], missing: ["titan (not a moon of jupiter)"] });
    expect(satellitesFor(all, "jupiter", ["krypton"])).toEqual({ ids: [], missing: ["krypton"] });
  });

  test("no focus, no satellites", () => {
    expect(satellitesFor(all, null, ["jupiter"])).toEqual({ ids: [], missing: [] });
  });
});

describe("orbitRadii", () => {
  const inner = sorted(["mercury", "venus", "earth", "mars"]);
  test("schematic and sizes space the orbits evenly from rMin to rMax", () => {
    expect(orbitRadii(inner, "schematic", 60, 290)).toEqual([60, 60 + 230 / 3, 60 + (2 * 230) / 3, 290]);
    expect(orbitRadii(inner, "sizes", 60, 290)).toEqual(orbitRadii(inner, "schematic", 60, 290));
  });
  test("distances are proportional to a_km, the outermost at rMax", () => {
    const r = orbitRadii(inner, "distances", 60, 290);
    expect(r[3]).toBe(290);
    expect(r[2]).toBeCloseTo((290 * B("earth").a_km) / B("mars").a_km, 6);
  });
  test("log runs from rMin to rMax and keeps the order", () => {
    const r = orbitRadii(sorted(PLANET_IDS), "log", 60, 290);
    expect(r[0]).toBe(60);
    expect(r[7]).toBe(290);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    expect(logRadius(1, 1, 100, 0, 100)).toBe(0);
    expect(logRadius(10, 1, 100, 0, 100)).toBeCloseTo(50, 9);
  });
  test("one body sits midway; none gives none", () => {
    expect(orbitRadii([B("moon")], "schematic", 130, 290)).toEqual([210]);
    expect(orbitRadii([B("moon")], "distances", 130, 290)).toEqual([290]);
    expect(orbitRadii([], "schematic", 60, 290)).toEqual([]);
  });
});

describe("drawnRadii", () => {
  const planets = sorted(PLANET_IDS);
  test("sizes keeps true ratios: Jupiter/Earth ≈ 11, the Sun ≈ 10 Jupiters", () => {
    const r = drawnRadii(B("sun"), planets, "sizes", 70);
    const at = (id: string) => r.bodies[planets.findIndex((b) => b.id === id)];
    expect(at("jupiter")).toBe(70);
    expect(at("jupiter") / at("earth")).toBeCloseTo(69911 / 6371, 1);
    expect(r.centre).toBeCloseTo((70 * 695700) / 69911, 3);
  });
  test("schematic compresses by the square root; small bodies never vanish", () => {
    const r = drawnRadii(B("sun"), planets, "schematic", 14);
    const at = (id: string) => r.bodies[planets.findIndex((b) => b.id === id)];
    expect(at("jupiter") / at("earth")).toBeCloseTo(Math.sqrt(69911 / 6371), 2);
    expect(at("mercury")).toBeGreaterThanOrEqual(MIN_BODY_PX);
    expect(drawnRadii(B("sun"), planets, "log", 14)).toEqual(r);
  });
  test("distances: every body the same small dot; the centre true-relative when the scale is given", () => {
    expect(drawnRadii(B("sun"), planets, "distances", 14)).toEqual({ centre: 8, bodies: planets.map(() => 5) });
    const pxPerKm = 290 / B("mars").a_km;
    expect(drawnRadii(B("sun"), planets, "distances", 14, pxPerKm).centre).toBe(3); // 0.9 px, floored
    expect(drawnRadii(B("jupiter"), moonsOf(all, "jupiter"), "distances", 14, 290 / B("callisto").a_km).centre).toBeCloseTo((290 * 69911) / 1882700, 3);
  });
  test("a body alone gets the budget", () => {
    expect(drawnRadii(B("venus"), [], "schematic", 120)).toEqual({ centre: 120, bodies: [] });
  });
});

describe("the Sun as a segment", () => {
  test("a circle that leaves the frame is clipped to it, and its visible arc is a contiguous run inside", () => {
    const { fill, arc, clipped } = sunSegment([-767, 390], 877, FRAME);
    expect(clipped).toBe(true);
    for (const [x, y] of fill) {
      expect(x).toBeGreaterThanOrEqual(FRAME.x0 - 1e-6);
      expect(x).toBeLessThanOrEqual(FRAME.x1 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(FRAME.y0 - 1e-6);
      expect(y).toBeLessThanOrEqual(FRAME.y1 + 1e-6);
    }
    expect(arc.length).toBeGreaterThan(10);
    for (const [x] of arc) expect(x).toBeGreaterThanOrEqual(FRAME.x0);
    for (let i = 1; i < arc.length; i++) expect(Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1])).toBeLessThan(40);
  });
  test("a circle inside the frame is untouched", () => {
    const { fill, arc, clipped } = sunSegment([160, 390], 97, FRAME);
    expect(clipped).toBe(false);
    expect(fill).toHaveLength(240);
    expect(arc).toHaveLength(240);
  });
  test("clipRingToBox is Sutherland–Hodgman: a square half outside comes back as the inside half", () => {
    const out = clipRingToBox([[-10, 0], [10, 0], [10, 10], [-10, 10]], { x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(out).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const first = circle([0, 0], 1, 4)[0];
    expect(first[0]).toBeCloseTo(-1, 9);
    expect(first[1]).toBeCloseTo(0, 9);
  });
});

describe("the note, the bar and the tiers", () => {
  test("every scale mode states which truth it keeps, in both languages", () => {
    expect(scaleNote("schematic", "en")).toBe("Not to scale");
    expect(scaleNote("sizes", "en")).toBe("Sizes to scale, distances not");
    expect(scaleNote("distances", "en")).toBe("Distances to scale, sizes not");
    expect(scaleNote("log", "en")).toBe("Log distances");
    expect(scaleNote("schematic", "nb")).toBe("Ikke i målestokk");
    expect(scaleNote("distances", "nb")).toBe("Avstander i målestokk, størrelser ikke");
  });

  // The clamped body is NAMED, because it is not always the Sun: a portrait of
  // Jupiter and its moons clamps Jupiter, and a note that says "Sun reduced"
  // there describes a body the figure does not contain.
  test("the reduced body is named, in both languages, and only under sizes", () => {
    expect(scaleNote("sizes", "en", "Sun")).toBe("Sizes to scale, Sun reduced, distances not");
    expect(scaleNote("sizes", "nb", "Solen")).toBe("Størrelser i målestokk, Solen forminsket, avstander ikke");
    expect(scaleNote("sizes", "en", "Jupiter")).toBe("Sizes to scale, Jupiter reduced, distances not");
    expect(scaleNote("sizes", "en", "")).toBe("Sizes to scale, distances not");
    expect(scaleNote("schematic", "en", "Sun")).toBe("Not to scale");
  });
  test("the bar picks a round unit that draws between 50 and 300 px", () => {
    expect(scaleBar("sizes", 0.001, "en")).toEqual({ lengthPx: 100, label: "100\u202f000\u202fkm" });
    const mars = scaleBar("distances", 290 / B("mars").a_km, "en");
    expect(mars?.label).toBe("1 AU");
    expect(mars?.lengthPx).toBeCloseTo(190.3, 0);
    const neptune = scaleBar("distances", 290 / B("neptune").a_km, "en");
    expect(neptune?.label).toBe("10 AU");
    expect(neptune?.lengthPx).toBeCloseTo(96.1, 0);
    expect(scaleBar("schematic", 0.001, "en")).toBeNull();
    expect(scaleBar("log", 0.001, "en")).toBeNull();
  });
  test("labelTiers drops a name to the next tier when its neighbour's is too close", () => {
    expect(labelTiers([100, 130, 160, 400], [70, 70, 70, 70], 6)).toEqual([0, 1, 2, 0]);
    expect(labelTiers([100, 300], [70, 70], 6)).toEqual([0, 0]);
    expect(labelTiers([], [], 6)).toEqual([]);
  });
});
