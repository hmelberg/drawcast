// plot3d: a 3D math plot in orbit-camera perspective — a wireframe surface
// z = f(x, y), a parametric space curve, or labeled points — with, when its
// expressions carry parameters, the equation written above it (each value
// its own part, eq_param_<name>) and an optional drawn panel of sliders.
// Everything is live: the layout re-runs on each animate frame and each
// widget patch (an orbit, a zoom, a scrubbed number), and `values` carries
// the numbers for {plot3d.<key>} tokens.
//
// Ported from the mathlogic pack's YAML body (2026-09-27) so the params-ui
// modules — TypeScript — could be used as they are. A figure with no
// parameters draws exactly what the pack version drew
// (tests/plot3d-parity.test.ts): the same ids, order, geometry and labels.
//
// ---- world-coordinate convention (deliberate) ----
// project3d's orbit camera treats world Y as "up" (azimuth spins around Y;
// elevation tilts toward/away from it) and world X/Z as the horizontal
// plane. Ordinary math notation treats z as "up". Every math (x, y, z) is
// converted ONCE via toWorld(): world = [x, z, y] — math z becomes world Y
// (vertical on screen), math y becomes world Z (depth). Every element id
// keeps its math meaning (axis_z is labeled "z" and points up on screen).
import { plotArea } from "../../layout/canvas";
import { COLORS, SKETCH_MS, Z_STROKE, defaultDrawOpts, defaultStyle, type AreaDrawable, type Drawable, type Pt } from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { Side } from "../../spec/types";
import { getLoadedEngines, type MathJaxEngine } from "../engines";
import { kit, type Camera3, type Prim3 } from "../kit";
import type { SceneLayout } from "../types";
import { drawEquation, equationTeX } from "../params-ui/equation";
import type { Node } from "../params-ui/expr";
import { drawPanel, panelRows, PANEL_W } from "../params-ui/panel";
import { gridCoords, readModel, rangeEnvs, sampleCurve3, sampleSurface, steadyZAbs, steadyZExtent, surfaceAt, zExtent, type Model, type Plot3dParams, type Vec3 } from "./model";
import { buildCells, clipPolygon, grow, heightColor, occluder, type Proj } from "./mesh";

export type { Plot3dParams } from "./model";

const toWorld = (mx: number, my: number, mz: number): Vec3 => [mx, mz, my];

/**
 * project3d's own camera-space projection (kit.ts project3d, the same
 * formula) — its "seg" primitive always splits in two for its depth sort,
 * so a 12×12 wireframe would explode into ~528 drawables instead of the 24
 * polylines this template promises. Axes and point markers go through
 * project3d; the wireframe and the curve are projected here, each ONE
 * polyline.
 */
export function proj3(camera: Required<Pick<Camera3, "azimuth" | "elevation" | "distance" | "fov" | "cx" | "cy">>, p: Vec3): { x: number; y: number; depth: number } {
  const az = (camera.azimuth * Math.PI) / 180;
  const el = (camera.elevation * Math.PI) / 180;
  const x1 = p[0] * Math.cos(az) - p[2] * Math.sin(az);
  const z1 = p[0] * Math.sin(az) + p[2] * Math.cos(az);
  const y2 = p[1] * Math.cos(el) - z1 * Math.sin(el);
  const z2 = p[1] * Math.sin(el) + z1 * Math.cos(el);
  const depth = camera.distance - z2;
  const s = camera.fov / Math.max(0.1, depth);
  return { x: camera.cx + x1 * s, y: camera.cy + y2 * s, depth };
}

/** The page: where the plot's centre sits, how big a world unit is, and the box its ink may use. */
export interface Page {
  cx: number;
  cy: number;
  /** Pixels a point at the camera's reach lands from the centre (before zoom). */
  pxPerReach: number;
  /** The plot's own box (logical, y-up): the ink is clipped to it once anything shares the page. */
  box: { x0: number; y0: number; x1: number; y1: number };
  eqCy: number;
  eqWidth: number;
  panel: { x0: number; x1: number; yMid: number };
  /** Where the height legend's bar stands (its left edge), when there is one: the plot's box stops short of it. */
  legendX: number;
}

const PX_PER_UNIT = 190;
const PX_LIVE = 270;
const PX_LIVE_PANEL = 250;
const EQ_LINE = 60;
const PANEL_RIGHT = 975;
/** The column the height legend keeps for itself at the plot's right. */
const LEGEND_W = 110;

/** A surface drawn with fills (style "mesh" / "solid"). */
const filledOf = (m: Model): boolean => m.kind === "surface" && m.fill.style !== "wire";

