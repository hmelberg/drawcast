// The space pack's pure rules: which bodies a selection names, how big and
// how far apart they are drawn under each scale mode, the Sun as a segment
// inside the frame, the scale note and bar, label tiers. No DOM, no clock,
// no astronomy — those live in ephemeris.ts. A layout body cannot import, so
// the engine (engine.ts) re-exposes these as engines.space.*.

import type { Pt } from "../../layout/model";
import type { BodiesTable, Body, Frame, ScaleMode } from "./types";

export const AU_KM = 149597870.7;

export const PLANET_IDS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
export const DWARF_IDS = ["pluto", "ceres", "eris", "haumea", "makemake"] as const;
const GROUPS: Record<string, readonly string[]> = {
  planets: PLANET_IDS,
  inner: PLANET_IDS.slice(0, 4),
  outer: PLANET_IDS.slice(4),
  all: [...PLANET_IDS, ...DWARF_IDS],
};

/** The frame every view draws inside; the strip below y0 holds the notes and the bar. */
export const FRAME: Frame = { x0: 60, y0: 80, x1: 940, y1: 700 };
/** The smallest disc worth drawing: below this a body is a stroke-width blob. */
export const MIN_BODY_PX = 2.5;

export function indexBodies(table: BodiesTable): Record<string, Body> {
  const out: Record<string, Body> = {};
  for (const b of table.bodies) out[b.id] = b;
  return out;
}

/**
 * Group words expand in place; ids and names (en/nb) match case-insensitively;
 * duplicates collapse; unknown names are reported, never thrown (anatomy's rule).
 */
export function expandBodies(all: Record<string, Body>, sel: readonly string[]): { ids: string[]; missing: string[] } {
  const byName = new Map<string, string>();
  for (const b of Object.values(all)) {
    byName.set(b.id, b.id);
    byName.set(b.name.en.toLowerCase(), b.id);
    byName.set(b.name.nb.toLowerCase(), b.id);
  }
  const ids: string[] = [];
  const missing: string[] = [];
  const take = (id: string): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const raw of sel) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase();
    if (key === "") continue;
    const group = GROUPS[key];
    if (group) {
      for (const id of group) if (all[id]) take(id);
      continue;
    }
    const id = byName.get(key);
    if (id) take(id);
    else missing.push(raw.trim());
  }
  return { ids, missing };
}

/** Direct children, innermost first. */
export function moonsOf(all: Record<string, Body>, parentId: string): Body[] {
  return Object.values(all).filter((b) => b.parent === parentId).sort((a, b) => a.a_km - b.a_km);
}

/**
 * What orbits the focus body: every child by default, or the `moons`
 * selection — moon ids, or the parent's own id meaning all of them —
 * restricted to the focus body's children. No focus, no satellites.
 */
export function satellitesFor(all: Record<string, Body>, focus: string | null, moons: readonly string[] | undefined): { ids: string[]; missing: string[] } {
  if (!focus || !all[focus]) return { ids: [], missing: [] };
  const own = moonsOf(all, focus).map((b) => b.id);
  if (!moons || moons.length === 0) return { ids: own, missing: [] };
  const ids: string[] = [];
  const named = expandBodies(all, moons);
  const missing = [...named.missing];
  for (const id of named.ids) {
    if (id === focus) {
      for (const m of own) if (!ids.includes(m)) ids.push(m);
    } else if (own.includes(id)) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      missing.push(`${id} (not a moon of ${focus})`);
    }
  }
  ids.sort((a, b) => all[a].a_km - all[b].a_km);
  return { ids, missing };
}

/** Log mapping of a distance onto [rMin, rMax]; degenerate ranges land at rMax. */
export function logRadius(a: number, aMin: number, aMax: number, rMin: number, rMax: number): number {
  if (aMax <= aMin || a <= 0 || aMin <= 0) return rMax;
  const t = (Math.log(a) - Math.log(aMin)) / (Math.log(aMax) - Math.log(aMin));
  return rMin + Math.max(0, Math.min(1, t)) * (rMax - rMin);
}

