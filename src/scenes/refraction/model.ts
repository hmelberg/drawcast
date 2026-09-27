// refraction's physics and the geometry every part is placed by — pure, so
// the layout, the widget body, the lint and the tests read ONE model.
//
// Snell's law n₁ sin θ₁ = n₂ sin θ₂; past the critical angle (n₁ > n₂,
// sin θ₁ > n₂/n₁) there is no refracted ray and all the light reflects.
// How much reflects is Fresnel's (unpolarised: the mean of the s and p
// reflectances), which the figure shows as the reflected ray's strength.
//
// The layout works in a CANONICAL frame — the light arrives from the upper
// left, medium 1 above the boundary — and mirrors it: `from: "right"` flips
// x, `light_from: "below"` flips y, both about the point where the ray meets
// the boundary.
import type { Pt } from "../../layout/model";

export interface RefractionParams {
  medium1?: string;
  n1?: number;
  medium2?: string;
  n2?: number;
  theta1_deg?: number;
  from?: "left" | "right";
  light_from?: "above" | "below";
  show_angles?: boolean;
  show_reflection?: boolean;
  show_critical?: boolean;
  show_law?: boolean;
  wavefronts?: boolean;
  apparent?: boolean;
  image_label?: string;
  eye?: boolean;
  slab?: boolean;
  source_label?: string;
  title?: string;
}

/** Refractive indices of the media a name may stand for (yellow light). */
export const MEDIA: Readonly<Record<string, number>> = Object.freeze({
  vacuum: 1,
  air: 1.0,
  ice: 1.31,
  water: 1.33,
  oil: 1.47,
  acrylic: 1.49,
  glass: 1.5,
  "crown glass": 1.52,
  "flint glass": 1.62,
  diamond: 2.42,
  // The names a Norwegian cast writes.
  vakuum: 1,
  luft: 1.0,
  is: 1.31,
  vann: 1.33,
  olje: 1.47,
  diamant: 2.42,
});

/** The everyday name the viewer's index lands on (1.33 → water), or null. */
export function mediumFor(n: number): string | null {
  for (const name of ["air", "ice", "water", "glass", "diamond"]) if (Math.abs(MEDIA[name] - n) < 0.005) return name;
  return null;
}

