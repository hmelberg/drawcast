// Tier-2/3 layout: turns semantic elements into Drawables. The LLM never
// places anything here except tier-3 escape-hatch coordinates.

import { CANVAS, linearScale, plotArea } from "./canvas";
import { makeAxes } from "./axes";
import { interpolateAtX, intersectPolylines, qualitativeShape, sampleExpression } from "./curves";
import { centroid, type BBox } from "./geometry";
import { heuristicMeasure } from "./measure";
import * as M from "./measures";
import { codeDrawables, type CodeWindow } from "./code";
import { boxAnchor, isUniversalAnchor, polygonAnchors, polylineAnchors, ptsBox, sectorAnchors } from "./anchors";
import {
  COLORS,
  LINE_HEIGHT,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultStyle,
  drawablesForId,
  leafDrawables,
  type AreaDrawable,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import { decodePhoto, decodeSourceImage, decodeTrace } from "../spec/trace";
import { wrapText, type LabelRequest } from "./labels";
import { linkKindOf } from "../ui/link-model";
import type { EndRef, PointRef, SpecElement } from "../spec/types";

/**
 * One piece's geometry (currently only `pieces: {of: "sectors"}`), keyed by
 * the piece's own id (`<parentId>_<k>`) — what the `move` (rotate) and
 * `arrange` verbs need: the pivot to turn about (apex), where the piece's
 * own mass sits (centroid), and the wedge it occupies (midAngle/halfAngle).
 */
export interface PieceGeometry {
  apex: Pt;
  centroid: Pt;
  midAngle: number;
  halfAngle: number;
  radius: number;
}

export interface Tier2Result {
  drawables: Drawable[];
  labels: LabelRequest[];
  /** Logical anchor point per element id (for labels, arrows, and commands). */
  anchors: Record<string, Pt>;
  /** Geometric anchors per element id (design §2.1): polygon vertex_k/side_k/centroid, sector apex/arc/start/end, arrow tail/tip/mid, path start/end/mid/point_k. */
  namedAnchors: Record<string, Record<string, Pt>>;
  /**
   * Command-addressable ids tier-2 minted that are NOT spec element ids — a
   * source element's quote highlights (`<id>_quote`, `<id>_quote_2`, …), which
   * the storyboard times to the narration beat on their own line, and a
   * `pieces` element's `<id>_1` … `<id>_n` sectors.
   */
  extraOrder: string[];
  warnings: string[];
  /** Windowed code panes (el.lines), keyed by element id — the plan scrolls them. */
  windows: Record<string, CodeWindow>;
  /** Each drawn code pane's text rectangle, keyed by element id — where the
   *  in-place editor lays itself down. */
  panes: Record<string, BBox>;
  /** Per-piece geometry (see PieceGeometry), keyed by the piece's own id. */
  pieces: Record<string, PieceGeometry>;
  /** parent `pieces` element id → its child piece ids, in order. */
  pieceGroups: Record<string, string[]>;
  /** `measure` element specs (design §2.3), keyed by the measure's own element id. */
  measures: Record<string, M.MeasureSpec>;
}

interface Ctx {
  sx: (v: number) => number;
  sy: (v: number) => number;
  domainX: [number, number];
  domainY: [number, number];
  domainDeclared: boolean;
  /** curve samples in domain coordinates, for intersections/regions */
  curveSamples: Map<string, Pt[]>;
  nodeRadius: Map<string, number>;
  anchors: Record<string, Pt>;
  namedAnchors: Record<string, Record<string, Pt>>;
  /** The drawables laid out so far — an arrow endpoint's `anchor` reads a box off them. */
  drawablesSoFar: Drawable[];
  extraOrder: string[];
  warnings: string[];
  windows: Record<string, CodeWindow>;
  panes: Record<string, BBox>;
  pieces: Record<string, PieceGeometry>;
  pieceGroups: Record<string, string[]>;
  measures: Record<string, M.MeasureSpec>;
}

export function layoutElements(
  elements: SpecElement[],
  domain: { x?: [number, number]; y?: [number, number] } | undefined,
  seedAnchors: Record<string, Pt> = {},
  /** Scene curves (in the spec's domain space): valid region/intersection references. */
  seedCurveSamples: Record<string, Pt[]> = {},
): Tier2Result {
  const plot = plotArea();
  const domainX: [number, number] = domain?.x ?? [0, 100];
  const domainY: [number, number] = domain?.y ?? [0, 100];
  const ctx: Ctx = {
    sx: linearScale(domainX, [plot.x0, plot.x1]),
    sy: linearScale(domainY, [plot.y0, plot.y1]),
    domainX,
    domainY,
    domainDeclared: domain !== undefined,
    curveSamples: new Map(Object.entries(seedCurveSamples)),
    nodeRadius: new Map(),
    anchors: { ...seedAnchors },
    namedAnchors: {},
    drawablesSoFar: [],
    extraOrder: [],
    windows: {},
    panes: {},
    warnings: [],
    pieces: {},
    pieceGroups: {},
    measures: {},
  };

  // Pass 1: position free nodes deterministically on a circle.
  const freeNodes = elements.filter((e) => e.type === "node" && e.x === undefined);
  const center: Pt = [CANVAS.w / 2, CANVAS.h / 2 + 10];
  const ringRadius = Math.min(CANVAS.w, CANVAS.h) * 0.32;
  freeNodes.forEach((node, i) => {
    if (freeNodes.length === 1) {
      ctx.anchors[node.id] = center;
      return;
    }
    const angle = Math.PI / 2 - (2 * Math.PI * i) / freeNodes.length;
    ctx.anchors[node.id] = [center[0] + ringRadius * Math.cos(angle), center[1] + ringRadius * Math.sin(angle)];
  });
  for (const node of elements.filter((e) => e.type === "node" && e.x !== undefined)) {
    ctx.anchors[node.id] = [node.x!, node.y ?? CANVAS.h / 2];
  }

  // Pass 2: sample curves (needed before points/regions regardless of order).
  for (const el of elements.filter((e) => e.type === "curve")) {
    try {
      ctx.curveSamples.set(el.id, sampleCurveDomain(el, ctx));
    } catch (err) {
      ctx.warnings.push(`curve "${el.id}": ${(err as Error).message} — using a straight line`);
      ctx.curveSamples.set(el.id, sampleCurveDomain({ ...el, expr: undefined, direction: el.direction ?? "decreasing" }, ctx));
    }
  }

  // Pass 3: emit drawables in element order.
  const drawables: Drawable[] = [];
  ctx.drawablesSoFar = drawables;
  const labels: LabelRequest[] = [];
  for (const el of elements) {
    switch (el.type) {
      case "axes":
        drawables.push(makeAxes(el.id, plot, el.x_label, el.y_label));
        ctx.anchors[el.id] = [plot.x1 - 60, plot.y0 + 40];
        break;
      case "curve":
        drawables.push(curveDrawable(el, ctx));
        break;
      case "point":
        drawables.push(...pointDrawables(el, ctx, plot));
        break;
      case "region":
        drawables.push(...regionDrawable(el, ctx));
        break;
      case "node":
        drawables.push(...nodeDrawables(el, ctx));
        break;
      case "arrow":
      case "edge":
        drawables.push(...connectorDrawable(el, ctx));
        break;
      case "label": {
        const anchor = ctx.anchors[el.attach_to ?? ""];
        if (!anchor) {
          ctx.warnings.push(`label "${el.id}": unknown attach_to "${el.attach_to}" — placing at canvas center`);
        }
        labels.push({
          id: el.id,
          anchor: anchor ?? [CANVAS.w / 2, CANVAS.h / 2],
          side: el.side ?? "above-right",
          text: el.text ?? el.id,
          fontSize: el.font_size ?? 28,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
        break;
      }
      case "path": {
        const pts = (el.points ?? []) as Pt[];
        drawables.push({
          id: el.id,
          kind: "stroke",
          pts,
          closed: el.closed,
          z: Z_STROKE,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw),
        });
        ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)] ?? [CANVAS.w / 2, CANVAS.h / 2];
        ctx.namedAnchors[el.id] = polylineAnchors(pts, "path");
        break;
      }
      case "text": {
        const pos: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
        drawables.push({
          id: el.id,
          kind: "text",
          pos,
          text: el.text ?? "",
          fontSize: el.font_size ?? 28,
          anchor: "middle",
          z: Z_TEXT,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
        ctx.anchors[el.id] = pos;
        break;
      }
      case "shape":
        drawables.push(shapeDrawable(el, ctx));
        break;
      case "portrait":
        drawables.push(portraitDrawable(el, ctx));
        break;
      case "source":
        drawables.push(...sourceDrawables(el, ctx));
        break;
      case "code":
        drawables.push(...codeDrawables(el, ctx));
        break;
      case "sector":
        drawables.push(...sectorDrawables(el, ctx));
        break;
      case "arc":
        drawables.push(arcDrawable(el, ctx));
        break;
      case "polygon":
        drawables.push(...polygonDrawables(el, ctx));
        break;
      case "pieces":
        drawables.push(...piecesDrawables(el, ctx));
        break;
      case "angle":
        drawables.push(...angleDrawables(el, ctx));
        break;
      case "measure":
        drawables.push(...measureDrawables(el, ctx));
        break;
    }
  }

  return {
    drawables,
    labels,
    anchors: ctx.anchors,
    namedAnchors: ctx.namedAnchors,
    extraOrder: ctx.extraOrder,
    warnings: ctx.warnings,
    windows: ctx.windows,
    panes: ctx.panes,
    pieces: ctx.pieces,
    pieceGroups: ctx.pieceGroups,
    measures: ctx.measures,
  };
}

function sampleCurveDomain(el: SpecElement, ctx: Ctx): Pt[] {
  const [dx0, dx1] = ctx.domainX;
  const [dy0, dy1] = ctx.domainY;
  const x0 = el.x_from ?? dx0 + (dx1 - dx0) * 0.02;
  const x1 = el.x_to ?? dx1 - (dx1 - dx0) * 0.02;
  if (el.expr) {
    return sampleExpression(el.expr, x0, x1).map(([x, y]): Pt => [x, clamp(y, dy0, dy1)]);
  }
  const shape = qualitativeShape(el.direction ?? "decreasing", el.curvature ?? "linear", el.steepness ?? "medium");
  return shape.map(([tx, ty]): Pt => [x0 + (x1 - x0) * tx, dy0 + (dy1 - dy0) * ty]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function toLogical(pts: Pt[], ctx: Ctx): Pt[] {
  return pts.map(([x, y]): Pt => [ctx.sx(x), ctx.sy(y)]);
}

function curveDrawable(el: SpecElement, ctx: Ctx): StrokeDrawable {
  const domainPts = ctx.curveSamples.get(el.id)!;
  const pts = toLogical(domainPts, ctx);
  ctx.anchors[el.id] = pts[pts.length - 1];
  return {
    id: el.id,
    kind: "stroke",
    pts,
    z: Z_STROKE,
    style: resolveStyle(el.style, { strokeWidth: 4.5 }),
    drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.curve }),
  };
}

function resolvePointDomain(el: SpecElement, ctx: Ctx): Pt | null {
  const at = el.at;
  if (!at) return null;
  if (Array.isArray(at)) {
    ctx.warnings.push(`point "${el.id}": at must be an object ({x, y} or intersection_of), not an array`);
    return null;
  }
  if (at.intersection_of && at.intersection_of.length === 2) {
    const a = ctx.curveSamples.get(at.intersection_of[0]);
    const b = ctx.curveSamples.get(at.intersection_of[1]);
    if (!a || !b) {
      ctx.warnings.push(`point "${el.id}": intersection_of references unknown curves`);
      return null;
    }
    const hit = intersectPolylines(a, b);
    if (!hit) {
      ctx.warnings.push(`point "${el.id}": curves do not intersect in the domain`);
      return null;
    }
    return hit;
  }
  if (at.x !== undefined && at.y !== undefined) return [at.x, at.y];
  if (at.ref !== undefined || at.anchor !== undefined) {
    // Defensive: validateSpec already rejects this shape on a point (at is a
    // shared property — angle reuses it for a {ref, anchor} vertex), but a
    // spec built by hand and never validated must still fail loudly, not
    // silently resolve to nothing.
    ctx.warnings.push(`point "${el.id}": at must be {x, y} or {intersection_of} — {ref, anchor} is not valid on a point`);
    return null;
  }
  return null;
}

function pointDrawables(el: SpecElement, ctx: Ctx, plot: ReturnType<typeof plotArea>): Drawable[] {
  const domainPt = resolvePointDomain(el, ctx);
  if (!domainPt) return [];
  const p: Pt = [ctx.sx(domainPt[0]), ctx.sy(domainPt[1])];
  ctx.anchors[el.id] = p;
  const out: Drawable[] = [];
  if (el.guides) {
    out.push({
      id: `${el.id}_guides`,
      kind: "stroke",
      pts: [
        [plot.x0, p[1]],
        p,
        [p[0], plot.y0],
      ],
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.guide, strokeWidth: 2.5, dash: true, roughness: 0.9 }),
      drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides }),
    });
  }
  out.push({
    id: el.id,
    kind: "stroke",
    pts: [p],
    shapeHint: { type: "circle", c: p, r: 7 },
    z: Z_STROKE,
    style: resolveStyle(el.style, { strokeWidth: 3, fill: resolveStyle(el.style).color }),
    drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.dot }),
  });
  return out;
}

