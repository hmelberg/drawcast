import { describe, expect, test } from "vitest";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, getLoadedEngines, type SpaceEngine } from "../src/scenes/engines";
import { TEMPLATE_DOC_API_SCHEMA } from "../src/llm/author";

async function space(): Promise<SpaceEngine> {
  await ensureEngines(["space"]);
  return getLoadedEngines(["space"]).space as SpaceEngine;
}

describe("space engine (real load — node, no DOM)", () => {
  test("is a known engine with a loader, and the authoring schema's enum agrees", () => {
    expect(KNOWN_ENGINES).toContain("space");
    expect(ENGINE_DEFS.space).toBeDefined();
    expect(TEMPLATE_DOC_API_SCHEMA.properties.engines.items.enum).toContain("space");
  });

  test("bodies, groups and moons come from the table", async () => {
    const eng = await space();
    expect(eng.bodies(["planets"]).bodies.map((b) => b.id)).toHaveLength(8);
    expect(eng.bodies(["Jorden", "krypton"])).toMatchObject({ missing: ["krypton"] });
    expect(eng.body("mars")?.name.nb).toBe("Mars");
    expect(eng.moonsOf("jupiter").map((b) => b.id)).toEqual(["io", "europa", "ganymede", "callisto"]);
    expect(eng.satellites("jupiter", ["io"]).bodies.map((b) => b.id)).toEqual(["io"]);
    expect(Object.keys(eng.all())).toHaveLength(35);
  });

  test("positions, moon positions, phase and the schematic flag go through", async () => {
    const eng = await space();
    const d = eng.resolveDate("2026-09-06", 0);
    const p = eng.positions(["earth"], d).earth;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 1);
    expect(typeof p.z).toBe("number");
    expect(Math.hypot(eng.moonPositions("earth", ["moon"], d).moon.x, eng.moonPositions("earth", ["moon"], d).moon.y)).toBeGreaterThan(350000);
    expect(eng.phase(d).fraction).toBeLessThanOrEqual(1);
    expect(eng.schematic("ceres")).toBe(true);
    expect(eng.schematic("mars")).toBe(false);
    expect(eng.au(eng.km(2))).toBeCloseTo(2, 9);
  });

  test("the scale rules are reachable from a layout body", async () => {
    const eng = await space();
    const inner = eng.bodies(["inner"]).bodies;
    expect(eng.orbitRadii(inner, "schematic", 60, 290)).toHaveLength(4);
    expect(eng.drawnRadii(eng.body("sun")!, inner, "sizes", 40).bodies).toHaveLength(4);
    expect(eng.sunSegment([-700, 390], 800, { x0: 60, y0: 80, x1: 940, y1: 700 }).clipped).toBe(true);
    expect(eng.scaleNote("schematic", "nb")).toBe("Ikke i målestokk");
    expect(eng.scaleBar("sizes", 0.001, "en")?.lengthPx).toBe(100);
    expect(eng.labelTiers([0, 10], [30, 30], 4)).toEqual([0, 1]);
    expect(eng.logRadius(10, 1, 100, 0, 100)).toBeCloseTo(50, 9);
  });
});