export const N_MIN = 1;
export const N_MAX = 3;
export const THETA_MAX = 89.5;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const deg = (r: number): number => (r * 180) / Math.PI;
const rad = (d: number): number => (d * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** θ₂ in degrees for θ₁ in degrees, or null past the critical angle. */
export function snell(n1: number, n2: number, theta1: number): number | null {
  const s = (n1 / n2) * Math.sin(rad(theta1));
  return s > 1 + 1e-12 ? null : deg(Math.asin(Math.min(1, s)));
}

/** The critical angle in degrees (n₁ > n₂), else null. */
export function criticalAngle(n1: number, n2: number): number | null {
  return n1 > n2 ? deg(Math.asin(n2 / n1)) : null;
}

/** Unpolarised Fresnel reflectance (0–1) at θ₁; 1 past the critical angle. */
export function reflectance(n1: number, n2: number, theta1: number): number {
  const t2 = snell(n1, n2, theta1);
  if (t2 === null) return 1;
  const ci = Math.cos(rad(theta1));
  const ct = Math.cos(rad(t2));
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
  const r = (rs * rs + rp * rp) / 2;
  return Number.isFinite(r) ? clamp(r, 0, 1) : 1;
}

/** The θ₁ that refracts to θ₂ (the inverse law), or null when none does. */
export function incidenceFor(n1: number, n2: number, theta2: number): number | null {
  const s = (n2 / n1) * Math.sin(rad(theta2));
  return s > 1 + 1e-12 ? null : deg(Math.asin(Math.min(1, s)));
}

/** Where the geometry sits (logical y-up). */
export const GEOM = Object.freeze({
  /** The hit point's x without / with a slab (the slab moves it toward the source). */
  ox: 500,
  slabShift: 70,
  /** The boundary's y (canonical: medium 1 above) without / with a slab. */
  oy: 400,
  oySlab: 450,
  /** Ray lengths. */
  ray: 220,
  raySlab: 180,
  /** The slab's thickness. */
  slab: 140,
  /** The figure's band, and the boundary's run. */
  top: 640,
  bottom: 160,
  left: 70,
  right: 930,
});

export interface Model {
  n1: number;
  n2: number;
  name1: string | null;
  name2: string | null;
  theta1: number;
  /** null: total internal reflection. */
  theta2: number | null;
  critical: number | null;
  reflect: number;
  tir: boolean;
  /** +1: source on the left; −1: on the right. */
  sx: 1 | -1;
  /** +1: medium 1 above; −1: below. */
  sy: 1 | -1;
  slab: boolean;
  /** The hit point, world. */
  O: Pt;
  /** Ray length. */
  R: number;
  /** Canonical → world. */
  world(c: Pt): Pt;
  /** World → canonical. */
  canon(p: Pt): Pt;
}

/** The name a medium is written with: the author's, else the one its index is known by. */
function nameOf(given: unknown, n: number, fallback: string): string | null {
  if (typeof given === "string") return given.trim() === "" ? null : given.trim();
  return mediumFor(n) ?? (n === MEDIA[fallback] ? fallback : null);
}

/** The index a medium has: the author's number, else its name's, else the default. */
function indexOf(given: unknown, name: unknown, fallback: number): number {
  if (num(given)) return clamp(given, 0.2, 5);
  if (typeof name === "string") {
    const n = MEDIA[name.trim().toLowerCase()];
    if (n !== undefined) return n;
  }
  return fallback;
}

export function readModel(P: RefractionParams): Model {
  const n1 = indexOf(P.n1, P.medium1, 1);
  const n2 = indexOf(P.n2, P.medium2, 1.33);
  const theta1 = clamp(num(P.theta1_deg) ? P.theta1_deg : 40, 0, THETA_MAX);
  const theta2 = snell(n1, n2, theta1);
  const sx: 1 | -1 = P.from === "right" ? -1 : 1;
  const sy: 1 | -1 = P.light_from === "below" ? -1 : 1;
  const slab = P.slab === true;
  const ox = GEOM.ox - (slab ? GEOM.slabShift * sx : 0);
  // Mirrored about the figure's middle (y 400), so a light from below keeps
  // the same band.
  const oyC = slab ? GEOM.oySlab : GEOM.oy;
  const O: Pt = [ox, 400 + sy * (oyC - 400)];
  return {
    n1,
    n2,
    name1: nameOf(P.medium1, n1, "air"),
    name2: nameOf(P.medium2, n2, "water"),
    theta1,
    theta2,
    critical: criticalAngle(n1, n2),
    reflect: reflectance(n1, n2, theta1),
    tir: theta2 === null,
    sx,
    sy,
    slab,
    O,
    R: slab ? GEOM.raySlab : GEOM.ray,
    world: ([cx, cy]: Pt): Pt => [O[0] + sx * cx, O[1] + sy * cy],
    canon: ([x, y]: Pt): Pt => [(x - O[0]) * sx, (y - O[1]) * sy],
  };
}

/** A unit direction in the canonical frame at `a` degrees from the upward normal, toward +x. */
export function dirUp(a: number): Pt {
  return [Math.sin(rad(a)), Math.cos(rad(a))];
}
/** …from the downward normal, toward +x. */
export function dirDown(a: number): Pt {
  return [Math.sin(rad(a)), -Math.cos(rad(a))];
}

/** The canonical extents: how far medium 1 reaches up, the slab down, the page down. */
export function extents(m: Model): { up: number; down: number; slabDown: number; rightX: number; leftX: number } {
  const oyC = m.slab ? GEOM.oySlab : GEOM.oy;
  return {
    up: GEOM.top - oyC,
    down: oyC - GEOM.bottom,
    slabDown: GEOM.slab,
    rightX: m.sx > 0 ? GEOM.right - m.O[0] : m.O[0] - GEOM.left,
    leftX: m.sx > 0 ? m.O[0] - GEOM.left : GEOM.right - m.O[0],
  };
}

/**
 * The apparent position of the source seen along the refracted ray: that ray
 * traced straight back (as the eye does) to the vertical through the source.
 * Canonical; null past the critical angle. At normal incidence it is the
 * paraxial limit, depth × n₂/n₁.
 */
export function apparentPoint(m: Model): Pt | null {
  if (m.theta2 === null) return null;
  const S = scale(dirUp(m.theta1), m.R);
  const s2 = Math.sin(rad(m.theta2));
  if (s2 < 1e-6) return [0, S[1] * (m.n2 / m.n1)];
  const t = (Math.sin(rad(m.theta1)) * m.R) / s2;
  const back = dirUp(m.theta2);
  // The refracted ray leaves along dirDown(θ₂); straight back from O is up and to −x.
  return [-back[0] * t, back[1] * t];
}

export const scale = (p: Pt, k: number): Pt => [p[0] * k, p[1] * k];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

/** The lateral shift a slab gives, in slab thicknesses: sin(θ₁ − θ₂)/cos θ₂. */
export function slabShift(theta1: number, theta2: number): number {
  return Math.sin(rad(theta1 - theta2)) / Math.cos(rad(theta2));
}