function regionDrawable(el: SpecElement, ctx: Ctx): Drawable[] {
  const [aId, bId] = el.between ?? [];
  const a = ctx.curveSamples.get(aId);
  const b = ctx.curveSamples.get(bId);
  if (!a || !b) {
    ctx.warnings.push(`region "${el.id}": between references unknown curves — skipped`);
    return [];
  }
  const x0 = el.x_from ?? Math.max(Math.min(...a.map((p) => p[0])), Math.min(...b.map((p) => p[0])));
  const x1 = el.x_to ?? Math.min(Math.max(...a.map((p) => p[0])), Math.max(...b.map((p) => p[0])));
  const N = 30;
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const ya = interpolateAtX(a, x);
    const yb = interpolateAtX(b, x);
    if (ya === null || yb === null) continue;
    upper.push([x, ya]);
    lower.push([x, yb]);
  }
  if (upper.length < 2) return [];
  const pts = toLogical([...upper, ...lower.reverse()], ctx);
  const style = resolveStyle(el.style, { color: COLORS.region1, fill: el.style?.fill ?? COLORS.region1, opacity: 0.5, strokeWidth: 1 });
  ctx.anchors[el.id] = centroid(pts);
  return [
    {
      id: el.id,
      kind: "area",
      pts,
      z: Z_AREA,
      style,
      drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.region }),
    },
  ];
}

