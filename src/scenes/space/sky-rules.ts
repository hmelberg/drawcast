// The sky map's pure rules: the projection, the alt/az transform, the star
// dot's size and tint, the clock, the observer presets and the one foot
// caption's wording. No DOM, no astronomy-engine — the ephemeris lives in
// sky.ts, which is the code-split boundary. A layout body cannot import, so
// the engine re-exposes these as engines.sky.*.

import type {
  Chart, Constellation, ConstellationTable, Frame, NoteParts, Place, SkyDefaults, SkyLang, Star, StarTable, AltAz,
} from "./sky-types";

export const DEG = Math.PI / 180;

/** The drawn dome: the zenith at the centre, the horizon at `r`, on the
 *  1000×750 y-up canvas. The template draws it and the tray's click overlay
 *  reads it, so it is defined once. The numbers leave room for the compass
 *  letters at r + 18 (top 688, bottom 82), the title at y 726 and the two
 *  foot lines at y 52 and y 24 — measured so no two boxes meet. */
export const CHART: Chart = Object.freeze({ cx: 500, cy: 385, r: 285 });

/** The box a `focus` portrait crops to — round 1's frame, same numbers. Read
 *  it as SKY_DEFAULTS.frame: one name for it, so the template and the tray
 *  cannot end up holding two. */
const FRAME: Frame = Object.freeze({ x0: 60, y0: 80, x1: 940, y1: 700 });

/** The middle of a box — a portrait's magnifying glass moves the figure HERE,
 *  and 500, 390 is what this returns for FRAME. Derived, never typed twice. */
export function midOf(f: Frame): [number, number] {
  return [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2];
}

/**
 * The one definition of what a sky chart draws when the author says nothing,
 * and of the numbers a `focus` portrait magnifies by. The template reads them
 * through `engines.sky.defaults`; the tray's click overlay imports them
 * directly. Neither keeps a copy, because a copy is how round 1's one bug
 * report ("clicking a moon did nothing") comes back: change `pad` here and
 * the page and the click field move together, where two copies would move the
 * page alone and leave every click on a focused chart landing on the wrong
 * star with a green suite.
 */
export const SKY_DEFAULTS: SkyDefaults = Object.freeze({
  /** The nine bodies the sky's ephemeris knows, by their round-1 `space` ids.
   *  Everything else in that table — a moon, a dwarf planet — has no
   *  naked-eye place in a chart of the sky, so it is left out rather than
   *  faked. */
  ids: Object.freeze(["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"]) as readonly string[],
  /** What `show` draws when the author names nothing: the Sun, the Moon and
   *  the five planets you can see without a telescope. */
  show: Object.freeze(["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"]) as readonly string[],
  /** Oslo — PLACES[0], and the chart's default observer. */
  lat: 59.91,
  lon: 10.75,
  /** `limit_mag`'s range: 4.5 is the faintest the bundled union holds, and 2
   *  is as bright as a chart can be cut and still be a chart. */
  magMin: 2,
  magMax: 4.5,
  /** A portrait: the box it crops to, the room it leaves round the figure
   *  inside that box, and the zoom clamp. */
  frame: FRAME,
  pad: 110,
  zoomMin: 1,
  zoomMax: 6,
});

/** `limit_mag` as the chart actually uses it — the author's number clamped to
 *  the range the bundled union can honour, or the default when there is no
 *  usable number. ONE function, because the page and the tray's click overlay
 *  both need the answer: a tray override or a hand-edited spec that skipped
 *  the clamp would build a click field out of stars the page never drew. */
export function limitMag(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : SKY_DEFAULTS.magMax;
  return Math.max(SKY_DEFAULTS.magMin, Math.min(SKY_DEFAULTS.magMax, n));
}

/** J2000 → equatorial of date. `rot` is astronomy-engine's Rotation_EQJ_EQD
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
 *  time `lstDeg`. Azimuth is degrees clockwise from north, astronomy-engine's
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

/** Is this calendar day the day it says it is? `Date.UTC` ROLLS what will not
 *  fit rather than refusing it — month 13 becomes next January, 2026-02-30
 *  becomes March 2 — so the only way to know a matched date is real is to
 *  build it and read the fields back out. (A two-digit year is rolled too:
 *  Date.UTC(26, …) means 1926, which this catches as a disagreement.) */