export function pageOf(m: Model): Page {
  const panelOn = m.panel.length > 0;
  const eqOn = m.showEquation;
  const shared = panelOn || eqOn;
  const panelX0 = PANEL_RIGHT - PANEL_W;
  const legendOn = filledOf(m) && m.fill.legend;
  const cx = panelOn ? 360 : legendOn ? 470 : 500;
  const boxX1 = panelOn ? panelX0 - 30 : 988;
  // The equation's line sits where equation_plot's first line does: under
  // the page's top margin, or under a card's heading when there is one.
  const eqCy = plotArea().y1 + 8 - EQ_LINE / 2;
  const cy = eqOn ? Math.min(320, eqCy - 300) : 350;
  return {
    cx,
    cy,
    // The pack's 190 frames the axis box's corner — a bound no orbit
    // reaches, so its figures sit small in the page; kept for them
    // (parity). A live figure — or a filled one, which the pack never
    // drew — frames its reach larger, and its ink is clipped to the
    // plot's box anyway.
    pxPerReach: m.steady || shared || filledOf(m) ? (panelOn ? PX_LIVE_PANEL : PX_LIVE) : PX_PER_UNIT,
    box: { x0: 12, y0: 12, x1: legendOn ? boxX1 - LEGEND_W : boxX1, y1: eqOn ? eqCy - 40 : 738 },
    legendX: boxX1 - 92,
    eqCy,
    eqWidth: 1000 - 60,
    panel: { x0: panelX0, x1: PANEL_RIGHT, yMid: cy },
  };
}

