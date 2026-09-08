// The sky map's data shapes and the engine a layout sees as `engines.sky`.
// Nothing here imports astronomy-engine: the tray reaches this file and the
// engine chunk must stay behind sky.ts's dynamic import (the same rule
// types.ts follows for round 1).

/** Chart label language. `la` is the international Latin name, `en` the
 *  descriptive English one — three different words, which is what lets a
 *  question ask for one of them by name. */
export type SkyLang = "en" | "nb" | "la";

export interface Star {
  /** Hipparcos number: the catalogue key, and `hip_<n>` when there is no name. */
  hip: number;
  /** J2000 right ascension, degrees 0–360. */
  ra: number;
  /** J2000 declination, degrees −90–90. */
  dec: number;
  /** Apparent visual magnitude; smaller is brighter. */
  mag: number;
  /** B−V colour index; null where the catalogue has none. */
  bv: number | null;
  /** Proper name, for stars to magnitude 3.0; null for the anonymous field. */
  name: string | null;
  /** Norwegian proper name where it differs from `name`; null otherwise. */
  name_nb: string | null;
}

export interface Constellation {
  /** IAU abbreviation as d3-celestial spells it: "Ori", "UMa". */
  abbr: string;
  name: { la: string; en: string; nb: string };
  /** The figure as unordered HIP pairs, each pair ascending. The answer key. */
  edges: [number, number][];
}

/** Where something is for an observer: degrees. Azimuth is clockwise from north. */
export interface AltAz {
  alt: number;
  az: number;
}

/** An observer preset the ⊕ section offers. */
export interface Place {
  id: string;
  name: { en: string; nb: string };
  lat: number;
  lon: number;
}

/** The drawn dome on the logical canvas, y-up. */
export interface Chart {
  cx: number;
  cy: number;
  r: number;
}

/** The box a `focus` portrait crops to, in canvas units. Round 1's `Frame`
 *  has the same shape and the same numbers; this is the sky's own so that
 *  sky-types.ts stays the light half's one dependency. */
export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The shape of sky-rules.ts's SKY_DEFAULTS — the chart's own defaults and a
 *  `focus` portrait's magnifying glass, defined once and read by both the
 *  template (through `engines.sky.defaults`) and the tray. */
export interface SkyDefaults {
  /** The nine bodies the sky's ephemeris knows, by their round-1 `space` ids. */
  readonly ids: readonly string[];
  /** What `show` draws when the author names nothing. */
  readonly show: readonly string[];
  readonly lat: number;
  readonly lon: number;
  readonly magMin: number;
  readonly magMax: number;
  readonly frame: Frame;
  /** Room left round a focused figure inside `frame`, and the zoom clamp. */
  readonly pad: number;
  readonly zoomMin: number;
  readonly zoomMax: number;
}

/** The Moon's phase, and where its bright limb points ON THE SKY: a point 5°
 *  from the Moon along the great circle toward the Sun, which the template
 *  projects to get the direction on the page. null at new or full, where the
 *  crescent has no orientation worth drawing. */
export interface MoonLimb {
  fraction: number;
  waxing: boolean;
  toward: AltAz | null;
}

export interface NoteParts {
  daylight: boolean;
  below: string[];
  /** Named, above the horizon, and cropped off the page by a `focus` portrait
   *  — a different fact from `below`, and the reason the two are separate
   *  clauses rather than one list of things that are not on the page. */
  outside: string[];
  unknown: string[];
  symbols: boolean;
}

/** The committed table shapes (compact on purpose — 1 040 records). */
export interface StarTable {
  source: string;
  limit_mag: number;
  stars: { i: number; c: [number, number]; m: number; b: number | null; n?: string; nb?: string }[];
}
export interface ConstellationTable {
  source: string;
  constellations: { a: string; la: string; en: string; nb: string; e: [number, number][] }[];
}

/** What a template's `layout` gets as `engines.sky`, and what the ⊕ section reads. */
export interface SkyEngine {
  /** The drawn dome — ONE definition, shared by the template and the tray's click overlay. */
  chart: Chart;
  /** The chart's defaults and a portrait's magnifying glass (sky-rules.ts's
   *  SKY_DEFAULTS) — the same object the tray imports, so the page and the
   *  click field cannot be built from two different sets of numbers. */
  defaults: SkyDefaults;
  stars(): Star[];
  star(hip: number): Star | undefined;
  /** By proper name (en or nb), "hip_1234", or a bare HIP number. Case-insensitive. */
  findStar(query: string): Star | undefined;
  constellations(): Constellation[];
  /** By abbreviation, "con_ori", or the Latin, English or Norwegian name. Case-insensitive. */
  findConstellation(query: string): Constellation | undefined;
  /** The distinct stars a figure's edges touch, ascending. */
  edgeStars(c: Constellation): number[];
  /** "now" / an ISO instant / an ISO datetime / a bare date, shifted by hours and days. The pack's only clock for the sky. */
  resolveTime(time: unknown, hours: unknown, days: unknown, lon?: number): Date;
  /** Local solar time at `lon` — what `place_label` writes. */
  localClock(at: Date, lon: number): { date: string; time: string };
  /** Alt/az for every catalogue star, keyed by HIP. Precessed to date. */
  starPositions(at: Date, lat: number, lon: number): Map<number, AltAz>;
  /** Alt/az for the named bodies (round-1 `space` ids), of date, with aberration. */
  bodyPositions(ids: readonly string[], at: Date, lat: number, lon: number): Record<string, AltAz>;
  moonLimb(at: Date, lat: number, lon: number): MoonLimb;
  // ---- the pure rules (sky-rules.ts), reachable from a layout body ----
  project(p: AltAz, chart?: Chart): [number, number];
  starRadius(mag: number): number;
  starColor(bv: number | null): string;
  name(c: Constellation, lang: SkyLang): string;
  starName(s: Star, lang: SkyLang): string | null;
  starId(s: Star): string;
  conId(c: Constellation): string;
  /** `limit_mag` clamped to the range the bundled union can honour. */
  limitMag(v: unknown): number;
  /** The caption the figure writes: the clauses that matter, shortened until
   *  the line fits `maxWidth` under `measure` — never a naming clause
   *  dropped. See fitNote in sky-rules.ts for the order of concessions. */
  fitNote(p: NoteParts, lang: SkyLang, maxWidth: number, measure: (s: string) => number): string;
  places(): readonly Place[];
  placeName(p: Place, lang: SkyLang): string;
}
