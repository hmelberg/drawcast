// The sky map's pure rules: the projection, the alt/az transform, the star
// dot's size and tint, the clock, the observer presets and the one foot
// caption's wording. No DOM, no ephemeris library — the ephemeris lives in
// sky.ts, which is the code-split boundary. A layout body cannot import, so
// the engine re-exposes these as engines.sky.*.

import type {
  Chart, Constellation, ConstellationTable, NoteParts, Place, SkyLang, Star, StarTable, AltAz,
} from "./sky-types";

export const DEG = Math.PI / 180;

/** The drawn dome: the zenith at the centre, the horizon at `r`, on the
 *  1000×750 y-up canvas. The template draws it and the tray's click overlay
 *  reads it, so it is defined once. The numbers leave room for the compass
 *  letters at r + 18 (top 688, bottom 82), the title at y 726 and the two
 *  foot lines at y 52 and y 24 — measured so no two boxes meet. */
export const CHART: Chart = Object.freeze({ cx: 500, cy: 385, r: 285 });

/** The box a `focus` portrait crops to — round 1's frame, same numbers. */
export const FRAME = Object.freeze({ x0: 60, y0: 80, x1: 940, y1: 700 });

/** J2000 → equatorial of date. `rot` is the ephemeris library's Rotation_EQJ_EQD
 *  matrix, whose convention is out[j] = Σᵢ rot[i][j]·in[i]. Twenty-six years
 *  of precession moves a star by about 0.35° — more than a bright star's drawn
 *  radius — for one matrix per frame and nine multiply-adds per star. */
export function precess(rot: readonly (readonly number[])[], raDeg: number, decDeg: number): { ra: number; dec: number } {
  const cd = Math.cos(decDeg * DEG);
  const v0 = cd * Math.cos(raDeg * DEG);
  const v1 = cd * Math.sin(raDeg * DEG);
  const v2 = Math.sin(decDeg * DEG);
  const x = rot[0][0] * v0 + rot[1][0] * v1 + rot[2][0] * v2;
  const y = rot[0][1] * v0 + rot[1][1] * v1 + rot[2][1] * v2;
  const z = rot[0][2] * v0 + rot[1][2] * v1 + rot[2][2] * v2;
  return { ra: (Math.atan2(y, x) / DEG + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

/** Equatorial of date → horizontal, for latitude `latDeg` at local sidereal
 *  time `lstDeg`. Azimuth is degrees clockwise from north, the ephemeris library's
 *  own convention — and this agrees with its Horizon() to four decimals
 *  (tests/sky-rules.test.ts), at a tenth of a millisecond for a thousand stars. */
export function altAz(raDeg: number, decDeg: number, lstDeg: number, latDeg: number): AltAz {
  const H = ((((lstDeg - raDeg) % 360) + 540) % 360 - 180) * DEG;
  const d = decDeg * DEG, p = latDeg * DEG;
  const sd = Math.sin(d), cd = Math.cos(d), sp = Math.sin(p), cp = Math.cos(p), ch = Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sd * sp + cd * cp * ch))) / DEG;
  let az = Math.atan2(-Math.sin(H) * cd, sd * cp - cd * sp * ch) / DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

/** Stereographic from the zenith, onto the y-up canvas: north at the top,
 *  EAST ON THE LEFT. A planisphere is held overhead and you look up through
 *  it, so east and west are swapped against a map of the ground. alt 90 → the
 *  centre; alt 0 → the horizon circle; alt < 0 → outside it, which is how the
 *  template omits what has set. */
export function project(p: AltAz, chart: Chart = CHART): [number, number] {
  const r = chart.r * Math.tan(((90 - p.alt) * DEG) / 2);
  return [chart.cx - r * Math.sin(p.az * DEG), chart.cy + r * Math.cos(p.az * DEG)];
}

/** Dot radius by magnitude, ABSOLUTE rather than relative to `limit_mag`: a
 *  star must not change size because the author asked for a fainter chart.
 *  Sirius (−1.46) 4.9, Vega (0.03) 4.0, mag 2 → 2.8, mag 4 → 1.5, floor 1.3
 *  (still ink at the size the page is drawn), cap 5.4. */
export function starRadius(mag: number): number {
  return Math.max(1.3, Math.min(5.4, 4.0 - 0.62 * mag));
}

/** B−V → ink. The chart is dark marks on warm paper (kit.GROUND #faf6ec), so
 *  a star's colour is a TINT of the ink, not the star's own light: a pale blue
 *  dot on cream would be invisible. Every tint clears 4.5:1 against the paper
 *  — measured, not guessed (tests/sky-rules.test.ts recomputes them). */
export const STAR_TINTS: readonly { max: number; color: string }[] = Object.freeze([
  { max: 0.0, color: "#42618c" },   // blue        5.86:1
  { max: 0.3, color: "#4f6f8e" },   // blue-white  4.87:1
  { max: 0.6, color: "#66697a" },   // white       5.03:1
  { max: 1.0, color: "#7d6540" },   // yellow      5.11:1
  { max: 1.5, color: "#8d5932" },   // orange      5.39:1
  { max: Infinity, color: "#94472a" }, // red      6.09:1
]);

/** A star with no colour index is drawn neutral — the "white" band. */
export function starColor(bv: number | null): string {
  const v = bv === null ? 0.45 : bv;
  for (const t of STAR_TINTS) if (v < t.max) return t.color;
  return STAR_TINTS[STAR_TINTS.length - 1].color;
}

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

/**
 * The pack's ONE clock for the sky. "now" — or anything unusable — is the real
 * moment; an ISO datetime carrying an offset or a Z is that instant; one
 * without is read as UTC; a bare date is 22:00 LOCAL SOLAR time at `lon`
 * (UTC + lon/15 hours), which needs no timezone table, is deterministic, and
 * lands within a few minutes of the clock on the wall inside a zone. `hours`
 * and `days` then shift it, fractions allowed — they are the animatable handles.
 */
export function resolveTime(time: unknown, hours: unknown, days: unknown, lon = 0, now: Date = new Date()): Date {
  const s = typeof time === "string" ? time.trim() : "";
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let ms: number;
  if (full) {
    ms = full[7] ? Date.parse(s.replace(" ", "T")) : Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] ?? 0));
  } else if (dateOnly) {
    ms = Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) + Math.round((22 - lon / 15) * HOUR_MS);
  } else {
    ms = now.getTime();
  }
  if (!Number.isFinite(ms)) ms = now.getTime();
  const h = typeof hours === "number" && Number.isFinite(hours) ? hours : 0;
  const d = typeof days === "number" && Number.isFinite(days) ? days : 0;
  return new Date(ms + h * HOUR_MS + d * DAY_MS);
}