/** A polyline cut to the box: the pieces inside, each ending on the box's edge. */
export function clipToBox(pts: Pt[], b: Page["box"]): Pt[][] {
  const inside = (p: Pt): boolean => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
  // The segment p→q cut to the box (Liang–Barsky), or null.
  const cut = (p: Pt, q: Pt): [Pt, Pt] | null => {
    let t0 = 0;
    let t1 = 1;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    for (const [pp, qq] of [
      [-dx, p[0] - b.x0],
      [dx, b.x1 - p[0]],
      [-dy, p[1] - b.y0],
      [dy, b.y1 - p[1]],
    ]) {
      if (pp === 0) {
        if (qq < 0) return null;
      } else {
        const r = qq / pp;
        if (pp < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    return t0 <= t1 ? [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]] : null;
  };
  if (pts.every(inside)) return [pts];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const c = cut(pts[i - 1], pts[i]);
    if (!c) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(c[0]);
    cur.push(c[1]);
    if (!inside(pts[i])) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

/** A drawn equation, remembered: an orbit re-runs the layout every frame and the TeX has not changed. */
const eqMemo = new Map<string, ReturnType<typeof drawEquation>>();
function drawEquationMemo(mathjax: MathJaxEngine, o: Parameters<typeof drawEquation>[1]): ReturnType<typeof drawEquation> {
  const key = `${o.id}|${o.center.join(",")}|${o.width}|${o.lhsTeX}|${equationTeX(o).tex}|${o.set.params.map((p) => `${p.name}${p.editable ? "+" : "-"}`).join(",")}`;
  let r = eqMemo.get(key);
  if (!r) {
    r = drawEquation(mathjax, o);
    if (eqMemo.size > 40) eqMemo.clear();
    eqMemo.set(key, r);
  }
  // The pipeline may scale drawables in place (a template fit): hand out a copy.
  return structuredClone(r);
}

/** How far a one-line equation's ink reaches above its centre (a superscript's top). */
const EQ_HALF = 26;

/** Move a drawable (and its children) up or down in place. */
function shiftY(d: Drawable, dy: number): void {
  if (d.kind === "group") for (const c of d.children) shiftY(c, dy);
  else if (d.kind === "area") {
    d.pts = d.pts.map(([x, y]): Pt => [x, y + dy]);
    if (d.holes) d.holes = d.holes.map((h) => h.map(([x, y]): Pt => [x, y + dy]));
  } else if (d.kind === "stroke") d.pts = d.pts.map(([x, y]): Pt => [x, y + dy]);
  else if (d.kind === "text") d.pos = [d.pos[0], d.pos[1] + dy];
}

const trim = (v: number): string => {
  const s = kit.num(Number(v.toFixed(2)));
  return s === "-0" ? "0" : s;
};

export function layoutPlot3d(P: Plot3dParams): SceneLayout {
  const m = readModel(P);
  const page = pageOf(m);
  // Ink and letters keep to the plot's box once something shares the page
  // or the view is zoomed; a figure with neither is drawn as it always was.
  const clip = m.steady || filledOf(m) || m.showEquation || m.panel.length > 0 || m.camera.zoom !== 1;
  const C = COLORS;
  const MS = SKETCH_MS;

  // ---- the equation, in the drawing's hand, values in ----------------------
  // Laid out first: its top hangs from the page's top line, and a tall one
  // (a fraction) pushes the plot's box — and its centre — down.
  let eqDrawn: ReturnType<typeof drawEquation> | null = null;
  if (m.showEquation) {
    const lhs = m.kind === "curve" ? "(x, y, z)" : "z";
    const nodes = m.kind === "curve" ? [m.curve!.x.node, m.curve!.y.node, m.curve!.z.node] : [m.surface?.node ?? null];
    if (nodes.every((n): n is Node => n !== null)) {
      const mathjax = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
      eqDrawn = drawEquationMemo(mathjax, {
        id: "eq",
        lhsTeX: lhs,
        node: nodes.length === 1 ? nodes[0] : nodes,
        variables: m.variables,
        set: m,
        form: "values",
        center: [m.panel.length > 0 ? (page.box.x0 + page.panel.x1) / 2 : 500, page.eqCy],
        width: page.eqWidth,
      });
      const ys = eqDrawn.drawables.flatMap((d) => (d.kind === "group" ? d.children : [d])).flatMap((d) => (d.kind === "area" ? d.pts.map((q) => q[1]) : []));
      if (ys.length > 0) {
        const top = Math.max(...ys);
        const lift = page.eqCy + EQ_HALF - top; // a one-line equation's top sits EQ_HALF above its centre
        if (lift < 0) {
          for (const d of eqDrawn.drawables) shiftY(d, lift);
          for (const k of Object.keys(eqDrawn.anchors)) eqDrawn.anchors[k] = [eqDrawn.anchors[k][0], eqDrawn.anchors[k][1] + lift];
        }
        const bottom = Math.min(...ys) + Math.min(0, lift);
        const y1 = Math.min(page.box.y1, bottom - 14);
        if (y1 < page.box.y1) {
          page.cy -= (page.box.y1 - y1) / 2;
          page.panel.yMid = page.cy;
          page.box.y1 = y1;
        }
      }
    }
  }
  const CX = page.cx;
  const CY = page.cy;

  // ---- raw world-space content for the active kind (camera-independent) ----
  let gridWorld: Vec3[][] | null = null; // gridWorld[i][j], i = y-index (row), j = x-index (col)
  let curveWorld: Vec3[] | null = null;
  let pointsWorld: { w: Vec3; label: string | null }[] | null = null;
  const contentPts: Vec3[] = [];
  /** math z → world height. */
  let zWorld: (z: number) => number = (z) => z;
  const values: Record<string, number> = {};
  // style "mesh" / "solid": filled cells under the wires (mesh.ts).
  const fill = m.fill;
  const filled = m.kind === "surface" && fill.style !== "wire";
  let heightScale: { lo: number; hi: number; t: (worldHeight: number) => number } | null = null;

  if (m.kind === "surface") {
    const xs = gridCoords(m);
    const [d0, d1] = m.domain;
    const zHalf = (d1 - d0) / 2; // the surface's world height matches its domain's own scale
    const raw = m.surface?.node ? sampleSurface(m) : null;
    if (m.steady) {
      // Proportional, z = 0 on the origin, one scale over every value the parameters may take.
      const zAbs = steadyZAbs(m);
      const k = zAbs < 1e-9 ? 1 : zHalf / zAbs;
      zWorld = (z) => z * k;
      // The height colours run over the same fixed range: a colour means one height whatever the sliders do.
      if (filled) {
        const [lo, hi] = steadyZExtent(m);
        heightScale = { lo, hi, t: (w) => (hi - lo < 1e-9 ? 0.5 : (w / k - lo) / (hi - lo)) };
      }
    } else if (raw) {
      let zMin = Infinity;
      let zMax = -Infinity;
      raw.forEach((row) => row.forEach((z) => ((zMin = Math.min(zMin, z)), (zMax = Math.max(zMax, z)))));
      const zSpan = zMax - zMin;
      zWorld = (z) => (zSpan < 1e-9 ? 0 : ((z - zMin) / zSpan - 0.5) * 2 * zHalf);
      if (filled) heightScale = { lo: zMin, hi: zMax, t: (w) => (zSpan < 1e-9 ? 0.5 : w / (2 * zHalf) + 0.5) };
    }
    if (raw) {
      gridWorld = raw.map((row, i) =>
        row.map((z, j) => {
          const w = toWorld(xs[j], xs[i], zWorld(z));
          contentPts.push(w);
          return w;
        }),
      );
      const [lo, hi] = zExtent(m);
      values.z_min = Number(lo.toFixed(6));
      values.z_max = Number(hi.toFixed(6));
    }
    if (m.steady) {
      // The camera frames the whole reach, whatever the parameters do.
      const d = Math.max(Math.abs(d0), Math.abs(d1));
      contentPts.push([d, zHalf, d]);
    }
  } else if (m.kind === "curve") {
    curveWorld = sampleCurve3(m).map(([x, y, z]) => toWorld(x, y, z));
    contentPts.push(...curveWorld);
    if (m.steady) for (const env of rangeEnvs(m).slice(1)) for (const [x, y, z] of sampleCurve3(m, env)) contentPts.push(toWorld(x, y, z));
  } else {
    pointsWorld = (P.points ?? []).map((p) => {
      const at = p && Array.isArray(p.at) && p.at.length === 3 && p.at.every(Number.isFinite) ? p.at : [0, 0, 0];
      const w = toWorld(at[0], at[1], at[2]);
      contentPts.push(w);
      return { w, label: p && typeof p.label === "string" && p.label.trim() !== "" ? p.label : null };
    });
  }

  // ---- axes: one length per world axis, hugging the content's own extent ----
  const reachOn = (k: number): number => contentPts.reduce((a, p) => Math.max(a, Math.abs(p[k])), 0);
  const lenX = Math.max(1, reachOn(0) * 1.4);
  const lenVert = Math.max(1, reachOn(1) * 1.4); // world Y = math z
  const lenDepth = Math.max(1, reachOn(2) * 1.4); // world Z = math y
  // Camera reach: the corner of the axis box, a safe bound for how far
  // anything in the scene can be from the origin.
  // A live figure frames its longest axis instead (its ink is clipped to
  // the plot's box, so a corner a steep view swings out cannot spill).
  const reach = page.pxPerReach === PX_PER_UNIT ? Math.hypot(lenX, lenVert, lenDepth) : Math.max(lenX, lenVert, lenDepth) * 1.2;

  const DIST_FACTOR = 4;
  const distance = m.camera.distance ?? reach * DIST_FACTOR;
  // fov set so a point at radius `reach`, at zero depth offset, lands
  // pxPerReach (× zoom) from the centre — independent of distance, so a
  // distance override still frames the same way (distance only changes how
  // strong the perspective feels).
  const fov = (page.pxPerReach * m.camera.zoom * distance) / reach;
  const camera = { azimuth: m.camera.azimuth, elevation: m.camera.elevation, distance, fov, cx: CX, cy: CY };

  const axisLabelsIn = P.axis_labels && typeof P.axis_labels === "object" ? P.axis_labels : {};
  const axisText = (k: "x" | "y" | "z"): string => (typeof axisLabelsIn[k] === "string" && axisLabelsIn[k]!.trim() !== "" ? axisLabelsIn[k]! : k);
  const axisSpecs: { id: string; dir: Vec3; len: number; label: string }[] = [
    { id: "axis_x", dir: [1, 0, 0], len: lenX, label: axisText("x") },
    { id: "axis_y", dir: [0, 0, 1], len: lenDepth, label: axisText("y") },
    { id: "axis_z", dir: [0, 1, 0], len: lenVert, label: axisText("z") },
  ];

  // ---- axes + points batch: project3d's reliable scope (single-piece arrow/sphere prims) ----
  const prims: Prim3[] = [];
  const depthRef: Record<string, Vec3> = {};
  for (const ax of axisSpecs) {
    const tip: Vec3 = [ax.dir[0] * ax.len, ax.dir[1] * ax.len, ax.dir[2] * ax.len];
    prims.push({ kind: "arrow", id: ax.id, a: [0, 0, 0], b: tip, w: 3, color: C.guide, ms: MS.axis });
    depthRef[ax.id] = [tip[0] / 2, tip[1] / 2, tip[2] / 2];
  }
  const ptR = Math.max(0.05, reach * 0.035);
  if (pointsWorld) {
    pointsWorld.forEach((pt, i) => {
      const id = `pt_${i}`;
      prims.push({ kind: "sphere", id, c: pt.w, r: ptR, color: C.accent, ms: MS.node });
      depthRef[id] = pt.w;
    });
  }
  // Marks: dots ON the surface.
  const markInfo: { id: string; w: Vec3; text: string | null }[] = [];
  if (m.kind === "surface" && gridWorld) {
    m.marks.forEach((mk, i) => {
      const coord = (a: number | string): number => (typeof a === "number" ? a : (m.byName.get(a)?.value ?? NaN));
      const x = coord(mk.at[0]);
      const y = coord(mk.at[1]);
      const z = surfaceAt(m, x, y);
      if (![x, y, z].every(Number.isFinite)) return;
      const id = `mark_${i}`;
      values[`${id}_x`] = Number(x.toFixed(6));
      values[`${id}_y`] = Number(y.toFixed(6));
      values[`${id}_z`] = Number(z.toFixed(6));
      const w = toWorld(x, y, zWorld(z));
      // The same size on screen at any zoom: a dot marks a place, it is not a ball in the world.
      prims.push({ kind: "sphere", id, c: w, r: (ptR * 1.1) / m.camera.zoom, color: C.demand, fill: C.demand, ms: MS.dot });
      depthRef[id] = w;
      const text = mk.label === true ? `(${trim(x)}, ${trim(y)}, ${trim(z)})` : typeof mk.label === "string" && mk.label.trim() !== "" ? mk.label : null;
      markInfo.push({ id, w, text });
    });
  }
  const projected = kit.project3d(camera, prims);
  if (clip) {
    // An axis a zoom carries past the plot's box is cut at its edge (its arrowhead goes with the cut-off tip).
    projected.drawables = projected.drawables.flatMap((d) => {
      if (!/^axis_[xyz]$/.test(d.id) || d.kind !== "stroke") return [d];
      const pieces = clipToBox(d.pts, page.box);
      if (pieces.length === 0) return [];
      if (pieces[0] === d.pts) return [d];
      const { arrowhead: _cut, ...rest } = d;
      return [{ ...rest, pts: pieces[0] }];
    });
  }

  // ---- labels: through the collision solver (kit.label → layout/labels.ts),
  // never fixed 3D text. An orbit often foreshortens an axis nearly to zero
  // length, its tip then in the origin cluster; every anchor gets a
  // SCREEN-SPACE floor radius from the origin (which always projects to
  // [CX, CY]) along its own direction, a margin PAST its tip, and a nudge
  // OFF its own line, so the solver's compass choice can never lay the label
  // along the axis it names (reproduced: grid_n=2, azimuth 125-145,
  // elevation -45). Each axis label ignores only its OWN axis stroke.
  function sideFromDir(dx: number, dy: number): Side {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax < 0.35 * ay) return dy >= 0 ? "above" : "below";
    if (ay < 0.35 * ax) return dx >= 0 ? "right" : "left";
    if (dx >= 0 && dy >= 0) return "above-right";
    if (dx >= 0 && dy < 0) return "below-right";
    if (dx < 0 && dy >= 0) return "above-left";
    return "below-left";
  }
  const LABEL_INSET = 28;
  const MIN_ANCHOR_R = 95;
  const EXTRA_GAP = 45;
  const PERP_GAP = 22;
  function anchorFor(p2d: Pt): { anchor: Pt; side: Side } {
    const dx = p2d[0] - CX;
    const dy = p2d[1] - CY;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return { anchor: [CX, CY + MIN_ANCHOR_R], side: "above" };
    const targetR = Math.max(MIN_ANCHOR_R, d + EXTRA_GAP);
    const k = targetR / d;
    const ux = dx / d;
    const uy = dy / d;
    const px = -uy;
    const py = ux;
    const anchor: Pt = [CX + dx * k + px * PERP_GAP, CY + dy * k + py * PERP_GAP];
    // Sharing the page, a letter stays in the plot's box — never beside the equation or on the panel.
    if (clip) {
      const b = page.box;
      const x = Math.min(b.x1 - LABEL_INSET, Math.max(b.x0 + LABEL_INSET, anchor[0]));
      const y = Math.min(b.y1 - LABEL_INSET, Math.max(b.y0 + LABEL_INSET, anchor[1]));
      // Pulled back toward the tip, it would sit on its own axis: set it beside the line instead.
      if (x !== anchor[0] || y !== anchor[1]) return { anchor: [x + px * PERP_GAP, y + py * PERP_GAP], side: sideFromDir(px, py) };
    }
    return { anchor, side: sideFromDir(dx, dy) };
  }
  const attached: Record<string, string[]> = {};
  const labels: LabelRequest[] = [];
  for (const ax of axisSpecs) {
    const { anchor, side } = anchorFor(projected.anchors[ax.id]);
    labels.push({ ...kit.label(`${ax.id}_label`, anchor, side, ax.label, { fontSize: 24, color: C.guide }), ignore: [ax.id] });
    attached[ax.id] = [`${ax.id}_label`];
  }
  if (pointsWorld) {
    pointsWorld.forEach((pt, i) => {
      if (!pt.label) return;
      const id = `pt_${i}`;
      const { anchor, side } = anchorFor(projected.anchors[id]);
      labels.push({ ...kit.label(`pt_label_${i}`, anchor, side, pt.label, { fontSize: 20, color: C.ink }), ignore: [id] });
    });
  }
  markInfo.forEach((mk, i) => {
    if (!mk.text) return;
    const { anchor, side } = anchorFor(projected.anchors[mk.id]);
    labels.push({ ...kit.label(`mark_label_${i}`, anchor, side, mk.text, { fontSize: 22, color: C.demand }), ignore: [mk.id] });
    attached[mk.id] = [`mark_label_${i}`];
  });

  // ---- wireframe / curve: hand-projected, one polyline per row/column/curve ----
  const manual: { id: string; depth: number; drawable: Drawable }[] = [];
  const pushLine = (id: string, world: Vec3[], o: Parameters<typeof kit.stroke>[2]): Pt[] | null => {
    const qs = world.map((p) => proj3(camera, p));
    const pts = qs.map((q): Pt => [q.x, q.y]);
    const depth = qs.reduce((s, q) => s + q.depth, 0) / qs.length;
    const pieces = clip ? clipToBox(pts, page.box) : [pts];
    if (pieces.length === 0) return null;
    const drawable: Drawable =
      pieces.length === 1 ? kit.stroke(id, pieces[0], o) : { ...kit.group(id, pieces.map((p, k) => kit.stroke(`${id}__s${k}`, p, o))), style: kit.stroke(id, pts, o).style };
    manual.push({ id, depth, drawable });
    return pieces[0];
  };
  let curveMid: Pt | null = null;
  let fillGroup: Drawable | null = null;
  if (gridWorld && filled) {
    const mesh = meshOf(gridWorld, camera, heightScale?.t ?? (() => 0.5), fill, clip ? page.box : null, reach);
    fillGroup = mesh.fill;
    manual.push(...mesh.wires.map((w) => ({ ...w, depth: 0 })));
  } else if (gridWorld) {
    for (let i = 0; i < m.gridN; i++) pushLine(`wire_row_${i}`, gridWorld[i], { color: C.ink, strokeWidth: 3, ms: MS.stroke });
    for (let j = 0; j < m.gridN; j++) pushLine(`wire_col_${j}`, gridWorld.map((row) => row[j]), { color: C.supply, strokeWidth: 3, ms: MS.stroke });
  } else if (curveWorld) {
    const first = pushLine("curve", curveWorld, { color: C.demand, strokeWidth: 4, ms: MS.curve });
    if (first) curveMid = first[Math.floor(first.length / 2)];
  }

  // ---- one painter's-order list: project3d's pieces and the manual ones ----
  const merged = projected.drawables.map((d) => ({ id: d.id, depth: proj3(camera, depthRef[d.id]).depth, drawable: d })).concat(manual);
  merged.sort((a, b) => b.depth - a.depth); // far first, project3d's own convention
  // A mark sits ON the surface: drawn over the wires, never lost behind the near ones.
  merged.sort((a, b) => Number(a.id.startsWith("mark_")) - Number(b.id.startsWith("mark_")));
  if (fillGroup) {
    // Filled: the axes first, then the cells back to front, then the wires
    // (their hidden stretches already cut away), then the marks.
    const rank = (id: string): number => (/^axis_/.test(id) ? 0 : id.startsWith("mark_") ? 3 : 2);
    merged.sort((a, b) => rank(a.id) - rank(b.id));
    const cellsAt = merged.filter((x) => rank(x.id) === 0).length;
    merged.splice(cellsAt, 0, { id: fillGroup.id, depth: 0, drawable: fillGroup });
  }

  const drawables = merged.map((x) => x.drawable);
  // Labels paint last (on top) — they're read, not occluded.
  let order = merged.map((x) => x.id).concat(labels.map((l) => l.id));
  const anchors: Record<string, Pt> = { ...projected.anchors };
  if (curveMid) anchors.curve = curveMid;

  if (typeof P.title === "string" && P.title.trim() !== "") {
    labels.push(kit.label("title", [CX, 60], "below", P.title, { fontSize: 28 }));
    order = order.concat(["title"]);
  }

  // Sets: `draw: ["axes"]` for the three arrows and their letters,
  // `draw: ["surface"]` for every wireframe line.
  const groups: Record<string, string[]> = {
    axes: order.filter((id) => /^axis_[xyz](_label)?$/.test(id)),
  };
  const wires = order.filter((id) => /^wire_(row|col)_\d+$/.test(id));
  if (wires.length > 0) groups.surface = wires;
  if (fillGroup) {
    // A filled surface: `surface` is the wires AND the fill — a draw sketches
    // the wires in first, then the cells fade in under them, back to front.
    groups.surface_wires = wires;
    groups.surface = [...wires, fillGroup.id];
  }

  // ---- the equation (laid out above) --------------------------------------
  const drawnWith: Record<string, string[]> = {};
  // A mark's name comes with its dot.
  markInfo.forEach((mk, i) => {
    if (mk.text) drawnWith[mk.id] = [`mark_label_${i}`];
  });
  if (eqDrawn) {
    const r = eqDrawn;
    for (const d of r.drawables) {
      drawables.push(d);
      order.push(d.id);
      anchors[d.id] = r.anchors[d.id];
    }
    if (r.paramIds.length > 0) {
      attached.eq = r.paramIds;
      drawnWith.eq = r.paramIds;
    }
    groups.equations = ["eq", ...r.paramIds];
  }

  // ---- the panel -----------------------------------------------------------
  const panel = drawPanel(panelRows(m.panel, page.panel));
  for (const d of panel.drawables) {
    drawables.push(d);
    order.push(d.id);
    anchors[d.id] = panel.anchors[d.id];
  }
  Object.assign(drawnWith, panel.drawnWith);
  Object.assign(attached, panel.attached);
  if (panel.ids.length > 0) groups.panel = panel.ids;

  // ---- the colour bar: the height scale, low to high ------------------------
  if (fill.legend && heightScale && fillGroup) {
    const bar = colorBar(page, heightScale.lo, heightScale.hi, axisText("z"));
    for (const d of bar.drawables) {
      drawables.push(d);
      order.push(d.id);
    }
    Object.assign(anchors, bar.anchors);
    attached.colorbar = bar.labels;
    drawnWith.colorbar = bar.labels;
    groups.legend = ["colorbar", ...bar.labels];
  }

  // ---- values --------------------------------------------------------------
  for (const p of m.params) values[p.name] = p.value;
  values.azimuth = m.camera.azimuth;
  values.elevation = m.camera.elevation;
  values.zoom = m.camera.zoom;

  const out: SceneLayout = { drawables, labels, anchors, order, attached, groups, values };
  if (Object.keys(drawnWith).length > 0) out.drawnWith = drawnWith;
  return out;
}

/** Pen of a filled surface's wires: thin over the fills, a hairline for "solid". */
const MESH_WIRE = { mesh: { width: 1.6, opacity: 0.75 }, solid: { width: 1.1, opacity: 0.18 } } as const;
/** How far each cell reaches past its edges (logical units) so neighbours overlap and no paper seam shows. */
const CELL_GROW = 0.45;

type Cam = Parameters<typeof proj3>[0];

/**
 * A filled surface's drawables: the cells (exact fills, painter's order,
 * far first), and the wires drawn thin over them with every stretch a
 * nearer part of the surface hides cut away. `tOf` maps a world height onto
 * the colour scale.
 */
export function meshOf(
  world: Vec3[][],
  camera: Cam,
  tOf: (worldHeight: number) => number,
  fill: Model["fill"],
  box: Page["box"] | null,
  reach: number,
): { fill: Drawable; wires: { id: string; drawable: Drawable }[] } {
  const n = world.length;
  const proj: Proj[][] = world.map((row) => row.map((p) => proj3(camera, p)));
  const az = (camera.azimuth * Math.PI) / 180;
  const el = (camera.elevation * Math.PI) / 180;
  const [ca, sa, ce, se] = [Math.cos(az), Math.sin(az), Math.cos(el), Math.sin(el)];
  // A world vector into camera space (x right, y up, z toward the eye): proj3's rotation.
  const rotate = (v: Vec3): Vec3 => {
    const x1 = v[0] * ca - v[2] * sa;
    const z1 = v[0] * sa + v[2] * ca;
    return [x1, v[1] * ce - z1 * se, v[1] * se + z1 * ce];
  };
  const cells = buildCells(world, proj, rotate, tOf, fill.colorBy, fill.shading);
  // A draw of the whole fill (its cells one after another, back to front) takes about half what the wires do.
  const ms = Math.max(8, Math.round((SKETCH_MS.stroke * n) / Math.max(1, (n - 1) * (n - 1))));
  const cellDrawables: Drawable[] = [];
  for (const c of cells) {
    const pts = box ? clipPolygon(grow(c.pts, CELL_GROW), box) : grow(c.pts, CELL_GROW);
    if (pts.length < 3) continue;
    const d: AreaDrawable = {
      id: `surface_fill__${c.i}_${c.j}`,
      kind: "area",
      pts,
      precise: true,
      // In the stroke layer, so the paint order is this list's: over the axes, under the wires.
      z: Z_STROKE,
      style: defaultStyle({ fill: c.color, opacity: fill.opacity, strokeWidth: 0 }),
      drawOpts: defaultDrawOpts("sketch", ms),
    };
    cellDrawables.push(d);
  }
  // ONE element: the cells are its leaves, in paint order. (361 ids of their
  // own would make every per-id pass of the page and the player quadratic.)
  const fillGroup = kit.group("surface_fill", cellDrawables);

  // ---- the wires, their hidden stretches cut away ----
  const hidden = occluder(cells, proj, reach * 1e-3);
  const pen = MESH_WIRE[fill.style === "solid" ? "solid" : "mesh"];
  const o = { color: COLORS.ink, strokeWidth: pen.width, opacity: pen.opacity, ms: SKETCH_MS.stroke };
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const wires: { id: string; drawable: Drawable }[] = [];
  /** One wire: its grid points (world) and their projections; `borders(k)` the cells segment k→k+1 edges. */
  const wire = (id: string, w: Vec3[], q: Proj[], borders: (k: number) => [number, number][]): void => {
    const runs: Pt[][] = [];
    let cur: Pt[] = [];
    const close = (): void => {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    };
    for (let k = 0; k < w.length - 1; k++) {
      const own = borders(k);
      const skip = (i: number, j: number): boolean => own.some(([a, b]) => a === i && b === j);
      // Each half of a segment is seen or hidden as its own middle is.
      const seen = [0.25, 0.75].map((t) => !hidden(proj3(camera, lerp(w[k], w[k + 1], t)), skip));
      const a: Pt = [q[k].x, q[k].y];
      const b: Pt = [q[k + 1].x, q[k + 1].y];
      if (seen[0] && seen[1]) {
        if (cur.length === 0) cur.push(a);
        cur.push(b);
        continue;
      }
      const mid = proj3(camera, lerp(w[k], w[k + 1], 0.5));
      const m: Pt = [mid.x, mid.y];
      if (seen[0]) {
        if (cur.length === 0) cur.push(a);
        cur.push(m);
        close();
      } else if (seen[1]) {
        close();
        cur.push(m, b);
      } else close();
    }
    close();
    const pieces = box ? runs.flatMap((r) => clipToBox(r, box)) : runs;
    if (pieces.length === 0) return;
    const drawable: Drawable =
      pieces.length === 1 ? kit.stroke(id, pieces[0], o) : { ...kit.group(id, pieces.map((p, k) => kit.stroke(`${id}__s${k}`, p, o))), style: kit.stroke(id, pieces[0], o).style };
    wires.push({ id, drawable });
  };
  const inGrid = (c: [number, number][]): [number, number][] => c.filter(([i, j]) => i >= 0 && j >= 0 && i < n - 1 && j < n - 1);
  for (let i = 0; i < n; i++)
    wire(`wire_row_${i}`, world[i], proj[i], (k) =>
      inGrid([
        [i - 1, k],
        [i, k],
      ]),
    );
  for (let j = 0; j < n; j++)
    wire(
      `wire_col_${j}`,
      world.map((row) => row[j]),
      proj.map((row) => row[j]),
      (k) =>
        inGrid([
          [k, j - 1],
          [k, j],
        ]),
    );
  return { fill: fillGroup, wires };
}

/**
 * The height legend: a slim vertical bar of the ramp at the plot box's right
 * edge, the scale's top and bottom written beside it and the z axis's name
 * under it. One id for the bar (`colorbar`), its words their own.
 */
function colorBar(page: Page, lo: number, hi: number, zName: string): { drawables: Drawable[]; anchors: Record<string, Pt>; labels: string[] } {
  const STRIPS = 24;
  const W = 20;
  const H = 220;
  const x0 = page.legendX;
  const y0 = page.cy - H / 2;
  const strips: Drawable[] = [];
  for (let k = 0; k < STRIPS; k++) {
    const ya = y0 + (H * k) / STRIPS;
    const yb = y0 + (H * (k + 1)) / STRIPS + (k < STRIPS - 1 ? 0.5 : 0);
    const d: AreaDrawable = {
      id: `colorbar__${k}`,
      kind: "area",
      pts: [
        [x0, ya],
        [x0 + W, ya],
        [x0 + W, yb],
        [x0, yb],
      ],
      precise: true,
      z: Z_STROKE,
      style: defaultStyle({ fill: heightColor((k + 0.5) / STRIPS), strokeWidth: 0 }),
      drawOpts: defaultDrawOpts("sketch", 20),
    };
    strips.push(d);
  }
  const frame = kit.stroke(
    "colorbar__frame",
    [
      [x0, y0],
      [x0 + W, y0],
      [x0 + W, y0 + H],
      [x0, y0 + H],
    ],
    { closed: true, color: COLORS.guide, strokeWidth: 1.5, ms: SKETCH_MS.guides },
  );
  const bar = kit.group("colorbar", [...strips, frame]);
  const fs = 20;
  const texts = [
    kit.text("colorbar_max", [x0 + W + 8, y0 + H - fs * 0.35], trim(hi), { fontSize: fs, color: COLORS.guide, anchor: "start" }),
    kit.text("colorbar_min", [x0 + W + 8, y0 - fs * 0.35], trim(lo), { fontSize: fs, color: COLORS.guide, anchor: "start" }),
    kit.text("colorbar_label", [x0 + W / 2, y0 + H + 22], zName, { fontSize: 22, color: COLORS.guide }),
  ];
  return {
    drawables: [bar, ...texts],
    anchors: { colorbar: [x0 + W / 2, y0 + H / 2], colorbar_max: texts[0].pos, colorbar_min: texts[1].pos, colorbar_label: texts[2].pos },
    labels: texts.map((t) => t.id),
  };
}
