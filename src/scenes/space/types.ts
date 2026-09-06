// The space pack's data shapes and the engine a layout sees as `engines.space`.
// Ids are the English names in lower case and ARE the element ids (the same
// rule as anatomy). Nothing here imports astronomy-engine: this file is
// reachable from the main chunk (tray, model) and must stay light.

import type { Pt } from "../../layout/model";

export type BodyKind = "star" | "planet" | "dwarf" | "moon";

export interface Body {
  id: string;
  kind: BodyKind;
  /** Display names; these never go through the prose translator. */
  name: { en: string; nb: string };
  /** What it orbits: null for the Sun, "sun" for planets and dwarfs, a planet id for moons. */
  parent: string | null;
  /** Mean radius, km. */
  r_km: number;
  mass_kg: number;
  /** Semi-major axis around `parent`, km (0 for the Sun). */
  a_km: number;
  /** Sidereal orbital period, days; negative = retrograde orbit (Triton). 0 for the Sun. */
  period_d: number;
  /** Orbital eccentricity — carried for the card, not drawn in round 1. */
  e: number;
  /** Sidereal rotation, hours; negative = retrograde spin. */
  rot_h: number;
  /** Axial tilt, degrees; absent where unknown. */
  tilt_deg?: number;
  /** 6-digit hex; shades best. */
  color: string;
  /** Ring radii in body radii. Saturn only. */
  ring?: { inner: number; outer: number; color: string };
  /** Wikipedia article titles for the ⊕ card. */
  wiki: { en: string; nb: string };
  /** Round 3: `public/space/tex/<texture>`. */
  texture?: string;
  /** Approximate mean longitude at J2000, degrees, for bodies drawn on the circular sketch. */
  l0_deg?: number;
}

export interface BodiesTable {
  source: string;
  bodies: Body[];
}

export type ScaleMode = "schematic" | "sizes" | "distances" | "log";

/** A logical-canvas rectangle, y-up. */
export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Heliocentric ecliptic position, AU (z kept for round 3). */
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface MoonPhaseInfo {
  /** Illuminated fraction 0–1. */
  fraction: number;
  waxing: boolean;
  /** Ecliptic phase angle 0–360: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  angle: number;
  name: string;
  name_nb: string;
}

/** What a template's `layout` gets as `engines.space`, and what the ⊕ section reads. */
export interface SpaceEngine {
  /** Every body by id. */
  all(): Record<string, Body>;
  body(id: string): Body | undefined;
  /** Ids, names (en/nb) and the group words planets | inner | outer | all, case-insensitive; unknown names in `missing`. */
  bodies(sel: readonly string[]): { bodies: Body[]; missing: string[] };
  /** Direct children of a body, innermost first. */
  moonsOf(parentId: string): Body[];
  /** What orbits the focus body in the figure: its children, or the `moons` selection restricted to them. No focus, nothing. */
  satellites(focus: string | null, moons: readonly string[] | undefined): { bodies: Body[]; missing: string[] };
  /** "today" / an ISO date → a Date at UTC midnight, shifted by `days`. The only clock in the pack. */
  resolveDate(date: unknown, days: unknown): Date;
  /** Heliocentric ecliptic positions in AU for sun-orbiting bodies; a moon reports its parent's. */
  positions(ids: readonly string[], date: Date): Record<string, Vec>;
  /** Parent-centred ecliptic positions in km for the named moons of `parentId`. */
  moonPositions(parentId: string, ids: readonly string[], date: Date): Record<string, { x: number; y: number }>;
  phase(date: Date): MoonPhaseInfo;
  /** True when the body's position is the circular sketch, not an ephemeris. */
  schematic(id: string): boolean;
  au(km: number): number;
  km(au: number): number;
  // ---- the scale rules (rules.ts), reachable from a layout body ----
  orbitRadii(bodies: readonly Body[], mode: ScaleMode, rMin: number, rMax: number): number[];
  logRadius(a_km: number, aMin: number, aMax: number, rMin: number, rMax: number): number;
  drawnRadii(centre: Body, bodies: readonly Body[], mode: ScaleMode, largestPx: number, pxPerKm?: number): { centre: number; bodies: number[] };
  sunSegment(c: Pt, r: number, frame: Frame): { fill: Pt[]; arc: Pt[]; clipped: boolean };
  scaleNote(mode: ScaleMode, lang: "en" | "nb", reduced?: string): string;
  scaleBar(mode: ScaleMode, pxPerKm: number, lang: "en" | "nb"): { lengthPx: number; label: string } | null;
  labelTiers(xs: readonly number[], widths: readonly number[], gap: number): number[];
}
