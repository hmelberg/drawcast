// plot3d's model: the template params read once — which of the three kinds
// is drawn (a surface z = f(x, y), a parametric curve, points), its
// expressions parsed (params-ui/expr.ts: never eval'd), its free parameters
// (params-ui/params.ts: the same shape as equation_plot's), and the camera.
// Pure; the layout draws what this computes, the widget patches what this
// reads, the lint reports its errors.
//
// Two scales. A figure with no parameters is drawn exactly as the pack
// version drew it (tests/plot3d-parity.test.ts): the surface's z is
// stretched from its sampled min/max onto the domain's half-width, and the
// camera frames whatever was sampled. A figure WITH parameters (or a
// z_range) would then re-stretch on every change — a doubled `a` would look
// the same — so it is scaled once over every value the parameters' ranges
// allow (their min, middle and max; the current value too): z = 0 stays on
// the axes' origin, the height is proportional, and the camera stands still.
import { arityProblem, compile, namesIn, parseExpr, type Env, type Node } from "../params-ui/expr";
import { declaredNames, readParams, type ParamSet, type ParamsMap } from "../params-ui/params";

export type Vec3 = [number, number, number];

export interface MarkSpec3 {
  /** [x, y] on the surface: numbers, or a parameter's name. */
  at: [number | string, number | string];
  label?: string | boolean;
}

export interface Plot3dParams {
  surface?: string;
  curve?: { x_expr?: string; y_expr?: string; z_expr?: string; t_min?: number; t_max?: number; samples?: number };
  points?: { at?: number[]; label?: string }[];
  domain?: [number, number];
  grid_n?: number;
  azimuth_deg?: number;
  elevation_deg?: number;
  distance?: number;
  zoom?: number;
  axis_labels?: { x?: string; y?: string; z?: string };
  title?: string;
  params?: ParamsMap;
  editable?: string[];
  controls?: "equation" | "panel" | "both";
  panel?: string[];
  show_equation?: boolean;
  z_range?: [number, number];
  marks?: MarkSpec3[];
  style?: string;
  color_by?: string;
  shading?: boolean;
  opacity?: number;
  legend?: boolean;
}

export type Kind = "surface" | "curve" | "points";

/** How a surface is drawn: its wires only, filled cells under thin wires, or fills with the wires all but gone. */
export type SurfaceStyle = "wire" | "mesh" | "solid";
export const SURFACE_STYLES: SurfaceStyle[] = ["wire", "mesh", "solid"];
/** What a filled cell's colour says: its height, its facing (lit), or nothing (one tone). */
export type ColorBy = "height" | "shade" | "flat";
export const COLOR_BYS: ColorBy[] = ["height", "shade", "flat"];
export const DEFAULT_FILL_OPACITY = 0.8;

/** The fill options, read once — `style` "wire" (the default) draws none of it. */
export interface FillModel {
  style: SurfaceStyle;
  colorBy: ColorBy;
  /** Lambert light × the colour: always with "shade"; "height" takes it when asked (default: solid only). */
  shading: boolean;
  opacity: number;
  legend: boolean;
}

export interface Expr {
  src: string;
  node: Node | null;
  error: string | null;
  fn: (env: Env) => number;
}

export interface Model extends ParamSet {
  kind: Kind;
  /** The surface, when kind is "surface" (the saddle when nothing was given). */
  surface: Expr | null;
  /** x(t), y(t), z(t), when kind is "curve". */
  curve: { x: Expr; y: Expr; z: Expr; tMin: number; tMax: number; samples: number } | null;
  domain: [number, number];
  gridN: number;
  /** The variables the expressions read: x and y, or t. */
  variables: string[];
  /** Scaled once over the parameters' ranges (see the top of this file). */
  steady: boolean;
  showEquation: boolean;
  zRange: [number, number] | null;
  camera: { azimuth: number; elevation: number; zoom: number; distance: number | null };
  marks: MarkSpec3[];
  fill: FillModel;
  /** Names the expressions read that the author did not declare (each is 1). */
  undeclared: string[];
  errors: string[];
}

export const DEFAULT_AZIMUTH = 35;
export const DEFAULT_ELEVATION = 22;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 3;
export const ELEVATION_MIN = -85;
export const ELEVATION_MAX = 85;
export const DEFAULT_SURFACE = "x^2 - y^2";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function readExpr(src: string, declared: string[], what: string, errors: string[]): Expr {
  let node: Node | null = null;
  let error: string | null = null;
  try {
    node = parseExpr(src, declared);
    error = arityProblem(node);
    if (error) node = null;
  } catch (e) {
    error = (e as Error).message;
  }
  if (error) errors.push(`${what} "${src}": ${error}`);
  const f = node ? compile(node) : null;
  return { src, node, error, fn: f ?? ((): number => NaN) };
}

