// The object a layout sees as `engines.sky`: the committed star and
// constellation tables, the ephemeris for the Sun, Moon and planets, and the
// pure rules, behind one interface. Built by engines.ts's loadSky.
//
// THIS FILE IS THE CODE-SPLIT BOUNDARY. It imports astronomy-engine
// statically, so nothing the main chunk reaches may import it — sky-types.ts
// and sky-rules.ts are the light half the tray uses. The same rule
// space/engine.ts follows for round 1.

import * as AstroNs from "astronomy-engine";
import {
  CHART, DEG, PLACES, altAz, conId, constellationName, edgeStars, expandConstellations, expandStars,
  localClock, noteClauses, placeName, precess, project, resolveTime, starColor, starId, starName, starRadius,
} from "./sky-rules";
import type { AltAz, Constellation, ConstellationTable, SkyEngine, Star, StarTable } from "./sky-types";

// astronomy-engine ships CommonJS; Vite prebundles named exports, Node's ESM
// interop may hand them over under `default`. One shim, both worlds — the same
// one ephemeris.ts uses.
const A: typeof AstroNs = (AstroNs as { HelioVector?: unknown }).HelioVector ? AstroNs : ((AstroNs as { default?: typeof AstroNs }).default as typeof AstroNs);

/** The bodies a sky chart can mark, by their round-1 `space` ids. Everything
 *  else — a moon, a dwarf planet — is left out rather than faked: nothing but
 *  these has a naked-eye place in the sky worth drawing. */
const ASTRO_BODY: Record<string, AstroNs.Body> = {
  sun: A.Body.Sun,
  moon: A.Body.Moon,
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
};

/** Local apparent sidereal time in degrees — the one number the whole chart
 *  turns on. SiderealTime is Greenwich, in hours; longitude east adds lon/15. */
function lstDeg(at: Date, lon: number): number {
  return (((A.SiderealTime(at) + lon / 15) * 15) % 360 + 360) % 360;
}

