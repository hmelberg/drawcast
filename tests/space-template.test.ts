import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import bundledExamples from "../src/examples.json";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { COLORS, flattenDrawables, leafDrawables, type Drawable, type StrokeDrawable } from "../src/layout/model";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";

const DATE = "2026-09-06";
const lay = (params: Record<string, unknown>) => scenes.solar_system.layout!({ date: DATE, ...params });
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const leaf = (r: ReturnType<typeof lay>, id: string): Drawable | undefined => flattenDrawables(r.drawables).find((d) => d.id === id);
/** The drawn radius of a body: its own circle hint, or its disc's inside a ringed group. */
const radiusOf = (r: ReturnType<typeof lay>, id: string): number => {
  const d = (leaf(r, id + "__disc") ?? leaf(r, id)) as StrokeDrawable | undefined;
  return d?.shapeHint?.type === "circle" ? d.shapeHint.r : NaN;
};
/** Label text wherever the layout put it: a solver request (top views) or a placed text (row). */
const labelText = (r: ReturnType<typeof lay>, id: string): string | undefined => {
  const req = r.labels.find((l) => l.id === id);
  if (req) return req.text;
  const d = leaf(r, id);
  return d && d.kind === "text" ? d.text : undefined;
};
const spec = (params: Record<string, unknown>) => ({ template: "solar_system", params: { date: DATE, ...params }, elements: [] }) as never;
const PLANETS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

beforeAll(async () => {
  await ensureEngines(["space"]);
  unregisterPack("space");
  registerPack("space", spaceYaml);
});

describe("solar_system: registration and the default figure", () => {
  test("registers as one ready template", () => {
    unregisterPack("space");
    expect(registerPack("space", spaceYaml)).toMatchObject({ ok: true, templateIds: ["solar_system"] });
  });

  test("draws the Sun, the eight planets, their orbits and names, and the scale note", () => {
    const ids = idsOf({});
    expect(ids).toContain("sun");
    for (const p of PLANETS) {
      expect(ids).toContain(p);
      expect(ids).toContain("orbit_" + p);
      expect(ids).toContain("label_" + p);
    }
    expect(ids).toContain("label_sun");
    expect(ids).toContain("scale_note");
    expect(ids).not.toContain("scale_bar");
    expect(ids).not.toContain("frame");
    expect(ids).not.toContain("axis");
    expect(ids).not.toContain("pluto");
  });

  test("group words and ids select the bodies; unknown names and moons go to the note", () => {
    // `order` is the PAINTER'S order — far bodies first, so a near one covers a
    // far one when tilted (svg-backend paints layout.order, not the drawables
    // array). It therefore moves with the date; what a group word pins is WHICH.
    expect(PLANETS.filter((p) => idsOf({ bodies: ["inner"] }).includes(p))).toEqual(["mercury", "venus", "earth", "mars"]);
    expect(idsOf({ bodies: ["all"] })).toContain("eris");
    const r = lay({ bodies: ["planets", "krypton", "io"] });
    expect(r.order).not.toContain("io");
    expect(labelText(r, "missing_note")).toBe("Unknown: krypton, io (a moon: use focus)");
    expect(r.order.filter((id) => PLANETS.includes(id))).toHaveLength(8);
    // The Sun is the centre of every top view already, so naming it among the
    // bodies is a no-op — never "sun (a moon: use focus)".
    const withSun = lay({ bodies: ["sun", "earth"] });
    expect(labelText(withSun, "missing_note")).toBeUndefined();
    expect(withSun.order).toEqual(expect.arrayContaining(["sun", "earth"]));
  });

  test("names: en, nb or none", () => {
    expect(labelText(lay({}), "label_earth")).toBe("Earth");
    expect(labelText(lay({ names: "nb" }), "label_earth")).toBe("Jorden");
    expect(labelText(lay({ names: "nb" }), "scale_note")).toBe("Ikke i målestokk");
    expect(idsOf({ names: "none" }).some((id) => id.startsWith("label_"))).toBe(false);
  });

  test("orbits can be switched off, and a row never has them", () => {
    expect(idsOf({ orbits: false }).some((id) => id.startsWith("orbit_"))).toBe(false);
    expect(idsOf({ view: "row" }).some((id) => id.startsWith("orbit_"))).toBe(false);
  });

  // The manifest's own examples are what the compiler prompt shows the model:
  // every other pack sweeps them in tests/packs.test.ts, and a broken one
  // teaches a shape the repair round then argues with. The pinned date goes in
  // FIRST so an example that names its own still wins — one of them
  // deliberately omits `date` ("right now" is its whole point), and letting
  // that resolve to today would make this test's geometry, and so its verdict,
  // change with the sky.
  test("every example in the manifest lays out with no warning and no error lint", () => {
    for (const ex of scenes.solar_system.manifest.examples) {
      const res = layoutSpec({ template: "solar_system", params: { date: DATE, ...ex.params }, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), ex.request).toEqual([]);
    }
  });

  test("the same params give byte-identical layouts — no clock in the layout", () => {
    expect(JSON.stringify(lay({ view: "tilted" }))).toBe(JSON.stringify(lay({ view: "tilted" })));
  });
});