/** Read the template params. Never throws: what is wrong is listed in `errors`. */
export function readModel(P: Plot3dParams): Model {
  const errors: string[] = [];
  const hasSurface = str(P.surface);
  const c = P.curve && typeof P.curve === "object" ? P.curve : null;
  const hasCurve = !!c && typeof c.x_expr === "string" && typeof c.y_expr === "string" && typeof c.z_expr === "string";
  const hasPoints = Array.isArray(P.points) && P.points.length > 0;
  // "Exactly one" is the contract; more than one: surface, then curve, then
  // points. None at all: the saddle, so the figure is never empty.
  const kind: Kind = hasSurface ? "surface" : hasCurve ? "curve" : hasPoints ? "points" : "surface";
  const declared = declaredNames(P.params);
  const variables = kind === "curve" ? ["t"] : kind === "surface" ? ["x", "y"] : [];

  let surface: Model["surface"] = null;
  let curve: Model["curve"] = null;
  if (kind === "surface") surface = readExpr(hasSurface ? (P.surface as string) : DEFAULT_SURFACE, declared, "surface", errors);
  else if (kind === "curve") {
    const cc = c!;
    const tMin = num(cc.t_min) ? cc.t_min : 0;
    const tMax = num(cc.t_max) ? cc.t_max : 2 * Math.PI;
    const samples = Math.max(2, Math.min(1000, num(cc.samples) ? Math.round(cc.samples) : 200));
    curve = {
      x: readExpr(cc.x_expr as string, declared, "x_expr", errors),
      y: readExpr(cc.y_expr as string, declared, "y_expr", errors),
      z: readExpr(cc.z_expr as string, declared, "z_expr", errors),
      tMin,
      tMax,
      samples,
    };
  }

  // Parameters: every free name but the variables, in first-use order, then
  // a mark's `at` name, then any declared one the expressions do not read.
  const nodes = [surface?.node, curve?.x.node, curve?.y.node, curve?.z.node].filter((n): n is Node => !!n);
  const read: string[] = [];
  for (const n of nodes) for (const name of namesIn(n)) if (!variables.includes(name) && !read.includes(name)) read.push(name);
  const marks: MarkSpec3[] = kind === "surface" && Array.isArray(P.marks) ? P.marks.filter((m) => m && Array.isArray(m.at) && m.at.length === 2) : [];
  const names = [...read];
  for (const m of marks) for (const a of m.at) if (typeof a === "string" && !variables.includes(a) && !names.includes(a)) names.push(a);
  const set = readParams({ given: P.params, names: names.concat(declared.filter((n) => !variables.includes(n))), editable: P.editable, controls: P.controls, panel: P.panel });
  if (set.dropped.length > 0) errors.push(`${set.params.length + set.dropped.length} parameters — at most ${set.params.length}`);
  const undeclared = read.filter((n) => !declared.includes(n));

  const domain: [number, number] = Array.isArray(P.domain) && P.domain.length === 2 && num(P.domain[0]) && num(P.domain[1]) && P.domain[0] < P.domain[1] ? [P.domain[0], P.domain[1]] : [-1, 1];
  const gridN = Math.max(2, Math.min(20, num(P.grid_n) ? Math.round(P.grid_n) : 12));
  const zRange: [number, number] | null = Array.isArray(P.z_range) && num(P.z_range[0]) && num(P.z_range[1]) && P.z_range[1] > P.z_range[0] ? [P.z_range[0], P.z_range[1]] : null;
  const steady = set.params.length > 0 || zRange !== null;
  const showEquation = typeof P.show_equation === "boolean" ? P.show_equation && kind !== "points" : set.params.length > 0 && kind !== "points";
  const camera = {
    azimuth: num(P.azimuth_deg) ? P.azimuth_deg : DEFAULT_AZIMUTH,
    elevation: num(P.elevation_deg) ? P.elevation_deg : DEFAULT_ELEVATION,
    zoom: num(P.zoom) && P.zoom > 0 ? clampZoom(P.zoom) : 1,
    distance: num(P.distance) && P.distance > 0 ? P.distance : null,
  };
  return { ...set, kind, surface, curve, domain, gridN, variables, steady, showEquation, zRange, camera, marks, fill: readFill(P), undeclared, errors };
}

