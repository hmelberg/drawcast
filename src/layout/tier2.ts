// Tier-2/3 layout: turns semantic elements into Drawables. The LLM never
// places anything here except tier-3 escape-hatch coordinates.

import { CANVAS, linearScale, plotArea } from "./canvas";
import { makeAxes } from "./axes";
import { interpolateAtX, intersectPolylines, qualitativeShape, sampleExpression } from "./curves";
import { centroid } from "./geometry";
import { heuristicMeasure } from "./measure";
import {
  COLORS,
  LINE_HEIGHT,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultStyle,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import { decodePhoto, decodeSourceImage, decodeTrace } from "../spec/trace";
import { wrapText, type LabelRequest } from "./labels";
import type { SpecElement } from "../spec/types";

export interface Tier2Result {
  drawables: Drawable[];
  labels: LabelRequest[];
  /** Logical anchor point per element id (for labels, arrows, and commands). */
  anchors: Record<string, Pt>;
  /**
   * Command-addressable ids tier-2 minted that are NOT spec element ids — a
   * source element's quote highlights (`<id>_quote`, `<id>_quote_2`, …), which
   * the storyboard times to the narration beat on their own line.
   */
  extraOrder: string[];
  warnings: string[];
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
  extraOrder: string[];
  warnings: string[];
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
    extraOrder: [],
    warnings: [],
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
    }
  }

  return { drawables, labels, anchors: ctx.anchors, extraOrder: ctx.extraOrder, warnings: ctx.warnings };
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

function resolveEnd(end: { ref?: string; x?: number; y?: number } | undefined, ctx: Ctx): Pt | null {
  if (!end) return null;
  if (end.ref) {
    const a = ctx.anchors[end.ref];
    if (!a) {
      ctx.warnings.push(`arrow/edge endpoint references unknown id "${end.ref}"`);
      return null;
    }
    return a;
  }
  if (end.x !== undefined && end.y !== undefined) {
    return ctx.domainDeclared ? [ctx.sx(end.x), ctx.sy(end.y)] : [end.x, end.y];
  }
  return null;
}

function connectorDrawable(el: SpecElement, ctx: Ctx): Drawable[] {
  const from = resolveEnd(el.from, ctx);
  const to = resolveEnd(el.to, ctx);
  if (!from || !to) return [];
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const ux = (to[0] - from[0]) / dist;
  const uy = (to[1] - from[1]) / dist;
  const rFrom = el.from?.ref ? (ctx.nodeRadius.get(el.from.ref) ?? 10) + 4 : 0;
  const rTo = el.to?.ref ? (ctx.nodeRadius.get(el.to.ref) ?? 10) + 4 : 0;
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
 * A source element: a book cover, a paper's title page, or one page of
 * either — the same framed, paper-tinted photo family as a portrait, at a
 * size meant to be READ rather than recognized. Its title rides with it as a
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
  const page = el.page !== undefined || el.quote !== undefined;
  const w = el.width ?? (page ? 260 : 200);
  const cx = el.x ?? 820;
  const cy = el.y ?? 480;
  const decoded = el.strokes ? decodeSourceImage(el.strokes) : null;
  const aspect = decoded?.aspect ?? 1.4;
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