/**
 * Orbit radii in canvas units for bodies SORTED by a_km ascending: even
 * spacing (schematic, sizes), proportional with the outermost at rMax
 * (distances), or log (log). One body sits midway (or at rMax for distances).
 */
export function orbitRadii(bodies: readonly Body[], mode: ScaleMode, rMin: number, rMax: number): number[] {
  const n = bodies.length;
  if (n === 0) return [];
  if (mode === "distances") {
    const aMax = Math.max(...bodies.map((b) => b.a_km)) || 1;
    return bodies.map((b) => (rMax * b.a_km) / aMax);
  }
  if (n === 1) return [(rMin + rMax) / 2];
  if (mode === "log") {
    const as = bodies.map((b) => b.a_km);
    const aMin = Math.min(...as), aMax = Math.max(...as);
    return bodies.map((b) => logRadius(b.a_km, aMin, aMax, rMin, rMax));
  }
  return bodies.map((_, i) => rMin + (i * (rMax - rMin)) / (n - 1));
}

/**
 * Drawn radii: the largest body gets `largestPx`; the rest follow true ratios
 * (sizes) or square-root ratios (schematic, log), floored at MIN_BODY_PX. The
 * centre follows the same rule UNCLAMPED (the layout clamps or clips it).
 * distances: every body a 5 px dot, the centre 8 px — or, given px per km,
 * true-relative between 3 and 105 px.
 */
export function drawnRadii(centre: Body, bodies: readonly Body[], mode: ScaleMode, largestPx: number, pxPerKm?: number): { centre: number; bodies: number[] } {
  if (mode === "distances") {
    const c = pxPerKm !== undefined ? Math.max(3, Math.min(105, pxPerKm * centre.r_km)) : 8;
    return { centre: c, bodies: bodies.map(() => 5) };
  }
  const f = mode === "sizes" ? (km: number) => km : Math.sqrt;
  const maxF = bodies.length > 0 ? Math.max(...bodies.map((b) => f(b.r_km))) : 0;
  if (maxF === 0) return { centre: largestPx, bodies: [] };
  const k = largestPx / maxF;
  return { centre: k * f(centre.r_km), bodies: bodies.map((b) => Math.max(MIN_BODY_PX, k * f(b.r_km))) };
}

/** n points on a circle, starting at the LEFTMOST point (angle −π) and going counter-clockwise. */
export function circle(c: Pt, r: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = -Math.PI + (2 * Math.PI * i) / n;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

/** Sutherland–Hodgman clip of a closed ring to a rectangle (the anatomy layout's clipToBox). */
export function clipRingToBox(ring: Pt[], f: Frame): Pt[] {
  const clipEdge = (pts: Pt[], inside: (p: Pt) => boolean, intersect: (a: Pt, b: Pt) => Pt): Pt[] => {
    const res: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i - 1 + pts.length) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) {
        if (!pi) res.push(intersect(prev, cur));
        res.push(cur);
      } else if (pi) {
        res.push(intersect(prev, cur));
      }
    }
    return res;
  };
  const lerpX = (a: Pt, b: Pt, x: number): Pt => [x, a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))];
  const lerpY = (a: Pt, b: Pt, y: number): Pt => [a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1])), y];
  let out = ring;
  out = clipEdge(out, (p) => p[0] >= f.x0, (a, b) => lerpX(a, b, f.x0));
  out = clipEdge(out, (p) => p[0] <= f.x1, (a, b) => lerpX(a, b, f.x1));
  out = clipEdge(out, (p) => p[1] >= f.y0, (a, b) => lerpY(a, b, f.y0));
  out = clipEdge(out, (p) => p[1] <= f.y1, (a, b) => lerpY(a, b, f.y1));
  return out;
}

