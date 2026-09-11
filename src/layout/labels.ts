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

export interface LabelRequest {
  id: string;
  anchor: Pt;
  side: Side;
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
            obstacles.push({ box: expandBox(bboxOfPts([p0, p1]), pad), solid: false, id: d.id });
          }
        }
      }
    }
    // areas are not obstacles: region labels belong inside their region
  }
  return obstacles;
}

const DIRS: Record<Side, [number, number]> = {
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

function wrapLines(text: string, fontSize: number, measure: MeasureFn): string[] {
  return wrapText(text, fontSize, MAX_LABEL_WIDTH, measure);
}

function candidateBox(anchor: Pt, side: Side, r: number, w: number, h: number): BBox {
  const [dx, dy] = DIRS[side];
  const cx = anchor[0] + dx * (r + (dx !== 0 ? w / 2 : 0));
  const cy = anchor[1] + dy * (r + (dy !== 0 ? h / 2 : 0));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
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
    const lines = wrapLines(req.text, req.fontSize, measure);
    const w = Math.max(...lines.map((line) => measure(line, req.fontSize).w));
    const h = lines.length * req.fontSize * LINE_HEIGHT;
    const ignored = req.ignore && req.ignore.length > 0 ? new Set(req.ignore) : null;
    const inPlay = ignored ? blocked.filter((o) => o.id === undefined || !ignored.has(o.id)) : blocked;
    const sides: Side[] = [req.side, ...FALLBACK_ORDER.filter((s) => s !== req.side)];
    const r0 = 10 + req.fontSize * 0.55;
    const rings = [1, 2.2, 3.6, 6, 9, 13].map((k) => r0 * k);

    // Pinned: the boundary already chose, and this frame only follows the
    // anchor. No search at all — re-running it is the whole defect.
    const pin = pins?.[req.id];

    let chosen: { box: BBox; ringIndex: number } | null = null;
    let softNear: { box: BBox; ringIndex: number; penalty: number } | null = null;
    if (!pin) {
      outer: for (const [ringIndex, r] of rings.entries()) {
        for (const side of sides) {
          const box = clampToCanvas(candidateBox(req.anchor, side, r, w, h));
          if (inPlay.some((o) => o.solid && boxesOverlap(box, o.box, 3))) continue; // text-text: never
          const penalty = inPlay.reduce((sum, o) => (o.solid ? sum : sum + overlapArea(box, o.box)), 0);
          if (penalty === 0) {
            chosen = { box, ringIndex };
            break outer;
          }
          if (ringIndex < NEAR_RINGS && (softNear === null || penalty < softNear.penalty)) {
            softNear = { box, ringIndex, penalty };
          }
        }
        // No clean spot near the anchor: grazing a stroke here beats being
        // exiled to a distant clean spot with a leader line.
        if (ringIndex === NEAR_RINGS - 1 && softNear) {
          chosen = softNear;
          break;
        }
      }
    }

    // Nothing fits anywhere: keep the preferred spot and let lint report it.
    const finalBox = pin
      ? clampToCanvas({ x: req.anchor[0] + pin.d[0] - w / 2, y: req.anchor[1] + pin.d[1] - h / 2, w, h })
      : (chosen?.box ?? clampToCanvas(candidateBox(req.anchor, req.side, rings[0], w, h)));
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
    const wantsLeader = pin ? pin.leader : !!chosen && chosen.ringIndex >= 2;
    if (wantsLeader) {
      // Displaced far: draw a thin leader from the anchor toward the label edge.
      const cx = finalBox.x + finalBox.w / 2;
      const cy = finalBox.y + finalBox.h / 2;
      const towardAnchor: Pt = [
        cx + (req.anchor[0] < cx ? -finalBox.w / 2 - 2 : finalBox.w / 2 + 2),
        cy,
      ];
      leader = {
        id: `${req.id}_leader`,
        kind: "stroke",
        pts: [req.anchor, towardAnchor],
        z: Z_STROKE,
        style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.8 }),
        drawOpts: defaultDrawOpts("instant"),
      };
    }

    placed.push({
      text,
      leader,
      pin: { d: [text.pos[0] - req.anchor[0], text.pos[1] - req.anchor[1]], leader: wantsLeader },
    });
  }

  return placed;
}
