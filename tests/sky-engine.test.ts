// engines.sky: the committed tables plus astronomy-engine, behind one
// interface. What is checked here is that the ephemeris half agrees with
// astronomy-engine's own answers, and that the lookups are as forgiving as a
// model's spelling requires.

import { beforeAll, describe, expect, test } from "vitest";
import * as A from "astronomy-engine";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import { TEMPLATE_DOC_API_SCHEMA } from "../src/llm/author";
import type { AltAz, SkyEngine } from "../src/scenes/space/sky-types";

let sky: SkyEngine;
const OSLO = { lat: 59.91, lon: 10.75 };
const AT = new Date("2026-09-07T21:00:00Z");

beforeAll(async () => {
  await ensureEngines(["sky"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
});

/** Angular separation of two horizontal positions, degrees. */
function sep(a: AltAz, b: AltAz): number {
  const d = Math.PI / 180;
  const v = (p: AltAz): number[] => [Math.cos(p.alt * d) * Math.cos(p.az * d), Math.cos(p.alt * d) * Math.sin(p.az * d), Math.sin(p.alt * d)];
  const [x, y] = [v(a), v(b)];
  return Math.acos(Math.max(-1, Math.min(1, x[0] * y[0] + x[1] * y[1] + x[2] * y[2]))) / d;
}

describe("registration", () => {
  test("sky joins the known engines, the loader table and the authoring schema", () => {
    expect(KNOWN_ENGINES).toContain("sky");
    expect(ENGINE_DEFS.sky).toBeDefined();
    expect(TEMPLATE_DOC_API_SCHEMA.properties.engines.items.enum).toEqual([...KNOWN_ENGINES]);
  });
});

describe("the tables, and finding things in them", () => {
  test("the whole bundled sky is there, and the chart is defined once", () => {
    expect(sky.stars().length).toBeGreaterThanOrEqual(1000);
    expect(sky.constellations()).toHaveLength(88);
    expect(sky.chart).toEqual({ cx: 500, cy: 385, r: 285 });
  });

  test("a star answers to its name, its id and its number", () => {
    const sirius = sky.findStar("Sirius")!;
    expect(sirius).toBeDefined();
    expect(sky.findStar("sirius")).toBe(sirius);
    expect(sky.findStar(`hip_${sirius.hip}`)).toBe(sirius);
    expect(sky.findStar(String(sirius.hip))).toBe(sirius);
    expect(sky.star(sirius.hip)).toBe(sirius);
    expect(sky.findStar("Polarstjernen")!.name).toBe("Polaris");
    expect(sky.findStar("krypton")).toBeUndefined();
  });

  test("a constellation answers to its abbreviation, its id and all three names", () => {
    const uma = sky.findConstellation("UMa")!;
    for (const q of ["uma", "con_uma", "Ursa Major", "The Great Bear", "store bjørn"]) {
      expect(sky.findConstellation(q), q).toBe(uma);
    }
    expect(sky.conId(uma)).toBe("con_uma");
    expect(sky.name(uma, "nb")).toBe("Store bjørn");
    expect(sky.findConstellation("Krypton")).toBeUndefined();
  });

  test("a figure's own stars are all in the table", () => {
    const ori = sky.findConstellation("Orion")!;
    const hips = sky.edgeStars(ori);
    expect(hips.length).toBeGreaterThanOrEqual(15);
    for (const h of hips) expect(sky.star(h), `HIP ${h}`).toBeDefined();
  });
});

describe("where things are", () => {
  test("every star gets an alt/az, and they match astronomy-engine's own Horizon()", () => {
    const pos = sky.starPositions(AT, OSLO.lat, OSLO.lon);
    expect(pos.size).toBe(sky.stars().length);
    const obs = new A.Observer(OSLO.lat, OSLO.lon, 0);
    for (const name of ["Sirius", "Vega", "Polaris"]) {
      const s = sky.findStar(name)!;
      // Precess by astronomy-engine's OWN path, then ask its own Horizon() —
      // so this compares two independent routes, not a formula with itself.
      const sph = A.SphereFromVector(A.RotateVector(A.Rotation_EQJ_EQD(AT), A.VectorFromSphere(new A.Spherical(s.dec, s.ra, 1), AT)));
      const theirs = A.Horizon(AT, obs, sph.lon / 15, sph.lat, "");
      const mine = pos.get(s.hip)!;
      expect(mine.alt, name).toBeCloseTo(theirs.altitude, 3);
      expect(mine.az, name).toBeCloseTo(theirs.azimuth, 3);
    }
  });

  test("Polaris stands at the observer's latitude, from Oslo, Tromsø and the equator", () => {
    const s = sky.findStar("Polaris")!;
    for (const p of [{ lat: 59.91, lon: 10.75 }, { lat: 69.65, lon: 18.96 }]) {
      expect(sky.starPositions(AT, p.lat, p.lon).get(s.hip)!.alt, String(p.lat)).toBeCloseTo(p.lat, 0);
    }
    expect(Math.abs(sky.starPositions(AT, 0, 0).get(s.hip)!.alt)).toBeLessThan(1.5);
  });

  test("the Sun, Moon and planets agree with Equator → Horizon", () => {
    const got = sky.bodyPositions(["sun", "moon", "jupiter", "saturn"], AT, OSLO.lat, OSLO.lon);
    const obs = new A.Observer(OSLO.lat, OSLO.lon, 0);
    for (const [id, body] of [["sun", A.Body.Sun], ["moon", A.Body.Moon], ["jupiter", A.Body.Jupiter], ["saturn", A.Body.Saturn]] as const) {
      const eq = A.Equator(body, AT, obs, true, true);
      const theirs = A.Horizon(AT, obs, eq.ra, eq.dec, "");
      expect(got[id].alt, id).toBeCloseTo(theirs.altitude, 4);
      expect(got[id].az, id).toBeCloseTo(theirs.azimuth, 4);
    }
    // An id that is not a naked-eye body is left out, not faked.
    expect(sky.bodyPositions(["krypton", "io"], AT, OSLO.lat, OSLO.lon)).toEqual({});
  });

  test("the Sun is high at midday and below the horizon at midnight", () => {
    const noon = sky.bodyPositions(["sun"], new Date("2026-06-21T10:00:00Z"), OSLO.lat, OSLO.lon).sun;
    const night = sky.bodyPositions(["sun"], new Date("2026-12-21T23:00:00Z"), OSLO.lat, OSLO.lon).sun;
    expect(noon.alt).toBeGreaterThan(40);
    expect(noon.az).toBeGreaterThan(120);   // south-ish at local noon from 60°N
    expect(noon.az).toBeLessThan(240);
    expect(night.alt).toBeLessThan(0);
  });

  test("a thousand stars cost well under a frame", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) sky.starPositions(new Date(AT.getTime() + i * 3600000), OSLO.lat, OSLO.lon);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });
});