const NODE_FONT = 24;

function nodeDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c = ctx.anchors[el.id] ?? [CANVAS.w / 2, CANVAS.h / 2];
  const shape = el.shape ?? "circle";
  const text = el.text;
  const style = resolveStyle(el.style, { strokeWidth: 3 });
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.node });
  const out: Drawable[] = [];
  const textW = text ? heuristicMeasure(text, NODE_FONT).w : 0;

  if (shape === "person") {
    const s = 34; // half-height
    const head: StrokeDrawable = {
      id: `${el.id}_head`,
      kind: "stroke",
      pts: [],
      shapeHint: { type: "circle", c: [c[0], c[1] + s * 0.6], r: s * 0.38 },
      z: Z_STROKE,
      style,
      drawOpts,
    };
    const body: StrokeDrawable = {
      id: `${el.id}_body`,
      kind: "stroke",
      pts: [
        [c[0] - s * 0.55, c[1] - s], // left leg
        [c[0], c[1] - s * 0.25],
        [c[0] + s * 0.55, c[1] - s], // right leg
        [c[0], c[1] - s * 0.25],
        [c[0], c[1] + s * 0.25], // torso
        [c[0] - s * 0.6, c[1] - s * 0.05], // left arm
        [c[0], c[1] + s * 0.25],
        [c[0] + s * 0.6, c[1] - s * 0.05], // right arm
      ],
      z: Z_STROKE,
      style,
      drawOpts,
    };
    const group: GroupDrawable = { id: el.id, kind: "group", children: [head, body], z: Z_STROKE, style, drawOpts };
    ctx.nodeRadius.set(el.id, s * 1.2);
    out.push(group);
  } else if (shape === "rect" || shape === "decision") {
    const w = shape === "decision" ? 56 : Math.max(130, textW + 36);
    const h = shape === "decision" ? 56 : 62;
    ctx.nodeRadius.set(el.id, Math.hypot(w, h) / 2);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: rectPts(c, w, h),
      closed: true,
      shapeHint: { type: "rect", x: c[0] - w / 2, y: c[1] - h / 2, w, h },
      z: Z_STROKE,
      style,
      drawOpts,
    });
  } else if (shape === "triangle" || shape === "terminal") {
    const s = 30;
    ctx.nodeRadius.set(el.id, s + 6);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: [
        [c[0] - s, c[1] + s * 0.85],
        [c[0] - s, c[1] - s * 0.85],
        [c[0] + s, c[1]],
      ],
      closed: true,
      z: Z_STROKE,
      style,
      drawOpts,
    });
  } else {
    // circle / chance
    const r = shape === "chance" ? 32 : Math.max(44, textW / 2 + 14);
    ctx.nodeRadius.set(el.id, r);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: [c],
      shapeHint: { type: "circle", c, r },
      z: Z_STROKE,
      style,
      drawOpts,
    });
  }

  if (text && shape !== "person" && shape !== "terminal" && shape !== "triangle") {
    out.push(nodeText(el.id, c, text, drawOpts));
  } else if (text) {
    // text below persons/triangles
    out.push(nodeText(el.id, [c[0], c[1] - (ctx.nodeRadius.get(el.id) ?? 40) - 20], text, drawOpts));
  }
  return out;
}

function nodeText(id: string, pos: Pt, text: string, drawOpts: ReturnType<typeof resolveDrawOpts>): TextDrawable {
  return {
    id: `${id}_text`,
    kind: "text",
    pos,
    text,
    fontSize: NODE_FONT,
    anchor: "middle",
    z: Z_TEXT,
    style: defaultStyle(),
    drawOpts: { mode: drawOpts.mode, duration: Math.min(SKETCH_MS.text, drawOpts.duration) },
  };
}

function rectPts(c: Pt, w: number, h: number): Pt[] {
  return [
    [c[0] - w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] + h / 2],
    [c[0] - w / 2, c[1] + h / 2],
  ];
}

/** A resolved endpoint, and whether it landed on an exact named/box anchor
 *  (as opposed to the element's plain center anchor) — connectorDrawable
 *  only backs off toward the target's edge in the latter case: a resolved
 *  anchor point is already exact, whether or not `.anchor` was VALID (an
 *  unrecognised anchor name still falls back to the plain anchor, and must
 *  still get the usual backoff, not land bare on the target). */
interface ResolvedEnd {
  pt: Pt;
  anchored: boolean;
}

function resolveEnd(end: { ref?: string; x?: number; y?: number; anchor?: string } | undefined, ctx: Ctx): ResolvedEnd | null {
  if (!end) return null;
  if (end.ref) {
    const a = ctx.anchors[end.ref];
    if (!a) {
      ctx.warnings.push(`arrow/edge endpoint references unknown id "${end.ref}"`);
      return null;
    }
    if (end.anchor === undefined) return { pt: a, anchored: false };
    const named = ctx.namedAnchors[end.ref]?.[end.anchor];
    if (named) return { pt: named, anchored: true };
    if (isUniversalAnchor(end.anchor)) {
      // Universal anchors come off the box of what the element drew so far
      // (points only — tier-2 has no text measurer).
      const pts: Pt[] = [];
      for (const d of leafDrawables(drawablesForId(ctx.drawablesSoFar, end.ref))) {
        if (d.kind === "stroke" && d.shapeHint?.type === "circle") {
          const { c, r } = d.shapeHint;
          pts.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
        } else if (d.kind === "stroke" && d.shapeHint?.type === "rect") {
          const h = d.shapeHint;
          pts.push([h.x, h.y], [h.x + h.w, h.y + h.h]);
        } else if (d.kind === "stroke" || d.kind === "area") {
          pts.push(...d.pts);
        }
      }
      const box = ptsBox(pts);
      if (box) return { pt: boxAnchor(box, end.anchor), anchored: true };
    }
    ctx.warnings.push(`arrow/edge endpoint: "${end.ref}" has no anchor "${end.anchor}" — using its plain anchor`);
    return { pt: a, anchored: false };
  }
  if (end.x !== undefined && end.y !== undefined) {
    return { pt: ctx.domainDeclared ? [ctx.sx(end.x), ctx.sy(end.y)] : [end.x, end.y], anchored: false };
  }
  return null;
}

