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
  /** Typeface: absent = the sketch handwriting font; "mono" = the code font. */
  font?: "mono";
  /** Set when the text is word-wrapped; pos is the center of the whole block. */
  lines?: string[];
}

export const LINE_HEIGHT = 1.25;

export interface GroupDrawable extends BaseDrawable {
  kind: "group";
  children: Drawable[];
}

/**
 * How an image enters the canvas. Every effect is a PURE function of reveal
 * progress t ∈ [0,1] (see svg-backend makeLeafHandle): erase drives t
 * backwards and scrubbing jumps it anywhere, so an effect may hold no
 * direction state — which also means erase plays each entrance in reverse
 * for free (a developed photo dissolves back out of focus, an iris closes).
 */
export type ImageReveal = "develop" | "iris" | "wipe" | "drift" | "fade";

export interface ImageDrawable extends BaseDrawable {
  kind: "image";
  /** A data URI (self-contained; external URLs would break offline/export). */
  href: string;
  /** Center, logical y-up units. */
  pos: Pt;
  w: number;
  h: number;
  /** Entrance/exit effect (default "fade" — plain opacity). */
  reveal?: ImageReveal;
}

export type Drawable = StrokeDrawable | AreaDrawable | TextDrawable | ImageDrawable | GroupDrawable;

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
  /**
   * Ordered series palette for data-driven templates (bar_chart, line_chart,
   * …): series k takes series[k % 6]. Drawn from the roles above so a chart
   * shares the figure's ink. Frozen with its parent — the kit exposes it live.
   */
  series: Object.freeze(["#b5482e", "#2f6b8f", "#8a5fa8", "#d0865f", "#87a878", "#f2c14e"]),
  /**
   * A bright warm white for shapes that must read as "unfilled" ON TOP of a
   * tinted ground — a white chess piece on a green board, a knock-out counter
   * inside a filled shape. Deliberately a shade brighter than the app's own
   * paper ground (--paper #f5f1e6 in styles.css): a filled shape painted in
   * exactly the page's background is invisible the moment anything tinted sits
   * underneath it, which is the only situation this color is for.
   */
  paper: "#fdfbf5",
  /**
   * Chess-board squares. Started from chess.com's own pair (dark #739552,
   * light #ebecd0 — the board the user pointed at) and nudged toward this
   * app's warm, paper-toned palette so the board doesn't read as a foreign
   * screenshot dropped into a sketchbook: the dark is lightened and warmed
   * about a third of the way toward COLORS.region2 (#87a878, the muted sage
   * this board used to be shaded with), the light warmed about 40% of the way
   * toward the paper ground (#f5f1e6). Both stay far enough apart in value
   * that demand (the move arrow), region1 (square highlights) and accent
   * (annotation arrows) all still read clearly on either square.
   */
  boardDark: "#7d9a5e",
  boardLight: "#efeed9",
  /**
   * The marked-square wash on a chess board: region1 blended 40% toward
   * `paper`, i.e. region1's hue at a much higher lightness (relative
   * luminance 0.71 vs region1's own 0.58).
   *
   * Tuned against the two board tones above, because hue alone is not a
   * signal. region1 at 0.5 over the squares separated by only 1.39:1 from
   * boardDark and 1.20:1 from boardLight — the difference was carried almost
   * entirely by yellow-vs-green hue, which collapses on a dim or low-gamut
   * screen and for a red-green colorblind viewer. At full opacity this color
   * is 2.28:1 against boardDark. It CANNOT clear 1.8:1 against boardLight,
   * and neither can any other lightening color: pure white against
   * boardLight is 1.17:1, a hard ceiling. Going the other way (a fill dark
   * enough to be 1.8:1 BELOW boardLight and 1.8:1 below boardDark too) needs
   * luminance <= 0.135, which would bury the ink-filled black pieces
   * standing on it. So the light-square case is carried by an ink frame
   * around the square instead (9.88:1 against boardLight, 3.67:1 against
   * boardDark) — see the highlight block in packs/games.yaml.
   */
  boardHighlight: "#f6d891",
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
