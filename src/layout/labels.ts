// Greedy label placement with two obstacle tiers: text is SOLID (never
// overlapped — overlapping words are unreadable), strokes and shapes are SOFT
// (a label may graze a curve; the text halo keeps it legible). A near spot
// with a small soft overlap beats a distant clean spot — distance costs a
// leader line, which is the uglier outcome. Leaders appear only when text
// collisions force real displacement; fall back to the preferred spot when
// nothing fits (lint will flag it).

import { CANVAS } from "./canvas";
import { bboxOfPts, bboxOfText, boxesOverlap, expandBox, type BBox } from "./geometry";
import {
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  COLORS,
  flattenDrawables,
  leafDrawables,
  type Drawable,
  type DrawResolved,
  type GroupDrawable,
  type Pt,
  type ResolvedStyle,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";
import type { MeasureFn } from "./measure";
import type { Side } from "../spec/types";

export type { Side };

/** Where a label goes relative to its anchor. "center" is ON the anchor —
 *  an area's name inside the area (Hans 2026-09-26) — and falls back to the
 *  eight sides, with a leader when it has to go far. */
export type LabelSide = Side | "center";

export interface LabelRequest {
  id: string;
  anchor: Pt;
  side: LabelSide;
  text: string;
  fontSize: number;
  style: ResolvedStyle;
  drawOpts: DrawResolved;
  /**
   * Drawable ids this label may sit on — the very thing it names. A stroke's
   * obstacle box is its bounding rectangle, so a DIAGONAL line blocks the
   * whole wedge it spans: a label at the midpoint of a branch overlaps its own
   * branch from every side, never scores a clean spot, and gets pushed
   * somewhere arbitrary by the soft-penalty tie-break. Opt in and the label
   * competes only against everything else. Purely opt-in — a request without
   * it is placed exactly as before.
   */
  ignore?: string[];
  /**
   * The only sides this label may take (the preferred `side` first). A label
   * naming a point ON an axis — a price at the y-axis, a quantity at the
   * x-axis — must stay outside it: with free fallback, a crowded one (P₂
   * just above P₁, "P buyers" above P*) slid to the right, into the plot
   * (Hans 2026-09-26). Restricted, it stacks along the outside instead.
   */
  sides?: LabelSide[];
  /**
   * Wrap wider than this (default MAX_LABEL_WIDTH). A label that must fit a
   * narrow slot — a decision-tree branch label over its own branch — wraps
   * to it instead of shrinking its font (2026-09-27).
   */
  maxWidth?: number;
  /**
   * Strips the label must stay inside, as hard geometry rather than
   * obstacle boxes: a decision-tree branch label between its own branch and
   * the neighbouring one. Boxes cannot say this — a diagonal's boxes claim
   * the wedge it crosses — so the old solve treated the neighbour as a soft
   * cost, found nothing clean, and slid onto the next branch ("Grows
   * (p=0.53)" on the edge to "Never operated", 2026-09-27). Inside a
   * corridor the label slides ALONG the line it hugs, nearest the anchor
   * first, rather than out from the anchor in rings. Strictest first; a
   * label with no place in any corridor gets the ordinary search.
   */
  corridors?: LabelCorridor[];
  /**
   * No part of the label left of this x — a hard bound on every search. A
   * decision tree's terminal name and payoff belong right of their triangle;
   * crowded out of it, they used to drift left onto the branches, where they
   * read as branch labels (2026-09-27).
   */
  minX?: number;
}

/** See LabelRequest.corridors. Lines are extended past their ends. */
export interface LabelCorridor {
  xMin: number;
  xMax: number;
  /** The label stays above this line (logical y is up). */
  floor?: [Pt, Pt];
  /** The label stays below this line. */
  ceiling?: [Pt, Pt];
  /** The line the label sits along — the thing it names. */
  hug: "floor" | "ceiling";
  /** How far the label's edge may cross the OTHER line — a last resort for a
   *  label too big for its strip. Kept under a quarter of its height, the
   *  line never reaches the label's core (what the lint measures). */
  give?: number;
}

/** Move a request's geometry with its figure (template fit, group arrangement). */
export function mapLabelRequest(req: LabelRequest, map: (p: Pt) => Pt): void {
  req.anchor = map(req.anchor);
  if (req.minX !== undefined) req.minX = map([req.minX, 0])[0];
  if (req.corridors) {
    req.corridors = req.corridors.map((c) => ({
      ...c,
      xMin: map([c.xMin, 0])[0],
      xMax: map([c.xMax, 0])[0],
      floor: c.floor && [map(c.floor[0]), map(c.floor[1])],
      ceiling: c.ceiling && [map(c.ceiling[0]), map(c.ceiling[1])],
    }));
  }
}

/** Clearance between a corridor-bound label and the lines that bound it. */
const CORRIDOR_CLEAR = 7;
/** How far off the hugged line a corridor label may stand, nearest first. */
const HUG_OFFSETS = [0, 8, 18, 30];
/** The step a corridor label slides along its line. */
const HUG_STEP = 6;

function lineY([a, b]: [Pt, Pt], x: number): number {
  if (b[0] === a[0]) return a[1];
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

/** Whether a box stays inside its corridor. */
function insideCorridor(box: BBox, c: LabelCorridor): boolean {
  if (box.x < c.xMin - 0.01 || box.x + box.w > c.xMax + 0.01) return false;
  const xs = [box.x, box.x + box.w];
  const clear = (line: "floor" | "ceiling") => CORRIDOR_CLEAR - (c.hug === line ? 0 : Math.min(c.give ?? 0, box.h / 4));
  if (c.floor && box.y < Math.max(...xs.map((x) => lineY(c.floor!, x))) + clear("floor") - 0.01) return false;
  if (c.ceiling && box.y + box.h > Math.min(...xs.map((x) => lineY(c.ceiling!, x))) - clear("ceiling") + 0.01) return false;
  return true;
}

/**
 * Every spot along a corridor's hugged line, best first: close to the line,
 * then close to the anchor. The box stands HUG_OFFSETS off the line at its
 * nearer corner, so a steep line never runs through it.
 */
function hugCandidates(c: LabelCorridor, anchor: Pt, w: number, h: number): BBox[] {
  const line = c.hug === "floor" ? c.floor : c.ceiling;
  if (!line) return [];
  const out: { box: BBox; score: number }[] = [];
  const x0s: number[] = [];
  for (let x = c.xMin; x + w <= c.xMax + 0.01; x += HUG_STEP) x0s.push(x);
  if (x0s.length === 0 || x0s[x0s.length - 1] + w < c.xMax - 0.01) x0s.push(c.xMax - w);
  for (const x0 of x0s) {
    const ys = [lineY(line, x0), lineY(line, x0 + w)];
    HUG_OFFSETS.forEach((d, k) => {
      const y = c.hug === "floor" ? Math.max(...ys) + CORRIDOR_CLEAR + d : Math.min(...ys) - CORRIDOR_CLEAR - d - h;
      const box = { x: x0, y, w, h };
      if (!insideCorridor(box, c)) return;
      out.push({ box, score: k * 40 + Math.abs(x0 + w / 2 - anchor[0]) });
    });
  }
  return out.sort((p, q) => p.score - q.score).map((o) => o.box);
}

/**
 * A placement, as a vector from the anchor to the label's centre — what the
 * solver decided, in the one form that survives the anchor moving.
 *
 * The solve is an argmin over eight sides at six rings, and where the near
 * candidates score alike (a curve's obstacle boxes blanketing the plot area,
 * so no side ever scores a clean zero) the winner changes whenever the
 * geometry shifts a pixel. Harmless at a boundary, ruinous per frame: every
 * tween frame re-runs the whole layout (render/index.ts, Reprojector.frame),
 * so a label hopped a hundred units across the figure several times a second.
 * Hand the boundary's pin to the frames and the label rides its anchor
 * rigidly instead — one solve per boundary, none in between.
 */
export interface LabelPin {
  /** anchor → label centre. */
  d: Pt;
  /** Whether that placement drew a leader, so a pinned frame draws it too. */
  leader: boolean;
  /** The width the label was wrapped to, when the solve chose a narrower
   *  one than its request's (a corridor label fitting its strip). */
  maxWidth?: number;
}

export interface PlacedLabel {
  text: TextDrawable;
  leader?: StrokeDrawable;
  /** What this placement was, for the next frame to inherit. */
  pin: LabelPin;
}

export interface Obstacle {
  box: BBox;
  /** solid = text: never overlapped. Soft (strokes/shapes) may be grazed. */
  solid: boolean;
  /** The drawable this box came from, so a label can ignore its own (see LabelRequest.ignore). */
  id?: string;
  /** For a stroke piece: the segment itself, so a candidate can ask what the
   *  lint asks — does a line cross the label's core? */
  seg?: [Pt, Pt];
}

/** The ink box of a math group: the union of its glyph rings. Null for empty TeX. */
export function mathBox(g: GroupDrawable): BBox | null {
  const pts: Pt[] = [];
  for (const d of leafDrawables(g.children)) if (d.kind !== "text" && d.kind !== "image") pts.push(...d.pts);
  return pts.length > 0 ? bboxOfPts(pts) : null;
}

/** Longest stroke segment kept as a single obstacle box before subdividing. */
const SEG_MAX = 48;

/**
 * Everything already on the paper, as boxes a label (or a `math` element
 * choosing its side) must reckon with. Text is solid; strokes, images and
 * shapes are soft. A math group counts as SOLID text — its glyphs are words —
 * and is taken as one box, not as its fifty filled rings.
 */
export function obstacleBoxes(drawables: Drawable[], measure: MeasureFn): Obstacle[] {
  const obstacles: Obstacle[] = [];
  for (const g of flattenDrawables(drawables)) {
    if (g.kind === "group" && g.role === "math") {
      const box = mathBox(g);
      if (box) obstacles.push({ box: expandBox(box, 2), solid: true, id: g.id });
    }
  }
  for (const d of leafDrawables(drawables)) {
    if (d.kind === "text") {
      // Text is solid: overlapping words are unreadable.
      obstacles.push({ box: expandBox(bboxOfText(d, measure), 2), solid: true, id: d.id });
    } else if (d.kind === "image") {
      obstacles.push({ box: { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h }, solid: false, id: d.id });
    } else if (d.kind === "stroke") {
      // Strokes/shapes are soft: a label may graze them (the halo keeps it legible).
      if (d.shapeHint?.type === "circle") {
        const { c, r } = d.shapeHint;
        obstacles.push({ box: { x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r }, solid: false, id: d.id });
      } else if (d.shapeHint?.type === "rect") {
        obstacles.push({ box: { x: d.shapeHint.x, y: d.shapeHint.y, w: d.shapeHint.w, h: d.shapeHint.h }, solid: false, id: d.id });
      } else {
        // Per-segment boxes: keeps long thin curves from blocking half the
        // canvas — and LONG segments are subdivided, because one box around a
        // long diagonal is a lie: it claims the entire wedge the line crosses,
        // so every spot near that line scores a penalty and the least-bad one
        // ends up being ON it. Chopped into SEG_MAX pieces the boxes hug the
        // stroke instead.
        const pad = d.style.strokeWidth;
        for (let i = 0; i + 1 < d.pts.length; i++) {
          const [a, b] = [d.pts[i], d.pts[i + 1]];
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SEG_MAX));
          for (let k = 0; k < steps; k++) {
            const p0: Pt = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
            const p1: Pt = [a[0] + ((b[0] - a[0]) * (k + 1)) / steps, a[1] + ((b[1] - a[1]) * (k + 1)) / steps];
            obstacles.push({ box: expandBox(bboxOfPts([p0, p1]), pad), solid: false, id: d.id, seg: [p0, p1] });
          }
        }
      }
    }
    // areas are not obstacles: region labels belong inside their region
  }
  return obstacles;
}