/** A PointRef of a tier-2 element, in logical coordinates (arrays and {x, y} follow the arrow-endpoint rule: domain units when a domain is declared). */
function resolvePointRef(p: PointRef | undefined, ctx: Ctx): Pt | null {
  if (p === undefined) return null;
  if (Array.isArray(p)) return resolveEnd({ x: p[0], y: p[1] }, ctx)?.pt ?? null;
  return resolveEnd(p, ctx)?.pt ?? null;
}

function connectorDrawable(el: SpecElement, ctx: Ctx): Drawable[] {
  // arrow/edge always carries an EndRef object here — angle is the only
  // element type that can put a number or a bare [x, y] in from/to.
  const fromRef = el.from as { ref?: string; x?: number; y?: number; anchor?: string } | undefined;
  const toRef = el.to as { ref?: string; x?: number; y?: number; anchor?: string } | undefined;
  const fromEnd = resolveEnd(fromRef, ctx);
  const toEnd = resolveEnd(toRef, ctx);
  if (!fromEnd || !toEnd) return [];
  const from = fromEnd.pt;
  const to = toEnd.pt;
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const ux = (to[0] - from[0]) / dist;
  const uy = (to[1] - from[1]) / dist;
  // A bare ref, or one whose `.anchor` didn't actually resolve (unknown
  // name), backs off toward the target's edge (its node radius, or a guessed
  // bubble); a point that DID resolve through a named/box anchor is already
  // exact, so it lands there with no further shrink.
  const rFrom = fromRef?.ref && !fromEnd.anchored ? (ctx.nodeRadius.get(fromRef.ref) ?? 10) + 4 : 0;
  const rTo = toRef?.ref && !toEnd.anchored ? (ctx.nodeRadius.get(toRef.ref) ?? 10) + 4 : 0;
  const a: Pt = [from[0] + ux * rFrom, from[1] + uy * rFrom];
  const b: Pt = [to[0] - ux * rTo, to[1] - uy * rTo];
  let pts: Pt[];
  if (el.curved) {
    const mid: Pt = [(a[0] + b[0]) / 2 - uy * dist * 0.18, (a[1] + b[1]) / 2 + ux * dist * 0.18];
    pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0];
      const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1];
      pts.push([x, y]);
    }
  } else {
    pts = [a, b];
  }
  ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)];
  ctx.namedAnchors[el.id] = polylineAnchors(pts, "arrow");
  return [
    {
      id: el.id,
      kind: "stroke",
      pts,
      arrowhead: el.type === "arrow" ? "end" : undefined,
      z: Z_STROKE,
      style: resolveStyle(el.style, { strokeWidth: el.type === "arrow" ? 3.5 : 3 }),
      drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.connector }),
    },
  ];
}

function shapeDrawable(el: SpecElement, ctx: Ctx): StrokeDrawable {
  const style = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.node });
  const shape = el.shape ?? "rect";
  if (shape === "circle" || shape === "chance") {
    const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
    const r = el.radius ?? 40;
    ctx.anchors[el.id] = c;
    return { id: el.id, kind: "stroke", pts: [c], shapeHint: { type: "circle", c, r }, z: Z_STROKE, style, drawOpts };
  }
  // rect (x,y = lower-left corner in logical units)
  const x = el.x ?? 100;
  const y = el.y ?? 100;
  const w = el.width ?? 160;
  const h = el.height ?? 100;
  ctx.anchors[el.id] = [x + w / 2, y + h / 2];
  return {
    id: el.id,
    kind: "stroke",
    pts: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    closed: true,
    shapeHint: { type: "rect", x, y, w, h },
    z: Z_STROKE,
    style,
    drawOpts,
  };
}

/**
 * A portrait element: traced photo strokes (spec/trace.ts) drawn in the
 * house style, or — when the strokes are absent or unreadable (offline,
 * cache-cold, corrupted) — a sketched placeholder frame with the person's
 * initials, so a missing image degrades instead of breaking. Position and
 * width are LOGICAL units, like text/shape.
 */