describe("the Moon's phase", () => {
  test("the illuminated fraction is astronomy-engine's, and waxing follows the phase angle", () => {
    const m = sky.moonLimb(AT, OSLO.lat, OSLO.lon);
    expect(m.fraction).toBeCloseTo(A.Illumination(A.Body.Moon, AT).phase_fraction, 6);
    expect(m.waxing).toBe(A.MoonPhase(AT) < 180);
  });

  test("the bright limb points at the Sun, 5° away from the Moon", () => {
    const at = new Date("2026-09-20T20:00:00Z");
    const m = sky.moonLimb(at, OSLO.lat, OSLO.lon);
    expect(m.toward).not.toBeNull();
    const p = sky.bodyPositions(["moon", "sun"], at, OSLO.lat, OSLO.lon);
    expect(sep(p.moon, m.toward!)).toBeCloseTo(5, 1);
    // Stepping toward the Sun really does get closer to it.
    expect(sep(m.toward!, p.sun)).toBeLessThan(sep(p.moon, p.sun));
  });

  test("at new and full there is no direction worth drawing", () => {
    // Ask astronomy-engine for a real new moon rather than guessing a date.
    const newMoon = A.SearchMoonPhase(0, new Date("2026-09-01T00:00:00Z"), 40)!.date;
    expect(sky.moonLimb(newMoon, OSLO.lat, OSLO.lon).toward).toBeNull();
    expect(sky.moonLimb(newMoon, OSLO.lat, OSLO.lon).fraction).toBeLessThan(0.01);
    const full = A.SearchMoonPhase(180, new Date("2026-09-01T00:00:00Z"), 40)!.date;
    expect(sky.moonLimb(full, OSLO.lat, OSLO.lon).toward).toBeNull();
    expect(sky.moonLimb(full, OSLO.lat, OSLO.lon).fraction).toBeGreaterThan(0.99);
  });
});

describe("the code-split boundary", () => {
  test("the light half never pulls astronomy-engine in", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["sky-rules.ts", "sky-types.ts"]) {
      const src = readFileSync(new URL(`../src/scenes/space/${f}`, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/astronomy-engine/);
    }
  });
});
