// Positions for a date. astronomy-engine (MIT) where it has an ephemeris —
// the Sun, the eight planets and Pluto (HelioVector), the Moon (GeoMoon), the
// Galilean moons (JupiterMoons) — and a circular orbit of radius a_km for
// every other body. This is the ONE place in the pack that reads a clock
// (resolveDate); layouts stay deterministic by taking the Date it hands back.
//
// This file is reached in the browser only through engine.ts, which the
// engine loader dynamic-imports: that is what keeps the 116 KB of
// astronomy-engine out of the main chunk. Never import it from tray/ui code.

import * as AstroNs from "astronomy-engine";
import { AU_KM } from "./rules";
import type { Body, MoonPhaseInfo, Vec } from "./types";

// astronomy-engine ships CommonJS. Vite prebundles it with named exports;
// Node's ESM interop may hand the exports over directly or under `default`.
// One shim, both worlds — tests/space-ephemeris.test.ts proves the node path,
// the smoke (Task 10) the browser path.
const A: typeof AstroNs = (AstroNs as { HelioVector?: unknown }).HelioVector ? AstroNs : ((AstroNs as { default?: typeof AstroNs }).default as typeof AstroNs);

export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86400000;

/** Mean obliquity of the ecliptic at J2000. HelioVector, GeoMoon and JupiterMoons
 *  return J2000 EQUATORIAL (EQJ) vectors; one rotation about x makes them ecliptic. */
const OBLIQUITY_DEG = 23.4392911;
const EPS = (OBLIQUITY_DEG * Math.PI) / 180;
const COS_E = Math.cos(EPS), SIN_E = Math.sin(EPS);

const ASTRO_BODY: Record<string, AstroNs.Body> = {
  sun: A.Body.Sun,
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  earth: A.Body.Earth,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
  pluto: A.Body.Pluto,
};
const GALILEAN = ["io", "europa", "ganymede", "callisto"] as const;

/** Bodies whose position is a real ephemeris; every other body is the circular sketch. */
export const EPHEMERIS_IDS: ReadonlySet<string> = new Set([...Object.keys(ASTRO_BODY), "moon", ...GALILEAN]);

export function eqjToEcliptic(v: { x: number; y: number; z: number }): Vec {
  return { x: v.x, y: v.y * COS_E + v.z * SIN_E, z: -v.y * SIN_E + v.z * COS_E };
}

/**
 * "today" (or anything unusable) is the current UTC day at midnight — stable
 * within a day, so every figure in a session agrees; an ISO date (any time
 * part ignored) is that UTC midnight; `days` shifts either, fractions allowed.
 */
export function resolveDate(date: unknown, days: unknown): Date {
  let ms: number;
  const iso = typeof date === "string" ? date.trim() : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(iso);
  if (m) {
    ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const now = new Date();
    ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
  const d = typeof days === "number" && Number.isFinite(days) ? days : 0;
  return new Date(ms + d * DAY_MS);
}

export function daysSinceJ2000(d: Date): number {
  return (d.getTime() - J2000_MS) / DAY_MS;
}

/** The circular sketch: 2π·t/period from the body's J2000 longitude (l0_deg, default 0); a negative period runs clockwise. */
export function circularAngle(body: Body, d: Date): number {
  if (!body.period_d) return 0;
  const l0 = ((body.l0_deg ?? 0) * Math.PI) / 180;
  return l0 + (2 * Math.PI * daysSinceJ2000(d)) / body.period_d;
}

/** Heliocentric ecliptic positions in AU. A moon reports its parent's position (it is invisible at any honest solar-system scale). */
export function helioPositions(all: Record<string, Body>, ids: readonly string[], d: Date): Record<string, Vec> {
  const out: Record<string, Vec> = {};
  const one = (id: string): Vec | null => {
    const b = all[id];
    if (!b) return null;
    if (id === "sun") return { x: 0, y: 0, z: 0 };
    if (b.parent && b.parent !== "sun") return one(b.parent);
    const ab = ASTRO_BODY[id];
    if (ab !== undefined) return eqjToEcliptic(A.HelioVector(ab, d));
    const t = circularAngle(b, d), r = b.a_km / AU_KM;
    return { x: r * Math.cos(t), y: r * Math.sin(t), z: 0 };
  };
  for (const id of ids) {
    const p = one(id);
    if (p) out[id] = p;
  }
  return out;
}

/**
 * Parent-centred ecliptic positions in km: GeoMoon for the Moon, JupiterMoons
 * for the Galileans, the circular sketch for the rest. Ids that are not moons
 * of `parentId` are left out.
 */
export function moonPositionsKm(all: Record<string, Body>, parentId: string, ids: readonly string[], d: Date): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  let jm: AstroNs.JupiterMoonsInfo | null = null;
  for (const id of ids) {
    const b = all[id];
    if (!b || b.parent !== parentId) continue;
    if (parentId === "earth" && id === "moon") {
      const v = eqjToEcliptic(A.GeoMoon(d));
      out[id] = { x: v.x * AU_KM, y: v.y * AU_KM };
      continue;
    }
    if (parentId === "jupiter" && (GALILEAN as readonly string[]).includes(id)) {
      jm ??= A.JupiterMoons(d);
      // astronomy.d.ts names the four as io/europa/ganymede/callisto; an older
      // build exposes moon[0..3] in the same order — accept either.
      const info = jm as unknown as Record<string, { x: number; y: number; z: number }> & { moon?: { x: number; y: number; z: number }[] };
      const sv = info[id] ?? info.moon?.[GALILEAN.indexOf(id as (typeof GALILEAN)[number])];
      if (sv) {
        const v = eqjToEcliptic(sv);
        out[id] = { x: v.x * AU_KM, y: v.y * AU_KM };
        continue;
      }
    }
    const t = circularAngle(b, d);
    out[id] = { x: b.a_km * Math.cos(t), y: b.a_km * Math.sin(t) };
  }
  return out;
}

export const PHASE_NAMES: { en: string; nb: string }[] = [
  { en: "new moon", nb: "nymåne" },
  { en: "waxing crescent", nb: "voksende månesigd" },
  { en: "first quarter", nb: "første kvarter" },
  { en: "waxing gibbous", nb: "voksende måne" },
  { en: "full moon", nb: "fullmåne" },
  { en: "waning gibbous", nb: "avtagende måne" },
  { en: "last quarter", nb: "siste kvarter" },
  { en: "waning crescent", nb: "avtagende månesigd" },
];

/** The Moon's phase: illuminated fraction from Illumination, the waxing/waning side and the name from MoonPhase's 0–360° angle. */
export function moonPhase(d: Date): MoonPhaseInfo {
  const angle = A.MoonPhase(d);
  const fraction = A.Illumination(A.Body.Moon, d).phase_fraction;
  const i = Math.floor(((angle + 22.5) % 360) / 45);
  return { fraction, waxing: angle < 180, angle, name: PHASE_NAMES[i].en, name_nb: PHASE_NAMES[i].nb };
}