/** What `place_label` writes: local SOLAR time at `lon`. Same reasoning as
 *  the bare-date rule above — no timezone table, and honest about being solar. */
export function localClock(at: Date, lon: number): { date: string; time: string } {
  const d = new Date(at.getTime() + (lon / 15) * HOUR_MS);
  const p = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

/**
 * The figure's ONE caption, as clauses in the order they matter. The template
 * joins them with " · " and drops from the END while the line is too wide,
 * which is why the cheapest clause is last. Round 1's known limit was two
 * captions colliding in the same foot strip; one caption cannot collide with
 * itself.
 */
export function noteClauses(p: NoteParts, lang: SkyLang): string[] {
  const nb = lang === "nb";
  const out: string[] = [];
  if (p.daylight) out.push(nb ? "Sola er oppe — stjernene er der, men du kan ikke se dem" : "The Sun is up — these stars are there, but you cannot see them");
  if (p.below.length > 0) out.push((nb ? "Under horisonten: " : "Below the horizon: ") + p.below.join(", "));
  if (p.unknown.length > 0) out.push((nb ? "Ukjent: " : "Unknown: ") + p.unknown.join(", "));
  if (p.symbols) out.push(nb ? "Sol, måne og planeter som symboler, ikke i målestokk" : "Sun, Moon and planets as symbols, not to scale");
  return out;
}

export function constellationName(c: Constellation, lang: SkyLang): string {
  return lang === "nb" ? c.name.nb : lang === "la" ? c.name.la : c.name.en;
}

/** The proper name, or null for the anonymous field. Norwegian only where it
 *  differs — most star names are the same word in every language. */
export function starName(s: Star, lang: SkyLang): string | null {
  if (!s.name) return null;
  return lang === "nb" && s.name_nb ? s.name_nb : s.name;
}

export function starId(s: Star): string {
  return s.name ? s.name.toLowerCase().replace(/\s+/g, "_") : `hip_${s.hip}`;
}

export function conId(c: Constellation): string {
  return `con_${c.abbr.toLowerCase()}`;
}

export function edgeStars(c: Constellation): number[] {
  return [...new Set(c.edges.flat())].sort((a, b) => a - b);
}

export const PLACES: readonly Place[] = Object.freeze([
  { id: "oslo", name: { en: "Oslo", nb: "Oslo" }, lat: 59.91, lon: 10.75 },
  { id: "bergen", name: { en: "Bergen", nb: "Bergen" }, lat: 60.39, lon: 5.32 },
  { id: "tromso", name: { en: "Tromsø", nb: "Tromsø" }, lat: 69.65, lon: 18.96 },
  { id: "equator", name: { en: "The equator", nb: "Ekvator" }, lat: 0, lon: 0 },
]);

export function placeName(p: Place, lang: SkyLang): string {
  return lang === "nb" ? p.name.nb : p.name.en;
}

export function expandStars(t: StarTable): Star[] {
  return t.stars.map((s) => ({
    hip: s.i,
    ra: s.c[0],
    dec: s.c[1],
    mag: s.m,
    bv: s.b,
    name: s.n ?? null,
    name_nb: s.nb ?? null,
  }));
}

export function expandConstellations(t: ConstellationTable): Constellation[] {
  return t.constellations.map((c) => ({ abbr: c.a, name: { la: c.la, en: c.en, nb: c.nb }, edges: c.e }));
}