describe("solar_system: scale", () => {
  test("schematic keeps the Sun within a sixth of the frame, in both views", () => {
    expect(radiusOf(lay({}), "sun")).toBeLessThanOrEqual(104);
    expect(radiusOf(lay({ view: "row" }), "sun")).toBeLessThanOrEqual(104);
  });

  test("sizes in a row keeps Jupiter/Earth ≈ 11 and shows the Sun as a segment inside the canvas", () => {
    const r = lay({ view: "row", scale: "sizes" });
    expect(radiusOf(r, "jupiter") / radiusOf(r, "earth")).toBeGreaterThan(10.5);
    expect(radiusOf(r, "jupiter") / radiusOf(r, "earth")).toBeLessThan(11.5);
    const sun = leaf(r, "sun");
    expect(sun?.kind).toBe("group");
    const kids = leafDrawables([sun!]);
    expect(kids.map((d) => d.id).sort()).toEqual(["sun__arc", "sun__fill"]);
    for (const d of kids) {
      for (const [x, y] of (d as { pts: [number, number][] }).pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(750);
      }
    }
    expect(labelText(r, "scale_note")).toBe("Sizes to scale, distances not");
    expect(labelText(r, "scale_bar__label")).toMatch(/km$/);
  });

  test("sizes from above clamps the Sun and says so", () => {
    const r = lay({ view: "top", scale: "sizes" });
    expect(radiusOf(r, "sun")).toBeLessThanOrEqual(104);
    expect(labelText(r, "scale_note")).toBe("Sizes to scale, Sun reduced, distances not");
  });

  // The clamp is not the Sun's alone: a portrait of Jupiter and its moons cuts
  // Jupiter from ~584 px to 103, and the note has to name the body it means.
  test("sizes under focus clamps the focus body and names IT, not the Sun", () => {
    const r = lay({ focus: "jupiter", scale: "sizes" });
    expect(radiusOf(r, "jupiter")).toBeLessThanOrEqual(104);
    expect(radiusOf(r, "jupiter") / radiusOf(r, "ganymede")).toBeLessThan(69911 / 2634.1);
    expect(labelText(r, "scale_note")).toBe("Sizes to scale, Jupiter reduced, distances not");
    expect(labelText(lay({ focus: "jupiter", scale: "sizes", names: "nb" }), "scale_note")).toBe("Størrelser i målestokk, Jupiter forminsket, avstander ikke");
  });

  test("distances: orbits proportional to a, every body the same dot, a bar in AU", () => {
    const r = lay({ scale: "distances", bodies: ["inner"] });
    const orbitR = (id: string): number => {
      const o = leaf(r, "orbit_" + id) as StrokeDrawable;
      return Math.hypot(o.pts[0][0] - 500, o.pts[0][1] - 390);
    };
    expect(orbitR("mars") / orbitR("earth")).toBeCloseTo(227956000 / 149598000, 2);
    expect(radiusOf(r, "mercury")).toBe(radiusOf(r, "mars"));
    expect(labelText(r, "scale_note")).toBe("Distances to scale, sizes not");
    expect(labelText(r, "scale_bar__label")).toBe("1 AU");
  });

  test("log: the note says so and the eight planets get a 1 → 10 AU ruler", () => {
    const r = lay({ scale: "log" });
    expect(labelText(r, "scale_note")).toBe("Log distances");
    expect(r.order).toContain("scale_bar");
    expect(labelText(r, "scale_bar__label")).toBe("1 → 10 AU");
    expect(idsOf({ scale: "log", bodies: ["inner"] })).not.toContain("scale_bar"); // no decade pair between 0.39 and 1.52 AU
  });

  test("every view × scale × selection lays out without a lint error", () => {
    for (const view of ["top", "row", "tilted"]) {
      for (const scale of ["schematic", "sizes", "distances", "log"]) {
        for (const bodies of [["planets"], ["all"], ["inner"]]) {
          const res = layoutSpec(spec({ view, scale, bodies }));
          expect(res.warnings, `${view}/${scale}/${bodies}`).toEqual([]);
          expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), `${view}/${scale}/${bodies}`).toEqual([]);
        }
      }
    }
  });

  test("the drawn point budget stays under 4000", () => {
    const pts = leafDrawables(lay({ bodies: ["all"] }).drawables).reduce((s, d) => s + ("pts" in d ? d.pts.length : 0), 0);
    expect(pts).toBeLessThan(4000);
  });
});