function portraitDrawable(el: SpecElement, ctx: Ctx): GroupDrawable {
  // Cameo presentation: centered, larger, frameless, fast fade — built for
  // appear-at-first-mention-then-erase. Fixture: small, framed, cornered.
  const cameo = el.cameo === true;
  const w = el.width ?? (cameo ? 280 : 170);
  const cx = el.x ?? (cameo ? 500 : 170);
  const cy = el.y ?? (cameo ? 420 : 550);
  const photo = el.strokes ? decodePhoto(el.strokes) : null;
  const trace = !photo && el.strokes ? decodeTrace(el.strokes) : null;
  const children: Drawable[] = [];
  if (photo) {
    // The faithful look: a small styled grayscale photo, framed so it sits
    // in the sketchbook like something taped in.
    const h = w * photo.aspect;
    children.push({
      id: `${el.id}__img`,
      kind: "image",
      href: photo.href,
      pos: [cx, cy],
      w,
      h,
      z: Z_STROKE,
      style: resolveStyle(undefined, {}),
      // wipe by default for portraits (the face emerges like a print; erase
      // plays it backwards). Non-portrait images keep the plain fade — the
      // backend default when reveal is absent.
      reveal: el.reveal ?? "wipe",
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: cameo ? 650 : 900 }),
    });
    // The name rides with the photo: a centered caption below it (above when
    // the photo sits too low), part of the SAME element so it appears and
    // erases with the portrait — no separate label element needed.
    const name = (el.of ?? "").trim();
    if (name) {
      const fontSize = cameo ? 30 : 20;
      const frameEdge = cameo ? 0 : 5;
      const gap = frameEdge + (cameo ? 16 : 14) + fontSize / 2;
      const below = cy - h / 2 - gap;
      children.push({
        id: `${el.id}__name`,
        kind: "text",
        pos: [cx, below - fontSize / 2 < 6 ? cy + h / 2 + gap : below],
        text: name,
        fontSize,
        anchor: "middle",
        z: Z_TEXT,
        style: resolveStyle(el.style, {}),
        drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 240 }),
      });
    }
    if (!cameo) {
      children.push({
        id: `${el.id}__frame`,
        kind: "stroke",
        pts: [
          [cx - w / 2 - 5, cy - h / 2 - 5],
          [cx + w / 2 + 5, cy - h / 2 - 5],
          [cx + w / 2 + 5, cy + h / 2 + 5],
          [cx - w / 2 - 5, cy + h / 2 + 5],
        ],
        closed: true,
        z: Z_STROKE,
        style: resolveStyle(el.style, { strokeWidth: 3 }),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
      });
    }
  } else if (trace && trace.shapes.length > 0) {
    const h = w * trace.aspect;
    const map = ([nx, ny]: [number, number]): Pt => [cx - w / 2 + nx * w, cy - h / 2 + ny * w];
    // Paint order carries the poster logic: washes under, ink fills over,
    // paper holes (eyes, highlights) last, line strokes on top of all.
    const ORDER: Record<string, number> = { wash: 0, fill: 1, paper: 2, dot: 3, line: 4 };
    const shapes = trace.shapes.map((shape, i) => ({ shape, i })).sort((a, b) => (ORDER[a.shape.kind] ?? 3) - (ORDER[b.shape.kind] ?? 3) || a.i - b.i);
    const msPer = Math.max(25, Math.min(160, 3200 / shapes.length));
    for (const { shape, i } of shapes) {
      const pts = shape.pts.map(map);
      if (shape.kind === "dot") {
        // Two points: the center and a radius carrier at [cx + r, cy].
        const [c, rc] = pts;
        if (!c || !rc) continue;
        const r = Math.max(0.4, Math.abs(rc[0] - c[0]));
        children.push({
          id: `${el.id}__d${i}`,
          kind: "stroke",
          pts: [c],
          shapeHint: { type: "circle", c, r },
          z: Z_STROKE,
          style: resolveStyle(undefined, { color: COLORS.ink, fill: COLORS.ink, strokeWidth: 0.4 }),
          drawOpts: resolveDrawOpts(el.draw, { mode: "instant", duration: 0 }),
        });
        continue;
      }
      if (shape.kind === "line") {
        children.push({
          id: `${el.id}__s${i}`,
          kind: "stroke",
          pts,
          z: Z_STROKE,
          style: resolveStyle(el.style, { strokeWidth: 2.2 }),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: msPer }),
        });
        continue;
      }
      if (shape.kind === "wash") {
        // The house region wash: soft, hand-shaded at region opacity.
        children.push({
          id: `${el.id}__w${i}`,
          kind: "area",
          pts,
          z: Z_AREA,
          style: resolveStyle(undefined, { fill: COLORS.ink, opacity: 0.3, strokeWidth: 0 }),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: msPer }),
        });
        continue;
      }
      // fill / paper: the chess-piece idiom — exact solid shape + its outline.
      const paper = shape.kind === "paper";
      children.push({
        id: `${el.id}__f${i}`,
        kind: "area",
        pts,
        precise: true,
        z: Z_STROKE,
        style: resolveStyle(undefined, { fill: paper ? COLORS.paper : COLORS.ink, opacity: 1, strokeWidth: 0 }),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: msPer }),
      });
      if (!paper) {
        children.push({
          id: `${el.id}__o${i}`,
          kind: "stroke",
          pts,
          closed: true,
          z: Z_STROKE,
          style: resolveStyle(el.style, { strokeWidth: 2 }),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: msPer }),
        });
      }
    }
  } else if (cameo) {
    // A missing cameo leaves NOTHING behind — a centered placeholder frame
    // would sit on top of the very figure the cameo was meant to visit
    // (and its texts would fight the figure's in the static lint).
  } else {
    const h = w * 1.25;
    const initials = (el.of ?? "?")
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 3);
    children.push({
      id: `${el.id}__frame`,
      kind: "stroke",
      pts: [
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
      ],
      closed: true,
      z: Z_STROKE,
      style: resolveStyle(el.style, { color: COLORS.guide, strokeWidth: 3 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
    });
    children.push({
      id: `${el.id}__initials`,
      kind: "text",
      pos: [cx, cy],
      text: initials || "?",
      fontSize: Math.max(24, Math.round(w / 4)),
      anchor: "middle",
      z: Z_TEXT,
      style: resolveStyle(el.style, { color: COLORS.guide }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
  }
  ctx.anchors[el.id] = [cx, cy];
  return {
    id: el.id,
    kind: "group",
    z: Z_STROKE,
    style: defaultStyle(),
    drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }),
    children,
  };
}

/**
 * A source element: a book cover, a paper's title page, one page of either,
 * or a video's still — the same framed, paper-tinted photo family as a
 * portrait, at a size meant to be READ rather than recognized. Its title rides with it as a
 * caption (like a portrait's name), so no separate label element is ever
 * needed, and an unresolved reference degrades to a ruled placeholder page
 * instead of breaking.
 *
 * A `quote` resolves to highlight rectangles which are emitted as SEPARATE
 * top-level drawables (`<id>_quote`, `<id>_quote_2`, …) rather than children:
 * the marker sweep is its own beat, timed to the narration, targetable by
 * annotations, and played backwards by erase like any other ink.
 */
function sourceDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  // Pages need more width than covers: the size need is driven by the text.
  // A video still is wider still — 16:9 at 200 across is only 113 tall.
  const video = typeof el.url === "string" && linkKindOf(el.url).kind === "youtube";
  const page = el.page !== undefined || el.quote !== undefined;
  const w = el.width ?? (video ? 300 : page ? 260 : 200);
  const cx = el.x ?? 820;
  const cy = el.y ?? 480;
  const decoded = el.strokes ? decodeSourceImage(el.strokes) : null;
  const aspect = decoded?.aspect ?? (video ? 9 / 16 : 1.4);
  const h = w * aspect;
  const children: Drawable[] = [];

  if (decoded) {
    children.push({
      id: `${el.id}__img`,
      kind: "image",
      href: decoded.href,
      pos: [cx, cy],
      w,
      h,
      z: Z_STROKE,
      style: resolveStyle(undefined, {}),
      // Same entrance vocabulary as a portrait photo; wipe (a page sliding
      // out of the machine) is the default here too.
      reveal: el.reveal ?? "wipe",
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 900 }),
    });
  } else if (video) {
    // Unresolved video: the frame alone carries it — the play mark below
    // already says what this is, and ruled lines would say "page".
  } else {
    // Unresolved (bad reference, offline, CORS): a sketched page, ruled.
    const inset = w * 0.16;
    for (let i = 0; i < 4; i++) {
      const ly = cy + h / 2 - h * (0.22 + i * 0.16);
      children.push({
        id: `${el.id}__rule${i}`,
        kind: "stroke",
        pts: [
          [cx - w / 2 + inset, ly],
          [cx + w / 2 - inset * (i === 3 ? 2.2 : 1), ly],
        ],
        z: Z_STROKE,
        style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2.5 }),
        drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
      });
    }
  }

  children.push({
    id: `${el.id}__frame`,
    kind: "stroke",
    pts: [
      [cx - w / 2 - 5, cy - h / 2 - 5],
      [cx + w / 2 + 5, cy - h / 2 - 5],
      [cx + w / 2 + 5, cy + h / 2 + 5],
      [cx - w / 2 - 5, cy + h / 2 + 5],
    ],
    closed: true,
    z: Z_STROKE,
    style: resolveStyle(el.style, { color: decoded ? undefined : COLORS.guide, strokeWidth: 3 }),
    drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
  });

  if (video) {
    // The play mark is drawn in INK, over the still — never baked into the
    // pixels — so it arrives with the frame, erases with it, and says "this
    // is a video, click it" without a word of caption spent on saying so.
    const r = Math.max(16, w * 0.1);
    children.push({
      id: `${el.id}__play`,
      kind: "stroke",
      pts: [[cx, cy]],
      shapeHint: { type: "circle", c: [cx, cy], r },
      z: Z_STROKE,
      style: resolveStyle(el.style, { strokeWidth: 3 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 420 }),
    });
    children.push({
      id: `${el.id}__playtri`,
      kind: "area",
      pts: [
        [cx - r * 0.3, cy + r * 0.45],
        [cx + r * 0.55, cy],
        [cx - r * 0.3, cy - r * 0.45],
      ],
      precise: true,
      z: Z_STROKE,
      style: resolveStyle(undefined, { fill: COLORS.ink, opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 260 }),
    });
  }

  // The title rides with the picture — the portrait caption mechanism, so the
  // model must never add a label element of its own for it. A work's title is
  // a sentence where a person's name is two words, so it WRAPS to the picture's
  // own width (three lines, then an ellipsis) instead of running off the page.
  const title = (el.of ?? "").trim();
  if (title) {
    const fontSize = 20;
    let lines = wrapText(title, fontSize, w + 30, heuristicMeasure);
    if (lines.length > 3) lines = [...lines.slice(0, 2), `${lines[2]}…`];
    const blockH = lines.length * fontSize * LINE_HEIGHT;
    const gap = 5 + 12 + blockH / 2;
    const below = cy - h / 2 - gap;
    children.push({
      id: `${el.id}__name`,
      kind: "text",
      pos: [cx, below - blockH / 2 < 6 ? cy + h / 2 + gap : below],
      text: lines.join(" "),
      lines: lines.length > 1 ? lines : undefined,
      fontSize,
      anchor: "middle",
      z: Z_TEXT,
      style: resolveStyle(el.style, {}),
      drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 240 }),
    });
  }

  ctx.anchors[el.id] = [cx, cy];
  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children },
  ];

  // A declared quote PROMISES the id `<id>_quote`, and the storyboard draws it
  // on its own beat — so the id has to exist even when the reference has not
  // resolved (offline, cache-cold, a quote the page turned out not to carry).
  // An empty stroke keeps the beat and its narration and draws nothing, the
  // way an unresolved cameo stays addressable while showing no face.
  if (el.quote !== undefined && (decoded?.rects.length ?? 0) === 0) {
    const id = `${el.id}_quote`;
    ctx.extraOrder.push(id);
    ctx.anchors[id] = [cx, cy];
    out.push({
      id,
      kind: "stroke",
      pts: [],
      z: Z_STROKE,
      style: resolveStyle(el.style, { color: COLORS.region1, opacity: 0.42 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 600 }),
    });
    return out;
  }

  // Highlighter sweeps: one thick horizontal stroke per matched line, so the
  // dash-offset reveal IS the marker travelling left to right.
  (decoded?.rects ?? []).forEach(([nx, ny, nw, nh], i) => {
    const x = cx - w / 2 + nx * w;
    const y = cy - h / 2 + ny * w;
    const ww = nw * w;
    const hh = nh * w;
    if (ww <= 0 || hh <= 0) return;
    const id = i === 0 ? `${el.id}_quote` : `${el.id}_quote_${i + 1}`;
    ctx.extraOrder.push(id);
    ctx.anchors[id] = [x + ww / 2, y + hh / 2];
    out.push({
      id,
      kind: "stroke",
      pts: [
        [x, y + hh / 2],
        [x + ww, y + hh / 2],
      ],
      z: Z_STROKE,
      style: resolveStyle(el.style, { color: COLORS.region1, strokeWidth: hh, opacity: 0.42, roughness: 0.6 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: Math.max(320, Math.min(1500, ww * 7)) }),
    });
  });
  return out;
}