/**
 * The Sun that does not fit: its disc clipped to the frame (`fill`, an area)
 * and the part of its rim that lies inside (`arc`, an open stroke). Because
 * `circle` starts at the leftmost point, a centre off to the LEFT of the
 * frame gives a contiguous arc; a disc wholly inside comes back untouched.
 */
export function sunSegment(c: Pt, r: number, f: Frame): { fill: Pt[]; arc: Pt[]; clipped: boolean } {
  const ring = circle(c, r, 240);
  const inside = (p: Pt): boolean => p[0] >= f.x0 && p[0] <= f.x1 && p[1] >= f.y0 && p[1] <= f.y1;
  const arc = ring.filter(inside);
  const clipped = arc.length < ring.length;
  return { fill: clipped ? clipRingToBox(ring, f) : ring, arc, clipped };
}

const NOTES: Record<ScaleMode, { en: string; nb: string }> = {
  schematic: { en: "Not to scale", nb: "Ikke i målestokk" },
  sizes: { en: "Sizes to scale, distances not", nb: "Størrelser i målestokk, avstander ikke" },
  distances: { en: "Distances to scale, sizes not", nb: "Avstander i målestokk, størrelser ikke" },
  log: { en: "Log distances", nb: "Logaritmiske avstander" },
};
const REDUCED: Record<"en" | "nb", (name: string) => string> = {
  en: (name) => `Sizes to scale, ${name} reduced, distances not`,
  nb: (name) => `Størrelser i målestokk, ${name} forminsket, avstander ikke`,
};

/**
 * Which truth the figure keeps — every figure says so. `reduced` is the
 * DISPLAY NAME of the centre body the layout had to clamp, empty when nothing
 * was: the clamped body is the Sun in a solar-system view but the focus body
 * in a portrait of its moons, and this note's whole contract is being honest
 * about what THIS figure distorts.
 */
export function scaleNote(mode: ScaleMode, lang: "en" | "nb", reduced = ""): string {
  if (mode === "sizes" && reduced !== "") return REDUCED[lang](reduced);
  return NOTES[mode][lang];
}

/** U+202F, narrow no-break space: the thousands separator in every number the pack writes. */
export const THIN = "\u202f";
export const fmtInt = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

/**
 * A bar between 50 and 300 px in a round unit: km of RADIUS for sizes
 * (pxPerKm = px per km of radius), AU of DISTANCE for distances. The
 * schematic view has no scale; log's ruler is the layout's own.
 */
export function scaleBar(mode: ScaleMode, pxPerKm: number, lang: "en" | "nb"): { lengthPx: number; label: string } | null {
  if (!(pxPerKm > 0)) return null;
  const pick = (units: number[], pxPer: number): number | null => {
    for (const u of units) {
      const px = u * pxPer;
      if (px >= 50 && px <= 300) return u;
    }
    return null;
  };
  if (mode === "sizes") {
    const u = pick([10000, 100000, 1000000, 10000000], pxPerKm);
    return u === null ? null : { lengthPx: u * pxPerKm, label: `${fmtInt(u)}${THIN}km` };
  }
  if (mode === "distances") {
    const pxPerAu = pxPerKm * AU_KM;
    const u = pick([0.1, 1, 10, 100], pxPerAu);
    return u === null ? null : { lengthPx: u * pxPerAu, label: `${u < 1 ? (lang === "nb" ? "0,1" : "0.1") : u} AU` };
  }
  return null;
}

/**
 * Tiers for names under a row of bodies (xs ascending): a name takes the
 * lowest tier whose last name ends more than `gap` before this one starts.
 */
export function labelTiers(xs: readonly number[], widths: readonly number[], gap: number): number[] {
  const ends: number[] = [];
  return xs.map((x, i) => {
    const start = x - widths[i] / 2, end = x + widths[i] / 2;
    let t = 0;
    while (t < ends.length && ends[t] + gap > start) t++;
    ends[t] = end;
    return t;
  });
}
