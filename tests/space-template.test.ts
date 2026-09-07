import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import bundledExamples from "../src/examples.json";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { COLORS, flattenDrawables, leafDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";

const DATE = "2026-09-06";
const lay = (params: Record<string, unknown>) => scenes.solar_system.layout!({ date: DATE, ...params });
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const leaf = (r: ReturnType<typeof lay>, id: string): Drawable | undefined => flattenDrawables(r.drawables).find((d) => d.id === id);
/** The drawn radius of a body: its own circle hint, or its disc's inside a ringed group. */
const radiusOf = (r: ReturnType<typeof lay>, id: string): number => {
  const d = (leaf(r, id + "__disc") ?? leaf(r, id)) as StrokeDrawable | undefined;
  return d?.shapeHint?.type === "circle" ? d.shapeHint.r : NaN;
};
/** Any text this layout drew. The pack issues no solver requests any more — it
 *  places every name itself, in the top views as well as the row, so a name is
 *  a drawable like the notes and the scale bar's caption. */
const labelText = (r: ReturnType<typeof lay>, id: string): string | undefined => {
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
  // `warnings` is the NARROWER field: it carries the layout's own complaints,
  // not the lint's. Both of this template's first two defects — names lying
  // across the orbit guides, and a row's name tiers stepping less than a line
  // of type — showed up in `issues` and in nothing else, which is how they
  // shipped. Assert on `issues`, and on all of them, not just the errors.
  test("every example in the manifest lays out with NO lint issue at all", () => {
    for (const ex of scenes.solar_system.manifest.examples) {
      const res = layoutSpec({ template: "solar_system", params: { date: DATE, ...ex.params }, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues.map((i) => `[${i.severity}] ${i.message}`), ex.request).toEqual([]);
    }
  });

  // Determinism for a PINNED date, which is what every sweep in this file
  // rests on. Not the absence of a clock: `resolveDate`
  // (src/scenes/space/ephemeris.ts) is one by design, and reads the real one
  // whenever `date` is missing or "today" — `lay` pins a date so that this
  // file never asks it to.
  test("the same params and the same date give byte-identical layouts", () => {
    expect(JSON.stringify(lay({ view: "tilted" }))).toBe(JSON.stringify(lay({ view: "tilted" })));
  });
});

describe("solar_system: scale", () => {
  test("schematic keeps the Sun within a sixth of the frame, in both views", () => {
    expect(radiusOf(lay({}), "sun")).toBeLessThanOrEqual(104);
    expect(radiusOf(lay({ view: "row" }), "sun")).toBeLessThanOrEqual(104);
  });

  // The branch nothing else reaches: a selection that resolves to NO body.
  // `bodies: ["krypton"]` is a real request — an unrecognised name is skipped
  // by design and noted, not refused — and it takes the whole layout down a
  // path where no gap between orbits sets any size, so the centre falls back
  // to a fixed one. That fallback was a bare 120, above SUN_CAP (103), and
  // drew a Sun 39 % of the frame tall while the file's own comment promised a
  // sixth. Nothing tested it, in either direction.
  test("a selection that resolves to no bodies keeps the Sun inside its cap, and says what it did not know", () => {
    for (const view of ["top", "row", "tilted"]) {
      for (const scale of ["schematic", "sizes", "distances", "log"]) {
        const what = `${view}/${scale}`;
        const r = lay({ bodies: ["krypton"], view, scale });
        expect(labelText(r, "missing_note"), what).toBe("Unknown: krypton");
        expect(labelText(r, "label_sun"), what).toBe("Sun");
        const res = layoutSpec(spec({ bodies: ["krypton"], view, scale }));
        expect(res.issues.map((i) => `[${i.severity}] ${i.message}`), what).toEqual([]);
        // Measured on what was DRAWN, not on the radius asked for: from above
        // the Sun is a disc, in a row at true sizes it is a clipped segment
        // and has no radius at all.
        expect(elementBBoxes(res).get("sun")!.h / 2, what).toBeLessThanOrEqual(104);
      }
    }
    // The other way into that branch, and the reason the fallback is not
    // simply SUN_CAP: a portrait of a moonless body is not the Sun, and the
    // body IS the figure, so it keeps the larger size.
    expect(radiusOf(lay({ focus: "venus" }), "venus")).toBeGreaterThan(104);
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

  // The group words the schema documents for `bodies` — planets | inner |
  // outer | all — work here too, and have to: the same params schema teaches
  // them, so a model writing highlight: ["inner"] is generalising exactly what
  // this pack taught it. Expanding one name at a time and keeping bodies[0]
  // tinted Mercury and dropped Venus, Earth and Mars, with no note and no
  // warning — a figure quietly wrong rather than loudly.
  test("highlight expands group words the way bodies does, and an unknown name still reaches the note", () => {
    const tinted = (params: Record<string, unknown>): string[] =>
      flattenDrawables(lay(params).drawables)
        .filter((d) => d.kind === "stroke" && (d as StrokeDrawable).shapeHint?.type === "circle" && (d as StrokeDrawable).style.color === COLORS.accent)
        .map((d) => d.id.replace(/__disc$/, ""))
        .sort();
    expect(tinted({ highlight: ["inner"] })).toEqual(["earth", "mars", "mercury", "venus"]);
    expect(tinted({ highlight: ["inner"] })).toEqual(tinted({ highlight: ["mercury", "venus", "earth", "mars"] }));
    expect(tinted({ highlight: ["planets"] })).toHaveLength(8);
    // And the misses still get their note: the expansion carries them, so a
    // name nobody can tint is said out loud rather than dropped.
    expect(tinted({ highlight: ["krypton"] })).toEqual([]);
    expect(labelText(lay({ highlight: ["krypton"] }), "missing_note")).toBe("Unknown: krypton");
    expect(labelText(lay({ highlight: ["earth", "krypton"] }), "missing_note")).toBe("Unknown: krypton");
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

// Both of the template's first defects were SYSTEMATIC — every date, or one
// date in three — and invisible to a single-date test, because where a body
// stands on its orbit is what decides whether its name has room. So sweep the
// sky. A body moves, the geometry moves with it, and 200 consecutive days is
// enough to walk Mercury round its orbit twice and Mars past half of its own.
describe("solar_system: names clear the ink on any date", () => {
  const days = (n: number): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10));
    return out;
  };
  const labelTextOf = (r: { drawables: Drawable[] }, id: string): string | undefined => {
    const d = flattenDrawables(r.drawables).find((x) => x.id === id);
    return d && d.kind === "text" ? d.text : undefined;
  };
  const sweep = (params: Record<string, unknown>): { dirty: string[]; count: number } => {
    const dirty: string[] = [];
    let count = 0;
    for (const date of days(200)) {
      const issues = layoutSpec(spec({ ...params, date })).issues;
      if (issues.length > 0) { count++; dirty.push(`${date}: ${issues[0].message}`); }
    }
    return { dirty: dirty.slice(0, 4), count };
  };

  // The orbits are ON in all three, which is the whole point: with them off
  // the figure was always clean, and that is what hid the defect.
  test.each([
    ["the default figure", { view: "top", scale: "schematic" }],
    ["a focus portrait with its moons", { focus: "jupiter", moons: ["jupiter"] }],
    ["the inner planets at true distances", { view: "top", scale: "distances", bodies: ["inner"] }],
    ["a true-size line-up", { view: "row", scale: "sizes" }],
  ])("%s is lint-clean on every one of 200 dates", (_what, params) => {
    const { dirty, count } = sweep(params);
    expect(dirty).toEqual([]);
    expect(count).toBe(0);
  });

  // The guard against the cheap fix. Every one of these would silence the
  // warnings by drawing less, and none of them is allowed: every body keeps
  // its name, every orbit is still drawn, and a name is still a full 19 units.
  test("the clean figure still draws every orbit and names every body", () => {
    const r = lay({});
    for (const p of PLANETS) {
      expect(r.order, p).toContain("orbit_" + p);
      expect(labelText(r, "label_" + p), p).toBeTruthy();
    }
    expect(labelText(r, "label_sun")).toBe("Sun");
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "text" && d.id.startsWith("label_")) expect(d.fontSize, d.id).toBe(19);
    }
  });

  // An orbit a name sits on is drawn as a circle with a gap, not as a shorter
  // circle: what goes is the name's own footprint (plus a character's headroom
  // for a translated word), the rest of the ring is untouched, and it still
  // reads as a ring. The ring is 72 points; the widest break measured over 200
  // dates and eight configurations is Mercury's — the innermost and smallest
  // ring, where a seven-letter name is a fifth of the whole circumference —
  // at 50 points kept in the tilted view, 55 from above. Two thirds is the
  // line: below that a ring has been shortened rather than broken.
  test("an orbit that carries a name ducks under it — and keeps its shape", () => {
    let ducked = 0;
    for (const view of ["top", "tilted"]) {
      for (const date of days(60)) {
        const r = lay({ view, date });
        for (const p of PLANETS) {
          const o = leaf(r, "orbit_" + p) as StrokeDrawable;
          expect(o.kind, p).toBe("stroke");
          expect(o.pts.length, `${p} on ${date}`).toBeGreaterThanOrEqual(48);
          if (view === "top") {
            const rr = o.pts.map((q) => Math.hypot(q[0] - 500, q[1] - 390));
            expect(Math.max(...rr) - Math.min(...rr), o.id).toBeLessThan(1);   // still a circle
          }
          if (o.closed !== true) ducked++;
        }
      }
    }
    expect(ducked, "no orbit ever had to duck at all").toBeGreaterThan(0);
  });

  // A layout that places its own names owns the whole obstacle list, and the
  // first version of this fix left four things off it: `title` at the top of
  // the page, `scale_note` and `missing_note` along the foot, and the scale
  // bar. They are pushed after the names but their boxes are fixed before, and
  // the compass fallback reaches them — the outermost orbit runs 27 units
  // under the title's box, one step of the search away. The shared solver had
  // them for nothing, through obstacleBoxes. Nothing else in this file sets a
  // title or names an unknown body, which is exactly how the gap survived.
  test.each([
    ["a title", { title: "Where the eight planets stood on this date" }],
    ["a missing note", { bodies: ["planets", "krypton", "vulcan"] }],
    ["a title over a scale bar", { scale: "distances", bodies: ["inner"], title: "The inner planets, to scale" }],
    ["a title over a focus portrait", { focus: "jupiter", title: "Jupiter and its four Galilean moons" }],
  ])("%s is an obstacle to a name like any other text", (_what, params) => {
    const { dirty, count } = sweep(params);
    expect(dirty).toEqual([]);
    expect(count).toBe(0);
  });

  // The one combination that cannot be asserted clean: at scale "sizes" the
  // note grows to "Sizes to scale, Sun reduced, distances not" and runs into
  // `missing_note`, which sits in the same strip along the foot. That is two
  // CAPTIONS colliding, it reproduces identically on the commit before this
  // work, and it belongs to whoever owns that strip — not to the names. What
  // is pinned here is that no NAME is caught up in it.
  // BOTH branches, because they place their names by two different rules and
  // for one round only one of them was swept here. The row seeded its obstacle
  // list empty and never looked at a caption, so this test read clean on the
  // default top view while `{ view: "row", scale: "sizes", bodies:
  // ["jupiter", "krypton"] }` wrote Jupiter's name straight across
  // missing_note. A claim about that strip has to be made about everything
  // that writes into it. (A row's own note stays short — it clips the Sun
  // rather than shrinking it — so at this width its two captions clear each
  // other; what the row shares is the STRIP, and a name stepping down into
  // it.)
  test.each(["top", "row"])("in the %s view, no name is caught in the strip where two captions collide", (view) => {
    for (const date of days(200)) {
      const issues = layoutSpec(spec({ view, scale: "sizes", title: "The planets to scale", bodies: ["planets", "krypton"], date })).issues;
      expect(issues.filter((i) => i.ids.some((id) => id.startsWith("label_"))).map((i) => i.message), date).toEqual([]);
    }
    // The case the row missed, kept beside the sweep because it is the same
    // claim: one body big enough to fill the frame (Jupiter at true sizes is
    // 337 px across) starts its name at y 37, and missing_note is at y 36.
    const solo = layoutSpec(spec({ view, scale: "sizes", bodies: ["jupiter", "krypton"] })).issues;
    expect(solo.filter((i) => i.ids.some((id) => id.startsWith("label_"))).map((i) => i.message), view).toEqual([]);
  });

  // The limit this pack now owns, pinned at the size that matters — and it is
  // a real limit, not a hypothetical one. A translated copy swaps the drawn
  // words AFTER the layout has run (src/layout/text-map.ts) and leaves every
  // box where it was put, so every clearance here was measured for the English
  // word. What the fix buys is stated here: a character of headroom in the
  // clearance between names, and the same headroom in the gap cut in each
  // ring, so a proper noun that grows by a character — these are the Italian
  // names, and Sole, Mercurio, Venere and Saturno all do — still reads.
  // What it does not buy is a name the search had to put in a GAP rather than
  // on its own ring: there the room is the gap's, and a longer word can reach
  // the next ring along. Measured at one date in sixty for this set, and
  // pinned so it cannot quietly get worse.
  test("a copy translated into a language the pack does not know keeps its names apart", () => {
    const text_map = {
      Sun: "Sole", Mercury: "Mercurio", Venus: "Venere", Earth: "Terra", Mars: "Marte",
      Jupiter: "Giove", Saturn: "Saturno", Uranus: "Urano", Neptune: "Nettuno",
      "Not to scale": "Non in scala",
    };
    let residual = 0;
    for (const date of days(60)) {
      const res = layoutSpec({ template: "solar_system", params: { date }, elements: [], text_map } as never);
      expect(labelTextOf(res, "label_neptune"), date).toBe("Nettuno");   // the swap really happened
      expect(res.issues.filter((i) => i.rule === "overlap-label-label").map((i) => i.message), date).toEqual([]);
      residual += res.issues.length;
    }
    expect(residual).toBeLessThanOrEqual(3);
  });

  // Defect B in one line: the step between two rows of names has to clear a
  // real line of type (19 × 1.25) plus the 2 units lint keeps between boxes —
  // 26 did not, and the discs a name starts above are not all the same size.
  test("in a row, no two names come within a line of type of each other", () => {
    const r = lay({ view: "row", scale: "sizes" });
    const names = flattenDrawables(r.drawables).filter((d): d is TextDrawable => d.kind === "text" && d.id.startsWith("label_"));
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        // Measured the way lint measures, not with a copy of its constants.
        const aw = heuristicMeasure(a.text, a.fontSize).w, bw = heuristicMeasure(b.text, b.fontSize).w;
        const near = Math.abs(a.pos[0] - b.pos[0]) * 2 < aw + bw + 4;
        if (near) expect(Math.abs(a.pos[1] - b.pos[1]), `${a.id}/${b.id}`).toBeGreaterThanOrEqual(heuristicMeasure(a.text, a.fontSize).h + 2);
      }
    }
  });
});
