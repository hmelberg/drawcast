// The custom-svg backend (primary): rough.js hand-drawn rendering with
// dash-offset progressive drawing. Consumes the layout IR; applies the single
// y-flip at emission time.

import type { TextFamily, TextWeight } from "../layout/text-style";
import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import type { Options as RoughOptions } from "roughjs/bin/core";
import { CANVAS, FULL_VIEW, toSvgY } from "../layout/canvas";
import {
  CHAR_W,
  COLORS,
  INK,
  LINE_HEIGHT,
  drawablesForId,
  leafDrawables,
  type AreaDrawable,
  type Drawable,
  type GradientSpec,
  type ImageReveal,
  type Pt,
  type StrokeDrawable,
} from "../layout/model";
import { FIGURE_GROUND, readsAsSame } from "../layout/ink";
import { writtenAt } from "./emphasis";
import { findPart, rowOffset, textRows, type PartHit } from "../layout/highlight-part";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import type { LayoutResult } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import type { HighlightEffect } from "../spec/types";
import type { BackendEffects, BackendModule, FlowOpts, MountResult, RenderedElement, Squash } from "./backend";
import type { Turn } from "./pose";
import { computeTypeFrame, type TypeRun } from "./type-reveal";

export const SKETCH_FONT = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive";
/** System monospace stack: no webfont fetch, and available to the export
 *  canvas without embedding — code must render identically in the movie. */
export const MONO_FONT = "'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace";
/** The Commodore 64's own face (Style's C64 Pro Mono, public/fonts/c64/ —
 *  its licence allows @font-face embedding and shipping in free software,
 *  unmodified and unrenamed). One em square per cell: 8 × 8 at any size. */
export const C64_FONT = "'C64 Pro Mono', 'Menlo', 'Consolas', monospace";
/** The "plain" face: the system sans, so nothing to load and nothing to fall back silently. */
export const SANS_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** The CSS stack for a spec-level family (layout/text-style.ts). */
export function fontStack(family?: TextFamily): string {
  return family === "sans-serif" ? SANS_FONT : family === "monospace" ? MONO_FONT : SKETCH_FONT;
}
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Canvas-based text measurement matching the sketch font; heuristic fallback.
 * Until the webfont is actually loaded we measure conservatively and skip the
 * cache — otherwise fallback-font widths get cached and labels rendered in the
 * real (wider) font stick out past the canvas edge.
 */