const unit = (raDeg: number, decDeg: number): [number, number, number] => {
  const cd = Math.cos(decDeg * DEG);
  return [cd * Math.cos(raDeg * DEG), cd * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
};

export function makeSkyEngine(starTable: StarTable, conTable: ConstellationTable): SkyEngine {
  const stars = expandStars(starTable);
  const cons = expandConstellations(conTable);
  const byHip = new Map(stars.map((s) => [s.hip, s]));

  // One index per lookup, built once: a model spells a star four ways and a
  // constellation five, and a chart that answered to only one of them would
  // send half of them to the "unknown" clause of its own caption.
  const starIndex = new Map<string, Star>();
  // A HIP key belongs to exactly one star, but a PROPER NAME need not: the
  // catalogue calls both HIP 68002 (ζ Cen, mag 2.55) and HIP 109268 (α Gru,
  // mag 1.73) "Alnair". Whoever types that name means the one you can see —
  // so brightness settles a collision, not catalogue order, which happened to
  // hand the name to the fainter of the two.
  const put = (k: string | number, s: Star): void => {
    const key = String(k).trim().toLowerCase();
    if (key === "") return;
    const held = starIndex.get(key);
    if (held === undefined || s.mag < held.mag) starIndex.set(key, s);
  };
  for (const s of stars) {
    put(s.hip, s);
    put(`hip_${s.hip}`, s);
    if (s.name) { put(s.name, s); put(starId(s), s); }
    if (s.name_nb) put(s.name_nb, s);
  }
  const conIndex = new Map<string, Constellation>();
  for (const c of cons) {
    for (const k of [c.abbr, conId(c), c.name.la, c.name.en, c.name.nb]) {
      const key = k.trim().toLowerCase();
      if (!conIndex.has(key)) conIndex.set(key, c);
    }
  }

  return {
    chart: CHART,
    stars: () => stars,
    star: (hip) => byHip.get(hip),
    findStar: (q) => (typeof q === "string" ? starIndex.get(q.trim().toLowerCase()) : undefined),
    constellations: () => cons,
    findConstellation: (q) => (typeof q === "string" ? conIndex.get(q.trim().toLowerCase()) : undefined),
    edgeStars,
    resolveTime,
    localClock,

    starPositions(at, lat, lon) {
      // One precession matrix and one sidereal time per frame; nine
      // multiply-adds and two trig calls per star after that. Measured: 0.3 ms
      // for the whole catalogue, where a per-star Horizon() call is not.
      const rot = A.Rotation_EQJ_EQD(at).rot;
      const lst = lstDeg(at, lon);
      const out = new Map<number, AltAz>();
      for (const s of stars) {
        const d = precess(rot, s.ra, s.dec);
        out.set(s.hip, altAz(d.ra, d.dec, lst, lat));
      }
      return out;
    },

    bodyPositions(ids, at, lat, lon) {
      // Equator of date WITH aberration and a real observer, so the Moon's
      // parallax — about a degree — is in; then the same altAz the stars use,
      // so one transform draws the whole chart.
      const obs = new A.Observer(lat, lon, 0);
      const lst = lstDeg(at, lon);
      const out: Record<string, AltAz> = {};
      for (const id of ids) {
        const body = ASTRO_BODY[id];
        if (body === undefined) continue;
        const eq = A.Equator(body, at, obs, true, true);
        out[id] = altAz(eq.ra * 15, eq.dec, lst, lat);
      }
      return out;
    },

    moonLimb(at, lat, lon) {
      const obs = new A.Observer(lat, lon, 0);
      const lst = lstDeg(at, lon);
      const fraction = A.Illumination(A.Body.Moon, at).phase_fraction;
      let toward: AltAz | null = null;
      // Gated on the ILLUMINATED FRACTION, not the Sun-Moon separation on the
      // sky: at an exact new or full Moon (ecliptic longitude 0°/180° apart),
      // the Moon's own ecliptic latitude (up to ~5°) can still put it several
      // degrees from the Sun on the sky — a real, well-defined direction, but
      // one a barely-lit sliver or a near-full disc has no visible crescent
      // edge worth pointing with. Measured: at the 2026-09-11 new Moon the
      // fraction is 0.0002 while the sky separation is still 2.4°, so a
      // separation-based cutoff would have missed it.
      if (fraction > 0.005 && fraction < 0.995) {
        const eqM = A.Equator(A.Body.Moon, at, obs, true, true);
        const eqS = A.Equator(A.Body.Sun, at, obs, true, true);
        const m = unit(eqM.ra * 15, eqM.dec);
        const s = unit(eqS.ra * 15, eqS.dec);
        const dot = m[0] * s[0] + m[1] * s[1] + m[2] * s[2];
        const t = [s[0] - dot * m[0], s[1] - dot * m[1], s[2] - dot * m[2]];
        const len = Math.hypot(t[0], t[1], t[2]);
        // Defensive only: the fraction gate above already keeps the Sun and
        // Moon well off being (anti)parallel, so len (= sin of their sky
        // separation) is never near zero here in practice.
        if (len > 1e-6) {
          const c5 = Math.cos(5 * DEG), s5 = Math.sin(5 * DEG);
          const p = [0, 1, 2].map((i) => m[i] * c5 + (t[i] / len) * s5);
          const ra = (Math.atan2(p[1], p[0]) / DEG + 360) % 360;
          const dec = Math.asin(Math.max(-1, Math.min(1, p[2]))) / DEG;
          toward = altAz(ra, dec, lst, lat);
        }
      }
      return { fraction, waxing: A.MoonPhase(at) < 180, toward };
    },

    project,
    starRadius,
    starColor,
    name: constellationName,
    starName,
    starId,
    conId,
    noteClauses,
    places: () => PLACES,
    placeName,
  };
}
