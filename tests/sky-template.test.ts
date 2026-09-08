// sky_map: the sky over a place at a moment. Every geometric claim here is
// checkable against the projection's own definition — the zenith is the
// centre, the horizon is the rim, north is up and east is on the LEFT.
//
// `issues`, not `warnings`. `warnings` carries the layout's own complaints and
// is empty for a template that never complains; `issues` is what the bundled-
// examples guard asserts, and it is where round 1's two label defects lived.

import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import type { SkyEngine } from "../src/scenes/space/sky-types";

const AT = "2026-09-07T21:00:00Z";
const lay = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: AT, ...params });
const spec = (params: Record<string, unknown>) => ({ template: "sky_map", params: { time: AT, ...params }, elements: [] }) as never;
const idsOf = (params: Record<string, unknown>) => lay(params).order;
const leaf = (r: ReturnType<typeof lay>, id: string): Drawable | undefined => flattenDrawables(r.drawables).find((d) => d.id === id);
const textOf = (r: ReturnType<typeof lay>, id: string): string | undefined => {
  const d = leaf(r, id);
  return d && d.kind === "text" ? d.text : undefined;
};
let sky: SkyEngine;

beforeAll(async () => {
  await ensureEngines(["space", "sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
  unregisterPack("space");
  registerPack("space", spaceYaml);
});

describe("sky_map: registration and the default figure", () => {
  test("the space pack now registers two templates", () => {
    unregisterPack("space");
    expect(registerPack("space", spaceYaml)).toMatchObject({ ok: true, templateIds: ["solar_system", "sky_map"] });
  });

  test("draws a dome: the horizon, four compass points, a star field, a place and a caption", () => {
    const ids = idsOf({});
    for (const id of ["horizon", "compass_n", "compass_e", "compass_s", "compass_w", "stars", "place_label"]) {
      expect(ids, id).toContain(id);
    }
    expect(textOf(lay({}), "place_label")).toBe("Oslo · 2026-09-07 21:43");
  });

  test("the same params and the same moment give byte-identical layouts", () => {
    expect(JSON.stringify(lay({}))).toBe(JSON.stringify(lay({})));
  });

  test("the compass sits where the projection says it does — and EAST IS ON THE LEFT", () => {
    const r = lay({});
    const at = (id: string): [number, number] => (leaf(r, id) as TextDrawable).pos;
    const c = sky.chart;
    expect(at("compass_n")[1]).toBeGreaterThan(c.cy);
    expect(at("compass_s")[1]).toBeLessThan(c.cy);
    expect(at("compass_e")[0]).toBeLessThan(c.cx);
    expect(at("compass_w")[0]).toBeGreaterThan(c.cx);
    expect(textOf(r, "compass_e")).toBe("E");
    expect(textOf(lay({ names: "nb" }), "compass_e")).toBe("Ø");
  });

  test("north is up because POLARIS is up there, not because the compass agrees", () => {
    // The test above only checks that the layout agrees with ITSELF: negate
    // project()'s y term and the compass letters turn over with the chart, and
    // it still passes. Polaris is the one star whose place on the page is
    // fixed by something outside this template — it stands due north at an
    // altitude equal to the observer's latitude — so a sign that flipped would
    // fail against the sky rather than against a letter the same code drew.
    //
    // The canvas is y-up with the origin bottom-left (src/layout/canvas.ts:1)
    // and the single flip to SVG's y-down happens at emission in the backend
    // (canvas.ts:33, render/svg-backend.ts), so a HIGHER logical y is nearer
    // the top of the page.
    const pos = sky.starPositions(new Date(AT), 59.91, 10.75);
    const pole = pos.get(sky.findStar("Polaris")!.hip)!;
    expect(pole.alt).toBeCloseTo(59.91, 0);                     // as high up as Oslo is north
    expect(Math.min(pole.az, 360 - pole.az)).toBeLessThan(2);   // and due north
    const at = sky.project(pole, sky.chart);
    expect(at[1]).toBeGreaterThan(sky.chart.cy);                // …so it is drawn ABOVE the middle
    expect(Math.abs(at[0] - sky.chart.cx)).toBeLessThan(8);
    const dot = leaf(lay({ mark: ["Polaris"] }), "polaris") as StrokeDrawable;
    const c = dot.shapeHint?.type === "circle" ? dot.shapeHint.c : dot.pts[0];
    expect(c[1]).toBeGreaterThan(sky.chart.cy);                 // in the figure, not just the rules
    // And east is on the left for the same kind of reason: the drawn star
    // nearest due east — azimuth being astronomy-engine's own convention,
    // clockwise from north, checked against its Horizon() in
    // tests/sky-rules.test.ts — lands left of the middle.
    let east = null;
    for (const s of sky.stars()) {
      const q = pos.get(s.hip)!;
      if (q.alt < 5 || q.alt > 40 || s.mag > 4.5) continue;
      if (east === null || Math.abs(q.az - 90) < Math.abs(pos.get(east.hip)!.az - 90)) east = s;
    }
    expect(Math.abs(pos.get(east!.hip)!.az - 90), east!.name ?? `HIP ${east!.hip}`).toBeLessThan(5);
    expect(sky.project(pos.get(east!.hip)!, sky.chart)[0]).toBeLessThan(sky.chart.cx);
  });

  test("the horizon is a circle, and it owns no clicks — it is an edge, not a region", () => {
    const h = leaf(lay({}), "horizon") as StrokeDrawable;
    expect(h.kind).toBe("stroke");
    expect(h.closed).not.toBe(true);
    const rr = h.pts.map((p) => Math.hypot(p[0] - sky.chart.cx, p[1] - sky.chart.cy));
    expect(Math.max(...rr) - Math.min(...rr)).toBeLessThan(0.001);
    expect(Math.max(...rr)).toBeCloseTo(sky.chart.r, 6);
    // …and it closes: the last point is the first, so it draws as a ring.
    expect(h.pts[0]).toEqual(h.pts[h.pts.length - 1]);
  });

  test("every drawn star is above the horizon, and inside the circle", () => {
    const r = lay({});
    const pos = sky.starPositions(new Date(AT), 59.91, 10.75);
    const dots = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")) as StrokeDrawable[];
    expect(dots.length).toBeGreaterThan(150);
    for (const d of dots) {
      const hip = Number(d.id.replace("stars__hip_", ""));
      expect(pos.get(hip)!.alt, `HIP ${hip}`).toBeGreaterThanOrEqual(0);
      const c = d.shapeHint?.type === "circle" ? d.shapeHint.c : d.pts[0];
      expect(Math.hypot(c[0] - sky.chart.cx, c[1] - sky.chart.cy)).toBeLessThanOrEqual(sky.chart.r + 0.001);
    }
  });

  test("a brighter star is a bigger dot", () => {
    const r = lay({});
    const dots = (flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")) as StrokeDrawable[])
      .map((d) => ({ hip: Number(d.id.replace("stars__hip_", "")), r: d.shapeHint?.type === "circle" ? d.shapeHint.r : 0 }));
    const withMag = dots.map((d) => ({ ...d, m: sky.star(d.hip)!.mag })).sort((a, b) => a.m - b.m);
    expect(withMag[0].r).toBeGreaterThan(withMag[withMag.length - 1].r);
  });

  test("limit_mag thins the field without moving the stars that stay", () => {
    const count = (limit?: number) => flattenDrawables(lay(limit === undefined ? {} : { limit_mag: limit }).drawables).filter((d) => d.id.startsWith("stars__hip_")).length;
    expect(count(2)).toBeLessThan(count(4.5));
    expect(count(2)).toBeGreaterThan(5);
    // A star does not shrink because the author asked for a fainter chart, so
    // the SAME star is measured at both limits. (The catalogue is not sorted
    // by magnitude — "the first dot drawn" is a different star at each limit.)
    const hip = sky.findStar("Polaris")!.hip;
    const drawn = (limit: number) => {
      const d = flattenDrawables(lay({ limit_mag: limit }).drawables).find((x) => x.id === `stars__hip_${hip}`) as StrokeDrawable;
      return d.shapeHint?.type === "circle" ? d.shapeHint.r : 0;
    };
    expect(drawn(2)).toBeGreaterThan(1.3);
    expect(drawn(2)).toBe(drawn(4.5));
  });

  test("the star field draws in a couple of seconds however many stars there are", () => {
    // A group's leaf durations ACCUMULATE (src/render/svg-backend.ts:583-589),
    // so 400 dots at SKETCH_MS.dot would take 168 seconds.
    const total = flattenDrawables(lay({}).drawables)
      .filter((d) => d.id.startsWith("stars__hip_"))
      .reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(total).toBeLessThan(4000);
    expect(total).toBeGreaterThan(200);
  });
});

describe("sky_map: the Sun, the Moon and the planets", () => {
  test("a body above the horizon is drawn where the ephemeris puts it; one below is not drawn at all", () => {
    const at = new Date(AT);
    const pos = sky.bodyPositions(["sun", "moon", "jupiter", "saturn"], at, 59.91, 10.75);
    const ids = idsOf({});
    for (const id of ["sun", "moon", "jupiter", "saturn"]) {
      expect(ids.includes(id), `${id} alt ${pos[id].alt.toFixed(1)}`).toBe(pos[id].alt >= 0);
    }
    const sat = leaf(lay({}), "saturn") as StrokeDrawable;
    const want = sky.project(pos.saturn, sky.chart);
    expect(sat.shapeHint?.type === "circle" ? sat.shapeHint.c : sat.pts[0]).toEqual(want);
  });

  test("a body named in show but under the horizon is SAID, not silently dropped", () => {
    // Jupiter is 13° below the horizon at this moment — a real answer to
    // "where is Jupiter tonight?", and a figure that just omitted it would be
    // a blank page with no explanation.
    expect(textOf(lay({ show: ["jupiter"] }), "sky_note")).toContain("Below the horizon: Jupiter");
    expect(textOf(lay({ show: ["jupiter"], names: "nb" }), "sky_note")).toContain("Under horisonten: Jupiter");
    // The DEFAULT set never complains: half of it is always down.
    expect(textOf(lay({}), "sky_note") ?? "").not.toContain("Below the horizon");
  });

  test("an unknown name goes to the caption, never to an exception", () => {
    expect(textOf(lay({ show: ["krypton"] }), "sky_note")).toContain("Unknown: krypton");
    expect(textOf(lay({ mark: ["vulcan"] }), "sky_note")).toContain("Unknown: vulcan");
  });

  test("the Moon's lit area IS its illuminated fraction, at every phase", () => {
    // The terminator is a half-ellipse of semi-axis r(1 − 2k) along the bright
    // direction, which makes the lit area exactly k·πr². So the check is not
    // two thresholds at two hand-picked dates — it is the engine's own
    // `fraction`, at whatever phase the Moon happens to be in, which catches a
    // sign error in the terminator at ANY phase rather than at the two the
    // dates were chosen for. (The polygon is a 64-gon inscribed in the disc,
    // so it under-reads by 0.15 % — well inside two decimal places.)
    const disc = Math.PI * 12 * 12;
    let checked = 0;
    for (let day = 0; day < 30; day += 1.7) {
      const time = new Date(Date.UTC(2026, 1, 15) + day * 86400000).toISOString();
      const r = layoutSpec(spec({ time, show: ["moon"] }));
      const d = flattenDrawables(r.drawables).find((x) => x.id === "moon__lit") as { pts: [number, number][] } | undefined;
      if (!d) continue;                       // the Moon is below the horizon at this hour
      let a = 0;
      for (let i = 0; i < d.pts.length; i++) {
        const p = d.pts[i], q = d.pts[(i + 1) % d.pts.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      const want = sky.moonLimb(new Date(time), 59.91, 10.75).fraction;
      expect(Math.abs(a) / 2 / disc, `${time} (fraction ${want.toFixed(3)})`).toBeCloseTo(want, 2);
      checked++;
    }
    expect(checked, "no moment in the sweep had the Moon up").toBeGreaterThan(5);
  });

  test("the Moon fills its WHOLE disc, so its dark half still answers a click", () => {
    // An `area` is a hit outline and hitElement's box pass skips any id that
    // has one, so a moon that filled only its crescent would lose every click
    // on its dark half to whatever is behind it.
    const r = lay({ time: "2026-02-22T20:00:00Z", show: ["moon"] });
    const disc = flattenDrawables(r.drawables).find((d) => d.id === "moon__disc");
    expect(disc?.kind).toBe("area");
    expect((disc as { pts: [number, number][] }).pts.length).toBeGreaterThanOrEqual(40);
  });

  test("the crescent points at the Sun", () => {
    const at = new Date("2026-02-22T20:00:00Z");
    const p = sky.bodyPositions(["moon", "sun"], at, 59.91, 10.75);
    const moonAt = sky.project(p.moon, sky.chart);
    const sunAt = sky.project(p.sun, sky.chart);
    const r = lay({ time: "2026-02-22T20:00:00Z", show: ["moon", "sun"] });
    const litPts = (flattenDrawables(r.drawables).find((d) => d.id === "moon__lit") as { pts: [number, number][] }).pts;
    // The lit region's centroid lies on the Sun's side of the Moon's centre.
    const cx = litPts.reduce((s, q) => s + q[0], 0) / litPts.length;
    const cy = litPts.reduce((s, q) => s + q[1], 0) / litPts.length;
    const toSun = [sunAt[0] - moonAt[0], sunAt[1] - moonAt[1]];
    const toLit = [cx - moonAt[0], cy - moonAt[1]];
    expect(toSun[0] * toLit[0] + toSun[1] * toLit[1]).toBeGreaterThan(0);
  });

  test("when the Sun is up the figure says so, and still draws the stars", () => {
    const noon = lay({ time: "2026-06-21T10:00:00Z" });
    expect(textOf(noon, "sky_note")).toMatch(/^The Sun is up/);
    expect(noon.order).toContain("stars");
    expect(noon.order).toContain("sun");
  });

  test("the Sun is found for the daylight clause even when show never names it", () => {
    // `show` chooses what is DRAWN. Whether it is day is a fact about the
    // moment, not about the author's list — a chart that only marks Jupiter
    // still has to say the Sun is up.
    const r = lay({ time: "2026-06-21T10:00:00Z", show: ["jupiter"] });
    expect(textOf(r, "sky_note")).toMatch(/^The Sun is up/);
    expect(r.order).not.toContain("sun");
  });
});

describe("sky_map: what the author singles out", () => {
  test("a star named in mark leaves the field and becomes its own element", () => {
    // `draw` has no wildcard and the model cannot know which stars are up, so
    // the field is ONE element and `mark` lifts out what a question needs.
    const plain = idsOf({});
    expect(plain).not.toContain("vega");
    const marked = lay({ mark: ["Vega"] });
    expect(marked.order).toContain("vega");
    expect(flattenDrawables(marked.drawables).some((d) => d.id === `stars__hip_${sky.findStar("Vega")!.hip}`)).toBe(false);
  });

  test("highlight both lifts and tints, so a click question can hide its answer while a beat can show it", () => {
    const r = lay({ highlight: ["Vega"] });
    expect(r.order).toContain("vega");
    const dot = leaf(r, "vega") as StrokeDrawable;
    expect(dot.style.color).toBe("#8a5fa8");   // COLORS.accent
    // mark alone does NOT tint: that is the whole point of having both.
    const m = leaf(lay({ mark: ["Vega"] }), "vega") as StrokeDrawable;
    expect(m.style.color).not.toBe("#8a5fa8");
  });

  test("a marked star that is below the horizon is simply not there", () => {
    const pos = sky.starPositions(new Date(AT), 59.91, 10.75);
    const down = sky.stars().find((s) => s.name && pos.get(s.hip)!.alt < -20)!;
    expect(idsOf({ mark: [down.name!] })).not.toContain(sky.starId(down));
  });

  test("a group word in show expands, and never quietly keeps only its first body", () => {
    // Round 1's own scar: taking bodies[0] of a per-name expansion tinted
    // Mercury and dropped Venus, Earth and Mars. The sibling template offers
    // the same group words, so a model writing show: ["outer"] here is
    // generalising what this pack taught it.
    const ids = idsOf({ time: "2026-06-21T10:00:00Z", show: ["outer"] });
    for (const id of ["jupiter", "saturn", "uranus", "neptune"]) expect(ids, id).toContain(id);
    // Earth is in "planets" and can never be a point in its own sky: it drops
    // out of the expansion without a word, because nobody asked for it by name.
    const r = lay({ time: "2026-06-21T10:00:00Z", show: ["planets"] });
    expect(r.order).not.toContain("earth");
    expect(textOf(r, "sky_note") ?? "").not.toContain("Earth");
  });
});

describe("sky_map: the observer", () => {
  test("the place and the clock are written, and the clock is local solar time", () => {
    expect(textOf(lay({ place: "Tromsø", lat: 69.65, lon: 18.96 }), "place_label")).toBe("Tromsø · 2026-09-07 22:15");
    // lat/lon without a place does not silently claim to be Oslo.
    expect(textOf(lay({ lat: 0, lon: 0 }), "place_label")).toBe("2026-09-07 21:00");
  });

  test("moving the observer moves the sky", () => {
    const oslo = lay({});
    const sydney = lay({ lat: -33.87, lon: 151.21, place: "Sydney" });
    expect(JSON.stringify(oslo.drawables)).not.toBe(JSON.stringify(sydney.drawables));
    // From Sydney the southern sky is up: Crux's brightest star is above the
    // horizon there and below it from Oslo.
    const acrux = sky.findStar("Acrux") ?? sky.stars().reduce((a, b) => (b.dec < a.dec ? b : a));
    expect(sky.starPositions(new Date(AT), -33.87, 151.21).get(acrux.hip)!.alt).toBeGreaterThan(0);
    expect(sky.starPositions(new Date(AT), 59.91, 10.75).get(acrux.hip)!.alt).toBeLessThan(0);
  });

  test("hours and days turn the sky, and they are the animatable handles", () => {
    const now = lay({});
    const later = lay({ hours: 6 });
    expect(JSON.stringify(now.drawables)).not.toBe(JSON.stringify(later.drawables));
    // Six hours is a quarter turn: Polaris barely moves, everything else does.
    // Polaris is 0.74° off the pole, so its whole daily circle is 1.5° across
    // — that, not zero, is the bound a real pole star can be held to.
    const before = sky.starPositions(new Date(AT), 59.91, 10.75);
    const after = sky.starPositions(new Date(Date.parse(AT) + 6 * 3600000), 59.91, 10.75);
    const swing = (name: string) => {
      const hip = sky.findStar(name)!.hip;
      return Math.abs(before.get(hip)!.alt - after.get(hip)!.alt);
    };
    expect(swing("Polaris")).toBeLessThan(1.5);
    expect(swing("Vega")).toBeGreaterThan(20);
    expect(textOf(lay({ days: 30 }), "place_label")).toContain("2026-10-07");
  });
});

describe("sky_map: the captions cannot collide, because there is only one of each", () => {
  test("the two foot lines sit clear of each other and of the compass", () => {
    const r = layoutSpec(spec({ show: ["jupiter", "krypton"], title: "The sky over Oslo tonight" }));
    const boxes = elementBBoxes(r);
    const place = boxes.get("place_label")!;
    const note = boxes.get("sky_note")!;
    expect(note.y + note.h).toBeLessThan(boxes.get("compass_s")!.y - 2);
    expect(place.y + place.h).toBeLessThan(note.y - 2);
    expect(place.x).toBeGreaterThanOrEqual(0);
    expect(boxes.get("title")!.y + boxes.get("title")!.h).toBeLessThanOrEqual(750);
    expect(r.issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);
  });

  test("a caption too wide for the page drops its cheapest clause, not its most important", () => {
    const long = lay({ time: "2026-06-21T10:00:00Z", show: ["jupiter", "saturn", "uranus", "neptune", "krypton", "vulcan", "romulus"] });
    const note = textOf(long, "sky_note")!;
    expect(note).toMatch(/^The Sun is up/);            // the clause that matters most survives
    expect(note).not.toMatch(/as symbols/);            // the cheapest one went
    expect(note.length).toBeGreaterThan(20);
    expect(note).toContain("Unknown: krypton");        // and the author's own names stay
  });

  // The four measurements below are what the first width policy did: it
  // popped whole clauses off the END while the line was too wide, and three
  // of the five clauses live at that end — the three that keep the pack's
  // contract that a thing the author NAMED is said rather than silently
  // missing (`show`'s own description promises it, and so does `focus`: "what
  // it removes, it says"). No sweep can see this, because writing LESS is
  // lint-clean. Each case is the string that was actually drawn.
  describe("and it never stops naming what the author asked for", () => {
    const noteOf = (params: Record<string, unknown>): string => textOf(lay(params), "sky_note") ?? "";
    // The caption starts at the frame's left edge and may not pass its right.
    const withinFrame = (params: Record<string, unknown>): boolean => {
      const box = elementBBoxes(layoutSpec(spec(params))).get("sky_note");
      return box === undefined || box.x + box.w <= 940.5;
    };

    test("a daylight chart still lists the bodies that have set", () => {
      // Was: "The Sun is up — these stars are there, but you cannot see them",
      // and nothing else. Three named planets below the horizon, dropped.
      const p = { time: "2026-06-21T02:00:00Z", show: ["all"] };
      const note = noteOf(p);
      expect(note).toContain("Below the horizon:");
      for (const name of ["Mercury", "Venus", "Jupiter"]) expect(note).toContain(name);
      expect(withinFrame(p)).toBe(true);
    });

    test("a portrait still lists what its crop took — the failure this round was supposed to have fixed", () => {
      // Was: the daylight sentence alone. Eight named things off the page and
      // not one of them mentioned — the exact defect the "Outside view"
      // clause was added for, put back by the width policy for a slightly
      // longer list.
      const p = { time: "2026-06-21T10:00:00Z", focus: "Orion", show: ["all"], mark: ["Vega", "Polaris", "Deneb", "Altair"] };
      const note = noteOf(p);
      expect(note).toContain("Outside view:");
      for (const name of ["Polaris", "Vega", "Deneb"]) expect(note).toContain(name);
      expect(withinFrame(p)).toBe(true);
    });

    test("twelve typos are twelve typos, not silence", () => {
      // Was: no sky_note element at all. Twelve unknown names, no complaint.
      const p = { time: "2026-06-21T23:00:00Z", mark: ["krypton", "vulcan", "romulus", "tatooine", "arrakis", "gallifrey", "pandora", "coruscant", "naboo", "endor", "hoth", "dagobah"] };
      const note = noteOf(p);
      expect(note).toMatch(/^Unknown: krypton/);
      // Whatever it has room for by name, and a count for the rest, adding up
      // to the twelve that were typed.
      const named = note.slice("Unknown: ".length).split(" +")[0].split(", ").length;
      const rest = Number(/\+(\d+)$/.exec(note)?.[1] ?? 0);
      expect(named + rest).toBe(12);
      expect(withinFrame(p)).toBe(true);
    });

    test("and the case that already worked still works, unchanged", () => {
      expect(noteOf({ time: "2026-06-21T12:00:00Z", show: ["all"] }))
        .toBe("The Sun is up — these stars are there, but you cannot see them · Below the horizon: Neptune");
    });

    test("the fit is width-driven, so the FACTS must not flicker with the hour", () => {
      // The old policy's worst property was intermittency: the same params
      // kept "Below the horizon: Neptune" at noon and lost it at ten. Detail
      // may still come and go with the width — that is what a fit is — but a
      // named body that is down must be SAID at every hour of the day.
      for (let h = 0; h < 24; h++) {
        const t = `2026-06-21T${String(h).padStart(2, "0")}:00:00Z`;
        const pos = sky.bodyPositions([...sky.defaults.ids], sky.resolveTime(t, undefined, undefined, sky.defaults.lon), sky.defaults.lat, sky.defaults.lon);
        const down = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"].filter((id) => pos[id].alt < 0);
        const note = noteOf({ time: t, show: ["all"] });
        if (down.length > 0) expect(note, t).toContain("Below the horizon:");
        else expect(note, t).not.toContain("Below the horizon:");
        expect(withinFrame({ time: t, show: ["all"] }), t).toBe(true);
      }
    });
  });
});

describe("sky_map: the constellation figures", () => {
  // A December evening: Orion is up over Oslo, which is what makes it the
  // figure every test here can name.
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });

  test("the figures are ONE element by default, because no author can list them", () => {
    const r = win({});
    expect(r.order).toContain("figures");
    expect(r.order.filter((id) => id.startsWith("con_"))).toEqual([]);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__"));
    expect(segs.length).toBeGreaterThan(80);
    for (const s of segs) expect((s as StrokeDrawable).pts).toHaveLength(2);
  });

  /** Every circle-hinted dot on the page, keyed by its exact centre — the star
   *  field, the singled-out stars and the bodies alike. A line endpoint has to
   *  land on one of these, because that is the whole claim: the drawing IS the
   *  answer key, not a picture that resembles it. */
  const dotCentres = (r: ReturnType<typeof win>): Set<string> => {
    const out = new Set<string>();
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind !== "stroke") continue;
      const hint = (d as StrokeDrawable).shapeHint;
      if (hint?.type === "circle") out.add(hint.c.join(","));
    }
    return out;
  };

  test("every drawn line joins two stars that are both above the horizon", () => {
    const r = win({});
    const dots = dotCentres(r);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")) as StrokeDrawable[];
    expect(segs.length).toBeGreaterThan(80);
    for (const s of segs) {
      for (const p of s.pts) {
        // Every endpoint is inside the dome — which, since a point outside it
        // is below the horizon, is the same statement as "both stars are up".
        expect(Math.hypot(p[0] - sky.chart.cx, p[1] - sky.chart.cy)).toBeLessThanOrEqual(sky.chart.r + 0.001);
        expect(dots.has(p.join(",")), `line endpoint ${p.join(",")} has no star`).toBe(true);
      }
    }
  });

  test("a star a drawn line needs is drawn however faint — a line to nothing is a lie", () => {
    // 119 of the 756 line stars are fainter than 4.5 and 27 fainter than 5.0,
    // so a magnitude cut alone would leave the figures with holes.
    const r = win({ limit_mag: 2 });
    const dots = dotCentres(r);
    const segs = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")) as StrokeDrawable[];
    expect(segs.length).toBeGreaterThan(20);
    for (const s of segs) for (const p of s.pts) expect(dots.has(p.join(",")), `${s.id} ends at nothing`).toBe(true);
    // …and the figures really did keep stars the cut would have thrown away.
    const faint = sky.stars().filter((x) => x.mag > 2 && sky.constellations().some((c) => c.edges.some((e) => e[0] === x.hip || e[1] === x.hip)));
    expect(faint.length).toBeGreaterThan(100);
  });

  test("a chart that draws no line keeps no star for one", () => {
    // The exemption's own justification is that a line ending at nothing is a
    // lie — which says nothing about a chart with no lines on it. Measured at
    // limit_mag 2 on this December evening: 361 field stars while the figures
    // are drawn, and 23 when they are not, in BOTH the modes that draw none.
    const dots = (params: Record<string, unknown>) =>
      flattenDrawables(win(params).drawables).filter((d) => d.id.startsWith("stars__hip_")).length;
    expect(dots({ limit_mag: 2, constellations: "lines" })).toBe(dots({ limit_mag: 2 }));
    expect(dots({ limit_mag: 2 })).toBeGreaterThan(300);
    expect(dots({ limit_mag: 2, constellations: "names" })).toBe(dots({ limit_mag: 2, constellations: "none" }));
    expect(dots({ limit_mag: 2, constellations: "none" })).toBeLessThan(40);
    // …and the default limit is unaffected either way: those stars are drawn
    // because they are bright enough, not because a line reaches them.
    expect(dots({})).toBeGreaterThan(dots({ constellations: "none" }));
    expect(dots({ constellations: "none" })).toBeGreaterThan(400);
  });

  test("constellations: none draws no lines and no names", () => {
    const r = win({ constellations: "none" });
    expect(r.order).not.toContain("figures");
    expect(r.order.filter((id) => id.startsWith("label_con_"))).toEqual([]);
    expect(r.order).toContain("stars");
  });

  test("constellations: lines draws lines and no names; names draws names and no lines", () => {
    const lines = win({ constellations: "lines" });
    expect(lines.order).toContain("figures");
    expect(lines.order.filter((id) => id.startsWith("label_con_"))).toEqual([]);
    const only = win({ constellations: "names" });
    expect(only.order).not.toContain("figures");
    expect(only.order.filter((id) => id.startsWith("label_con_")).length).toBeGreaterThan(0);
  });

  test("a constellation the author singles out leaves the group and becomes its own element", () => {
    const r = win({ mark: ["Orion"] });
    expect(r.order).toContain("con_ori");
    expect(r.order).toContain("figures");
    const own = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("con_ori__"));
    expect(own.length).toBeGreaterThanOrEqual(15);
    expect(flattenDrawables(r.drawables).some((d) => d.id.startsWith("figures__Ori"))).toBe(false);
    // highlight tints it as well as lifting it.
    const hot = flattenDrawables(win({ highlight: ["Orion"] }).drawables).find((d) => d.id.startsWith("con_ori__")) as StrokeDrawable;
    expect(hot.style.color).toBe("#8a5fa8");
  });

  test("a figure draws in about a second however many lines it has", () => {
    // The group-duration trap again: Sagittarius has 29 edges, and 29 strokes
    // at SKETCH_MS.stroke would be forty seconds of drawing.
    const r = win({ mark: ["Orion"] });
    const total = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("con_ori__")).reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(total).toBeLessThan(2000);
    const field = flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")).reduce((n, d) => n + d.drawOpts.duration, 0);
    expect(field).toBeLessThan(4000);
  });
});