export function makeBrowserMeasure(font: { family: string; weight: TextWeight } = { family: SKETCH_FONT, weight: "normal" }): MeasureFn {
  if (typeof document === "undefined") return heuristicMeasure;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return heuristicMeasure;
  const cache = new Map<string, { w: number; h: number }>();
  let fontReady = false;
  return (text, fontSize) => {
    if (!fontReady) {
      try {
        // Only the handwriting face is a webfont; the system stacks are ready at once.
        fontReady = font.family !== SKETCH_FONT || (document.fonts?.check?.(`${fontSize}px 'Patrick Hand'`) ?? false);
      } catch {
        fontReady = false;
      }
    }
    const key = `${fontSize}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    ctx.font = `${font.weight} ${fontSize}px ${font.family}`;
    let w = ctx.measureText(text).width;
    if (!fontReady) w = Math.max(w, heuristicMeasure(text, fontSize).w) * 1.06;
    // small safety margin against font rendering variance
    const result = { w: w * 1.03 + 2, h: fontSize * 1.25 };
    if (fontReady) cache.set(key, result);
    return result;
  };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 + 1;
}

/**
 * Pure attribute construction for an SVG <radialGradient>, split from the DOM
 * assembly so it stays unit-testable in the node test environment.
 */
export function radialGradientParts(g: GradientSpec): { attrs: Record<string, string>; stops: Record<string, string>[] } {
  const attrs: Record<string, string> = {};
  if (g.fx !== undefined) attrs.fx = String(g.fx);
  if (g.fy !== undefined) attrs.fy = String(g.fy);
  attrs.r = String(g.r ?? 0.5);
  const stops = g.stops.map((s) => {
    const stop: Record<string, string> = { offset: `${+(s.offset * 100).toFixed(1)}%`, "stop-color": s.color };
    if (s.opacity !== undefined) stop["stop-opacity"] = String(s.opacity);
    return stop;
  });
  return { attrs, stops };
}

// Paint-server ids are looked up document-wide, and several SVGs can share a
// page (viewer + a re-render + export cloning) — a monotone counter keeps
// every gradient id unique for the session.
let gradSeq = 0;

/** Builds the <radialGradient> INSIDE the leaf's own <g> (a paint server is
 * referenced by id, not by position, so it needn't live in <defs>) — this way
 * it serializes with the element, which is what the video exporter clones. */
function appendRadialGradient(g: SVGGElement, spec: GradientSpec): string {
  const id = `csg${++gradSeq}`;
  const parts = radialGradientParts(spec);
  const el = document.createElementNS(SVG_NS, "radialGradient");
  el.setAttribute("id", id);
  for (const [k, v] of Object.entries(parts.attrs)) el.setAttribute(k, v);
  for (const s of parts.stops) {
    const stop = document.createElementNS(SVG_NS, "stop");
    for (const [k, v] of Object.entries(s)) stop.setAttribute(k, v);
    el.appendChild(stop);
  }
  g.appendChild(el);
  return `url(#${id})`;
}

function pathFromPts(pts: Pt[], closed?: boolean): string {
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${toSvgY(y).toFixed(1)}`).join(" ");
  return closed ? `${d} Z` : d;
}

/** Geometric dashes (M/L subpaths) so dash-offset reveal still works on dashed strokes. */
function dashedPathFromPts(pts: Pt[], dash = 11, gap = 9): string {
  const parts: string[] = [];
  let carry = 0;
  let drawing = true;
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x, y] = pts[i];
    const [x1, y1] = pts[i + 1];
    let segLen = Math.hypot(x1 - x, y1 - y);
    const ux = (x1 - x) / (segLen || 1);
    const uy = (y1 - y) / (segLen || 1);
    while (segLen > 0) {
      const need = (drawing ? dash : gap) - carry;
      const step = Math.min(need, segLen);
      const nx = x + ux * step;
      const ny = y + uy * step;
      if (drawing) parts.push(`M${x.toFixed(1)} ${toSvgY(y).toFixed(1)} L${nx.toFixed(1)} ${toSvgY(ny).toFixed(1)}`);
      x = nx;
      y = ny;
      segLen -= step;
      carry += step;
      if (carry >= (drawing ? dash : gap) - 1e-6) {
        carry = 0;
        drawing = !drawing;
      }
    }
  }
  return parts.join(" ");
}

/**
 * True when an area is an EXACT filled shape rather than a shaded region:
 * one crisp path in both render styles. Any hole implies it — rough.js's
 * hachure polygon has no way to express one.
 */
export function isExactArea(d: Pick<AreaDrawable, "holes" | "precise">): boolean {
  return d.precise === true || (d.holes?.length ?? 0) > 0;
}

/**
 * Path data for an exact area: the outer ring plus one closed subpath per
 * hole. Filled with fill-rule evenodd (see exactAreaAttrs), so an enclosed
 * subpath reads as a counter and a disjoint one as a second blot — which is
 * also why a hole needs no winding fix-up. Rings under 3 points enclose
 * nothing and are dropped rather than emitted as stubs.
 */
export function areaPathData(d: Pick<AreaDrawable, "pts" | "holes">): string {
  const rings = [d.pts, ...(d.holes ?? [])].filter((r) => r.length >= 3);
  return rings.map((r) => pathFromPts(r, true)).join(" ");
}

/**
 * The full attribute set for an exact area's <path>. Deliberately fill-only:
 * a letterform gets the same "precise" treatment TEXT gets — no stroke to
 * fatten the stems, and no fill-opacity knock-down at all — the wash that
 * makes a shaded region read as a region makes an equation read as washed
 * out, so an exact area paints at full strength (its own `opacity`, below,
 * is the only thing that may soften it).
 */
export function exactAreaAttrs(d: AreaDrawable): Record<string, string> {
  const attrs: Record<string, string> = {
    d: areaPathData(d),
    fill: d.style.fill ?? d.style.color,
    "fill-rule": "evenodd",
    stroke: "none",
  };
  if (d.style.opacity < 1) attrs.opacity = String(d.style.opacity);
  return attrs;
}

/** Marks a fill-only exact path so the emphasis clone leaves it fill-only. */
const EXACT_ATTR = "data-exact-fill";

function exactAreaPath(d: AreaDrawable): SVGPathElement {
  const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  for (const [k, v] of Object.entries(exactAreaAttrs(d))) p.setAttribute(k, v);
  p.setAttribute(EXACT_ATTR, "1");
  return p;
}

import { ARROWHEAD_SIZE } from "../layout/model";
export { ARROWHEAD_SIZE };

/**
 * The point on a polyline `dist` units back from one end, walking along the
 * path (interpolated within a segment); the far end when the path is shorter.
 */
function pointBackAlong(pts: Pt[], at: "end" | "start", dist: number): Pt {
  const order = at === "end" ? [...pts].reverse() : pts;
  let left = dist;
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= left && seg > 0) {
      const t = left / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= seg;
  }
  return order[order.length - 1];
}

/**
 * The two arms of an open arrowhead at a path's tip. Its direction is the
 * tangent over the last ARROWHEAD_SIZE units of the path, not the final
 * sample pair: a smoothed curve ends in a segment a few units long whose
 * direction wobbles, and the head sat askew on every curved edge and every
 * self-loop (arrow round, 2026-09-17). A straight two-point path is
 * unchanged.
 */
export function arrowheadPts(pts: Pt[], at: "end" | "start", size: number = ARROWHEAD_SIZE): [Pt, Pt, Pt] | null {
  if (pts.length < 2) return null;
  const tip = at === "end" ? pts[pts.length - 1] : pts[0];
  const prev = pointBackAlong(pts, at, size);
  const dx = tip[0] - prev[0];
  const dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const spread = 0.45;
  const left: Pt = [tip[0] - size * (ux * Math.cos(spread) - uy * Math.sin(spread)), tip[1] - size * (uy * Math.cos(spread) + ux * Math.sin(spread))];
  const right: Pt = [tip[0] - size * (ux * Math.cos(spread) + uy * Math.sin(spread)), tip[1] - size * (uy * Math.cos(spread) - ux * Math.sin(spread))];
  return [left, tip, right];
}

function roughOpts(d: StrokeDrawable | AreaDrawable, extra: Partial<RoughOptions> = {}): RoughOptions {
  return {
    roughness: d.style.roughness,
    stroke: d.style.color,
    strokeWidth: d.style.strokeWidth,
    seed: hashSeed(d.id),
    bowing: 0.9,
    ...extra,
  };
}

// ---- clean (non-rough) rendering: same drawables, crisp single paths ----
// Everything stays a <path> so the dash-offset reveal works identically.

function circlePath(cx: number, cySvg: number, r: number): string {
  return `M${(cx - r).toFixed(1)} ${cySvg.toFixed(1)} A${r} ${r} 0 1 0 ${(cx + r).toFixed(1)} ${cySvg.toFixed(1)} A${r} ${r} 0 1 0 ${(cx - r).toFixed(1)} ${cySvg.toFixed(1)}`;
}

function plainPath(d: string, style: { color: string; strokeWidth: number; fill?: string; opacity?: number }, filled = false): SVGPathElement {
  const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  p.setAttribute("d", d);
  p.setAttribute("stroke", style.color);
  p.setAttribute("stroke-width", String(style.strokeWidth));
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("fill", filled && style.fill ? style.fill : "none");
  return p;
}

function drawLeafClean(g: SVGGElement, d: Exclude<Drawable, { kind: "group" | "text" | "image" }>): void {
  if (d.kind === "area") {
    if (d.blink) g.classList.add("cs-blink");
    if (isExactArea(d)) {
      g.appendChild(exactAreaPath(d));
      return;
    }
    const p = plainPath(pathFromPts(d.pts, true), { ...d.style, strokeWidth: 1.5 }, true);
    p.setAttribute("fill", d.style.fill ?? d.style.color);
    // No extra fill-opacity knock-down here: the region's wash is carried by
    // its own `opacity` (kit.area's default 0.35, or whatever the template
    // asked for). A second, hardcoded knock-down was invisible at rest — the
    // draw reveal overwrites fill-opacity the moment the element is drawn —
    // and surfaced ONLY on animate's cheap tween frames, which build fresh
    // nodes and attach no handles: every shaded region went pale for the
    // length of a tween and snapped back at settle (the chess board's dark
    // squares losing their green while a piece glided).
    p.setAttribute("opacity", String(d.style.opacity));
    g.appendChild(p);
    return;
  }
  const filled = !!(d.style.fill || d.style.fillGradient);
  if (d.shapeHint?.type === "circle") {
    const gradPaint = d.style.fillGradient ? appendRadialGradient(g, d.style.fillGradient) : null;
    const { c, r } = d.shapeHint;
    const p = plainPath(circlePath(c[0], toSvgY(c[1]), r), d.style, filled);
    if (filled) p.setAttribute("fill", gradPaint ?? d.style.fill!);
    g.appendChild(p);
  } else if (d.shapeHint?.type === "rect") {
    const { x, y, w, h: rh } = d.shapeHint;
    const top = toSvgY(y + rh);
    g.appendChild(plainPath(`M${x} ${top} h${w} v${rh} h${-w} Z`, d.style));
  } else if (d.pts.length >= 2) {
    const dStr = d.style.dash ? dashedPathFromPts(d.pts) : pathFromPts(d.pts, d.closed);
    g.appendChild(plainPath(dStr, d.style));
  }
  if (d.arrowhead && d.pts.length >= 2) {
    const heads: ("end" | "start")[] = d.arrowhead === "both" ? ["start", "end"] : [d.arrowhead];
    for (const at of heads) {
      const tri = arrowheadPts(d.pts, at, d.headSize);
      if (tri) g.appendChild(plainPath(pathFromPts(tri), d.style));
    }
  }
  if (d.style.opacity < 1) g.setAttribute("opacity", String(d.style.opacity));
}

/** A code source line's coloured runs (layout/model.ts TextDrawable.runs) as
 *  nested tspans on their row (or directly on `<text>` for a single-row
 *  leaf) — one child per run, in order, so the run texts read exactly as
 *  the row's own text. A plain run (no colour: the tokenizer's `plain`
 *  kind, or an unknown language) gets no `fill` attribute at all and simply
 *  inherits the drawable's own `style.color` from the ancestor `<text>`. */
function appendRuns(parent: SVGTextElement | SVGTSpanElement, runs: { text: string; color?: string }[]): void {
  for (const run of runs) {
    const span = document.createElementNS(SVG_NS, "tspan");
    if (run.color) span.setAttribute("fill", run.color);
    span.textContent = run.text;
    parent.appendChild(span);
  }
}

let monoAdvance: number | null | undefined;
/** The code font's real advance per em, measured once; null where there is
 *  no canvas to measure with (node tests) — the text is then left alone. */
function monoAdvanceEm(): number | null {
  if (monoAdvance !== undefined) return monoAdvance;
  monoAdvance = null;
  try {
    const ctx = document.createElement("canvas").getContext?.("2d");
    if (ctx) {
      ctx.font = `100px ${MONO_FONT}`;
      const w = ctx.measureText("0000000000").width;
      if (w > 0) monoAdvance = w / 1000;
    }
  } catch {
    monoAdvance = null;
  }
  return monoAdvance;
}

function drawLeaf(rc: RoughSVG | null, d: Exclude<Drawable, { kind: "group" }>): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.dataset.leafId = d.id;
  if (d.kind === "text") {
    const t = document.createElementNS(SVG_NS, "text");
    const x = d.pos[0];
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(toSvgY(d.pos[1])));
    t.setAttribute("fill", d.style.color);
    // Paper-colored halo: text stays legible when it grazes a stroke
    // (the label solver treats strokes as soft obstacles).
    // …but not on a Commodore screen: there the halo was a cream outline
    // around every glyph (Hans, 2026-09-06), and a screen has no paper.
    // …nor on a code pane's own field (TextDrawable.halo).
    if (d.font !== "c64" && d.halo !== false) {
      t.setAttribute("paint-order", "stroke");
      t.setAttribute("stroke", FIGURE_GROUND);
      t.setAttribute("stroke-width", "5");
      t.setAttribute("stroke-linejoin", "round");
    }
    t.setAttribute("font-size", String(d.fontSize));
    t.setAttribute("font-family", d.font === "mono" ? MONO_FONT : d.font === "c64" ? C64_FONT : fontStack(d.family));
    // In mono text the whitespace IS content — a Python body loses its
    // meaning if SVG collapses the leading spaces of an indented line.
    // SVG2 renderers take this from CSS, not the legacy xml:space.
    if (d.font === "mono" || d.font === "c64") t.style.whiteSpace = "pre";
    // Layout places everything in a code pane — its width, a mark's column —
    // on a CHAR_W grid; the font's own advance is whatever the machine has
    // (Menlo 0.602 em). Letter-spacing closes the gap, so a mark sits on its
    // characters however far along the line they are.
    if (d.font === "mono") {
      const adv = monoAdvanceEm();
      if (adv !== null && Math.abs(adv - CHAR_W) > 0.001) t.setAttribute("letter-spacing", ((CHAR_W - adv) * d.fontSize).toFixed(3));
    }
    if (d.weight === "bold") t.setAttribute("font-weight", "bold");
    t.setAttribute("text-anchor", d.anchor === "middle" ? "middle" : d.anchor);
    t.setAttribute("dominant-baseline", "central");
    if (d.style.opacity < 1) t.setAttribute("opacity", String(d.style.opacity));
    if (d.lines && d.lines.length > 1) {
      const lineH = d.fontSize * 1.25;
      d.lines.forEach((line, i) => {
        const span = document.createElementNS(SVG_NS, "tspan");
        span.setAttribute("x", String(x));
        span.setAttribute("dy", String(i === 0 ? -((d.lines!.length - 1) / 2) * lineH : lineH));
        // Marks this as a ROW, for the `type` draw mode below — distinct
        // from a single-row leaf's own run tspans (case just below), which
        // sit directly on <text> with no row wrapper and so carry no marker.
        span.dataset.row = "1";
        const runs = d.runs?.[i];
        if (runs) appendRuns(span, runs);
        else span.textContent = line;
        t.appendChild(span);
      });
    } else if (d.runs?.[0]) {
      appendRuns(t, d.runs[0]);
    } else {
      t.textContent = d.text;
    }
    g.appendChild(t);
    return g;
  }
  if (d.kind === "image") {
    const img = document.createElementNS(SVG_NS, "image");
    img.setAttribute("href", d.href);
    img.setAttribute("x", String(d.pos[0] - d.w / 2));
    img.setAttribute("y", String(toSvgY(d.pos[1] + d.h / 2)));
    img.setAttribute("width", String(d.w));
    img.setAttribute("height", String(d.h));
    img.setAttribute("preserveAspectRatio", "none");
    if (d.style.opacity < 1) img.setAttribute("opacity", String(d.style.opacity));
    g.appendChild(img);
    return g;
  }
  if (!rc || (d.kind === "stroke" && d.precise)) {
    drawLeafClean(g, d);
    return g;
  }
  if (d.kind === "area") {
    if (d.blink) g.classList.add("cs-blink");
    // An exact area is exact in BOTH styles: hachure at gap 5.5 across a 54 px
    // glyph stem is one or two wobbling strokes, which is what "grainy" was.
    if (isExactArea(d)) {
      g.appendChild(exactAreaPath(d));
      return g;
    }
    // Dense, heavy hachure — thin sparse fills read as unshaded on some screens.
    const node = rc.polygon(
      d.pts.map(([x, y]) => [x, toSvgY(y)]),
      roughOpts(d, { fill: d.style.fill ?? d.style.color, fillStyle: "hachure", hachureGap: 5.5, fillWeight: 1.7, strokeWidth: 1.8 }),
    );
    node.setAttribute("opacity", String(Math.min(1, d.style.opacity + 0.15)));
    g.appendChild(node);
    return g;
  }
  // stroke
  const opts = roughOpts(d);
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const fillPaint = d.style.fillGradient ? appendRadialGradient(g, d.style.fillGradient) : d.style.fill;
    const node = rc.circle(c[0], toSvgY(c[1]), r * 2, fillPaint ? { ...opts, fill: fillPaint, fillStyle: "solid" } : opts);
    g.appendChild(node);
  } else if (d.shapeHint?.type === "rect") {
    const node = rc.rectangle(d.shapeHint.x, toSvgY(d.shapeHint.y + d.shapeHint.h), d.shapeHint.w, d.shapeHint.h, opts);
    g.appendChild(node);
  } else if (d.pts.length >= 2) {
    const dStr = d.style.dash ? dashedPathFromPts(d.pts) : pathFromPts(d.pts, d.closed);
    g.appendChild(rc.path(dStr, opts));
  }
  if (d.kind === "stroke" && d.arrowhead && d.pts.length >= 2) {
    const heads: ("end" | "start")[] = d.arrowhead === "both" ? ["start", "end"] : [d.arrowhead];
    for (const at of heads) {
      const tri = arrowheadPts(d.pts, at, d.headSize);
      if (tri) g.appendChild(rc.linearPath(tri.map(([x, y]) => [x, toSvgY(y)] as [number, number]), opts));
    }
  }
  if (d.style.opacity < 1 && d.kind === "stroke") g.setAttribute("opacity", String(d.style.opacity));
  return g;
}

interface LeafHandle {
  durationMs: number;
  prepare(): void;
  setProgress(t: number): void;
}

/**
 * One frame of an image reveal: the CSS an image group wears at progress t.
 * PURE in t on purpose — erase drives t backwards and scrubbing jumps it
 * anywhere, so no effect may hold direction state; every entrance therefore
 * doubles as its own exit, played in reverse. At t ≥ 1 all properties clear
 * to the resting value, so a settled image is byte-identical to a freshly
 * built node (the swapGeometry invariant), filters cost nothing at rest,
 * and export captures a crisp frame.
 */
export function imageRevealFrame(reveal: ImageReveal, baseOpacity: number, t: number): { opacity: string; filter: string; clipPath: string; transform: string } {
  const rest = { filter: "", clipPath: "", transform: "" };
  if (t >= 1) return { opacity: String(baseOpacity), ...rest };
  switch (reveal) {
    case "develop":
      // Darkroom develop: the print is there early, sharpness arrives last.
      return { ...rest, opacity: String(baseOpacity * Math.min(1, t / 0.6)), filter: `blur(${(14 * (1 - t)).toFixed(2)}px)` };
    case "iris":
      // Film iris: a circle opens from the center (75% covers the corners).
      return { ...rest, opacity: String(baseOpacity * Math.min(1, t / 0.25)), clipPath: `circle(${(t * 75).toFixed(2)}% at 50% 50%)` };
    case "wipe":
      // A print sliding out of the machine: top edge first.
      return { ...rest, opacity: String(baseOpacity * Math.min(1, t / 0.2)), clipPath: `inset(0 0 ${((1 - t) * 100).toFixed(2)}% 0)` };
    case "drift": {
      // Slightly oversized, settling into place as it fades in.
      const e = 1 - (1 - t) ** 3;
      return { ...rest, opacity: String(baseOpacity * t), transform: `scale(${(1.06 - 0.06 * e).toFixed(4)})` };
    }
    default:
      return { ...rest, opacity: String(baseOpacity * t) };
  }
}

function makeLeafHandle(g: SVGGElement, leaf: Exclude<Drawable, { kind: "group" }>): LeafHandle {
  if (leaf.kind === "image") {
    // A photo has no pen to follow, so it reveals by effect (ImageReveal in
    // layout/model.ts): the pure frame math lives in imageRevealFrame.
    const base = leaf.style.opacity;
    const reveal = leaf.reveal ?? "fade";
    const apply = (t: number) => {
      const f = imageRevealFrame(reveal, base, t);
      g.style.opacity = f.opacity;
      g.style.filter = f.filter;
      g.style.clipPath = f.clipPath;
      g.style.transform = f.transform;
    };
    // transform-box makes scale() pivot on the image itself, not the SVG origin.
    g.style.transformBox = "fill-box";
    g.style.transformOrigin = "center";
    return {
      durationMs: leaf.drawOpts.duration,
      prepare: () => apply(0),
      setProgress: apply,
    };
  }
  if (leaf.kind === "text") {
    // KNOWN, DELIBERATE mismatch: the reveal ends on `base`, but drawLeaf has
    // ALREADY put opacity="base" on the <text> itself, so a settled
    // translucent text paints at base² while a freshly built node (an animate
    // tween frame, which attaches no handles — see swapGeometry) paints it at
    // base. Text with opacity < 1 therefore looks brighter mid-tween than at
    // rest. Left alone on purpose: the fix is `g.style.opacity = String(t)`,
    // making the group's fade a pure 0→1 multiplier over the node's own
    // authored value — exactly the pattern the area branch below now follows —
    // but it would also brighten the depth-faded labels the 3D scenes rely on
    // (src/scenes/kit.ts multiplies leaf opacity by a depth factor), an
    // unrelated visual change. Apply that one-liner if the mid-tween
    // brightening ever matters, and re-check the 3D scenes when you do.
    if (leaf.drawOpts.mode === "type") {
      // The typed reveal: at progress p the node shows the first round(p·n)
      // characters, row by row for a wrapped line — and, within a coloured
      // source line, run by run, so a token keeps its own fill while it
      // types — with a cursor glyph after the last shown character while
      // typing. The character math is pure (computeTypeFrame,
      // render/type-reveal.ts — untestable here without a browser, this
      // repo carries no jsdom): scrub, erase (p runs 1→0: the line untypes)
      // and the exporter's fixed frame clock all agree because they are all
      // just calls to it at different n. This is only the DOM glue around
      // that: reading the leaf's rows/runs from what drawLeaf just built,
      // and writing the answer back.
      //
      // Rows are the direct-child ROW tspans drawLeaf marks with
      // `data-row` (a wrapped, multi-row leaf) — never every descendant
      // tspan, which would also catch a row's own nested run tspans and
      // miscount them as extra rows. A single-row leaf has no row tspan at
      // all: its run tspans (a coloured line with no `lines`), if any, sit
      // directly on `<text>`, so `<text>` itself is that one row; with
      // neither runs nor rows, `<text>` is its own single, uncoloured run
      // (the legacy shape, textContent set directly).
      const textEl = g.querySelector("text");
      const isTspan = (n: Element): n is SVGTSpanElement => n.tagName === "tspan";
      const rowTspans = textEl ? [...textEl.children].filter((c): c is SVGTSpanElement => isTspan(c) && "row" in c.dataset) : [];
      const rowEls: (SVGTextElement | SVGTSpanElement)[] = rowTspans.length > 0 ? rowTspans : textEl ? [textEl] : [];
      const rowRunEls: (SVGTextElement | SVGTSpanElement)[][] = rowEls.map((row) => {
        const nested = [...row.children].filter(isTspan);
        return nested.length > 0 ? nested : [row];
      });
      const full: TypeRun[][] = rowRunEls.map((runEls) => runEls.map((el) => ({ text: el.textContent ?? "" })));
      const total = full.reduce((a, runs) => a + runs.reduce((b, r) => b + r.text.length, 0), 0);
      const CURSOR = "▌";
      const apply = (n: number, typing: boolean) => {
        const { shown, cursorAt } = computeTypeFrame(full, n, typing);
        shown.forEach((runs, i) => {
          runs.forEach((text, j) => {
            const cursor = cursorAt && cursorAt[0] === i && cursorAt[1] === j ? CURSOR : "";
            rowRunEls[i][j].textContent = text + cursor;
          });
        });
      };
      return {
        durationMs: leaf.drawOpts.duration,
        prepare: () => {
          g.style.opacity = String(leaf.style.opacity);
          apply(0, false);
        },
        setProgress: (t) => {
          const typing = t > 0 && t < 1;
          apply(Math.round(t * total), typing);
          g.classList.toggle("cs-typing", typing);
        },
      };
    }
    return {
      durationMs: leaf.drawOpts.duration,
      prepare: () => {
        g.style.opacity = "0";
      },
      setProgress: (t) => {
        const base = leaf.style.opacity;
        g.style.opacity = String(base * t);
      },
    };
  }
  // `fillOpacity` is the path's OWN authored fill-opacity (null = nothing to
  // fade). The reveal multiplies it rather than replacing it, so a fully
  // revealed path lands back on exactly the value a freshly built node
  // carries — the invariant animate's cheap tween frames depend on (see
  // swapGeometry).
  let paths: RevealNode[] | null = null;
  /** The nodes the reveal is writing to WHILE it runs: one per subpath (see
   *  splitForReveal), or null whenever the leaf stands at its own nodes. */
  let drawing: RevealNode[] | null = null;
  let total = 0;
  const ensure = () => {
    if (paths) return;
    paths = [];
    for (const p of Array.from(g.querySelectorAll("path"))) {
      paths.push(revealNode(p));
      total += p.getTotalLength();
    }
  };
  /** Back to the leaf's own nodes: what a freshly built leaf looks like, which
   *  is what every cheap tween frame and every clone of this group assumes. */
  const collapse = () => {
    if (!drawing) return;
    for (const n of drawing) if (n.el.dataset.revealPiece) n.el.remove();
    for (const n of paths!) n.el.style.display = "";
    drawing = null;
  };
  const apply = (nodes: RevealNode[], t: number) => {
    const locals = revealLocals(nodes.map((n) => n.len), t);
    nodes.forEach((n, i) => setRevealAt(n, locals[i], t));
  };
  return {
    durationMs: leaf.drawOpts.duration,
    prepare: () => {
      ensure();
      collapse();
      apply(paths!, 0);
    },
    setProgress: (t) => {
      ensure();
      // At either end the leaf stands at its own nodes; only the draw itself
      // needs the split, so the DOM carries the extra nodes for the length of
      // one beat and no longer.
      if (t <= 0 || t >= 1) {
        collapse();
        apply(paths!, t);
        return;
      }
      if (!drawing) drawing = splitForReveal(paths!);
      apply(drawing, t);
    },
  };
}

/** One node the reveal writes to, and what it needs to know about it. */
interface RevealNode {
  el: SVGPathElement;
  len: number;
  /** The path's OWN authored fill-opacity; null when there is no fill to fade. */
  fillOpacity: number | null;
}

function revealNode(el: SVGPathElement): RevealNode {
  const authored = Number(el.getAttribute("fill-opacity") ?? "1");
  // Solid fills are not hidden by dash-offset; fade them with progress.
  const fillOpacity = (el.getAttribute("fill") ?? "none") === "none" ? null : Number.isFinite(authored) ? authored : 1;
  return { el, len: el.getTotalLength(), fillOpacity };
}

/** Where the pen has got to on each node when the leaf is at `t`: one node is
 *  finished before the next is started, so the lengths are drawn in order.
 *  Pure, and the whole of the reveal's timing. */
export function revealLocals(lens: number[], t: number): number[] {
  const total = lens.reduce((a, b) => a + b, 0);
  let elapsed = t * total;
  return lens.map((len) => {
    const local = Math.min(Math.max(elapsed, 0), len);
    elapsed -= len;
    return local;
  });
}

function setRevealAt(n: RevealNode, local: number, t: number): void {
  const { el, len, fillOpacity } = n;
  if (len > 0) {
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len - local}`;
  } else {
    // A path with no length cannot be dashed at all: `stroke-dasharray: 0` is
    // a no-op, and a round cap paints the degenerate subpath as a DOT. Hide it
    // outright until the pen reaches it.
    el.style.visibility = t > 0 ? "" : "hidden";
  }
  if (fillOpacity !== null) el.style.fillOpacity = String(fillOpacity * (len > 0 ? local / len : t));
}

/** At most this many nodes stand in for one path while it is drawn. A traced
 *  outline can hold thousands of subpaths; past the cap they are grouped, so
 *  the drawing still moves through the path in order and the DOM stays sane. */
const MAX_REVEAL_NODES = 240;

/**
 * The reveal's nodes for one beat: every multi-subpath path replaced, in
 * place, by one node per subpath.
 *
 * Why, at all: a dash pattern RESTARTS at the start of every subpath, so
 * `stroke-dasharray: len; stroke-dashoffset: len − local` (the whole path's
 * length) advances EVERY subpath by `local` at once. A path holds many
 * subpaths — rough.js draws each segment twice, each pass its own subpath; a
 * dashed line is one subpath per dash; an arrowhead is a subpath of its own —
 * so the leaf did not draw stroke by stroke at all: every stroke grew at the
 * same time, the short ones finished within the first percent of the beat and
 * then SAT THERE as small marks (an arrowhead waiting at the tip for its
 * shaft) while the long ones caught up, and the whole shape was done long
 * before its beat was (measured 2026-09-21: a triangle at 21% of its slot, a
 * dashed curve at 1%). One node per subpath is the same ink with one pen.
 */
function splitForReveal(paths: RevealNode[]): RevealNode[] {
  const out: RevealNode[] = [];
  for (const n of paths) {
    // A filled path is one shape: split it and each piece would fill itself.
    const subs = n.fillOpacity === null ? splitSubpaths(n.el.getAttribute("d") ?? "") : null;
    if (!subs || subs.length < 2) {
      out.push(n);
      continue;
    }
    const parent = n.el.parentNode;
    if (!parent) {
      out.push(n);
      continue;
    }
    for (const d of chunkSubpaths(subs, MAX_REVEAL_NODES)) {
      const piece = n.el.cloneNode(false) as SVGPathElement;
      piece.setAttribute("d", d);
      piece.dataset.revealPiece = "1";
      parent.insertBefore(piece, n.el);
      out.push(revealNode(piece));
    }
    n.el.style.display = "none";
  }
  return out;
}

/**
 * A path's data as one string per subpath, in drawing order — or null when
 * the data must not be taken apart: a RELATIVE moveto reads from the previous
 * subpath's last point, so a piece lifted out of the path would move.
 */
export function splitSubpaths(d: string): string[] | null {
  const parts = d
    .split(/(?=[Mm])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((p) => p.startsWith("m"))) return null;
  return parts;
}

/** `subs` as at most `max` nodes, consecutive subpaths grouped when there are
 *  more than that. Order is never disturbed: the join of the result is the
 *  join of the input. */
export function chunkSubpaths(subs: string[], max: number): string[] {
  if (subs.length <= max) return subs;
  const per = Math.ceil(subs.length / max);
  const out: string[] = [];
  for (let i = 0; i < subs.length; i += per) out.push(subs.slice(i, i + per).join(" "));
  return out;
}

/**
 * The `transform` a pose wears, or null when the pose is the identity.
 *
 * SVG rotates clockwise in y-down, so a y-up counter-clockwise `deg` is
 * `rotate(-deg)` about the flipped pivot; translate, then rotate about the
 * pivot, then scale about the same pivot.
 *
 * Module-level because TWO writers need the identical string: the element
 * handle (settled state) and buildNodes (a tween frame's handle-less nodes).
 * When only the handle knew how, every animate tween and slider preview
 * rebuilt rotated/scaled elements with a bare translate — they snapped
 * upright for the length of the tween and jumped back at settle.
 */
export function poseTransform(dx: number, dy: number, deg: number, pivot: Pt, scale = 1, mirror = false, squash?: Squash): string | null {
  const parts: string[] = [];
  if (squash && squash.k < 1) {
    // Applied LAST (outermost): squash perpendicular to the mirror line. In
    // SVG's y-down frame a y-up line at φ lies at −φ, so rotate(φ) aligns it
    // with the x-axis; scale y; rotate back.
    const qx = squash.at[0].toFixed(1);
    const qy = (CANVAS.h - squash.at[1]).toFixed(1);
    const k = Math.max(squash.k, 0.002).toFixed(4);
    parts.push(`translate(${qx} ${qy}) rotate(${(-squash.angle).toFixed(2)}) scale(1 ${k}) rotate(${squash.angle.toFixed(2)}) translate(${(-squash.at[0]).toFixed(1)} ${(-(CANVAS.h - squash.at[1])).toFixed(1)})`);
  }
  const px = pivot[0].toFixed(1);
  const py = (CANVAS.h - pivot[1]).toFixed(1);
  if (dx !== 0 || dy !== 0) parts.push(`translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`);
  if (deg !== 0) parts.push(`rotate(${(-deg).toFixed(2)} ${px} ${py})`);
  if (scale !== 1 || mirror) {
    // The canvas's y-flip commutes with a mirror in x, so scale(−s, s) about P is the reflection.
    parts.push(`translate(${px} ${py}) scale(${(mirror ? -scale : scale).toFixed(4)} ${scale.toFixed(4)}) translate(${(-pivot[0]).toFixed(1)} ${(-(CANVAS.h - pivot[1])).toFixed(1)})`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}

/** One leaf's live nodes, as buildNodes assembles them: the leaf's own `<g>`
 *  (data-leaf-id carrying node, rebuilt in place by setPoints), the drawable
 *  it was built from, and the fade wrapper `<g>` above it. */
interface LeafEntry {
  g: SVGGElement;
  leaf: Exclude<Drawable, { kind: "group" }>;
  fadeNode: SVGGElement;
}

class SvgElementHandle implements RenderedElement {
  readonly id: string;
  readonly durationMs: number;
  private leaves: LeafHandle[];
  private cumulative: number[];
  private groups: SVGGElement[];
  /** Per-leaf `setOpacity` targets: a dedicated wrapper `<g>` ABOVE each
   *  leaf's own `<g>`, for EVERY leaf kind (see buildNodes' `fadeNode`). The
   *  wrapper exists because the leaf node's own opacity is already spoken
   *  for, in two different ways: text/image reveals write `g.style.opacity`
   *  every frame, and stroke/area leaves carry the drawable's AUTHORED
   *  `style.opacity` as the `opacity` ATTRIBUTE on `g` (drawLeaf). Fading
   *  the leaf node directly would clobber one or the other — a translucent
   *  highlighter band snapping to full ink the first time a scene applied.
   *  On a wrapper, fade∘reveal∘focus∘authored all compose multiplicatively. */
  private fadeGroups: SVGGElement[];
  private entries: LeafEntry[];
  /** Per-leaf id: the points setPoints last applied (null = the layout's own). */
  private current = new Map<string, Pt[] | null>();
  /** Per-leaf id: the string setText last applied (null = the layout's own). */
  private currentText = new Map<string, string | null>();
  /** The reveal progress this element was last put at — 0 after mount and
   *  after hide(), 1 after finish(), whatever setProgress was handed
   *  mid-draw. A leaf rebuilt by setPoints/setText is restored to THIS, not
   *  to 1: a measure whose figure moves before the measure has been drawn
   *  would otherwise pop into view mid-move (design §2.3), and so would one
   *  the cast has hidden or erased. */
  private lastProgress = 0;

  constructor(id: string, entries: LeafEntry[], private readonly rc: RoughSVG | null) {
    this.id = id;
    this.entries = entries;
    this.leaves = entries.map(({ g, leaf }) => makeLeafHandle(g, leaf));
    this.groups = entries.map(({ g }) => g);
    this.fadeGroups = entries.map(({ fadeNode }) => fadeNode);
    this.cumulative = [];
    let acc = 0;
    for (const l of this.leaves) {
      this.cumulative.push(acc);
      acc += l.durationMs;
    }
    this.durationMs = acc;
    this.leaves.forEach((l) => l.prepare());
  }

  /** Redraw one leaf from a changed drawable, in place: new nodes under the
   *  leaf's own `<g>` (so the pose transform, the fade wrapper and anything
   *  holding the node keep working), a fresh leaf handle, and the reveal put
   *  back exactly where this element already stood. NEVER at progress 1 —
   *  see `lastProgress`. */
  private rebuildLeaf(i: number, drawable: Exclude<Drawable, { kind: "group" }>): void {
    const rebuilt = drawLeaf(this.rc, drawable);
    this.entries[i].g.replaceChildren(...Array.from(rebuilt.children));
    this.leaves[i] = makeLeafHandle(this.entries[i].g, drawable);
    this.leaves[i].prepare();
    this.leaves[i].setProgress(this.leafProgressAt(i, this.lastProgress));
  }

  /** Morph support: rebuild a leaf with new points, or with its own when
   *  unlisted. Same-reference points are a no-op, so applyScene's per-boundary
   *  call costs nothing once a boundary's shapes are already applied. */
  setPoints(points: Record<string, Pt[]>): void {
    this.entries.forEach((e, i) => {
      const leaf = e.leaf;
      if (leaf.kind !== "stroke" && leaf.kind !== "area") return;
      // Only a stroke ever carries a shapeHint (a circle/rect drawn exactly,
      // not from its sampled polyline) — AreaDrawable has no such field.
      if (leaf.kind === "stroke" && leaf.shapeHint) return;
      const want = points[leaf.id] ?? null;
      if (want === (this.current.get(leaf.id) ?? null)) return;
      this.current.set(leaf.id, want);
      this.rebuildLeaf(i, want ? { ...leaf, pts: want } : leaf);
    });
  }

  /** A measure's value follows what it measures (design §2.3): rebuild a text
   *  leaf with a new string, or with its own when unlisted. Same-value calls
   *  are a no-op, so applyScene's per-boundary call costs nothing once a
   *  boundary's texts are already applied. `lines` is dropped with the old
   *  string: the wrap was measured for THAT text, and a stale line list would
   *  paint the old words. */
  setText(texts: Record<string, string>): void {
    this.entries.forEach((e, i) => {
      const leaf = e.leaf;
      if (leaf.kind !== "text") return;
      const want = texts[leaf.id] ?? null;
      if (want === (this.currentText.get(leaf.id) ?? null)) return;
      this.currentText.set(leaf.id, want);
      this.rebuildLeaf(i, want !== null ? { ...leaf, text: want, lines: undefined } : leaf);
    });
  }

  /** Persistent translation, logical units y-up (the y-flip happens here). */
  setOffset(dx: number, dy: number): void {
    this.setTransform(dx, dy, 0, [0, 0]);
  }

  /** Pose: see poseTransform. */
  setTransform(dx: number, dy: number, deg: number, pivot: Pt, scale = 1, mirror = false, squash?: Squash): void {
    const t = poseTransform(dx, dy, deg, pivot, scale, mirror, squash);
    for (const g of this.groups) {
      if (t === null) g.removeAttribute("transform");
      else g.setAttribute("transform", t);
    }
  }

  /** Persistent opacity (the `opacity` ATTRIBUTE, not CSS) — the fade verb's
   *  store, applied to fadeGroups (see its doc comment). Kept on a node of
   *  its own, ABOVE the leaf, so it never collides with anything the leaf's
   *  own node already uses its opacity for: the drawable's authored
   *  translucency (an `opacity` attribute written by drawLeaf), the reveal's
   *  `style.opacity` (text/image), or the focus effect's transient
   *  `style.opacity`. Different nodes means SVG's nested-opacity compositing
   *  MULTIPLIES them, so a fade to 0.5 halves a 0.42 highlighter band rather
   *  than replacing it, and ending a focus never undoes a fade. */
  setOpacity(alpha: number): void {
    for (const g of this.fadeGroups) {
      if (alpha >= 1) g.removeAttribute("opacity");
      else g.setAttribute("opacity", Math.max(0, alpha).toFixed(3));
    }
  }

  /** Where leaf `i` stands when the whole element is at `t` — the element's
   *  duration split across its leaves in draw order. Factored out of
   *  setProgress so rebuildLeaf can put one leaf back on that same curve. */
  private leafProgressAt(i: number, t: number): number {
    if (t >= 1) return 1;
    if (this.durationMs === 0) return 0;
    const elapsed = t * this.durationMs;
    const leaf = this.leaves[i];
    if (leaf.durationMs === 0) return elapsed >= this.cumulative[i] && t > 0 ? 1 : 0;
    return Math.min(Math.max((elapsed - this.cumulative[i]) / leaf.durationMs, 0), 1);
  }

  setProgress(t: number): void {
    this.lastProgress = t;
    this.leaves.forEach((leaf, i) => leaf.setProgress(this.leafProgressAt(i, t)));
  }

  finish(): void {
    this.setProgress(1);
  }

  hide(): void {
    this.lastProgress = 0;
    this.leaves.forEach((l) => l.setProgress(0));
  }
}

/**
 * Last-line defense against text clipping at the canvas border: after render
 * (and again once webfonts finish loading), shift any overflowing <text> back
 * inside the viewBox. Purely visual; layout/lint boxes are unchanged.
 */
function nudgeTextsIntoCanvas(svg: SVGSVGElement): void {
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    try {
      // Our backend never sets transforms on text otherwise, so recomputing
      // from a clean slate keeps repeated calls (e.g. after fonts load) idempotent.
      t.removeAttribute("transform");
      const bb = (t as SVGTextElement).getBBox();
      let dx = 0;
      const overRight = bb.x + bb.width - (CANVAS.w - 3);
      if (overRight > 0) dx = -overRight;
      else if (bb.x < 3) dx = 3 - bb.x;
      let dy = 0;
      if (bb.y < 3) dy = 3 - bb.y;
      else if (bb.y + bb.height > CANVAS.h - 3) dy = CANVAS.h - 3 - (bb.y + bb.height);
      if (dx !== 0 || dy !== 0) {
        t.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      }
    } catch {
      // getBBox throws on detached/hidden nodes — nothing to fix then
    }
  }
}

// ---- gesture-verb effects: stateless per-frame primitives on an overlay ----

const HIGHLIGHT_COLOR = "#cf4632";
const LASER_COLOR = "#d33827";

/**
 * Coloured echo of an element's rendered nodes — pulse's whole effect, and
 * glow's tint on glyphs, text and areas. No halo of its own: the old glow put
 * a 4 px + 14 px drop-shadow here, which on a letter was wider than the
 * letter (Hans, 2026-09-24: "a cheap neon sign"). An echoed text also drops
 * its paper halo, which would otherwise paint over its neighbours.
 */
function emphasisClone(g: SVGGElement, color: string): SVGGElement {
  const c = g.cloneNode(true) as SVGGElement;
  c.removeAttribute("opacity");
  c.style.opacity = "0";
  c.style.pointerEvents = "none";
  for (const p of Array.from(c.querySelectorAll("path"))) {
    if ((p.getAttribute("fill") ?? "none") !== "none") {
      p.setAttribute("fill", color);
      // A shaded AREA stays see-through even at full strength: there is
      // something underneath it (the labels in a region, the curve through a
      // sector) that a solid echo would paint over for the whole sentence.
      // A letterform has nothing behind it and keeps its solid fill below.
      if (!p.hasAttribute(EXACT_ATTR)) p.setAttribute("fill-opacity", "0.4");
    }
    // An exact area (a letterform) stays fill-only: a 4.5 px echo stroke
    // around a glyph welds its counters shut. Everything else — rough.js's own
    // solid-fill paths included — keeps the bolder echo it has always had.
    if (p.hasAttribute(EXACT_ATTR)) continue;
    p.setAttribute("stroke", color);
    const w = parseFloat(p.getAttribute("stroke-width") ?? "3") || 3;
    p.setAttribute("stroke-width", String(w + 1.5));
  }
  for (const t of Array.from(c.querySelectorAll("text"))) {
    t.setAttribute("fill", color);
    t.removeAttribute("stroke");
  }
  // A code line's coloured runs (layout/model.ts TextDrawable.runs) sit on
  // nested tspans with their OWN `fill` — which, unlike the ancestor
  // <text>'s, is not overwritten above and would otherwise win, leaving the
  // emphasis echo rainbow-tinted instead of a flat highlight colour.
  for (const s of Array.from(c.querySelectorAll("tspan"))) s.removeAttribute("fill");
  return c;
}

/** The marker yellow — COLORS.region1, the same pen as a code pane's marks. */
const MARKER_COLOR = COLORS.region1;
/** Glow's band along a stroke: wide enough to read as a highlighter pass on a 2–3 px line. */
const BAND_WIDTH = 20;
/** Strength of a band or marker: the yellow at 60 %; a colour the caller chose
 *  (the answer green, say) at 35 %, since a saturated band that strong drowns the ink. */
const BAND_ALPHA = 0.6;
const BAND_ALPHA_COLORED = 0.35;
/** Where an emphasis colour reads as the target's own ink, the next of these that does not. */
const EMPHASIS_FALLBACKS = [HIGHLIGHT_COLOR, COLORS.supply, COLORS.accent];

/**
 * The colour to emphasise `own` ink with: `want`, unless the two read as one
 * ink (a red highlight on a red curve, blue on blue) — then the first
 * fallback that is neither the target's colour nor plain ink. Only the
 * DEFAULT colour switches; a colour the spec asked for is kept as asked.
 */
export function emphasisColorFor(want: string, own: string | undefined, explicit: boolean): string {
  if (explicit || !own || !readsAsSame(want, own)) return want;
  return EMPHASIS_FALLBACKS.find((c) => !readsAsSame(c, own) && !readsAsSame(c, INK)) ?? want;
}

/** What glow does to one leaf: a band under a line, a marker behind a code row, or the ink recoloured. */
export function glowKindOf(leaf: Exclude<Drawable, { kind: "group" }>): "band" | "marker" | "tint" {
  if (leaf.kind === "text" && leaf.font === "mono") return "marker";
  if (leaf.kind === "stroke" && leaf.pts.length >= 2 && !leaf.precise) return "band";
  return "tint";
}

/** A thick round-capped path — band and marker alike — under the ink, posed like its leaf. */
function penPath(d: string, color: string, width: number, alpha: number, pose: string | null): SVGPathElement {
  const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", color);
  p.setAttribute("stroke-width", String(width));
  p.setAttribute("stroke-opacity", String(alpha));
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  p.style.pointerEvents = "none";
  if (pose) p.setAttribute("transform", pose);
  return p;
}

/**
 * The marker behind a code row: one round-capped band per drawn row, from its
 * first non-blank character to its last, on the same CHAR_W grid the row's
 * letters are spaced to. Anchor-start rows only — a code pane's are.
 */
function markerRowsPath(leaf: Extract<Drawable, { kind: "text" }>, piece?: { row: number; col: number; len: number }): { d: string; width: number } | null {
  const rows = leaf.lines ?? [leaf.text];
  const fs = leaf.fontSize;
  const width = fs * 1.1;
  const cap = width / 2;
  const segs: string[] = [];
  rows.forEach((row, i) => {
    if (piece && piece.row !== i) return;
    const first = piece ? piece.col : row.search(/\S/);
    if (first < 0) return;
    const last = piece ? piece.col + piece.len : row.trimEnd().length;
    const y = toSvgY(leaf.pos[1] + ((rows.length - 1) / 2 - i) * LINE_HEIGHT * fs);
    const x0 = leaf.pos[0] + first * CHAR_W * fs - 0.25 * fs + cap;
    const x1 = Math.max(x0 + 0.5, leaf.pos[0] + last * CHAR_W * fs + 0.25 * fs - cap);
    segs.push(`M${x0.toFixed(1)} ${y.toFixed(1)} L${x1.toFixed(1)} ${y.toFixed(1)}`);
  });
  return segs.length > 0 ? { d: segs.join(" "), width } : null;
}

/** A box in SVG coordinates (y down, y = the top edge) — what ring and underline are drawn around. */
interface SvgBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const svgBoxOf = (b: BBox): SvgBox => ({ x: b.x, y: toSvgY(b.y + b.h), w: b.w, h: b.h });

function unionSvgBoxes(boxes: SvgBox[]): SvgBox | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The hand-drawn ring round a box. A whole element gets room (22/18); a
 *  part sits among its neighbours and gets a tight ring (12/9) that does not
 *  swallow them. */
function ellipseRingPath(box: SvgBox, color: string, rc: RoughSVG | null, tight = false): SVGGElement {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2 + (tight ? 12 : 22);
  const ry = box.h / 2 + (tight ? 9 : 18);
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.style.pointerEvents = "none";
  if (rc) {
    g.appendChild(rc.ellipse(cx, cy, rx * 2, ry * 2, { stroke: color, strokeWidth: 3.5, roughness: tight ? 1.2 : 1.6, fill: undefined, seed: 7 }));
  } else {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`);
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", "3.5");
    p.setAttribute("fill", "none");
    g.appendChild(p);
  }
  return g;
}

/** The pen line under a box — `underline`, written on left to right. */
function underlinePath(box: SvgBox, color: string, rc: RoughSVG | null): SVGGElement {
  const y = box.y + box.h + 5;
  const x0 = box.x - 3;
  const x1 = box.x + box.w + 3;
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.style.pointerEvents = "none";
  if (rc) {
    g.appendChild(rc.line(x0, y, x1, y, { stroke: color, strokeWidth: 3, roughness: 1, bowing: 1.2, seed: 5 }));
  } else {
    g.appendChild(plainPath(`M${x0.toFixed(1)} ${y.toFixed(1)} L${x1.toFixed(1)} ${y.toFixed(1)}`, { color, strokeWidth: 3 }));
  }
  for (const p of Array.from(g.querySelectorAll("path"))) p.setAttribute("stroke-linecap", "round");
  return g;
}

/**
 * Where a run of characters sits on one row of a text leaf, in SVG
 * coordinates before the leaf's pose. Mono text is exact (the CHAR_W grid
 * it is letter-spaced to); other text asks the browser for the glyphs'
 * extents, and without one (node tests) estimates half an em per character.
 */
function textPieceBox(g: SVGGElement, leaf: Extract<Drawable, { kind: "text" }>, row: number, col: number, len: number): SvgBox {
  const rows = textRows(leaf);
  const fs = leaf.fontSize;
  const text = g.querySelector("text") as SVGTextElement | null;
  if (leaf.font !== "mono" && text && typeof text.getExtentOfChar === "function") {
    try {
      const at = rowOffset(rows, row, col);
      const a = text.getExtentOfChar(at);
      const b = text.getExtentOfChar(at + len - 1);
      const m = text.transform?.baseVal?.consolidate?.()?.matrix;
      const dx = m ? m.e : 0;
      const dy = m ? m.f : 0;
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y + a.height, b.y + b.height);
      if (b.x + b.width > a.x) return { x: a.x + dx, y: top + dy, w: b.x + b.width - a.x, h: bottom - top };
    } catch {
      // fall through to the estimate
    }
  }
  const charW = (leaf.font === "mono" ? CHAR_W : 0.5) * fs;
  const rowW = rows[row].length * charW;
  const left = leaf.pos[0] - (leaf.anchor === "middle" ? rowW / 2 : leaf.anchor === "end" ? rowW : 0);
  const cy = toSvgY(leaf.pos[1] + ((rows.length - 1) / 2 - row) * LINE_HEIGHT * fs);
  return { x: left + col * charW, y: cy - 0.55 * fs, w: len * charW, h: 1.1 * fs };
}

/** A leaf's ink as an SVG box, before its pose — the whole of it, or one text piece. */
function pieceBox(g: SVGGElement, leaf: Exclude<Drawable, { kind: "group" }>, hit?: Extract<PartHit, { kind: "text" }>): SvgBox | null {
  if (leaf.kind === "text") {
    if (hit) return textPieceBox(g, leaf, hit.row, hit.col, hit.len);
    const rows = textRows(leaf);
    return unionSvgBoxes(rows.map((r, i) => textPieceBox(g, leaf, i, 0, r.length)));
  }
  if (leaf.kind === "image") return { x: leaf.pos[0] - leaf.w / 2, y: toSvgY(leaf.pos[1] + leaf.h / 2), w: leaf.w, h: leaf.h };
  if (leaf.pts.length === 0) return null;
  const xs = leaf.pts.map((p) => p[0]);
  const ys = leaf.pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y1 = Math.max(...ys);
  return { x: x0, y: toSvgY(y1), w: Math.max(...xs) - x0, h: y1 - Math.min(...ys) };
}

/**
 * An emphasis echo of ONE run of a text leaf's characters: the clone is the
 * whole text, recoloured, with everything outside [start, end) made
 * invisible, so it lies on the original and lights just the piece. Works on
 * the "holders" — the elements that carry text directly (the <text>, a row,
 * a coloured run) — which spell the rows end to end (rowOffset).
 */
function rangeClone(g: SVGGElement, color: string, start: number, end: number): SVGGElement {
  const c = g.cloneNode(true) as SVGGElement;
  c.removeAttribute("opacity");
  c.style.opacity = "0";
  c.style.pointerEvents = "none";
  const holders: Element[] = [];
  const walk = (el: Element) => {
    if (el.children.length === 0) holders.push(el);
    else Array.from(el.children).forEach(walk);
  };
  for (const t of Array.from(c.querySelectorAll("text"))) {
    t.setAttribute("fill", color);
    t.removeAttribute("stroke");
    walk(t);
  }
  let at = 0;
  for (const h of holders) {
    const txt = h.textContent ?? "";
    const a = at;
    const b = at + txt.length;
    at = b;
    if (h.tagName.toLowerCase() === "tspan") h.removeAttribute("fill");
    if (b <= start || a >= end) {
      h.setAttribute("fill-opacity", "0");
      continue;
    }
    if (a >= start && b <= end) continue;
    const i = Math.max(start, a) - a;
    const j = Math.min(end, b) - a;
    h.textContent = "";
    const piece = (t: string, hidden: boolean) => {
      if (t === "") return;
      const sp = document.createElementNS(SVG_NS, "tspan");
      sp.textContent = t;
      if (hidden) sp.setAttribute("fill-opacity", "0");
      h.appendChild(sp);
    };
    piece(txt.slice(0, i), true);
    piece(txt.slice(i, j), false);
    piece(txt.slice(j), true);
  }
  return c;
}

interface HighlightNodes {
  /** Everything that follows the level's opacity (echoes, the ring, bands, markers). */
  nodes: (SVGGElement | SVGPathElement)[];
  ringPaths: { el: SVGPathElement; len: number }[];
  /** How much of the ring has been written — the highest level it has seen. */
  drawn: number;
  /** glow's bands and markers, written on left to right. */
  penPaths: { el: SVGPathElement; len: number }[];
  /** How much of them has been written — never unwrites, like the ring. */
  written: number;
}

function makeEffects(
  svg: SVGSVGElement,
  overlay: SVGGElement,
  underlay: SVGGElement,
  leafNodes: Map<string, { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[]>,
  rc: RoughSVG | null,
): BackendEffects {
  const active = new Map<string, HighlightNodes>();
  const flows = new Map<string, SVGPathElement[]>();
  /** What a ghosted node's `transform` was before the drag picked it up — per
   *  NODE, so a geometry rebuild simply starts the ghost over on the new one
   *  rather than pasting a stale pose onto it. */
  const ghostBase = new WeakMap<Element, string>();
  const keyOf = (ids: string[]) => ids.join("|");
  let pointer: SVGGElement | null = null;

  const removeHighlight = (key: string) => {
    const st = active.get(key);
    if (!st) return;
    st.nodes.forEach((n) => n.remove());
    active.delete(key);
  };

  return {
    /**
     * ONE FRAME of emphasis, at intensity `level` (0-1). The shape over time —
     * three swells and then a hold — belongs to render/emphasis.ts and the
     * player that samples it; a backend only says what a level LOOKS like.
     * Nothing here removes the echo: `endHighlight` does, which is what lets
     * the player release exactly when the voice stops rather than at the end
     * of whatever cycle it happened to be in.
     */
    setHighlight(ids: string[], effect: HighlightEffect, level: number, box: BBox | null, color?: string, elapsedMs?: number, part?: string): void {
      const key = keyOf(ids);
      let st = active.get(key);
      if (!st) {
        st = { nodes: [], ringPaths: [], drawn: 0, penPaths: [], written: 0 };
        const entries = ids.flatMap((id) => leafNodes.get(id) ?? []);
        // `part` narrows the emphasis to a piece of the targets; one that
        // names nothing leaves the whole target lit (lint says why).
        const hits = part ? findPart(entries.map((e) => e.leaf), part) : [];
        const glyphHits = new Set(hits.flatMap((h) => (h.kind === "glyphs" ? h.leafIds : [])));
        const textHits = new Map(hits.flatMap((h) => (h.kind === "text" ? [[h.leafId, h] as const] : [])));
        const narrowed = hits.length > 0;
        const lit = narrowed ? entries.filter((e) => glyphHits.has(e.leaf.id) || textHits.has(e.leaf.id)) : entries;
        const writeOn = (el: SVGPathElement, into: { el: SVGPathElement; len: number }[]) => {
          const len = el.getTotalLength();
          el.style.strokeDasharray = `${len}`;
          el.style.strokeDashoffset = `${len}`;
          into.push({ el, len });
        };

        if (effect === "circle" || effect === "underline") {
          // Around (or under) the piece when there is one — measured on the
          // leaves and posed like them — else the targets' own layout box.
          let around: SvgBox | null = null;
          let pose: string | null = null;
          if (narrowed) {
            around = unionSvgBoxes(lit.flatMap((e) => pieceBox(e.g, e.leaf, textHits.get(e.leaf.id)) ?? []));
            pose = lit[0]?.g.getAttribute("transform") ?? null;
          } else if (box) {
            around = svgBoxOf(box);
          } else {
            around = unionSvgBoxes(entries.flatMap((e) => pieceBox(e.g, e.leaf) ?? []));
            pose = entries[0]?.g.getAttribute("transform") ?? null;
          }
          if (around) {
            const pen = color ?? HIGHLIGHT_COLOR;
            const mark = effect === "circle" ? ellipseRingPath(around, pen, rc, narrowed) : underlinePath(around, pen, rc);
            if (pose) mark.setAttribute("transform", pose);
            overlay.appendChild(mark);
            st.nodes.push(mark);
            // The ring is written by the level (it always has been); the
            // underline by the clock, like glow's pens.
            for (const p of Array.from(mark.querySelectorAll("path"))) writeOn(p as SVGPathElement, effect === "circle" ? st.ringPaths : st.penPaths);
          }
        } else {
          for (const { g, leaf } of lit) {
            const own = leaf.kind === "image" ? undefined : leaf.style.color;
            const hit = textHits.get(leaf.id);
            const glow = effect === "glow" ? glowKindOf(leaf) : "tint";
            if (glow === "tint") {
              const tint = emphasisColorFor(color ?? HIGHLIGHT_COLOR, own, color !== undefined);
              const clone =
                hit && leaf.kind === "text"
                  ? rangeClone(g, tint, rowOffset(textRows(leaf), hit.row, hit.col), rowOffset(textRows(leaf), hit.row, hit.col) + hit.len)
                  : emphasisClone(g, tint);
              overlay.appendChild(clone);
              st.nodes.push(clone);
              continue;
            }
            // band / marker: a highlighter pen UNDER the ink (the underlay
            // sits between the area layer and the strokes), so the line or
            // the letters stay exactly as they were, only lit from beneath.
            const pen = color ?? MARKER_COLOR;
            const alpha = color === undefined ? BAND_ALPHA : BAND_ALPHA_COLORED;
            const pose = g.getAttribute("transform");
            let path: SVGPathElement | null = null;
            if (glow === "band" && leaf.kind === "stroke") {
              path = penPath(pathFromPts(leaf.pts, leaf.closed), emphasisColorFor(pen, own, color !== undefined), BAND_WIDTH, alpha, pose);
            } else if (glow === "marker" && leaf.kind === "text") {
              const m = markerRowsPath(leaf, hit);
              if (m) path = penPath(m.d, pen, m.width, alpha, pose);
              // A code number is the marker's own yellow: re-ink whatever
              // reads as the pen, on an echo over the row, so it does not
              // vanish into the box.
              const sameAsPen = Array.from(g.querySelectorAll("tspan")).filter((t) => readsAsSame(t.getAttribute("fill") ?? "", pen));
              if (sameAsPen.length > 0) {
                const echo = g.cloneNode(true) as SVGGElement;
                echo.removeAttribute("opacity");
                echo.style.opacity = "0";
                echo.style.pointerEvents = "none";
                for (const t of Array.from(echo.querySelectorAll("tspan"))) {
                  if (readsAsSame(t.getAttribute("fill") ?? "", pen)) t.setAttribute("fill", INK);
                }
                overlay.appendChild(echo);
                st.nodes.push(echo);
              }
            }
            if (!path) continue;
            underlay.appendChild(path);
            st.nodes.push(path);
            writeOn(path, st.penPaths);
          }
        }
        active.set(key, st);
      }
      const a = Math.min(Math.max(level, 0), 1);
      if (st.ringPaths.length > 0) {
        // The ring is written ON by the rising level and then stays written:
        // a pen stroke does not unwrite itself when the throb dips.
        st.drawn = Math.max(st.drawn, a);
        for (const { el, len } of st.ringPaths) el.style.strokeDashoffset = `${len * (1 - st.drawn)}`;
      }
      if (st.penPaths.length > 0) {
        // Written by the clock when there is one, by the level otherwise (a
        // widget's one-shot swell); either way it never unwrites.
        st.written = Math.max(st.written, elapsedMs !== undefined ? writtenAt(elapsedMs) : a);
        for (const { el, len } of st.penPaths) el.style.strokeDashoffset = `${len * (1 - st.written)}`;
      }
      st.nodes.forEach((n) => (n.style.opacity = String(a)));
    },

    endHighlight(ids: string[]): void {
      removeHighlight(keyOf(ids));
    },

    /** The drag ghost: a translate PREPENDED to the node's own transform, so
     *  it applies after the element's pose exactly as poseTransform's own
     *  translate does (y-up in, SVG's y-down out). (0, 0) restores the
     *  remembered string and forgets it. */
    setOffset(id: string, dx: number, dy: number): void {
      for (const { g } of leafNodes.get(id) ?? []) {
        if (dx === 0 && dy === 0) {
          const base = ghostBase.get(g);
          if (base === undefined) continue;
          ghostBase.delete(g);
          if (base === "") g.removeAttribute("transform");
          else g.setAttribute("transform", base);
          continue;
        }
        let base = ghostBase.get(g);
        if (base === undefined) {
          base = g.getAttribute("transform") ?? "";
          ghostBase.set(g, base);
        }
        const t = `translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`;
        g.setAttribute("transform", base === "" ? t : `${t} ${base}`);
      }
    },

    setFocus(dimIds: string[], alpha: number): void {
      const a = Math.max(0, Math.min(1, alpha));
      for (const id of dimIds) {
        for (const { g } of leafNodes.get(id) ?? []) {
          if (a >= 1) g.style.removeProperty("opacity");
          else g.style.opacity = String(a);
        }
      }
    },

    endFocus(dimIds: string[]): void {
      for (const id of dimIds) {
        for (const { g } of leafNodes.get(id) ?? []) g.style.removeProperty("opacity");
      }
    },

    setFlow(ids: string[], o: FlowOpts, frame: { travelled: number; alpha: number }): void {
      const key = keyOf(ids);
      let paths = flows.get(key);
      if (!paths) {
        paths = [];
        for (const id of ids) {
          for (const { g, leaf } of leafNodes.get(id) ?? []) {
            if (leaf.kind !== "stroke" || leaf.pts.length < 2 || leaf.shapeHint) continue;
            const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
            p.setAttribute("d", pathFromPts(leaf.pts, leaf.closed));
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", o.color ?? leaf.style.color);
            p.setAttribute("stroke-linecap", "round");
            p.setAttribute("stroke-width", o.marks === "dots" ? "7" : "4");
            p.setAttribute("stroke-dasharray", o.marks === "dots" ? `0.1 ${o.spacing}` : `${o.spacing / 2} ${o.spacing / 2}`);
            p.style.pointerEvents = "none";
            g.appendChild(p); // inside the leaf's own group: inherits the element's pose and fade
            paths.push(p);
          }
        }
        flows.set(key, paths);
      }
      const phase = frame.travelled % o.spacing;
      const offset = o.reverse ? phase : -phase;
      for (const p of paths) {
        p.setAttribute("stroke-dashoffset", offset.toFixed(2));
        p.setAttribute("opacity", (0.95 * Math.max(0, Math.min(1, frame.alpha))).toFixed(3));
      }
    },

    endFlow(ids: string[]): void {
      const key = keyOf(ids);
      for (const p of flows.get(key) ?? []) p.remove();
      flows.delete(key);
    },

    setPointer(p: Pt | null): void {
      if (!p) {
        pointer?.setAttribute("display", "none");
        return;
      }
      if (!pointer) {
        pointer = document.createElementNS(SVG_NS, "g") as SVGGElement;
        pointer.style.pointerEvents = "none";
        const halo = document.createElementNS(SVG_NS, "circle");
        halo.setAttribute("r", "11");
        halo.setAttribute("fill", LASER_COLOR);
        halo.setAttribute("opacity", "0.28");
        const core = document.createElementNS(SVG_NS, "circle");
        core.setAttribute("r", "4.5");
        core.setAttribute("fill", LASER_COLOR);
        pointer.append(halo, core);
        overlay.appendChild(pointer);
      }
      pointer.removeAttribute("display");
      pointer.setAttribute("transform", `translate(${p[0].toFixed(1)} ${toSvgY(p[1]).toFixed(1)})`);
    },

    setCamera(box: BBox | null): void {
      const b = box ?? FULL_VIEW;
      svg.setAttribute("viewBox", `${b.x.toFixed(1)} ${toSvgY(b.y + b.h).toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}`);
    },
  };
}

function makeSvgBackend(opts: { name: string; label: string; sketchy: boolean }): BackendModule {
  return {
    name: opts.name,
    label: opts.label,
    async mount(layout: LayoutResult, _spec, container: HTMLElement): Promise<MountResult> {
      const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      // The canvas inside its paper margin (layout/canvas.ts VIEW_PAD).
      svg.setAttribute("viewBox", `${FULL_VIEW.x} ${toSvgY(FULL_VIEW.y + FULL_VIEW.h)} ${FULL_VIEW.w} ${FULL_VIEW.h}`);
      svg.setAttribute("class", "cs-svg");
      const rc = opts.sketchy ? rough.svg(svg) : null;

      const layers = { 0: document.createElementNS(SVG_NS, "g"), 1: document.createElementNS(SVG_NS, "g"), 2: document.createElementNS(SVG_NS, "g"), 3: document.createElementNS(SVG_NS, "g") };
      // Overlay for gesture effects (highlight echoes, laser pointer) — always on top.
      const overlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
      overlay.setAttribute("class", "cs-overlay");
      // Clip rectangles for windowed leaves (a code pane's window), shared by
      // rect so one <clipPath> serves every line of a pane. In <defs> so the
      // exporter's serialization carries them with the drawing.
      const defs = document.createElementNS(SVG_NS, "defs");
      const clipIds = new Map<string, string>();
      const clipFor = (clip: NonNullable<Drawable["clip"]>): string => {
        const key = `${clip.x},${clip.y},${clip.w},${clip.h}`;
        let id = clipIds.get(key);
        if (!id) {
          id = `cs-clip-${clipIds.size + 1}`;
          const cp = document.createElementNS(SVG_NS, "clipPath");
          cp.setAttribute("id", id);
          cp.setAttribute("clipPathUnits", "userSpaceOnUse");
          const r = document.createElementNS(SVG_NS, "rect");
          r.setAttribute("x", clip.x.toFixed(1));
          r.setAttribute("y", toSvgY(clip.y + clip.h).toFixed(1));
          r.setAttribute("width", clip.w.toFixed(1));
          r.setAttribute("height", clip.h.toFixed(1));
          cp.appendChild(r);
          defs.appendChild(cp);
          clipIds.set(key, id);
        }
        return id;
      };
      // glow's highlighter pens (a band along a line, the marker behind a
      // code row) go UNDER the ink but over the area layer — a region, a
      // code pane's own field — so the ink they light stays exactly as drawn.
      const underlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
      underlay.setAttribute("class", "cs-underlay");
      svg.append(defs, layers[0], underlay, layers[1], layers[2], layers[3], overlay);

      // Paint order: z layer, then IR order within the layer. Extracted so
      // swapGeometry/remount can rebuild nodes for a new layout without
      // duplicating the loop.
      const buildNodes = (
        l: LayoutResult,
        into: Map<string, LeafEntry[]>,
        visible?: ReadonlySet<string>,
        offsets?: Record<string, Pt>,
        turns?: Record<string, Turn>,
        opacities?: Record<string, number>,
        shapes?: Record<string, Record<string, Pt[]>>,
        texts?: Record<string, Record<string, string>>,
      ) => {
        for (const id of l.order) {
          if (visible && !visible.has(id)) continue;
          const parts = drawablesForId(l.drawables, id);
          const entry: LeafEntry[] = [];
          const turn = turns?.[id];
          const alpha = opacities?.[id];
          for (const leaf of leafDrawables(parts)) {
            // A morphed leaf substitutes its tween points for this frame —
            // the same handle-less-rebuild path a rotated/scaled tween frame
            // already relies on (see the pose comment just below).
            const pts = shapes?.[id]?.[leaf.id];
            // …and a measure's rewritten value substitutes its string, the
            // same way (design §2.3): a handle-less frame carries no setText.
            const text = texts?.[id]?.[leaf.id];
            const drawn =
              pts && (leaf.kind === "stroke" || leaf.kind === "area")
                ? { ...leaf, pts }
                : text !== undefined && leaf.kind === "text"
                  ? { ...leaf, text, lines: undefined }
                  : leaf;
            const g = drawLeaf(rc, drawn);
            const z = (leaf.z <= 0 ? 0 : leaf.z === 1 ? 1 : leaf.z === 2 ? 2 : 3) as 0 | 1 | 2 | 3;
            const [dx, dy] = offsets?.[id] ?? [0, 0];
            // The SAME string the element handle would write (poseTransform):
            // a tween frame attaches no handles, so anything it does not
            // reproduce here — a rotation, a scale — is simply lost for the
            // length of the tween.
            const pose = turn ? poseTransform(dx, dy, turn.deg, turn.pivot, turn.scale ?? 1, turn.mirror ?? false) : poseTransform(dx, dy, 0, [0, 0]);
            if (pose !== null) g.setAttribute("transform", pose);
            // EVERY leaf gets a wrapper `<g>` that fade targets (the handle's
            // fadeGroups), never the leaf's own node. The leaf node's opacity
            // is already spoken for twice over: text/image reveals write
            // `g.style.opacity` each frame, and drawLeaf puts the drawable's
            // AUTHORED `style.opacity` on `g` as an attribute for stroke and
            // area leaves. Fading `g` would clobber whichever applies; on a
            // wrapper the two nest, and SVG's opacity compositing multiplies
            // them instead.
            const fadeNode = document.createElementNS(SVG_NS, "g") as SVGGElement;
            fadeNode.appendChild(g);
            // Same reasoning as the pose: a handle-less frame must carry the
            // scene's fades or a dimmed element flashes back to full ink.
            if (alpha !== undefined && alpha < 1) fadeNode.setAttribute("opacity", Math.max(0, alpha).toFixed(3));
            // A clipped leaf scrolls INSIDE a fixed window: the clip sits on
            // a static wrapper, the offset transform stays on the leaf's own
            // group (the handle's setOffset targets that one), so the window
            // never moves with the line.
            if (leaf.clip) {
              const wrap = document.createElementNS(SVG_NS, "g") as SVGGElement;
              wrap.setAttribute("clip-path", `url(#${clipFor(leaf.clip)})`);
              wrap.appendChild(fadeNode);
              layers[z].appendChild(wrap);
            } else {
              layers[z].appendChild(fadeNode);
            }
            entry.push({ g, leaf, fadeNode });
          }
          into.set(id, entry);
        }
      };

      const leafNodes = new Map<string, LeafEntry[]>();
      buildNodes(layout, leafNodes);

      container.appendChild(svg);
      nudgeTextsIntoCanvas(svg);
      document.fonts?.ready?.then(() => {
        if (svg.isConnected) nudgeTextsIntoCanvas(svg);
      });

      // Handles need the nodes in the DOM (getTotalLength).
      const elements = new Map<string, RenderedElement>();
      for (const [id, entry] of leafNodes) {
        elements.set(
          id,
          new SvgElementHandle(id, entry, rc),
        );
      }

      return {
        elements,
        effects: makeEffects(svg, overlay, underlay, leafNodes, rc),
        destroy: () => svg.remove(),
        // A tween frame runs every rAF tick, so it rebuilds nodes and attaches
        // NO handles — no getTotalLength, no prepare/setProgress. That is only
        // correct while a freshly built node ALREADY looks fully drawn: any
        // paint a leaf builder hides behind a value the draw reveal later
        // overwrites (a knocked-down fill-opacity, say) would show up here as
        // a flicker for the whole tween. Keep the two in step — makeLeafHandle
        // ends its reveal on the node's own authored values.
        swapGeometry: (l, visible, offsets, turns, opacities, shapes, texts) => {
          layers[0].replaceChildren();
          layers[1].replaceChildren();
          layers[2].replaceChildren();
          layers[3].replaceChildren();
          // The SAME map makeEffects closed over, refreshed in place: the glow,
          // the focus dim, the flow and the widget's drag ghost all reach for
          // their nodes through it, and a throwaway map left every one of them
          // writing to the nodes this line has just detached (found in review
          // 2026-09-15 — one preview and the effects were painting nothing).
          // Still no handles and no measurement: the next commit rebinds those.
          leafNodes.clear();
          buildNodes(l, leafNodes, visible, offsets, turns, opacities, shapes, texts);
        },
        remount: (l) => {
          layers[0].replaceChildren();
          layers[1].replaceChildren();
          layers[2].replaceChildren();
          layers[3].replaceChildren();
          leafNodes.clear();
          buildNodes(l, leafNodes);
          nudgeTextsIntoCanvas(svg);
          const els = new Map<string, RenderedElement>();
          for (const [id, entry] of leafNodes) {
            els.set(
              id,
              new SvgElementHandle(id, entry, rc),
            );
          }
          return els;
        },
      };
    },
  };
}

/** The one renderer, in its two styles. Same drawables, same animation. */
export const sketchyRenderer = makeSvgBackend({ name: "sketchy", label: "Hand-drawn (rough.js)", sketchy: true });
export const cleanRenderer = makeSvgBackend({ name: "clean", label: "Clean lines", sketchy: false });

export type RenderStyle = "sketchy" | "clean";

export function rendererFor(style: RenderStyle): BackendModule {
  return style === "clean" ? cleanRenderer : sketchyRenderer;
}
