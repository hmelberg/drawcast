// The backend-independent layout IR. Scenes and tier-2 layout produce Drawables
// in logical y-up coordinates; every rendering backend consumes them.

export type Pt = [number, number];

/**
 * Radial-gradient fill in SVG objectBoundingBox coordinates. When set on a
 * circle-hinted stroke drawable, both renderers paint the fill with this
 * gradient instead of the flat `fill` (keep `fill` set too — it is the base
 * color the gradient shades, and the fallback paint). SVG is y-down here:
 * an up-left highlight means fx, fy < 0.5.
 */
export interface GradientSpec {
  stops: { offset: number; color: string; opacity?: number }[];
  fx?: number;
  fy?: number;
  /** Radius in unit bbox coords (default 0.5; > 0.5 softens the limb). */
  r?: number;
}

export interface ResolvedStyle {
  color: string;
  fill?: string;
  fillGradient?: GradientSpec;
  strokeWidth: number;
  dash?: boolean;
  roughness: number;
  opacity: number;
}

export interface DrawResolved {
  mode: "sketch" | "instant";
  /** milliseconds */
  duration: number;
}

export type ShapeHint =
  | { type: "circle"; c: Pt; r: number }
  | { type: "rect"; x: number; y: number; w: number; h: number };

interface BaseDrawable {
  id: string;
  z: number;
  style: ResolvedStyle;
  drawOpts: DrawResolved;
}

export interface StrokeDrawable extends BaseDrawable {
  kind: "stroke";
  pts: Pt[];
  closed?: boolean;
  arrowhead?: "end" | "start" | "both";
  /** Lets backends draw a true circle/rect instead of the sampled polyline. */
  shapeHint?: ShapeHint;
}

export interface AreaDrawable extends BaseDrawable {
  kind: "area";
  pts: Pt[];
  /**
   * Rings punched out of `pts`: the counters of a letterform (the hole in a
   * "b", the two in an "8"). Painted as extra subpaths of the SAME path with
   * `fill-rule: evenodd`, so an enclosed ring becomes a hole. Implies
   * `precise` — a hachured rough.js polygon cannot express a hole at all.
   */
  holes?: Pt[][];
  /**
   * Paint this area as ONE exact filled path — no roughening, no hachure, no
   * knocked-down fill opacity — in BOTH render styles. For shapes whose
   * silhouette IS the meaning: glyph outlines above all, which at ~54 px read
   * as grain and blur under the hand-drawn region fill.
   */
  precise?: boolean;
}

export interface TextDrawable extends BaseDrawable {
  kind: "text";
  pos: Pt;
  text: string;
  fontSize: number;
  anchor: "start" | "middle" | "end";
  /** Set when the text is word-wrapped; pos is the center of the whole block. */
  lines?: string[];
}

export const LINE_HEIGHT = 1.25;

export interface GroupDrawable extends BaseDrawable {
  kind: "group";
  children: Drawable[];
}

export type Drawable = StrokeDrawable | AreaDrawable | TextDrawable | GroupDrawable;

export const Z_AREA = 0;
export const Z_STROKE = 1;
export const Z_TEXT = 2;

// Palette (see also src/styles.css). Warm ink on paper; curves get semantic colors.
export const INK = "#3d3833";
// Frozen: this object is exposed live on `kit` to compiled template bodies
// (src/scenes/kit.ts) — `as const` is type-level only, so without a runtime
// freeze a body could do `kit.COLORS.ink = "red"` and poison every render
// app-wide (this is the one shared instance, not a per-call copy).
export const COLORS = Object.freeze({
  ink: INK,
  demand: "#b5482e",
  supply: "#2f6b8f",
  shifted: "#d0865f",
  accent: "#8a5fa8",
  guide: "#8f887c",
  region1: "#f2c14e",
  region2: "#87a878",
  regionLoss: "#c96567",
} as const);

export function defaultStyle(overrides: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return { color: INK, strokeWidth: 3.5, roughness: 1.4, opacity: 1, ...overrides };
}

/**
 * Default sketch durations (ms) per element role, at speed 1×. Tuned slow
 * enough that each element visibly "draws itself"; the speed control scales
 * everything from here.
 */
// Frozen for the same reason as COLORS above — also exposed live on `kit`.
export const SKETCH_MS = Object.freeze({
  stroke: 1400,
  curve: 2150,
  axis: 1000,
  guides: 900,
  dot: 420,
  region: 1300,
  connector: 850,
  node: 850,
  priceLine: 1150,
  arrow: 730,
  text: 400,
} as const);

export function defaultDrawOpts(mode: "sketch" | "instant" = "sketch", durationMs?: number): DrawResolved {
  return { mode, duration: mode === "instant" ? 0 : (durationMs ?? SKETCH_MS.stroke) };
}

/** Pre-order flatten: groups are included, followed by their children. */
export function flattenDrawables(drawables: Drawable[]): Drawable[] {
  const out: Drawable[] = [];
  const walk = (d: Drawable) => {
    out.push(d);
    if (d.kind === "group") d.children.forEach(walk);
  };
  drawables.forEach(walk);
  return out;
}

/** Leaves only (what actually gets painted / linted). */
export function leafDrawables(drawables: Drawable[]): Exclude<Drawable, GroupDrawable>[] {
  return flattenDrawables(drawables).filter((d): d is Exclude<Drawable, GroupDrawable> => d.kind !== "group");
}

/**
 * Sub-drawable suffixes: `<elementId>_<suffix>` drawables animate together with
 * their parent element (e.g. a point's guides, a node's text, a label's leader).
 */
const SUB_SUFFIXES = ["text", "guides", "leader", "head", "body", "dot"];

/** All top-level drawables belonging to one command-addressable element id. */
export function drawablesForId(drawables: Drawable[], id: string): Drawable[] {
  return drawables.filter((d) => d.id === id || SUB_SUFFIXES.some((s) => d.id === `${id}_${s}`));
}