const DIRS: Record<LabelSide, [number, number]> = {
  center: [0, 0],
  above: [0, 1],
  below: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  "above-left": [-0.75, 0.75],
  "above-right": [0.75, 0.75],
  "below-left": [-0.75, -0.75],
  "below-right": [0.75, -0.75],
};

const FALLBACK_ORDER: Side[] = [
  "above-right",
  "below-right",
  "above-left",
  "below-left",
  "above",
  "below",
  "right",
  "left",
];

const EDGE_PAD = 4;
/** Wrap labels wider than this many logical units into multiple lines. */
const MAX_LABEL_WIDTH = 280;
const LINE_HEIGHT = 1.25;

/** Greedy word wrap at a measured width. Shared with the source caption. */
export function wrapText(text: string, fontSize: number, maxWidth: number, measure: MeasureFn): string[] {
  if (measure(text, fontSize).w <= maxWidth) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, fontSize).w > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapLines(req: LabelRequest, measure: MeasureFn): string[] {
  return wrapText(req.text, req.fontSize, req.maxWidth ?? MAX_LABEL_WIDTH, measure);
}

function candidateBox(anchor: Pt, side: LabelSide, r: number, w: number, h: number): BBox {
  const [dx, dy] = DIRS[side];
  const cx = anchor[0] + dx * (r + (dx !== 0 ? w / 2 : 0));
  const cy = anchor[1] + dy * (r + (dy !== 0 ? h / 2 : 0));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Where a label would sit at its preferred side on the nearest ring — the box
 * the solver tries first, before it knows what is in the way. What a template
 * fit counts as ink (template-fit.ts): a fit that measured the drawables
 * alone sized the figure to fill its box and left the labels hanging out of
 * it (a decision tree's terminal names at the canvas edge, 2026-09-26).
 */
export function preferredLabelBox(req: LabelRequest, measure: MeasureFn): BBox {
  const lines = wrapLines(req, measure);
  const w = Math.max(...lines.map((line) => measure(line, req.fontSize).w));
  const h = lines.length * req.fontSize * LINE_HEIGHT;
  return candidateBox(req.anchor, req.side, 10 + req.fontSize * 0.55, w, h);
}

function clampToCanvas(b: BBox): BBox {
  const x = Math.min(Math.max(b.x, EDGE_PAD), CANVAS.w - b.w - EDGE_PAD);
  const y = Math.min(Math.max(b.y, EDGE_PAD), CANVAS.h - b.h - EDGE_PAD);
  return { ...b, x, y };
}

function overlapArea(a: BBox, b: BBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The label's core — the box the label–stroke lint measures (lint.ts): a
 *  line through it threatens legibility, a graze of the edge does not. */
function coreOf(b: BBox): BBox {
  return { x: b.x + b.w * 0.2, y: b.y + b.h * 0.25, w: b.w * 0.6, h: b.h * 0.5 };
}

function segmentHitsBox([a, b]: [Pt, Pt], r: BBox): boolean {
  const inside = (p: Pt) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const cross = (p: Pt, q: Pt, u: Pt, v: Pt) => {
    const d = (q[0] - p[0]) * (v[1] - u[1]) - (q[1] - p[1]) * (v[0] - u[0]);
    if (d === 0) return false;
    const t = ((u[0] - p[0]) * (v[1] - u[1]) - (u[1] - p[1]) * (v[0] - u[0])) / d;
    const w = ((u[0] - p[0]) * (q[1] - p[1]) - (u[1] - p[1]) * (q[0] - p[0])) / d;
    return t >= 0 && t <= 1 && w >= 0 && w <= 1;
  };
  const c: Pt[] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  return c.some((p, i) => cross(a, b, p, c[(i + 1) % 4]));
}

/** Where a leader from `anchor` meets a label's box: the middle of its nearer side. */
function leaderEnd(box: BBox, anchor: Pt): Pt {
  const cx = box.x + box.w / 2;
  return [cx + (anchor[0] < cx ? -box.w / 2 - 2 : box.w / 2 + 2), box.y + box.h / 2];
}

/** Rings 0..NEAR_RINGS-1 count as "near the anchor" — no leader needed there. */
const NEAR_RINGS = 2;

export function placeLabels(
  requests: LabelRequest[],
  obstacles: Obstacle[],
  measure: MeasureFn,
  pins?: Record<string, LabelPin>,
): PlacedLabel[] {
  const blocked: Obstacle[] = [...obstacles];
  const placed: PlacedLabel[] = [];

  for (const req of requests) {
    // Pinned: the boundary already chose, and this frame only follows the
    // anchor. No search at all — re-running it is the whole defect.
    const pin = pins?.[req.id];
    const shape = (maxWidth: number) => {
      const lines = wrapText(req.text, req.fontSize, maxWidth, measure);
      return { lines, maxWidth, w: Math.max(...lines.map((line) => measure(line, req.fontSize).w)), h: lines.length * req.fontSize * LINE_HEIGHT };
    };
    let { lines, w, h, maxWidth: wrappedTo } = shape(pin?.maxWidth ?? req.maxWidth ?? MAX_LABEL_WIDTH);
    const ignored = req.ignore && req.ignore.length > 0 ? new Set(req.ignore) : null;
    const inPlay = ignored ? blocked.filter((o) => o.id === undefined || !ignored.has(o.id)) : blocked;
    // Restricted sides are a strong preference, not a ban: they alone are
    // tried at the near rings; only if none is clean there may the label
    // take another side ("outside … unless in exceptional circumstances" —
    // a long "going rent" that cannot fit left of the axis).
    const preferred: LabelSide[] | null = req.sides ? [req.side, ...req.sides.filter((s) => s !== req.side)] : null;
    const sides: LabelSide[] = preferred
      ? [...preferred, ...FALLBACK_ORDER.filter((s) => !preferred.includes(s))]
      : [req.side, ...FALLBACK_ORDER.filter((s) => s !== req.side)];
    const r0 = 10 + req.fontSize * 0.55;
    const rings = [1, 2.2, 3.6, 6, 9, 13].map((k) => r0 * k);

    // (Typed by assertion: they are set inside the search closure below, which
    // flow analysis would otherwise not see.)
    let chosen = null as { box: BBox; ringIndex: number } | null;
    let softNear = null as { box: BBox; ringIndex: number; penalty: number } | null;
    /** The nearest spot no line crosses the core of, however much it grazes. */
    let coreClean = null as { box: BBox; ringIndex: number; penalty: number } | null;
    // A line through the label's core is what the label–stroke lint reports;
    // the solver used to accept it near the anchor ("grazing beats exile")
    // and the lint then blamed the author (ledger, Engine #4: labels on
    // curves, on the y-axis). Near spots must now leave the core clear.
    const crossed = (box: BBox) => {
      const core = coreOf(box);
      return inPlay.some((o) => !o.solid && o.seg !== undefined && segmentHitsBox(o.seg, core));
    };
    const onCanvas = (b: BBox) => b.x >= EDGE_PAD && b.y >= EDGE_PAD && b.x + b.w <= CANVAS.w - EDGE_PAD && b.y + b.h <= CANVAS.h - EDGE_PAD;
    // Corridors first: the first clean spot along the hugged line, else the
    // least-grazing one no line crosses; else a narrower wrap (a wedge
    // between two branches opens toward the children, and a narrower box
    // reaches further into the open end); else the next corridor.
    if (!pin && req.corridors) {
      const wraps = [shape(wrappedTo)];
      for (;;) {
        const last = wraps[wraps.length - 1];
        if (last.lines.length >= req.text.split(/\s+/).length) break;
        const next = shape(last.w - 1);
        if (next.lines.length === last.lines.length) break; // no word breaks narrower
        wraps.push(next);
      }
      corridors: for (const corridor of req.corridors) for (const wrap of wraps) {
        let best: { box: BBox; penalty: number } | null = null;
        for (const box of hugCandidates(corridor, req.anchor, wrap.w, wrap.h)) {
          if (!onCanvas(box)) continue;
          if (inPlay.some((o) => o.solid && boxesOverlap(box, o.box, 3))) continue;
          const penalty = inPlay.reduce((sum, o) => (o.solid ? sum : sum + overlapArea(box, o.box)), 0);
          if (penalty === 0) {
            best = { box, penalty };
            break;
          }
          if (crossed(box)) continue;
          if (best === null || penalty < best.penalty) best = { box, penalty };
        }
        if (best) {
          chosen = { box: best.box, ringIndex: 0 };
          ({ lines, w, h, maxWidth: wrappedTo } = wrap);
          break corridors;
        }
      }
    }
    // The search order: with preferred sides, first those alone at the near
    // rings; then every side at the near rings; then every side further out —
    // near on another side beats far on the preferred one, and an exile with
    // a leader comes last. Grazing a stroke is accepted only in the open pass.
    const passes: { ringIndex: number; r: number; only: boolean }[] = [
      ...(preferred ? rings.slice(0, NEAR_RINGS).map((r, i) => ({ ringIndex: i, r, only: true })) : []),
      ...rings.map((r, i) => ({ ringIndex: i, r, only: false })),
    ];
    const search = (passes: { ringIndex: number; r: number; only: boolean }[], leadersClear = true) => {
      outer: for (const { ringIndex, r, only } of passes) {
        for (const side of sides) {
          if (only && !preferred!.includes(side)) continue;
          if (!only && preferred && ringIndex < NEAR_RINGS && preferred.includes(side)) continue; // tried in its own pass
          const box = clampToCanvas(candidateBox(req.anchor, side, r, w, h));
          if (req.minX !== undefined && box.x < req.minX) continue;
          if (inPlay.some((o) => o.solid && boxesOverlap(box, o.box, 3))) continue; // text-text: never
          // An exiled corridor label's leader is how it names its branch; one
          // drawn through another label strikes that label out. So does any
          // leader: a terminal's name exiled past its payoff drew its dashed
          // line straight through the number (2026-09-27).
          if (req.corridors?.length || (leadersClear && ringIndex >= 2)) {
            const lead: [Pt, Pt] = [req.anchor, leaderEnd(box, req.anchor)];
            if (inPlay.some((o) => o.solid && segmentHitsBox(lead, o.box))) continue;
          }
          const penalty = inPlay.reduce((sum, o) => (o.solid ? sum : sum + overlapArea(box, o.box)), 0);
          if (penalty === 0) {
            chosen = { box, ringIndex };
            break outer;
          }
          if (crossed(box)) continue;
          if (coreClean === null || ringIndex < coreClean.ringIndex || (ringIndex === coreClean.ringIndex && penalty < coreClean.penalty)) {
            coreClean = { box, ringIndex, penalty };
          }
          if (!only && ringIndex < NEAR_RINGS && (softNear === null || penalty < softNear.penalty)) {
            softNear = { box, ringIndex, penalty };
          }
        }
        // No clean spot near the anchor: grazing a stroke here beats being
        // exiled to a distant clean spot with a leader line.
        if (!only && ringIndex === NEAR_RINGS - 1 && softNear) {
          chosen = softNear;
          break;
        }
      }
    };
    if (!pin && !chosen) {
      // A label that had corridors and found no place in any is past the
      // near rings: near but outside its corridor is exactly the spot that
      // reads as the neighbour's label. It goes far first, with a leader to
      // its own anchor; near only when there is no far spot either.
      if (req.corridors?.length) search(passes.filter((p) => p.ringIndex >= NEAR_RINGS));
      if (!chosen && !coreClean) search(passes);
      // Every far spot's leader crossing text is still better than no far spot.
      if (!chosen && !coreClean && !req.corridors?.length) search(passes, false);
    }

    // Nothing fits anywhere: keep the preferred spot and let lint report it.
    const finalBox = pin
      ? clampToCanvas({ x: req.anchor[0] + pin.d[0] - w / 2, y: req.anchor[1] + pin.d[1] - h / 2, w, h })
      : (chosen?.box ?? coreClean?.box ?? clampToCanvas(candidateBox(req.anchor, req.side, rings[0], w, h)));
    // Pinned or not, the spot is taken: labels solved after this one avoid it.
    blocked.push({ box: finalBox, solid: true });

    const text: TextDrawable = {
      id: req.id,
      kind: "text",
      pos: [finalBox.x + finalBox.w / 2, finalBox.y + finalBox.h / 2],
      text: req.text,
      lines: lines.length > 1 ? lines : undefined,
      fontSize: req.fontSize,
      anchor: "middle",
      z: Z_TEXT,
      style: req.style,
      drawOpts: req.drawOpts,
    };
    // sanity: keep bbox math consistent with the backend's anchor semantics
    void bboxOfText(text, measure);

    let leader: StrokeDrawable | undefined;
    const used = chosen ?? coreClean;
    const wantsLeader = pin ? pin.leader : !!used && used.ringIndex >= 2;
    if (wantsLeader) {
      // Displaced far: draw a thin leader from the anchor toward the label edge.
      const towardAnchor = leaderEnd(finalBox, req.anchor);
      leader = {
        id: `${req.id}_leader`,
        kind: "stroke",
        pts: [req.anchor, towardAnchor],
        z: Z_STROKE,
        style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.8 }),
        drawOpts: defaultDrawOpts("instant"),
      };
      // Labels solved after this one keep off the leader as off any line.
      const [a, b] = leader.pts as [Pt, Pt];
      const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40));
      for (let i = 0; i < pieces; i++) {
        const p: Pt = [a[0] + ((b[0] - a[0]) * i) / pieces, a[1] + ((b[1] - a[1]) * i) / pieces];
        const q: Pt = [a[0] + ((b[0] - a[0]) * (i + 1)) / pieces, a[1] + ((b[1] - a[1]) * (i + 1)) / pieces];
        const box = { x: Math.min(p[0], q[0]), y: Math.min(p[1], q[1]), w: Math.abs(q[0] - p[0]), h: Math.abs(q[1] - p[1]) };
        blocked.push({ box, solid: false, id: leader.id, seg: [p, q] });
      }
    }

    placed.push({
      text,
      leader,
      pin: {
        d: [text.pos[0] - req.anchor[0], text.pos[1] - req.anchor[1]],
        leader: wantsLeader,
        ...(wrappedTo !== (req.maxWidth ?? MAX_LABEL_WIDTH) ? { maxWidth: wrappedTo } : {}),
      },
    });
  }

  return placed;
}