function realDay(y: number, mo: number, da: number): boolean {
  const b = new Date(Date.UTC(y, mo - 1, da));
  return b.getUTCFullYear() === y && b.getUTCMonth() + 1 === mo && b.getUTCDate() === da;
}

/** …and is this a clock? The same rolling applies to the time of day, but one
 *  rolled clock is legitimate: T24:00:00 is midnight ENDING the day, the one
 *  ISO form that means the roll, so it keeps its meaning rather than being
 *  thrown out with T25:00. */
function realClock(hh: number, mi: number, sec: number): boolean {
  return hh < 24 ? mi < 60 && sec < 60 : hh === 24 && mi === 0 && sec === 0;
}

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
  // The seconds may carry a fraction, because `new Date().toISOString()` — the
  // canonical way anything in this codebase writes an instant — ALWAYS emits
  // ".mmm". Without that group the pattern rejected the commonest ISO string
  // there is and fell through to `now`, which is the worst failure this
  // function has: a figure that names a date and quietly draws today. Nothing
  // says so out loud, so a sweep over a year of timestamps silently became two
  // hundred copies of one real moment.
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let ms: number;
  if (full) {
    const y = +full[1], mo = +full[2], da = +full[3], hh = +full[4], mi = +full[5];
    const sec = full[6] === undefined ? 0 : Number(full[6]);
    // A regex match is not a date, and BOTH constructors here roll silently
    // rather than refusing: "2026-13-45" resolves to 2027-02-14 and "T25:00"
    // to the next day at 01:00. A figure that names one date and draws another
    // is the "now" fallback's own defect one step later, so a matched-but-
    // impossible instant goes to that fallback instead of to a wrong sky.
    ms = realDay(y, mo, da) && realClock(hh, mi, sec)
      ? (full[7]
        ? Date.parse(s.replace(" ", "T"))
        : Date.UTC(y, mo - 1, da, hh, mi, Math.floor(sec), Math.round((sec % 1) * 1000)))
      : NaN;
  } else if (dateOnly) {
    const y = +dateOnly[1], mo = +dateOnly[2], da = +dateOnly[3];
    ms = realDay(y, mo, da) ? Date.UTC(y, mo - 1, da) + Math.round((22 - lon / 15) * HOUR_MS) : NaN;
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

/** One clause of the caption, in the parts the fit needs in order to shorten
 *  it instead of losing it. */
interface Clause {
  /** The whole sentence for a prose clause; the "Below the horizon: " opener
   *  for a clause that lists what the author asked about. */
  head: string;
  /** The names — empty for a prose clause. */
  items: readonly string[];
  /** A prose clause's short form: the same fact without the lesson. */
  short?: string;
  /** `symbols` alone. It is the one clause that names nothing anybody typed,
   *  so it is the one clause the fit may remove outright. */
  droppable?: boolean;
}

function clauseParts(p: NoteParts, lang: SkyLang): Clause[] {
  const nb = lang === "nb";
  const out: Clause[] = [];
  if (p.daylight) {
    out.push({
      head: nb ? "Sola er oppe — stjernene er der, men du kan ikke se dem" : "The Sun is up — these stars are there, but you cannot see them",
      items: [],
      short: nb ? "Sola er oppe" : "The Sun is up",
    });
  }
  if (p.below.length > 0) out.push({ head: nb ? "Under horisonten: " : "Below the horizon: ", items: p.below });
  // Up, but not on this page — a portrait shows one figure and crops the rest
  // of the sky away. `maps.yaml` says the same thing with the same words when
  // a marker falls outside a cropped map.
  if (p.outside.length > 0) out.push({ head: nb ? "Utenfor utsnittet: " : "Outside view: ", items: p.outside });
  if (p.unknown.length > 0) out.push({ head: nb ? "Ukjent: " : "Unknown: ", items: p.unknown });
  if (p.symbols) {
    out.push({
      head: nb ? "Sol, måne og planeter som symboler, ikke i målestokk" : "Sun, Moon and planets as symbols, not to scale",
      items: [],
      droppable: true,
    });
  }
  return out;
}

/**
 * The figure's ONE caption, as whole clauses in the order they matter — what
 * the line says when there is room for all of it. `fitNote` is what the
 * template actually writes; this is the wording and the priority, and the
 * order is the priority: the cheapest clause is last.
 */
export function noteClauses(p: NoteParts, lang: SkyLang): string[] {
  return clauseParts(p, lang).map((c) => c.head + c.items.join(", "));
}

/** A clause written with `keep` of its names, the rest counted: "Below the
 *  horizon: Mercury, Venus +5". `keep` 0 counts them all — "Unknown: +12" —
 *  which is the last thing tried, and never for a clause naming ONE thing,
 *  where "+1" would cost the same and say less. */
function clauseText(c: Clause, keep: number, brief: boolean): string {
  if (c.items.length === 0) return brief && c.short !== undefined ? c.short : c.head;
  const kept = c.items.slice(0, Math.max(0, keep));
  const rest = c.items.length - kept.length;
  if (kept.length === 0) return c.head + "+" + rest;
  return c.head + kept.join(", ") + (rest > 0 ? " +" + rest : "");
}

/** Cut a line that will not fit even at its shortest, rather than say nothing
 *  at all. Only an author who typed a three-hundred-character name can reach
 *  this, and a trimmed name back is better than silence. */
function clip(s: string, maxWidth: number, measure: (t: string) => number): string {
  if (measure(s) <= maxWidth) return s;
  let out = s;
  while (out.length > 1 && measure(out + "…") > maxWidth) out = out.slice(0, -1);
  return out + "…";
}

/**
 * The caption as it is actually written: the clauses joined with " · ",
 * given up DETAIL first and never a fact, until the line fits `maxWidth`
 * under `measure` (the template hands over kit.textWidth at the caption's own
 * size).
 *
 * The width policy is here, and not in the template, because writing LESS is
 * lint-clean and no sweep can see it. The first version popped whole clauses
 * off the end while the line was too wide, which is safe only if the tail
 * clauses are cheap — and they are not: positions 2, 3 and 4 are the three
 * that keep the pack's contract that a thing the author NAMED is said rather
 * than silently missing (space.yaml's own `show` description promises it, and
 * `focus`'s "what it removes, it says"). `{time: "2026-06-21T10:00:00Z",
 * show: ["all"]}` came out as the daylight sentence ALONE, every named body
 * below the horizon dropped, and twelve unknown names at night produced no
 * caption at all — twelve typos, no complaint. Worse, it depended on the
 * width, so the promise held at one hour and not the next.
 *
 * So the concessions run cheapest-first, and none of them is a whole naming
 * clause:
 *   1. drop `symbols` — the only clause that names nothing anybody typed;
 *   2. shorten the daylight sentence to its bare fact ("The Sun is up") —
 *      what is left is the lesson, and the author's names outrank it;
 *   3. count the tails of the naming lists, cheapest clause first, down to
 *      one name apiece — "Below the horizon: Mercury, Venus +5";
 *   4. count a list whole ("Unknown: +12"), cheapest first, when even that is
 *      too wide;
 *   5. and, only for an absurd name, cut the line with an ellipsis.
 * A naming clause is never removed, so its HEAD survives every rung: the
 * caption always says that something the author named has set, or was cropped
 * away, or matched nothing, and how many.
 */
export function fitNote(p: NoteParts, lang: SkyLang, maxWidth: number, measure: (s: string) => number): string {
  const all = clauseParts(p, lang);
  if (all.length === 0) return "";
  const keep = all.map((c) => c.items.length);
  let symbols = true, brief = false;
  const text = (): string => {
    const parts: string[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].droppable === true && !symbols) continue;
      parts.push(clauseText(all[i], keep[i], brief));
    }
    return parts.join(" · ");
  };
  const fits = (): boolean => measure(text()) <= maxWidth;

  if (fits()) return text();
  symbols = false;
  if (fits()) return text();
  brief = true;
  if (fits()) return text();
  // Cheapest clause first, and only ever one name at a time, so a caption
  // gives up as little as the line demands.
  const lists: number[] = [];
  for (let i = 0; i < all.length; i++) if (all[i].items.length > 0) lists.push(i);
  for (let n = lists.length - 1; n >= 0; n--) {
    const i = lists[n];
    while (keep[i] > 1) {
      keep[i]--;
      if (fits()) return text();
    }
  }
  for (let n = lists.length - 1; n >= 0; n--) {
    const i = lists[n];
    if (all[i].items.length < 2) continue;
    keep[i] = 0;
    if (fits()) return text();
  }
  return clip(text(), maxWidth, measure);
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