describe("sky_map: names on a crowded chart", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });
  const namesOf = (r: ReturnType<typeof win>) => r.order.filter((id) => id.startsWith("label_con_"));

  // The guard against the cheap fix. A name is written only where it costs
  // nothing, which is what makes the sweep clean — so the sweep alone would
  // also pass a template that wrote NO names at all. These are the floor.
  test("the default chart names a real handful of constellations", () => {
    expect(namesOf(win({})).length).toBeGreaterThanOrEqual(5);
  });

  test("Orion is named on a December evening over Oslo", () => {
    expect(namesOf(win({}))).toContain("label_con_ori");
  });

  test("three languages give three different words on the page", () => {
    const at = (params: Record<string, unknown>) => {
      const d = flattenDrawables(win(params).drawables).find((x) => x.id === "label_con_uma");
      return d && d.kind === "text" ? d.text : undefined;
    };
    expect(at({ focus: "UMa" })).toBe("The Great Bear");
    expect(at({ focus: "UMa", names: "la" })).toBe("Ursa Major");
    expect(at({ focus: "UMa", names: "nb" })).toBe("Store bjørn");
    expect(at({ focus: "UMa", names: "none" })).toBeUndefined();
  });

  test("no name is nearer another figure's lines than its own", () => {
    // The rule a reader actually applies: a name belongs to whatever is
    // closest to it. Placing each name in a free spot near its own middle is
    // not enough — a sprawling figure (Camelopardalis, Lacerta) has a big box
    // with almost nothing in it, and a name in one of its corners lands on the
    // neighbour's stars. Measured before the fix, on this one December chart:
    // 10 of 39 names sat nearer another figure's lines, "The Giraffe" 52 units
    // from its own and 11 from Andromeda's.
    const r = win({});
    const segsBy = new Map<string, [number, number][][]>();
    for (const s of flattenDrawables(r.drawables).filter((d) => d.id.startsWith("figures__")) as StrokeDrawable[]) {
      const abbr = s.id.slice("figures__".length).replace(/_\d+$/, "");
      (segsBy.get(abbr) ?? segsBy.set(abbr, []).get(abbr)!).push(s.pts as [number, number][]);
    }
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
      return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
    };
    const toFigure = (p: [number, number], abbr: string) =>
      Math.min(...segsBy.get(abbr)!.map((s) => segDist(p, s[0], s[1])));
    const wrong: string[] = [];
    let checked = 0;
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind !== "text" || !d.id.startsWith("label_con_")) continue;
      const abbr = [...segsBy.keys()].find((k) => k.toLowerCase() === d.id.slice("label_con_".length));
      expect(abbr, `${d.id} names a figure that is not drawn`).toBeDefined();
      const own = toFigure(d.pos as [number, number], abbr!);
      checked++;
      for (const k of segsBy.keys()) {
        const dd = toFigure(d.pos as [number, number], k);
        if (k !== abbr && dd < own) wrong.push(`${d.text} (${abbr}) at ${own.toFixed(0)} is nearer ${k}'s lines at ${dd.toFixed(0)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(5);   // …and it checked something
  });

  test("a name is never written where it would cross a line or another name", () => {
    // The same rule lint applies, applied here to the names this layout placed
    // itself — which is the only reason it is allowed to place them.
    const r = layoutSpec(spec({ time: WINTER }));
    expect(r.issues.filter((i) => i.ids.some((id) => id.startsWith("label_"))).map((i) => i.message)).toEqual([]);
  });
});

describe("sky_map: focus — one figure, filling the page", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  const win = (params: Record<string, unknown>) => scenes.sky_map.layout!({ time: WINTER, ...params });

  test("focus draws that figure alone, names it, and gives every one of its stars an id", () => {
    const r = win({ focus: "Orion" });
    expect(r.order).toContain("con_ori");
    expect(r.order).not.toContain("figures");
    expect(r.order).toContain("label_con_ori");     // a portrait ALWAYS names its subject
    expect(r.order).toContain("frame");
    expect(r.order).not.toContain("horizon");       // the crop does not keep the rim
    const ori = sky.findConstellation("Ori")!;
    for (const h of sky.edgeStars(ori)) {
      const s = sky.star(h)!;
      expect(r.order, `HIP ${h}`).toContain(sky.starId(s));
    }
    expect(r.order).toContain("betelgeuse");
    expect(r.order).toContain("rigel");
  });

  test("the frame owns no clicks — it is a border, not a region", () => {
    const r = layoutSpec(spec({ time: WINTER, focus: "Orion" }));
    expect(r.order).toContain("frame");
    expect([...elementRings(r).keys()]).not.toContain("frame");
  });

  test("the portrait really is bigger than the same figure on the whole sky", () => {
    const span = (params: Record<string, unknown>): number => {
      const b = elementBBoxes(layoutSpec(spec({ time: WINTER, ...params }))).get("con_ori")!;
      return Math.max(b.w, b.h);
    };
    expect(span({ focus: "Orion" })).toBeGreaterThan(2 * span({ mark: ["Orion"] }));
  });

  test("focus resolves however the model spells it", () => {
    for (const q of ["Orion", "orion", "Ori", "con_ori"]) {
      expect(win({ focus: q }).order, q).toContain("con_ori");
    }
    expect(textOf(win({ focus: "Krypton" }), "sky_note")).toContain("Unknown: Krypton");
    expect(win({ focus: "Krypton" }).order).toContain("horizon");   // falls back to the whole sky
  });

  test("every one of the 88 figures can be the subject, at any season", () => {
    // The sweep's three portraits are Orion, the Plough and Cassiopeia, which
    // are the three a test can name — and three of eighty-eight is not a
    // claim about `focus`. Sagittarius has 29 edges and Triangulum has 2;
    // Hydra sprawls a third of the way round the sky and Crux never rises
    // here. All of them, at the four seasons: 156 of the 352 were really
    // portraits, the other 196 were below the horizon and said so, and none
    // produced a lint issue or fell through to tier-2.
    const noteOf = (r: { drawables: Drawable[] }): string => {
      const d = flattenDrawables(r.drawables).find((x) => x.id === "sky_note");
      return d && d.kind === "text" ? d.text : "";
    };
    const bad: string[] = [];
    let drew = 0;
    for (const c of sky.constellations()) {
      for (const time of ["2026-03-20T21:00:00Z", "2026-06-21T01:00:00Z", "2026-09-22T21:00:00Z", WINTER]) {
        const r = layoutSpec(spec({ time, focus: c.abbr }));
        if (r.order.includes("frame")) {
          drew++;
          if (!r.order.includes(`con_${c.abbr.toLowerCase()}`)) bad.push(`${c.abbr} ${time}: framed but not drawn`);
          if (!r.order.includes(`label_con_${c.abbr.toLowerCase()}`)) bad.push(`${c.abbr} ${time}: drawn but not named`);
        } else if (!noteOf(r).includes(sky.name(c, "en"))) {
          bad.push(`${c.abbr} ${time}: no portrait and no word about why`);
        }
        for (const i of r.issues) bad.push(`${c.abbr} ${time}: [${i.severity}] ${i.message}`);
        for (const w of r.warnings) bad.push(`${c.abbr} ${time}: WARN ${w}`);
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
    expect(drew).toBeGreaterThan(100);
  }, 60000);

  test("everything else the author named and the crop took is SAID", () => {
    // The pack's contract, in its own description: a thing you named that is
    // not on the page is said so rather than silently missing. A portrait
    // crops the whole sky away around its subject, which is the biggest way
    // this template can lose a named thing — and it lost six of them without a
    // word. "Outside view" is maps.yaml's phrase for a marker outside a
    // cropped map; it is a different fact from "below the horizon", which is
    // why it is a different clause.
    const r = win({ focus: "Orion", mark: ["Vega", "Polaris", "Ursa Major"], show: ["jupiter", "saturn", "moon"] });
    const note = textOf(r, "sky_note") ?? "";
    expect(note).toContain("Outside view:");
    for (const name of ["The Great Bear", "Polaris", "Vega", "Jupiter", "Saturn", "Moon"]) {
      expect(note, name).toContain(name);
      expect(r.order, name).not.toContain(name.toLowerCase().replace(/\s+/g, "_"));
    }
    // A cropped body is NOT reported as set: it has not set.
    expect(note).not.toContain("Below the horizon");
    expect(textOf(win({ focus: "Orion", mark: ["Vega"], names: "nb" }), "sky_note")).toContain("Utenfor utsnittet: Vega");
    // And nothing is invented: a portrait nobody asked anything else of says
    // nothing about the sky it cropped.
    expect(textOf(win({ focus: "Orion" }), "sky_note") ?? "").not.toContain("Outside view");
  });

  test("a marked constellation that never rose is SAID too", () => {
    // The manifest's own fourth example has this shape — mark: ["Orion"] on a
    // date — and half the year Orion is down. It used to produce neither a
    // con_ori nor a word.
    const r = win({ mark: ["Crux"] });
    expect(r.order).not.toContain("con_cru");
    expect(textOf(r, "sky_note")).toContain("Below the horizon: The Southern Cross");
    // Up, but not in this portrait, is the other clause — and it is not said
    // twice when focus and mark name the same figure.
    expect(textOf(win({ focus: "Crux", mark: ["Crux"] }), "sky_note")).toContain("Below the horizon: The Southern Cross");
    expect((textOf(win({ focus: "Crux", mark: ["Crux"] }), "sky_note") ?? "").match(/Southern Cross/g)).toHaveLength(1);
  });

  test("a portrait's own stars share a drawing budget, like every other crowd", () => {
    // Separate elements, not a group — but a plan draws them one after another
    // all the same. Orion's 23 dots at SKETCH_MS.dot would be 9.7 seconds.
    const r = win({ focus: "Orion" });
    const ids = new Set(sky.edgeStars(sky.findConstellation("Ori")!).map((h) => sky.starId(sky.star(h)!)));
    const dots = flattenDrawables(r.drawables).filter((d) => ids.has(d.id));
    expect(dots).toHaveLength(23);
    expect(dots.reduce((n, d) => n + d.drawOpts.duration, 0)).toBeLessThan(2200);
    // …and two marked stars on a whole-sky chart still get the full dot time.
    const two = flattenDrawables(lay({ mark: ["Vega", "Deneb"] }).drawables).filter((d) => d.id === "vega" || d.id === "deneb");
    expect(two).toHaveLength(2);
    for (const d of two) expect(d.drawOpts.duration).toBe(420);   // SKETCH_MS.dot
  });

  test("a figure entirely below the horizon is SAID, not silently blank", () => {
    // Crux never rises over Oslo.
    const r = win({ focus: "Crux" });
    expect(textOf(r, "sky_note")).toContain("Below the horizon: The Southern Cross");
    expect(r.order).toContain("horizon");
    expect(r.order).toContain("stars");
  });
});

describe("sky_map: lint-clean over a year of moments", () => {
  // Round 1's lesson, in one test: its default figure warned on EVERY date and
  // nothing noticed for a whole round. 200 moments, stepping 1.837 days and
  // 1.373 hours each time, so a year of sky and a whole day of rotation are
  // both covered — and the bar is zero issues, not zero errors.
  const moments = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * (1.837 * 86400000 + 1.373 * 3600000)).toISOString());

  /** What each row's 200 layouts contained, recorded AS THEY ARE SWEPT and
   *  read back by the guard below. Counting the subjects in a second pass laid
   *  1 400 charts a second time for five and a half seconds, and proved facts
   *  about layouts the rows had not asserted on; this is the same ones. */
  const drew: Record<string, { figures: number; frame: number; con_ori: number; names: number[] }> = {};

  const sweep = (params: Record<string, unknown>, row = ""): { dirty: string[]; count: number } => {
    const dirty: string[] = [];
    const seen = { figures: 0, frame: 0, con_ori: 0, names: [] as number[] };
    let count = 0;
    for (const time of moments(200)) {
      const r = layoutSpec(spec({ ...params, time }));
      if (r.issues.length > 0) { count++; dirty.push(`${time}: [${r.issues[0].severity}] ${r.issues[0].message}`); }
      // One allocation-free pass over `order`: four `includes`/`filter` calls
      // over 450 ids, 200 times, 19 rows, is two seconds of nothing.
      let named = 0;
      for (const id of r.order) {
        if (id.startsWith("label_con_")) named++;
        else if (id === "figures") seen.figures++;
        else if (id === "frame") seen.frame++;
        else if (id === "con_ori") seen.con_ori++;
      }
      seen.names.push(named);
    }
    if (row !== "") drew[row] = seen;
    return { dirty: dirty.slice(0, 4), count };
  };

  // The guard that makes every row below mean anything. `resolveTime` answers
  // an unparseable `time` with the REAL clock and says nothing, so a sweep
  // whose timestamps it cannot read is two hundred copies of this instant —
  // which is exactly what these rows were until the pattern learned to read
  // the milliseconds `toISOString()` always writes (src/scenes/space/
  // sky-rules.ts). A sweep has to prove it swept.
  test("the sweep really moves the sky — 200 moments, 200 different skies", () => {
    const clocks = new Set(moments(200).map((time) => textOf(lay({ time }), "place_label")!));
    expect(clocks.size).toBe(200);
    const fields = new Set(moments(20).map((time) => JSON.stringify(lay({ time }).drawables)));
    expect(fields.size).toBe(20);
  });

  test.each([
    ["the default figure", {}],
    ["in Norwegian", { names: "nb" }],
    ["in Latin", { names: "la" }],
    ["with no names at all", { names: "none" }],
    ["from Tromsø", { lat: 69.65, lon: 18.96, place: "Tromsø" }],
    ["from the equator", { lat: 0, lon: 0, place: "The equator" }],
    ["from Sydney", { lat: -33.87, lon: 151.21, place: "Sydney" }],
    ["at the brightest limit, where the figures keep their faint stars", { limit_mag: 2 }],
    ["at the brightest limit with no figures to keep them", { limit_mag: 2, constellations: "none" }],
    ["with a title over it", { title: "The sky over Oslo tonight" }],
    ["with a planet named that is sometimes down", { show: ["jupiter", "saturn"] }],
    ["with a star singled out", { mark: ["Vega"], highlight: ["Sirius"] }],
    ["with an unknown name", { show: ["planets", "krypton"] }],
    ["with lines but no names", { constellations: "lines" }],
    ["with names but no lines", { constellations: "names" }],
    ["with a constellation singled out", { mark: ["Orion"], highlight: ["Cassiopeia"] }],
    ["a portrait of Orion", { focus: "Orion" }],
    ["a portrait of the Plough", { focus: "Ursa Major" }],
    ["a portrait of Cassiopeia in Norwegian", { focus: "Cassiopeia", names: "nb" }],
  ])("%s is lint-clean on every one of 200 moments", (what, params) => {
    const { dirty, count } = sweep(params, what);
    expect(dirty).toEqual([]);
    expect(count).toBe(0);
  }, 30000);

  // The same guard as the one above, for what THIS round varies — and it reads
  // what the rows recorded WHILE sweeping, so it is provably about the very
  // layouts they called clean. A row called "a portrait of Orion" proves
  // nothing about portraits if Orion was below the horizon at all 200 moments
  // and every one of them quietly fell back to the whole sky; a row called
  // "with lines but no names" proves nothing if no line was ever drawn; and a
  // chart that named no constellation at all would sweep clean for the worst
  // possible reason. Measured: 200/200 charts draw figures, 147/200 of the
  // Orion portraits really are portraits, and a chart names 11–24 figures.
  test("…and those 200 moments really drew what the rows are named after", () => {
    const at = (row: string) => {
      const f = drew[row];
      expect(f, `row "${row}" did not sweep — the rows above must run first`).toBeDefined();
      return f!;
    };
    expect(at("the default figure").figures).toBe(200);
    expect(at("with lines but no names").figures).toBe(200);
    expect(at("with names but no lines").figures).toBe(0);
    expect(Math.min(...at("the default figure").names)).toBeGreaterThanOrEqual(8);
    expect(at("with names but no lines").names.every((n) => n > 0)).toBe(true);
    expect(at("with no names at all").names.every((n) => n === 0)).toBe(true);
    // `frame` is drawn only when a figure really was magnified, and `con_ori`
    // only when Orion had an edge with both stars up.
    expect(at("with a constellation singled out").con_ori).toBeGreaterThan(100);
    expect(at("a portrait of Orion").frame).toBeGreaterThan(100);
    expect(at("a portrait of the Plough").frame).toBe(200);
    expect(at("a portrait of Cassiopeia in Norwegian").frame).toBe(200);
    expect(at("the default figure").frame).toBe(0);
  });

  test("a copy translated into a language the pack does not know keeps its names apart", () => {
    // applyTextMap runs AFTER this body (src/layout/layout.ts:111), so every
    // clearance was measured for the word written HERE. A character of
    // headroom is what the layout buys, and it reserves that character against
    // the drawn LINES as well as against the other names — which is what makes
    // this zero rather than the handful of `label_con_ori` ("Orione") grazes it
    // was when only the label-label side was padded.
    const text_map = {
      Orion: "Orione", "The Great Bear": "Orsa Maggiore", "The Little Bear": "Orsa Minore",
      Cassiopeia: "Cassiopea", "The Bull": "Toro", "The Twins": "Gemelli", "The Charioteer": "Auriga",
      Sirius: "Sirio", Vega: "Vega", "The Sun is up — these stars are there, but you cannot see them": "Il Sole è alto",
    };
    const residual: string[] = [];
    for (const time of moments(40)) {
      const res = layoutSpec({ template: "sky_map", params: { time }, elements: [], text_map } as never);
      expect(res.issues.filter((i) => i.rule === "overlap-label-label").map((i) => i.message), time).toEqual([]);
      for (const i of res.issues) residual.push(`${time}: ${i.message}`);
    }
    expect(residual.length, residual.join("\n")).toBe(0);
  });

  test("the clean figure is not clean because it draws nothing", () => {
    const r = lay({});
    expect(flattenDrawables(r.drawables).filter((d) => d.id.startsWith("stars__hip_")).length).toBeGreaterThan(150);
    expect(r.order).toContain("horizon");
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "text") expect(d.fontSize, d.id).toBeGreaterThanOrEqual(14);
    }
  });

  // The manifest is a document, so it cannot reference SKY_DEFAULTS — its
  // numbers are typed out for the model to read. That makes it the one copy
  // left, and this is what keeps it honest: a range the schema advertises but
  // the template clamps differently would let a model write a spec the chart
  // silently overrules.
  test("what the manifest promises about limit_mag is what the engine actually does", () => {
    const schema = scenes.sky_map.manifest.params_schema as { properties: Record<string, { minimum?: number; maximum?: number; description: string }> };
    const p = schema.properties;
    expect(p.limit_mag.minimum).toBe(sky.defaults.magMin);
    expect(p.limit_mag.maximum).toBe(sky.defaults.magMax);
    expect(sky.limitMag(p.limit_mag.maximum)).toBe(p.limit_mag.maximum);
    expect(sky.limitMag(p.limit_mag.minimum)).toBe(p.limit_mag.minimum);
    // And the defaults the descriptions quote.
    expect(p.lat.description).toContain(String(sky.defaults.lat));
    expect(p.lon.description).toContain(String(sky.defaults.lon));
    expect(p.limit_mag.description).toContain(`default ${sky.defaults.magMax}`);
  });

  test("the manifest's own examples lay out with NO lint issue at all", () => {
    for (const ex of scenes.sky_map.manifest.examples) {
      const res = layoutSpec({ template: "sky_map", params: { time: AT, ...ex.params }, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues.map((i) => `[${i.severity}] ${i.message}`), ex.request).toEqual([]);
    }
  });

  test("two catalogue stars with the same proper name mint ONE element, not a duplicate id", () => {
    // HIP 68002 and HIP 109268 are both called "Alnair" in the bundled table,
    // and both are up from Sydney at this moment. A duplicate drawable id
    // throws in the compile guard, which layoutSpec catches as a silent
    // fall-through to tier-2 — a blank figure and a WARNING, never an issue,
    // so nothing but this test would notice.
    const r = layoutSpec(spec({ lat: -33.87, lon: 151.21, place: "Sydney", mark: ["hip_68002", "hip_109268"] }));
    expect(r.warnings).toEqual([]);
    expect(r.order.filter((id) => id === "alnair")).toHaveLength(1);
    expect(flattenDrawables(r.drawables).filter((d) => d.id === "label_alnair").length).toBeLessThanOrEqual(1);
  });
});
