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
  noteClauses(p: NoteParts, lang: SkyLang): string[];
  places(): readonly Place[];
  placeName(p: Place, lang: SkyLang): string;
}
