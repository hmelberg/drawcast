import { describe, expect, test } from "vitest";
import bodiesJson from "../src/scenes/space/bodies.json";
import type { BodiesTable } from "../src/scenes/space/types";
import { AU_KM, indexBodies } from "../src/scenes/space/rules";
import {
  EPHEMERIS_IDS, J2000_MS, PHASE_NAMES, circularAngle, daysSinceJ2000, eqjToEcliptic, helioPositions, moonPhase, moonPositionsKm, resolveDate,
} from "../src/scenes/space/ephemeris";

const all = indexBodies(bodiesJson as unknown as BodiesTable);
const D = resolveDate("2026-09-06", 0);
const deg = (r: number): number => ((r * 180) / Math.PI + 360) % 360;
const norm = (p: { x: number; y: number }): number => Math.hypot(p.x, p.y);

describe("resolveDate", () => {
  test("an ISO date is that day at UTC midnight; days shift it, fractions included", () => {
    expect(D.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(resolveDate("2026-09-06", 1.5).toISOString()).toBe("2026-09-07T12:00:00.000Z");
    expect(resolveDate("2026-09-06T14:30:00+02:00", 0).toISOString()).toBe("2026-09-06T00:00:00.000Z");
  });
  test("'today', undefined and garbage are today's UTC midnight", () => {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    expect(resolveDate("today", 0).getTime()).toBe(midnight);
    expect(resolveDate(undefined, undefined).getTime()).toBe(midnight);
    expect(resolveDate("yesterday-ish", "3").getTime()).toBe(midnight);
  });
  test("J2000 is 2000-01-01 12:00 UTC", () => {
    expect(daysSinceJ2000(resolveDate("2000-01-01", 0))).toBe(-0.5);
    expect(J2000_MS).toBe(Date.UTC(2000, 0, 1, 12));
  });
});

describe("heliocentric positions (astronomy-engine, rotated to the ecliptic)", () => {
  test("Earth is one AU from the Sun on 2026-09-06, in the ecliptic plane, at a heliocentric longitude near 343°", () => {
    const p = helioPositions(all, ["earth"], D).earth;
    expect(norm(p)).toBeGreaterThan(0.98);
    expect(norm(p)).toBeLessThan(1.02);
    expect(Math.abs(p.z)).toBeLessThan(0.005); // in the EQUATORIAL frame this would be ~0.4 AU
    const lon = deg(Math.atan2(p.y, p.x));
    expect(lon).toBeGreaterThan(335);
    expect(lon).toBeLessThan(352);
  });
  test("the Sun is the origin; Mars lies between perihelion and aphelion", () => {
    const p = helioPositions(all, ["sun", "mars"], D);
    expect(p.sun).toEqual({ x: 0, y: 0, z: 0 });
    expect(norm(p.mars)).toBeGreaterThan(1.38);
    expect(norm(p.mars)).toBeLessThan(1.67);
  });
  test("one Martian year later Mars has come round to the same longitude", () => {
    const a = helioPositions(all, ["mars"], D).mars;
    const b = helioPositions(all, ["mars"], resolveDate("2026-09-06", all.mars.period_d)).mars;
    const da = Math.abs(deg(Math.atan2(a.y, a.x)) - deg(Math.atan2(b.y, b.x)));
    expect(Math.min(da, 360 - da)).toBeLessThan(1.5);
  });
  test("a moon reports its parent's position; unknown ids are left out", () => {
    const p = helioPositions(all, ["io", "jupiter", "krypton"], D);
    expect(p.io).toEqual(p.jupiter);
    expect(p.krypton).toBeUndefined();
  });
  test("a body without an ephemeris rides the circular sketch at its semi-major axis", () => {
    const p = helioPositions(all, ["ceres"], D).ceres;
    expect(norm(p)).toBeCloseTo(all.ceres.a_km / AU_KM, 9);
    expect(EPHEMERIS_IDS.has("ceres")).toBe(false);
    expect(EPHEMERIS_IDS.has("pluto")).toBe(true);
    expect(EPHEMERIS_IDS.size).toBe(15);
  });
  test("the rotation is the J2000 obliquity about x", () => {
    const v = eqjToEcliptic({ x: 1, y: 0, z: 0 });
    expect(v).toEqual({ x: 1, y: 0, z: 0 });
    const w = eqjToEcliptic({ x: 0, y: 0, z: 1 });
    expect(w.y).toBeCloseTo(Math.sin((23.4392911 * Math.PI) / 180), 9);
  });
});

describe("moon positions (parent-centred, km)", () => {
  test("the Moon is 356 000 – 407 000 km from Earth", () => {
    const r = norm(moonPositionsKm(all, "earth", ["moon"], D).moon);
    expect(r).toBeGreaterThan(356000);
    expect(r).toBeLessThan(407000);
  });
  test("the Galilean moons come out in order, Io at about 421 800 km", () => {
    const p = moonPositionsKm(all, "jupiter", ["callisto", "io", "europa", "ganymede"], D);
    expect(norm(p.io)).toBeGreaterThan(421800 * 0.95);
    expect(norm(p.io)).toBeLessThan(421800 * 1.05);
    expect(norm(p.io)).toBeLessThan(norm(p.europa));
    expect(norm(p.europa)).toBeLessThan(norm(p.ganymede));
    expect(norm(p.ganymede)).toBeLessThan(norm(p.callisto));
  });
  test("every other moon rides a circle of radius a_km and returns after one period", () => {
    const a = moonPositionsKm(all, "saturn", ["titan"], D).titan;
    expect(norm(a)).toBeCloseTo(all.titan.a_km, 6);
    const b = moonPositionsKm(all, "saturn", ["titan"], resolveDate("2026-09-06", all.titan.period_d)).titan;
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.y).toBeCloseTo(a.y, 3);
  });
  test("a retrograde moon runs the other way; a foreign id is left out", () => {
    const t0 = resolveDate("2026-09-06", 0), t1 = resolveDate("2026-09-06", 0.5);
    const a = moonPositionsKm(all, "neptune", ["triton"], t0).triton, b = moonPositionsKm(all, "neptune", ["triton"], t1).triton;
    expect(a.x * b.y - a.y * b.x).toBeLessThan(0); // clockwise
    expect(moonPositionsKm(all, "jupiter", ["titan"], D).titan).toBeUndefined();
  });
  test("circularAngle: one period is one turn, from l0", () => {
    const fake = { ...all.ceres, period_d: 10, l0_deg: 90 };
    expect(circularAngle(fake, new Date(J2000_MS))).toBeCloseTo(Math.PI / 2, 9);
    expect(circularAngle(fake, new Date(J2000_MS + 10 * 86400000))).toBeCloseTo(Math.PI / 2 + 2 * Math.PI, 9);
  });
});

describe("moon phase", () => {
  test("fraction in [0, 1], a name from the eight, waxing below 180°", () => {
    const p = moonPhase(D);
    expect(p.fraction).toBeGreaterThanOrEqual(0);
    expect(p.fraction).toBeLessThanOrEqual(1);
    expect(PHASE_NAMES.map((n) => n.en)).toContain(p.name);
    expect(PHASE_NAMES.map((n) => n.nb)).toContain(p.name_nb);
    expect(p.waxing).toBe(p.angle < 180);
  });
  test("the least-lit day of a month is a new moon", () => {
    let best = moonPhase(D);
    for (let i = 1; i <= 30; i++) { const p = moonPhase(resolveDate("2026-09-06", i)); if (p.fraction < best.fraction) best = p; }
    expect(best.fraction).toBeLessThan(0.05);
    expect(best.name).toBe("new moon");
  });
});