/** The fill options — an unknown style is "wire" (the lint names it), an unknown color_by "height". */
export function readFill(P: Plot3dParams): FillModel {
  const style: SurfaceStyle = SURFACE_STYLES.includes(P.style as SurfaceStyle) ? (P.style as SurfaceStyle) : "wire";
  const colorBy: ColorBy = COLOR_BYS.includes(P.color_by as ColorBy) ? (P.color_by as ColorBy) : "height";
  const shading = colorBy === "shade" ? true : typeof P.shading === "boolean" ? P.shading : style === "solid";
  const opacity = num(P.opacity) ? Math.min(1, Math.max(0.1, P.opacity)) : DEFAULT_FILL_OPACITY;
  const legend = P.legend === true && colorBy === "height" && style !== "wire";
  return { style, colorBy, shading, opacity, legend };
}

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export const clampElevation = (e: number): number => Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, e));

/** The grid's coordinates along x (and y): gridN evenly from the domain's min to its max. */
export function gridCoords(m: Model): number[] {
  const [d0, d1] = m.domain;
  const step = (d1 - d0) / (m.gridN - 1);
  return Array.from({ length: m.gridN }, (_, i) => d0 + step * i);
}

/** The surface's raw z over the grid, rows by y: raw[i][j] = f(xs[j], ys[i]) (0 where undefined, as the pack version did). */
export function sampleSurface(m: Model, env: Env = m.env): number[][] {
  const xs = gridCoords(m);
  const f = m.surface?.fn ?? ((): number => NaN);
  const e: Env = { ...env };
  return xs.map((y) =>
    xs.map((x) => {
      e.x = x;
      e.y = y;
      const z = f(e);
      return Number.isFinite(z) ? z : 0;
    }),
  );
}

/** z at one (x, y) — NaN where undefined. */
export function surfaceAt(m: Model, x: number, y: number, env: Env = m.env): number {
  const z = m.surface?.fn({ ...env, x, y }) ?? NaN;
  return Number.isFinite(z) ? z : NaN;
}

/** The curve's points (math x, y, z; 0 where undefined, as the pack version did). */
export function sampleCurve3(m: Model, env: Env = m.env): Vec3[] {
  const c = m.curve;
  if (!c) return [];
  const out: Vec3[] = [];
  const e: Env = { ...env };
  for (let k = 0; k < c.samples; k++) {
    e.t = c.tMin + (c.tMax - c.tMin) * (k / (c.samples - 1));
    const x = c.x.fn(e);
    const y = c.y.fn(e);
    const z = c.z.fn(e);
    out.push([Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0]);
  }
  return out;
}

/**
 * The environments a steady scale is taken over: the current values, and
 * every combination of each bounded parameter's min, middle and max (min and
 * max only past four of them, the current value past six) — so the scale
 * holds while any slider moves, the movie's animate included.
 */
export function rangeEnvs(m: Model): Env[] {
  const bounded = m.params.filter((p) => p.min !== undefined && p.max !== undefined && p.max > p.min);
  const levels = bounded.slice(0, 6).map((p) => (bounded.length <= 4 ? [p.min!, (p.min! + p.max!) / 2, p.max!] : [p.min!, p.max!]));
  let envs: Env[] = [{ ...m.env }];
  let all: Env[] = [{}];
  bounded.slice(0, 6).forEach((p, i) => {
    const next: Env[] = [];
    for (const c of all) for (const v of levels[i]) next.push({ ...c, [p.name]: v });
    all = next;
  });
  if (bounded.length > 0) envs = envs.concat(all.map((c) => ({ ...m.env, ...c })));
  return envs;
}

/** The largest |z| the surface reaches over its range of parameters (or the z_range's). */
export function steadyZAbs(m: Model): number {
  const [lo, hi] = steadyZExtent(m);
  return Math.max(Math.abs(lo), Math.abs(hi));
}

/** The lowest and highest z the surface reaches over its range of parameters (or the z_range) — the height colours' fixed scale. */
export function steadyZExtent(m: Model): [number, number] {
  if (m.zRange) return [m.zRange[0], m.zRange[1]];
  let lo = 0;
  let hi = 0;
  for (const env of rangeEnvs(m)) for (const row of sampleSurface(m, env)) for (const z of row) {
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return [lo, hi];
}

/** The surface's min and max z at the current values (raw units), sampled
 *  finer than the drawn grid and through the domain's middle — so a saddle's
 *  {plot3d.z_max} reads 1, not the 0.99 the nearest wire happens to reach. */
export function zExtent(m: Model, n = 41): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of sampleSurface({ ...m, gridN: n })) for (const z of row) {
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return [lo, hi];
}