// --- sector / arc / polygon / pieces (design §2.2) ---------------------

const DEG = Math.PI / 180;
/** Ceiling on the cells one `pieces` element may cut a rectangle into. */
const MAX_PIECE_CELLS = 256;

/** A closed fan: the centre, then the arc boundary — a sector's outline. */
function sectorPts(c: Pt, r: number, from: number, to: number, steps = 24): Pt[] {
  const pts: Pt[] = [c];
  for (let i = 0; i <= steps; i++) {
    const a = (from + ((to - from) * i) / steps) * DEG;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/** The arc boundary alone, no centre point — an arc has no interior to close. */
function arcPts(c: Pt, r: number, from: number, to: number, steps = 32): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (from + ((to - from) * i) / steps) * DEG;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * A closed outline with a wash, the pair every filled primitive is made of —
 * mirrors shapeDrawable/regionDrawable's ids (outline = the element id, wash
 * = `${id}_wash`, found via SUB_SUFFIXES) and regionDrawable's opacity
 * convention (a style.opacity the author set always wins; otherwise the wash
 * defaults dimmer than the outline, which stays fully opaque). NOT `_fill`:
 * that suffix is already a public, independently addressable sub-id across
 * the shipped scene packs (e.g. `nucleus`/`nucleus_fill`), so reusing it here
 * would double-paint their washes and let highlight/dim/erase leak onto them.
 */
function filledOutline(id: string, pts: Pt[], el: SpecElement): Drawable[] {
  const outlineStyle = resolveStyle(el.style);
  const out: Drawable[] = [];
  if (outlineStyle.fill) {
    out.push({
      id: `${id}_wash`,
      kind: "area",
      pts,
      z: Z_AREA,
      style: resolveStyle(el.style, { opacity: 0.35 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.region }),
    });
  }
  out.push({
    id,
    kind: "stroke",
    pts,
    closed: true,
    z: Z_STROKE,
    style: outlineStyle,
    drawOpts: resolveDrawOpts(el.draw),
  });
  return out;
}

function sectorDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const r = el.radius ?? 100;
  const from = el.start ?? 0;
  const to = el.end ?? 90;
  const pts = sectorPts(c, r, from, to);
  const mid = (from + to) / 2;
  const centroid: Pt = [c[0] + r * 0.6 * Math.cos(mid * DEG), c[1] + r * 0.6 * Math.sin(mid * DEG)];
  ctx.anchors[el.id] = centroid;
  ctx.namedAnchors[el.id] = sectorAnchors(c, r, from, to);
  // A standalone sector is a piece too: arrange's zipper and fan read its
  // apex and angles here, exactly as they read a `pieces` child's.
  // |end − start|: a sector written the other way round (start 90, end 30)
  // draws fine, and its half-span must stay positive for zipper and fan.
  ctx.pieces[el.id] = { apex: c, centroid, midAngle: mid, halfAngle: Math.abs(to - from) / 2, radius: r };
  return filledOutline(el.id, pts, el);
}