describe("solar_system: focus, moons, time, highlight, clicks", () => {
  test("focus draws the body large with its moons, orbits, axis and frame — and nothing else", () => {
    const ids = idsOf({ focus: "jupiter" });
    for (const m of ["io", "europa", "ganymede", "callisto"]) {
      expect(ids).toContain(m);
      expect(ids).toContain("orbit_" + m);
      expect(ids).toContain("label_" + m);
    }
    expect(ids).toContain("jupiter");
    expect(ids).toContain("axis");
    expect(ids).toContain("frame");
    expect(ids).not.toContain("sun");
    expect(ids).not.toContain("mars");
    expect(radiusOf(lay({ focus: "jupiter" }), "jupiter")).toBeGreaterThan(60);
  });

  test("moons filters the focus body's moons; a foreign moon goes to the note", () => {
    const ids = idsOf({ focus: "jupiter", moons: ["io"] });
    expect(ids).toContain("io");
    expect(ids).not.toContain("europa");
    expect(labelText(lay({ focus: "jupiter", moons: ["titan"] }), "missing_note")).toBe("Unknown: titan (not a moon of jupiter)");
  });

  test("a body without moons stands alone; Saturn brings its ring", () => {
    const venus = lay({ focus: "venus" });
    expect(venus.order).toEqual(expect.arrayContaining(["frame", "venus", "axis", "label_venus", "scale_note"]));
    expect(venus.order.some((id) => id.startsWith("orbit_"))).toBe(false);
    const saturn = lay({ focus: "saturn", moons: ["titan"] });
    expect(leafDrawables([leaf(saturn, "saturn")!]).map((d) => d.id)).toEqual(expect.arrayContaining(["saturn__ringb", "saturn__disc", "saturn__ringf"]));
  });

  test("nothing a focus figure draws leaves the canvas", () => {
    for (const focus of ["jupiter", "saturn", "earth", "pluto", "venus"]) {
      for (const scale of ["schematic", "sizes", "distances", "log"]) {
        const res = layoutSpec(spec({ focus, scale }));
        expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), `${focus}/${scale}`).toEqual([]);
      }
    }
  });

  test("days moves Mars along its orbit, and one Martian year brings it back", () => {
    const a = lay({ bodies: ["inner"] }).anchors.mars;
    const b = lay({ bodies: ["inner"], days: 100 }).anchors.mars;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(40);
    const back = lay({ bodies: ["inner"], days: 687 }).anchors.mars;
    expect(Math.hypot(a[0] - back[0], a[1] - back[1])).toBeLessThan(12);
  });

  test("highlight tints the body's rim without removing anything", () => {
    const r = lay({ highlight: ["mars"] });
    expect((leaf(r, "mars") as StrokeDrawable).style.color).toBe(COLORS.accent);
    expect(r.order).toContain("venus");
  });

  test("a body's box is its disc, so a click-ask can hit even a small planet", () => {
    const box = elementBBoxes(layoutSpec(spec({}))).get("mercury")!;
    expect(box.w).toBeCloseTo(2 * radiusOf(lay({}), "mercury"), 3);
  });

  test("tilted compresses the vertical spread and keeps everything on the page", () => {
    const spread = (params: Record<string, unknown>): number => {
      const ys = PLANETS.map((p) => lay(params).anchors[p][1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread({ view: "tilted" })).toBeLessThan(0.7 * spread({ view: "top" }));
  });
});

describe("bundled space examples", () => {
  test("drawcast ships five space examples", () => {
    expect((bundledExamples as { packs?: string[] }[]).filter((e) => e.packs?.includes("space"))).toHaveLength(5);
  });
});