function arcDrawable(el: SpecElement, ctx: Ctx): Drawable {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  const r = el.radius ?? 100;
  const from = el.start ?? 0;
  const to = el.end ?? 180;
  const pts = arcPts(c, r, from, to);
  ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)];
  ctx.namedAnchors[el.id] = polylineAnchors(pts, "arc");
  return { id: el.id, kind: "stroke", pts, z: Z_STROKE, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw) };
}

/**
 * `angle` (design §2.2): the angle between two arms at a vertex — `at`
 * (a PointRef), `from`/`to` (a PointRef, resolved like an arrow endpoint, or
 * a bare direction in degrees), swept counter-clockwise from `from` to `to`
 * in (0, 360]. Drawables `<id>` (the arc, or the right-angle square when
 * `right` is true, or the angle is within 0.5° of 90 and `right` is not
 * false) and `<id>_text` (the label, default the rounded degrees). Anchors
 * `vertex`, `arc` (the bisector point on the arc). Static at layout.
 */
function angleDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const at = resolvePointRef(el.at as PointRef, ctx);
  if (!at) {
    ctx.warnings.push(`angle "${el.id}": its vertex does not resolve`);
    return [];
  }
  const dirOf = (arm: unknown): number | null => {
    if (typeof arm === "number") return arm;
    const p = resolvePointRef(arm as PointRef, ctx);
    if (!p) return null;
    // A resolved arm that lands exactly on the vertex has no direction —
    // atan2(0, 0) reads as a silent 0° rather than the degenerate angle it is.
    if (Math.hypot(p[0] - at[0], p[1] - at[1]) < 1e-9) return NaN;
    return (Math.atan2(p[1] - at[1], p[0] - at[0]) * 180) / Math.PI;
  };
  const a0 = dirOf(el.from);
  const a1 = dirOf(el.to);
  if (a0 === null || a1 === null) {
    ctx.warnings.push(`angle "${el.id}": an arm does not resolve`);
    return [];
  }
  if (Number.isNaN(a0) || Number.isNaN(a1)) {
    ctx.warnings.push(`angle "${el.id}": an arm coincides with the vertex`);
    return [];
  }
  let sweep = (((a1 - a0) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const r = el.radius ?? 40;
  const style = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides });
  const right = el.right === true || (el.right !== false && Math.abs(sweep - 90) <= 0.5);
  let pts: Pt[];
  if (right) {
    const s = r * 0.6;
    const d0: Pt = [at[0] + s * Math.cos(a0 * DEG), at[1] + s * Math.sin(a0 * DEG)];
    const d1: Pt = [at[0] + s * Math.cos((a0 + sweep) * DEG), at[1] + s * Math.sin((a0 + sweep) * DEG)];
    pts = [d0, [d0[0] + d1[0] - at[0], d0[1] + d1[1] - at[1]], d1];
  } else {
    pts = arcPts(at, r, a0, a0 + sweep, Math.max(12, Math.round(sweep / 6)));
  }
  const bis = (a0 + sweep / 2) * DEG;
  const arcPt: Pt = [at[0] + r * Math.cos(bis), at[1] + r * Math.sin(bis)];
  const out: Drawable[] = [{ id: el.id, kind: "stroke", pts, z: Z_STROKE, style, drawOpts }];
  const labelText = el.label === false ? null : typeof el.label === "string" ? el.label : `${Math.round(sweep)}°`;
  if (labelText !== null) {
    const pos: Pt = [at[0] + (r + 22) * Math.cos(bis), at[1] + (r + 22) * Math.sin(bis)];
    out.push({ id: `${el.id}_text`, kind: "text", pos, text: labelText, fontSize: 22, anchor: "middle", z: Z_TEXT, style, drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }) });
  }
  ctx.anchors[el.id] = arcPt;
  ctx.namedAnchors[el.id] = { vertex: at, arc: arcPt };
  return out;
}

/** The primary ring of an element laid out so far: its first closed leaf (area or closed stroke), else its first stroke's points. */
function primaryRingSoFar(ctx: Ctx, id: string): { pts: Pt[]; closed: boolean } | null {
  const leaves = leafDrawables(drawablesForId(ctx.drawablesSoFar, id)).filter((d): d is StrokeDrawable | AreaDrawable => d.kind === "stroke" || d.kind === "area");
  const closed = leaves.find((d) => d.kind === "area" || (d.kind === "stroke" && d.closed && !d.shapeHint));
  if (closed) return { pts: closed.pts, closed: true };
  const open = leaves.find((d) => d.kind === "stroke" && !d.shapeHint && d.pts.length >= 2);
  return open ? { pts: open.pts, closed: false } : null;
}

/**
 * `measure` (design §2.3): the length/width/height of an element or the
 * span between two points, or the area/perimeter of a closed outline — a
 * dimension line with end ticks (`<id>`, `<id>_guides`, `<id>_dot`) plus a
 * separate text element `label_<id>` that never rotates. `of` reads the
 * element's own box/ring; `from`/`to` measures a segment between two
 * resolved points instead. The dimension line sits `offset` (default 24)
 * to the `side` away from the measured element's centroid, unless `side`
 * is given explicitly.
 */
function measureDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const format: M.MeasureFormat = { label: typeof el.label === "string" ? el.label : "{value}", unit: el.unit, scale: el.scale ?? 1, decimals: el.decimals };
  const textId = `label_${el.id}`;
  const style = resolveStyle(el.style, { strokeWidth: 2 });
  const drawOpts = resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides });
  let a: Pt | null = null, b: Pt | null = null;
  let ring: Pt[] | null = null;
  let what: M.MeasureWhat;
  let fromSrc: M.PointSource | undefined, toSrc: M.PointSource | undefined;
  let awayFrom: Pt | null = null;
  const src = (p: PointRef | undefined): M.PointSource | undefined => (p === undefined ? undefined : !Array.isArray(p) && p.ref ? { ref: p.ref, anchor: p.anchor ?? "center" } : (() => { const pt = resolvePointRef(p, ctx); return pt ? { pt } : undefined; })());
  if (el.from !== undefined && el.to !== undefined) {
    a = resolvePointRef(el.from as PointRef, ctx);
    b = resolvePointRef(el.to as PointRef, ctx);
    fromSrc = src(el.from as PointRef);
    toSrc = src(el.to as PointRef);
    what = (el.what as M.MeasureWhat | undefined) ?? "length";
    const refId = !Array.isArray(el.from) && (el.from as EndRef).ref;
    if (refId) { const r = primaryRingSoFar(ctx, refId); if (r) awayFrom = M.ringCentroid(r.pts); }
  } else if (el.of !== undefined) {
    const r = primaryRingSoFar(ctx, el.of);
    if (!r) { ctx.warnings.push(`measure "${el.id}": "${el.of}" has nothing to measure`); return []; }
    ring = r.pts;
    what = (el.what as M.MeasureWhat | undefined) ?? (r.closed ? "area" : "length");
    if (what === "length") { a = r.pts[0]; b = r.pts[r.pts.length - 1]; }
    if (what === "width") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const y = Math.min(...ys); a = [Math.min(...xs), y]; b = [Math.max(...xs), y]; }
    if (what === "height") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const x = Math.max(...xs); a = [x, Math.min(...ys)]; b = [x, Math.max(...ys)]; }
    awayFrom = M.ringCentroid(r.pts);
  } else {
    ctx.warnings.push(`measure "${el.id}": needs of, or from and to`);
    return [];
  }
  const value = M.measureValue(what, { a: a ?? undefined, b: b ?? undefined, ring: ring ?? undefined });
  if (value === null || (what !== "area" && what !== "perimeter" && (!a || !b))) { ctx.warnings.push(`measure "${el.id}": cannot resolve what to measure`); return []; }
  const out: Drawable[] = [];
  let textPos: Pt;
  let side: "left" | "right" = "left";
  if (a && b && what !== "area" && what !== "perimeter") {
    if (el.side === "right" || el.side === "left") side = el.side;
    else if (awayFrom) {
      const cross = (b[0] - a[0]) * (awayFrom[1] - a[1]) - (b[1] - a[1]) * (awayFrom[0] - a[0]);
      side = cross > 0 ? "right" : "left"; // the centroid is on the left → put the line on the right
    }
    const d = M.dimensionLine(a, b, el.offset ?? 24, side);
    out.push({ id: el.id, kind: "stroke", pts: d.line, z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_guides`, kind: "stroke", pts: d.ticks[0], z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_dot`, kind: "stroke", pts: d.ticks[1], z: Z_STROKE, style, drawOpts });
    textPos = d.textPos;
    ctx.anchors[el.id] = [(d.line[0][0] + d.line[1][0]) / 2, (d.line[0][1] + d.line[1][1]) / 2];
  } else {
    textPos = ring ? (what === "perimeter" ? [M.ringCentroid(ring)[0], Math.max(...ring.map((p) => p[1])) + 26] : M.ringCentroid(ring)) : [CANVAS.w / 2, CANVAS.h / 2];
    ctx.anchors[el.id] = textPos;
  }
  out.push({ id: textId, kind: "text", pos: textPos, text: M.formatMeasure(value, format), fontSize: 24, anchor: "middle", z: Z_TEXT, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }) });
  ctx.extraOrder.push(textId);
  ctx.anchors[textId] = textPos;
  ctx.measures[el.id] = { of: el.of, what, from: fromSrc, to: toSrc, side, offset: el.offset ?? 24, format, lineId: el.id, textId };
  return out;
}

function polygonDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  let pts: Pt[];
  if (el.points && el.points.length >= 3) {
    pts = el.points as Pt[];
  } else {
    const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
    const n = Math.max(3, Math.round(el.sides ?? 5));
    const r = el.radius ?? 100;
    const rot = (el.rotation ?? 0) * DEG;
    pts = Array.from({ length: n }, (_, i): Pt => {
      const a = rot + Math.PI / 2 + (2 * Math.PI * i) / n; // first vertex on top
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
    });
  }
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  ctx.anchors[el.id] = [cx, cy];
  ctx.namedAnchors[el.id] = polygonAnchors(pts);
  return filledOutline(el.id, pts, el);
}

/**
 * `pieces: {of: "sectors"}` cuts a circle into n equal sectors, each its own
 * command-addressable id `<id>_1` … `<id>_n` (pushed to extraOrder — the
 * parent id itself draws nothing and is skipped in layout.ts's order loop).
 * Each piece is a plain filledOutline pair (no group wrapper), so it is found
 * by drawablesForId/elementRings exactly like a standalone sector.
 */
function piecesDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
  if (el.of === "strips" || el.of === "grid") return rectPiecesDrawables(el, ctx, c);
  const r = el.radius ?? 120;
  const n = Math.max(2, Math.round(el.n ?? 8));
  const step = 360 / n;
  const out: Drawable[] = [];
  const ids: string[] = [];
  for (let k = 0; k < n; k++) {
    const id = `${el.id}_${k + 1}`;
    const from = k * step;
    const to = (k + 1) * step;
    const pts = sectorPts(c, r, from, to);
    const mid = (from + to) / 2;
    const centroid: Pt = [c[0] + r * 0.6 * Math.cos(mid * DEG), c[1] + r * 0.6 * Math.sin(mid * DEG)];
    out.push(...filledOutline(id, pts, el));
    ctx.anchors[id] = centroid;
    ctx.namedAnchors[id] = sectorAnchors(c, r, from, to);
    ctx.pieces[id] = { apex: c, centroid, midAngle: mid, halfAngle: step / 2, radius: r };
    ids.push(id);
    ctx.extraOrder.push(id);
  }
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}

/**
 * A width × height rectangle centred on `c`, cut into `n` vertical strips
 * (`of: "strips"`) or `n` columns × `rows` rows (`of: "grid"`), numbered row
 * by row from the top left. Each cell is a closed outline with a wash and
 * its own id, like a sector piece; it carries no sector geometry, so the
 * zipper and fan treat it as a plain box (row/grid/ring/hex/stack/fade/move
 * all work on it).
 */
function rectPiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  const w = el.width ?? 400;
  const h = el.height ?? 200;
  // Defaults are for hand-edited specs only: validateSpec requires width,
  // height and n (and rows for a grid). The cell count is capped at 256 —
  // more than reads on the canvas, and lint's co-visibility bookkeeping is
  // quadratic in visible ids (a 64 × 64 grid took layoutSpec down).
  const cols = Math.max(1, Math.round(el.n ?? 4));
  const rawRows = el.of === "grid" ? Math.max(1, Math.round(el.rows ?? 2)) : 1;
  const rows = Math.min(rawRows, Math.max(1, Math.floor(MAX_PIECE_CELLS / cols)));
  const cw = w / cols;
  const ch = h / rows;
  const left = c[0] - w / 2;
  const top = c[1] + h / 2; // y-up: the first row is the top one
  const out: Drawable[] = [];
  const ids: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const id = `${el.id}_${r * cols + k + 1}`;
      const x0 = left + k * cw;
      const y1 = top - r * ch;
      const pts: Pt[] = [
        [x0, y1],
        [x0 + cw, y1],
        [x0 + cw, y1 - ch],
        [x0, y1 - ch],
      ];
      out.push(...filledOutline(id, pts, el));
      ctx.anchors[id] = [x0 + cw / 2, y1 - ch / 2];
      ids.push(id);
      ctx.extraOrder.push(id);
    }
  }
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}
