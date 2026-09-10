// Tier-2/3 layout: turns semantic elements into Drawables. The LLM never
// places anything here except tier-3 escape-hatch coordinates.

import { CANVAS, linearScale, plotArea } from "./canvas";
import { makeAxes } from "./axes";
import { interpolateAtX, intersectPolylines, qualitativeShape, sampleExpression } from "./curves";
import { centroid, type BBox } from "./geometry";
import { heuristicMeasure, type MeasureFn } from "./measure";
import * as M from "./measures";
import { codeDrawables, type CodeWindow } from "./code";
import { UNIVERSAL_ANCHORS, boxAnchor, isUniversalAnchor, polygonAnchors, polylineAnchors, ptsBox, sectorAnchors } from "./anchors";
import { boxOfId } from "./boxes";
import { fitTransform, ownBBox, pickSide, placementOrder, refBBox, relAt, relativeDelta, scaleDrawables, shiftDrawables, shiftPoints } from "./place";
import { fitRegion, isFitName } from "./regions";
import {
  COLORS,
  LINE_HEIGHT,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  SUB_SUFFIXES,
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
import { mathDrawables } from "./math";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import { catmullRom, catmullRomClosed } from "./smooth";
import { decodeIcon, decodePhoto, decodeSourceImage, decodeTrace } from "../spec/trace";
import { obstacleBoxes, wrapText, type LabelRequest } from "./labels";
import { enginesLoaded, getLoadedEngines, type MathJaxEngine } from "../scenes/engines";
import { linkKindOf } from "../ui/link-model";
import type { LintIssue } from "../lint/lint";
import type { EndRef, PointRef, SpecElement } from "../spec/types";
import { evalBindings, interpolateVars, type Vars } from "../spec/vars";
import { mapDrawable, poseMapOf, type LayoutOverrides } from "./posed";

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
  /** A ring piece: its inner and outer radii (pieces of rings). */
  ring?: { rIn: number; rOut: number };
  /** The piece's height across its apex-to-base direction (a triangle's apothem); absent = radius. */
  height?: number;
}

export interface Tier2Result {
  drawables: Drawable[];
  labels: LabelRequest[];
  /** Logical anchor point per element id (for labels, arrows, and commands). */
  anchors: Record<string, Pt>;
  /** Geometric anchors per element id (design §2.1, §2.5): polygon vertex_k/side_k/centroid, sector apex/arc/start/end, arrow tail/tip/mid, path start/end/mid/point_k, ellipse focus_1/focus_2, line start/end/mid/point_k. */
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
  /** `group` element id → its members, flattened to leaf element ids (a nested group contributes its own leaves). */
  groups: Record<string, string[]>;
  /** The subset of `groups` that carry a `fit`: their members were scaled and
   *  centred as one, so two of them touching is composition, not a defect. */
  fitGroups: Record<string, string[]>;
  /** `measure` element specs (design §2.3), keyed by the measure's own element id. */
  measures: Record<string, M.MeasureSpec>;
  /** Structural placement defects (unknown `at.ref`, dependency cycles). */
  issues: LintIssue[];
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
  /** `group` element id → its flattened leaf member ids. */
  groups: Record<string, string[]>;
  /** Those of them with a `fit` (see Tier2Result.fitGroups). */
  fitGroups: Record<string, string[]>;
  /** Each group's union box, as it stood when the group was emitted. */
  groupBoxes: Record<string, BBox>;
  measures: Record<string, M.MeasureSpec>;
  /** Elements built at the origin because `at.ref` places them: where each
   *  would have gone WITHOUT `at`, so a ref that never resolves can still put
   *  the element somewhere sane instead of in the bottom-left corner. */
  atFallback: Record<string, Pt>;
  /** The spec's vars (spec/vars.ts): read by curve expr, bind and `{name}` text tokens. */
  vars: Vars;
  /** Logical → domain, the inverse of sx/sy (a posed curve's samples go through logical space and back). */
  ix: (v: number) => number;
  iy: (v: number) => number;
  /** The posed lookup view (design 2026-09-10 §2.5, posed.ts): anchors of an
   *  element under its override, read by DEFINITIONAL references (arrow and
   *  edge endpoints, angle arms, a line's points, a measure's ring) — never by
   *  placement (`at`) or labels, which read the raw `anchors`. */
  posedAnchors: Record<string, Pt>;
  posedNamed: Record<string, Record<string, Pt>>;
  /** Posed curve samples (domain units) of overridden curves — what an
   *  intersection, a point on a curve and a region read (`samplesOf`);
   *  `curveSamples` stays raw for the curve's own ink. Computed once after
   *  Pass 2, so element order does not matter (review finding 4). */
  posedCurveSamples: Map<string, Pt[]>;
  overrides: LayoutOverrides;
}

export function layoutElements(
  elements: SpecElement[],
  domain: { x?: [number, number]; y?: [number, number] } | undefined,
  seedAnchors: Record<string, Pt> = {},
  /** Scene curves (in the spec's domain space): valid region/intersection references. */
  seedCurveSamples: Record<string, Pt[]> = {},
  /** measure: the text measurer relative placement sizes boxes with.
   *  seedDrawables: the template's drawables, so `at.ref` can name a template id.
   *  vars: the spec's top-level numbers (spec/vars.ts).
   *  overrides: poses and morphed shapes the definitional references read (posed.ts). */
  opts: { measure?: MeasureFn; seedDrawables?: Drawable[]; vars?: Vars; overrides?: LayoutOverrides } = {},
): Tier2Result {
  const measure = opts.measure ?? heuristicMeasure;
  const vars = opts.vars ?? {};
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
    groups: {},
    fitGroups: {},
    groupBoxes: {},
    measures: {},
    atFallback: {},
    vars,
    ix: linearScale([plot.x0, plot.x1], domainX),
    iy: linearScale([plot.y0, plot.y1], domainY),
    posedAnchors: {},
    posedNamed: {},
    posedCurveSamples: new Map(),
    overrides: opts.overrides ?? {},
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

  // Ids that exist outside `elements` and are therefore legal `at.ref`
  // targets: everything the template exported — an anchor, or just ink.
  const known = new Set([...Object.keys(seedAnchors), ...(opts.seedDrawables ?? []).map((d) => d.id)]);
  // Ids of real elements that draw nothing until layout.ts places them — a
  // label (collision solver) and an annotation (drawn onto already-placed
  // geometry) — so a group naming one is not naming a ghost.
  const placedLater = new Set(elements.filter((e) => e.type === "label" || e.type === "annotation").map((e) => e.id));
  const { order: emitOrder, issues } = placementOrder(elements, known);

  // bind (design 2026-09-10 §2.2): every element is laid out from a copy
  // with its bound fields computed from the vars; a binding that cannot be
  // evaluated is error-severity lint (the repair round sees it) and is
  // dropped. Cached so Pass 2 and Pass 3 see the same copy.
  const boundCache = new Map<string, SpecElement>();
  const bound = (el: SpecElement): SpecElement => {
    const hit = boundCache.get(el.id);
    if (hit) return hit;
    const r = evalBindings(el, vars);
    for (const message of r.errors) issues.push({ rule: "bind", ids: [el.id], severity: "error", message });
    boundCache.set(el.id, r.el);
    return r.el;
  };

  // Pass 2: sample curves (needed before points/regions regardless of order).
  for (const raw of elements.filter((e) => e.type === "curve")) {
    const el = bound(raw);
    try {
      ctx.curveSamples.set(el.id, sampleCurveDomain(el, ctx));
    } catch (err) {
      ctx.warnings.push(`curve "${el.id}": ${(err as Error).message} — using a straight line`);
      ctx.curveSamples.set(el.id, sampleCurveDomain({ ...el, expr: undefined, direction: el.direction ?? "decreasing" }, ctx));
    }
  }

  // Pass 3: emit drawables in dependency order (spec order wherever nothing
  // has to wait) — an element placed relative to another, and a label or a
  // measure that reads one, must come after the geometry it depends on.
  const drawables: Drawable[] = [];
  // The posed lookup view (posed.ts): what DEFINITIONAL readers — arrow and
  // edge endpoints, angle arms, a line's points, a measure's ring — see.
  // Placement (`at`, labels) reads `drawables`/`seedDrawables` and the raw
  // anchors. Same objects as `drawables` except where an id is overridden,
  // whose leaves are replaced by posed copies.
  const view: Drawable[] = [];
  ctx.drawablesSoFar = view;
  const overriddenIds = new Set([...Object.keys(ctx.overrides.poses ?? {}), ...Object.keys(ctx.overrides.shapes ?? {})]);
  /** Register an id's posed geometry: its anchors, its curve samples, and its leaves in `view` from index `from` on. */
  const applyOverride = (id: string, from: number) => {
    if (!overriddenIds.has(id)) return;
    const pose = ctx.overrides.poses?.[id];
    const shp = ctx.overrides.shapes?.[id];
    const { map, scale } = pose ? poseMapOf(pose) : { map: (p: Pt) => p, scale: 1 };
    for (let i = from; i < view.length; i++) {
      const d = view[i];
      if (d.id === id || SUB_SUFFIXES.some((s) => d.id === `${id}_${s}`)) view[i] = mapDrawable(d, map, scale, shp);
    }
    const a = ctx.anchors[id];
    if (a) ctx.posedAnchors[id] = map(a);
    const named = ctx.namedAnchors[id];
    if (named) ctx.posedNamed[id] = Object.fromEntries(Object.entries(named).map(([k, p]) => [k, map(p)]));
  };
  // Template ink and anchors first, so a moved template id reads posed too.
  // Only ids no element declares: a tier-2 element is registered right after
  // it is emitted (below), so its own ink is built from its RAW samples and
  // only what comes after it reads the posed ones.
  view.push(...(opts.seedDrawables ?? []));
  const elementIds = new Set(elements.map((e) => e.id));
  for (const id of overriddenIds) if (!elementIds.has(id)) applyOverride(id, 0);
  // Every overridden curve's posed samples, seed and tier-2 alike, before any
  // element reads them — a point listed before its curve reads the same
  // geometry as one listed after.
  for (const id of overriddenIds) {
    const cs = ctx.curveSamples.get(id);
    if (!cs) continue;
    const pose = ctx.overrides.poses?.[id];
    const shp = ctx.overrides.shapes?.[id];
    const { map } = pose ? poseMapOf(pose) : { map: (p: Pt) => p };
    const logical = shp?.[id] ?? cs.map((p): Pt => [ctx.sx(p[0]), ctx.sy(p[1])]);
    ctx.posedCurveSamples.set(id, logical.map(map).map((p): Pt => [ctx.ix(p[0]), ctx.iy(p[1])]));
  }
  const labels: LabelRequest[] = [];
  for (const raw of emitOrder) {
    const el = bound(raw);
    const start = drawables.length;
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
          text: withVars(el.text ?? el.id, el, ctx),
          fontSize: el.font_size ?? 28,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
        break;
      }
      case "path": {
        const raw = (el.points ?? []) as Pt[];
        const pts = el.smooth ? (el.closed ? catmullRomClosed(raw) : catmullRom(raw)) : raw;
        if (el.closed && el.style?.fill) {
          drawables.push(...filledOutline(el.id, pts, el));
        } else {
          drawables.push({
            id: el.id,
            kind: "stroke",
            pts,
            closed: el.closed,
            z: Z_STROKE,
            style: resolveStyle(el.style),
            drawOpts: resolveDrawOpts(el.draw),
          });
        }
        ctx.anchors[el.id] = raw[Math.floor(raw.length / 2)] ?? [CANVAS.w / 2, CANVAS.h / 2];
        ctx.namedAnchors[el.id] = polylineAnchors(raw, "path");
        break;
      }
      case "text": {
        const pos = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
        drawables.push({
          id: el.id,
          kind: "text",
          pos,
          text: withVars(el.text ?? "", el, ctx),
          fontSize: el.font_size ?? 28,
          anchor: "middle",
          z: Z_TEXT,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
        ctx.anchors[el.id] = pos;
        break;
      }
      // TeX in the drawing's own hand: the mathjax engine turns it into glyph
      // outlines (math.ts). The engine is loaded from the spec before render
      // and before lint (engines.ensureEnginesForSpecs); layout is synchronous,
      // so all it can do without it is say so.
      case "math": {
        const [cx, cy] = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
        if (!enginesLoaded(["mathjax"])) {
          ctx.warnings.push(`math "${el.id}": mathjax engine not loaded — skipped`);
          break;
        }
        let laid: { drawables: Drawable[]; box: BBox };
        try {
          laid = mathDrawables(el, getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine, cx, cy);
        } catch (err) {
          issues.push({ rule: "math", ids: [el.id], severity: "error", message: `math "${el.id}": ${(err as Error).message}` });
          break;
        }
        drawables.push(...laid.drawables);
        ctx.anchors[el.id] = [laid.box.x + laid.box.w / 2, laid.box.y + laid.box.h / 2];
        ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(laid.box, n)]));
        break;
      }
      case "shape":
        drawables.push(shapeDrawable(el, ctx));
        break;
      case "portrait":
        drawables.push(portraitDrawable(el, ctx));
        break;
      case "image": {
        const group = imageDrawable(el, ctx);
        if (group) drawables.push(group);
        break;
      }
      case "icon": {
        const group = iconDrawable(el, ctx);
        if (group) drawables.push(group);
        break;
      }
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
      case "ellipse":
        drawables.push(...ellipseDrawables(el, ctx));
        break;
      case "line": {
        const line = lineDrawable(el, ctx);
        if (line) drawables.push(line);
        break;
      }
      // A group draws nothing of its own: it names members already drawn, so
      // one id can be drawn, moved or labelled as one thing. Members come
      // first (place.ts `deps`), so their ink is on the table by now.
      case "group": {
        const leaves: string[] = [];
        const missing: string[] = [];
        for (const m of el.members ?? []) {
          // A label or an annotation is a legal member even though it has no
          // ink yet: layout.ts places it after tier-2, so it contributes
          // nothing to the box here, but it IS one of the leaves — draw/hide/
          // fade on the group must reach the words attached to the thing.
          if (ctx.groups[m]) leaves.push(...ctx.groups[m]);
          else if (drawables.some((d) => d.id === m || d.id.startsWith(`${m}_`)) || (opts.seedDrawables ?? []).some((d) => d.id === m) || placedLater.has(m)) leaves.push(m);
          else missing.push(m);
        }
        if (missing.length > 0 || leaves.length === 0) {
          issues.push({
            rule: "group-empty",
            ids: [el.id],
            severity: "error",
            message: `group "${el.id}": ${missing.length > 0 ? `unknown members ${missing.map((m) => `"${m}"`).join(", ")}` : "no members"}`,
          });
        }
        ctx.groups[el.id] = leaves;
        const all = [...(opts.seedDrawables ?? []), ...drawables];
        let box = boxOfId(all, el.id, measure, ctx.groups, ctx.pieceGroups);
        // --- fit (spec §3.2): scale and centre the whole thing into a region.
        if (el.fit && box && box.w > 0 && box.h > 0) {
          box = fitGroup(el, leaves, box, all, labels, ctx, measure, issues);
        } else if (el.fit) {
          issues.push({ rule: "placement", ids: [el.id], severity: "warn", message: `group "${el.id}": nothing to fit (no member has a box)` });
        }
        // --- end fit
        if (box) {
          ctx.groupBoxes[el.id] = box;
          ctx.anchors[el.id] = [box.x + box.w / 2, box.y + box.h / 2];
          ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(box, n)]));
          // A moved member moves the group's DEFINITIONAL anchor (an arrow
          // from the group); its placement anchor stays where it was assembled.
          if (leaves.some((m) => overriddenIds.has(m))) {
            const vbox = boxOfId(view, el.id, measure, ctx.groups, ctx.pieceGroups);
            if (vbox) {
              ctx.posedAnchors[el.id] = [vbox.x + vbox.w / 2, vbox.y + vbox.h / 2];
              ctx.posedNamed[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(vbox, n)]));
            }
          }
        }
        break;
      }
    }
    // --- relative placement (place.ts): the element was built at the origin,
    // now it moves to where `at` says. `angle` and `point` are excluded —
    // their `at` is a POINT they resolve inside their own case (the angle's
    // vertex; the point's coordinates, where {ref} is a reported mistake).
    const at = relAt(el);
    if (at?.ref && el.type !== "angle" && el.type !== "point") {
      const mine = drawables.slice(start);
      const refBox = refBBox([...(opts.seedDrawables ?? []), ...drawables.slice(0, start)], at.ref, measure, ctx);
      const ownBox = ownBBox(mine, el.id, measure);
      const move = (dx: number, dy: number) => {
        shiftDrawables(mine, dx, dy);
        const bump = (id: string) => {
          const a = ctx.anchors[id];
          if (a) ctx.anchors[id] = [a[0] + dx, a[1] + dy];
          shiftPoints(ctx.namedAnchors[id], dx, dy);
          const pg = ctx.pieces[id];
          if (pg) { pg.apex = [pg.apex[0] + dx, pg.apex[1] + dy]; pg.centroid = [pg.centroid[0] + dx, pg.centroid[1] + dy]; }
        };
        bump(el.id);
        for (const k of ctx.pieceGroups[el.id] ?? []) bump(k);
      };
      const fallback = ctx.atFallback[el.id];
      if (refBox && ownBox) {
        // Both silent failures `at` used to have (C1). A figure assembled
        // from a misspelt anchor looks assembled, just wrong — and place.ts
        // cannot say so itself: it knows neither the element's id nor the
        // ref's name. Wording mirrors render/plan.ts's "— using center".
        const refAnchors = ctx.namedAnchors[at.ref] ?? {};
        if (at.side && at.anchor !== undefined) {
          issues.push({
            rule: "placement",
            ids: [el.id],
            severity: "warn",
            message: `element "${el.id}": at gives both side "${at.side}" and anchor "${at.anchor}" — side is used, anchor is ignored`,
          });
        } else if (at.anchor !== undefined && !isUniversalAnchor(at.anchor) && refAnchors[at.anchor] === undefined) {
          issues.push({
            rule: "placement",
            ids: [el.id],
            severity: "warn",
            message: `element "${el.id}": at.anchor "${at.anchor}" is not an anchor of "${at.ref}" — using center`,
          });
        }
        if (el.type === "math" && at.side && at.anchor === undefined) {
          // A formula is words: it tries the neighbouring sides before it
          // lies down on an axis or a curve (place.ts pickSide). Only what is
          // already built counts — labels are placed after this pass and
          // avoid the formula themselves (labels.ts obstacleBoxes).
          const obstacles = obstacleBoxes([...(opts.seedDrawables ?? []), ...drawables.slice(0, start)], measure);
          const pick = pickSide(ownBox, refBox, refAnchors, at, el.anchor, obstacles, CANVAS);
          move(pick.delta[0], pick.delta[1]);
          if (pick.side !== at.side) ctx.warnings.push(`math "${el.id}": side "${at.side}" of "${at.ref}" lands on other ink — placed ${pick.side} instead`);
        } else {
          const [dx, dy] = relativeDelta(ownBox, refBox, refAnchors, at, el.anchor);
          move(dx, dy);
        }
      } else if (!refBox) {
        // The element was already built at the origin, so leaving it there
        // would drop it in the bottom-left corner: put it back where it
        // would have gone with no `at` at all.
        if (fallback) {
          move(fallback[0], fallback[1]);
          ctx.warnings.push(`element "${el.id}": at.ref "${at.ref}" has no box — placed at its default position`);
        } else {
          ctx.warnings.push(`element "${el.id}": at.ref "${at.ref}" has no box — left where it was`);
        }
      } else {
        issues.push({
          rule: "placement",
          ids: [el.id],
          severity: "warn",
          message: el.type === "label"
            ? `element "${el.id}": at is ignored — a label draws nothing of its own to place; use attach_to and side instead`
            : `element "${el.id}": at is ignored — ${el.type} draws nothing of its own to place`,
        });
      }
    }
    // --- end relative placement
    // The element's ink joins the lookup view, posed where an override says so
    // (a pieces cut registers each of its cells under its own id).
    const viewStart = view.length;
    view.push(...drawables.slice(start));
    applyOverride(el.id, viewStart);
    for (const kid of ctx.pieceGroups[el.id] ?? []) applyOverride(kid, viewStart);
    // A pieces parent is moved through its cells: its definitional anchor
    // follows the cells' posed box (an arrow from the whole cut).
    if ((ctx.pieceGroups[el.id] ?? []).some((kid) => overriddenIds.has(kid))) {
      const vbox = boxOfId(view, el.id, measure, ctx.groups, ctx.pieceGroups);
      if (vbox) {
        ctx.posedAnchors[el.id] = [vbox.x + vbox.w / 2, vbox.y + vbox.h / 2];
        ctx.posedNamed[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(vbox, n)]));
      }
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
    groups: ctx.groups,
    fitGroups: ctx.fitGroups,
    measures: ctx.measures,
    issues,
  };
}

/** Below this, the fitted figure's own words stop being readable. The lint's
 *  own floor (14) is the hard one; this is the group telling the author that
 *  the region it was handed is too small for what is in it. */
const FIT_FONT_FLOOR = 18;

/**
 * `group.fit` (spec §3.2): scale the members UNIFORMLY and centre them in the
 * named region (or the given box), so a figure drawn at whatever size it came
 * out lands where the author wants it at the size that fits. Everything the
 * members own moves with the ink — their anchors, their pieces' geometry, a
 * nested group's box, a measure's remembered endpoints — and the group's own
 * box is recomputed from the scaled ink. Returns that new box.
 */
function fitGroup(
  el: SpecElement,
  leaves: string[],
  box: BBox,
  all: Drawable[],
  labels: LabelRequest[],
  ctx: Ctx,
  measure: MeasureFn,
  issues: LintIssue[],
): BBox | null {
  const target = isFitName(el.fit) ? fitRegion(el.fit) : (el.fit as BBox);
  if (!target || !(target.w > 0) || !(target.h > 0)) {
    issues.push({ rule: "placement", ids: [el.id], severity: "error", message: `group "${el.id}": fit needs a region name or a box with a positive width and height` });
    return box;
  }
  const { s, dx, dy } = fitTransform(box, target);
  const map = (p: Pt): Pt => [p[0] * s + dx, p[1] * s + dy];
  const scaleBox = (b: BBox): BBox => ({ x: b.x * s + dx, y: b.y * s + dy, w: b.w * s, h: b.h * s });
  // Every id the group's ink hides under: a leaf, that leaf's sub-drawables
  // and minted children (`<leaf>_…`), and the number a line-less measure
  // keeps under a name of its own (pieceGroups).
  const owned = [...new Set(leaves.flatMap((m) => [m, ...(ctx.pieceGroups[m] ?? [])]))];
  const belongs = (id: string) => owned.some((m) => id === m || id.startsWith(`${m}_`));
  // A group whose every leaf is one of ours moved with us, whether it is a
  // member of this group or a member of a member.
  const leafSet = new Set(leaves);
  const nested = new Set(Object.keys(ctx.groups).filter((g) => g !== el.id && ctx.groups[g].length > 0 && ctx.groups[g].every((m) => leafSet.has(m))));
  const touched = (id: string) => belongs(id) || nested.has(id);

  scaleDrawables(all.filter((d) => belongs(d.id)), s, dx, dy);
  for (const id of Object.keys(ctx.anchors)) if (touched(id)) ctx.anchors[id] = map(ctx.anchors[id]);
  for (const id of Object.keys(ctx.namedAnchors)) {
    if (!touched(id)) continue;
    const na = ctx.namedAnchors[id];
    for (const k of Object.keys(na)) na[k] = map(na[k]);
  }
  for (const id of nested) if (ctx.groupBoxes[id]) ctx.groupBoxes[id] = scaleBox(ctx.groupBoxes[id]);
  for (const [k, pg] of Object.entries(ctx.pieces)) {
    if (!belongs(k)) continue;
    pg.apex = map(pg.apex);
    pg.centroid = map(pg.centroid);
    pg.radius *= s;
    if (pg.ring) pg.ring = { rIn: pg.ring.rIn * s, rOut: pg.ring.rOut * s };
    if (pg.height !== undefined) pg.height *= s;
  }
  // A measure remembers the points it spanned; the fit moves them like ink.
  // The NUMBER it prints is deliberately left alone — it is the figure's own
  // measurement, and a scale drawing keeps its dimensions.
  for (const [id, ms] of Object.entries(ctx.measures)) {
    if (!belongs(id)) continue;
    for (const end of ["from", "to"] as const) {
      const p = ms[end];
      if (p && "pt" in p) ms[end] = { pt: map(p.pt) };
    }
    if (ms.circle) ms.circle = { c: map(ms.circle.c), r: ms.circle.r * s };
  }

  // A member LABEL is not ink yet — layout.ts solves it against the finished
  // drawing after tier-2 — but the point it will be solved AGAINST was read
  // off the member when the label was emitted, which was before this fit.
  // Move that point too, or the words land where the part used to be.
  // (An `annotation` member needs nothing: layout.ts measures its target's
  // box off the drawables after everything is laid out, so it reads the
  // scaled ink already. `ignore` holds drawable ids, not geometry.)
  for (const req of labels) if (belongs(req.id)) req.anchor = map(req.anchor);

  for (const d of leafDrawables(all.filter((x) => belongs(x.id)))) {
    if (d.kind !== "text" || d.fontSize >= FIT_FONT_FLOOR) continue;
    issues.push({
      rule: "font-too-small",
      ids: [el.id],
      severity: "warn",
      message: `fit box too small for the text in group "${el.id}" (${d.id} at ${Math.round(d.fontSize)})`,
    });
  }
  ctx.fitGroups[el.id] = leaves;
  return boxOfId(all, el.id, measure, ctx.groups, ctx.pieceGroups);
}

/**
 * Where an element builds itself: the ORIGIN when `at.ref` places it
 * relative to another element (the post-emit shift in pass 3 then moves the
 * finished drawables into place), otherwise its own x/y or the fallback.
 */
function originOr(el: SpecElement, ctx: Ctx, fallback: Pt): Pt {
  if (relAt(el)?.ref) {
    ctx.atFallback[el.id] = fallback;
    return [0, 0];
  }
  return [el.x ?? fallback[0], el.y ?? fallback[1]];
}

function sampleCurveDomain(el: SpecElement, ctx: Ctx): Pt[] {
  const [dx0, dx1] = ctx.domainX;
  const [dy0, dy1] = ctx.domainY;
  const x0 = el.x_from ?? dx0 + (dx1 - dx0) * 0.02;
  const x1 = el.x_to ?? dx1 - (dx1 - dx0) * 0.02;
  if (el.expr) {
    return sampleExpression(el.expr, x0, x1, ctx.vars).map(([x, y]): Pt => [x, clamp(y, dy0, dy1)]);
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

/** A curve's samples as a DEFINITIONAL reader sees them: posed when the curve is overridden, raw otherwise. */
function samplesOf(ctx: Ctx, id: string): Pt[] | undefined {
  return ctx.posedCurveSamples.get(id) ?? ctx.curveSamples.get(id);
}

/** `{name}` tokens in drawn text (design 2026-09-10 §2.1); an unknown name stays as written and warns, so a typo shows on the canvas. */
function withVars(text: string, el: SpecElement, ctx: Ctx): string {
  const r = interpolateVars(text, ctx.vars);
  for (const name of r.unknown) ctx.warnings.push(`${el.type} "${el.id}": text names {${name}}, which is not one of the vars — left as written`);
  return r.text;
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
    const a = samplesOf(ctx, at.intersection_of[0]);
    const b = samplesOf(ctx, at.intersection_of[1]);
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
  if (typeof at.on === "string") {
    // A point ON a curve at x (design 2026-09-10 §2.3): y read off the samples.
    const samples = samplesOf(ctx, at.on);
    if (!samples) {
      ctx.warnings.push(`point "${el.id}": at.on names unknown curve "${at.on}"`);
      return null;
    }
    if (typeof at.x !== "number") {
      ctx.warnings.push(`point "${el.id}": at.on needs x`);
      return null;
    }
    const y = interpolateAtX(samples, at.x);
    if (y === null) {
      ctx.warnings.push(`point "${el.id}": x = ${at.x} is outside curve "${at.on}"`);
      return null;
    }
    return [at.x, y];
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
  const a = samplesOf(ctx, aId);
  const b = samplesOf(ctx, bId);
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
  const text = el.text === undefined ? undefined : withVars(el.text, el, ctx);
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
    // Definitional readers see the posed view (design 2026-09-10 §2.5).
    const a = ctx.posedAnchors[end.ref] ?? ctx.anchors[end.ref];
    if (!a) {
      ctx.warnings.push(`arrow/edge endpoint references unknown id "${end.ref}"`);
      return null;
    }
    if (end.anchor === undefined) return { pt: a, anchored: false };
    const named = (ctx.posedNamed[end.ref] ?? ctx.namedAnchors[end.ref])?.[end.anchor];
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
  // A scaled source node is backed off by its scaled radius (review finding 8).
  const scaleOf = (ref: string): number => ctx.overrides.poses?.[ref]?.turn?.scale ?? 1;
  const rFrom = fromRef?.ref && !fromEnd.anchored ? (ctx.nodeRadius.get(fromRef.ref) ?? 10) * scaleOf(fromRef.ref) + 4 : 0;
  const rTo = toRef?.ref && !toEnd.anchored ? (ctx.nodeRadius.get(toRef.ref) ?? 10) * scaleOf(toRef.ref) + 4 : 0;
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
    const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
    const r = el.radius ?? 40;
    ctx.anchors[el.id] = c;
    return { id: el.id, kind: "stroke", pts: [c], shapeHint: { type: "circle", c, r }, z: Z_STROKE, style, drawOpts };
  }
  // rect (x,y = lower-left corner in logical units)
  const [x, y] = originOr(el, ctx, [100, 100]);
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
  const [cx, cy] = originOr(el, ctx, [cameo ? 500 : 170, cameo ? 420 : 550]);
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
 * An `image` element: a Commons photo resolved from a plain description
 * (`of`, resolve/image.ts), embedded faithfully rather than traced — unlike
 * a portrait, which draws a sketch. `strokes` is set by the resolver in the
 * ensure phase; layout is synchronous, so an element the resolver never
 * reached (offline, no licence, cache-cold) has none and draws nothing
 * beyond the warning that says why. `credit` rides above the photo as a
 * caption, licence-gated by the resolver — never fabricated here.
 */
function imageDrawable(el: SpecElement, ctx: Ctx): GroupDrawable | null {
  const photo = el.strokes ? decodePhoto(el.strokes) : null;
  if (!photo) {
    ctx.warnings.push(`no image found for "${el.of ?? el.id}"`);
    return null;
  }
  const w = el.width ?? 220;
  const h = w * photo.aspect;
  const [cx, cy] = originOr(el, ctx, [500, 375]);
  const children: Drawable[] = [
    {
      id: `${el.id}__img`,
      kind: "image",
      href: photo.href,
      pos: [cx, cy],
      w,
      h,
      z: Z_STROKE,
      style: resolveStyle(undefined, {}),
      reveal: el.reveal ?? "fade",
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 900 }),
    },
  ];
  if (el.credit) {
    children.push({
      id: `${el.id}__name`,
      kind: "text",
      pos: [cx, cy - h / 2 - 14],
      text: el.credit,
      fontSize: 14,
      anchor: "middle",
      z: Z_TEXT,
      style: resolveStyle(el.style, {}),
      drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 240 }),
    });
  }
  ctx.anchors[el.id] = [cx, cy];
  const box = { x: cx - w / 2, y: cy - h / 2, w, h };
  ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(box, n)]));
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
 * An icon element: an Iconify keyword icon's outline rings (resolveIcons,
 * render/icon.ts), redrawn hand-drawn at `size` — never the raw SVG. A ring's
 * points are normalised 0..1 in SVG y-down space (decodeIcon); painting them
 * flips y (canvas is y-up) and scales into a `size`×`size` box centred on the
 * element's origin. The credit (if any) rides in the spec for `creditsOf`
 * (export/credits.ts) only — spec §3.7 keeps icon attribution off the canvas.
 */
function iconDrawable(el: SpecElement, ctx: Ctx): GroupDrawable | null {
  const rings = el.strokes ? decodeIcon(el.strokes) : null;
  if (!rings || rings.length === 0) {
    ctx.warnings.push(`no icon for "${el.of ?? el.id}"`);
    return null;
  }
  const size = el.size ?? 100;
  const [cx, cy] = originOr(el, ctx, [500, 375]);
  const children: Drawable[] = rings.map((ring, k) => ({
    id: `${el.id}__r${k}`,
    kind: "stroke",
    pts: ring.map(([u, v]) => [cx - size / 2 + u * size, cy + size / 2 - v * size] as Pt),
    closed: true,
    z: Z_STROKE,
    style: resolveStyle(el.style),
    drawOpts: resolveDrawOpts(el.draw),
  }));
  ctx.anchors[el.id] = [cx, cy];
  const box = { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
  ctx.namedAnchors[el.id] = Object.fromEntries(UNIVERSAL_ANCHORS.map((n) => [n, boxAnchor(box, n)]));
  return {
    id: el.id,
    kind: "group",
    z: Z_STROKE,
    style: defaultStyle(),
    drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }),
    children,
    // The declared size×size slot, not the ink: an icon's rings rarely touch
    // the box's edges, so unionBBoxForId (boxes.ts) must read this nominal
    // box directly rather than union the rings' bbox — otherwise `at`
    // placement (side/gap) would vary per icon instead of tracking `size`.
    box,
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
  const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
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
  const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
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

/**
 * The primary ring of an element laid out so far: a circle shapeHint (its
 * `pts` is just the centre, so its centre+radius are returned separately —
 * a `shape`/`node` circle has no literal ring points to read); else its
 * first closed leaf (area, or a closed stroke — a rect shapeHint's `pts`
 * ARE its four real corners, so it needs no special case here); else its
 * first open stroke's points.
 */
function primaryRingSoFar(ctx: Ctx, id: string): { pts: Pt[]; closed: boolean; circle?: { c: Pt; r: number } } | null {
  const leaves = leafDrawables(drawablesForId(ctx.drawablesSoFar, id)).filter((d): d is StrokeDrawable | AreaDrawable => d.kind === "stroke" || d.kind === "area");
  const circleLeaf = leaves.find((d): d is StrokeDrawable & { shapeHint: { type: "circle"; c: Pt; r: number } } => d.kind === "stroke" && d.shapeHint?.type === "circle");
  if (circleLeaf) return { pts: [], closed: true, circle: { c: circleLeaf.shapeHint.c, r: circleLeaf.shapeHint.r } };
  const closed = leaves.find((d) => d.kind === "area" || (d.kind === "stroke" && d.closed));
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
  let circle: { c: Pt; r: number } | null = null;
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
    if (refId) { const r = primaryRingSoFar(ctx, refId); if (r) awayFrom = r.circle ? r.circle.c : M.ringCentroid(r.pts); }
  } else if (el.of !== undefined) {
    const r = primaryRingSoFar(ctx, el.of);
    if (!r) { ctx.warnings.push(`measure "${el.id}": "${el.of}" has nothing to measure`); return []; }
    what = (el.what as M.MeasureWhat | undefined) ?? (r.closed ? "area" : "length");
    if (r.circle) {
      circle = r.circle;
      const { c, r: rad } = r.circle;
      if (what === "width") { a = [c[0] - rad, c[1] - rad]; b = [c[0] + rad, c[1] - rad]; }
      if (what === "height") { a = [c[0] + rad, c[1] - rad]; b = [c[0] + rad, c[1] + rad]; }
      awayFrom = c;
    } else {
      ring = r.pts;
      if (what === "length") { a = r.pts[0]; b = r.pts[r.pts.length - 1]; }
      if (what === "width") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const y = Math.min(...ys); a = [Math.min(...xs), y]; b = [Math.max(...xs), y]; }
      if (what === "height") { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); const x = Math.max(...xs); a = [x, Math.min(...ys)]; b = [x, Math.max(...ys)]; }
      awayFrom = M.ringCentroid(r.pts);
    }
  } else {
    ctx.warnings.push(`measure "${el.id}": needs of, or from and to`);
    return [];
  }
  const value = M.measureValue(what, { a: a ?? undefined, b: b ?? undefined, ring: ring ?? undefined, circle: circle ?? undefined });
  if (value === null || (what !== "area" && what !== "perimeter" && (!a || !b))) { ctx.warnings.push(`measure "${el.id}": cannot resolve what to measure`); return []; }
  const text = M.formatMeasure(value, format);
  // The label is centred on textPos, so the dimension line needs to know how
  // wide it is to clear it on a vertical or oblique measure (see dimensionLine).
  const textWidth = M.heuristicLabelWidth(text);
  const out: Drawable[] = [];
  let textPos: Pt;
  let hasLine = false;
  let side: "left" | "right" = "left";
  if (a && b && what !== "area" && what !== "perimeter") {
    if (el.side === "right" || el.side === "left") side = el.side;
    else if (awayFrom) {
      const cross = (b[0] - a[0]) * (awayFrom[1] - a[1]) - (b[1] - a[1]) * (awayFrom[0] - a[0]);
      side = cross > 0 ? "right" : "left"; // the centroid is on the left → put the line on the right
    }
    const d = M.dimensionLine(a, b, el.offset ?? 24, side, undefined, textWidth);
    hasLine = true;
    out.push({ id: el.id, kind: "stroke", pts: d.line, z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_guides`, kind: "stroke", pts: d.ticks[0], z: Z_STROKE, style, drawOpts });
    out.push({ id: `${el.id}_dot`, kind: "stroke", pts: d.ticks[1], z: Z_STROKE, style, drawOpts });
    textPos = d.textPos;
    ctx.anchors[el.id] = [(d.line[0][0] + d.line[1][0]) / 2, (d.line[0][1] + d.line[1][1]) / 2];
  } else if (circle) {
    textPos = what === "perimeter" ? [circle.c[0], circle.c[1] + circle.r + 26] : circle.c;
    ctx.anchors[el.id] = textPos;
  } else {
    textPos = ring ? (what === "perimeter" ? [M.ringCentroid(ring)[0], Math.max(...ring.map((p) => p[1])) + 26] : M.ringCentroid(ring)) : [CANVAS.w / 2, CANVAS.h / 2];
    ctx.anchors[el.id] = textPos;
  }
  // label: false suppresses the text drawable (and its extraOrder/anchor
  // entry) but not the dimension line — measures[id].textId still names the
  // id the text WOULD have had, so a later step can turn it back on.
  if (el.label !== false) {
    out.push({ id: textId, kind: "text", pos: textPos, text, fontSize: M.MEASURE_FONT_SIZE, anchor: "middle", z: Z_TEXT, style: resolveStyle(el.style), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }) });
    ctx.extraOrder.push(textId);
    ctx.anchors[textId] = textPos;
    // An area/perimeter measure draws no dimension line, so nothing carries
    // the element's own id: register the text as the measure's group, the way
    // a `pieces` cut registers its children, so `draw: ["areal"]` (and
    // focus/highlight/keep) resolves through pieceGroups to `label_areal`
    // instead of dropping as an id that paints nothing.
    if (!hasLine) ctx.pieceGroups[el.id] = [textId];
  }
  ctx.measures[el.id] = { of: el.of, what, from: fromSrc, to: toSrc, side, offset: el.offset ?? 24, format, lineId: el.id, textId, circle: circle ?? undefined };
  return out;
}

function polygonDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  let pts: Pt[];
  if (el.points && el.points.length >= 3) {
    pts = el.points as Pt[];
  } else {
    const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
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
 * `ellipse` (design §2.5): a 48-point outline, counter-clockwise from the +x end of the
 * x-radius (the major axis only when rx ≥ ry), rotated by `rotation` — a filledOutline pair
 * measurable through primaryRingSoFar like any other closed ring, no special
 * case needed. Anchors `focus_1`/`focus_2` sit on the major axis (`focus_1`
 * toward −x before rotation); when rx === ry the foci coincide at the centre
 * (f = 0, not NaN).
 */
function ellipseDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
  const rx = el.rx ?? 150, ry = el.ry ?? 100;
  const rot = (el.rotation ?? 0) * DEG;
  const turn = (p: Pt): Pt => [c[0] + (p[0] - c[0]) * Math.cos(rot) - (p[1] - c[1]) * Math.sin(rot), c[1] + (p[0] - c[0]) * Math.sin(rot) + (p[1] - c[1]) * Math.cos(rot)];
  const pts = Array.from({ length: 48 }, (_, i): Pt => turn([c[0] + rx * Math.cos((2 * Math.PI * i) / 48), c[1] + ry * Math.sin((2 * Math.PI * i) / 48)]));
  const f = Math.sqrt(Math.abs(rx * rx - ry * ry));
  const [f1, f2]: [Pt, Pt] = rx >= ry ? [turn([c[0] - f, c[1]]), turn([c[0] + f, c[1]])] : [turn([c[0], c[1] - f]), turn([c[0], c[1] + f])];
  ctx.anchors[el.id] = c;
  ctx.namedAnchors[el.id] = { focus_1: f1, focus_2: f2 };
  return filledOutline(el.id, pts, el);
}

/** Where the line P + t·d enters and leaves a box, or null when it misses. */
function clipToBox(P: Pt, d: Pt, box: { x0: number; x1: number; y0: number; y1: number }): [Pt, Pt] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (const [lo, hi, p, v] of [[box.x0, box.x1, P[0], d[0]], [box.y0, box.y1, P[1], d[1]]] as [number, number, number, number][]) {
    if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return null; continue; }
    const ta = (lo - p) / v, tb = (hi - p) / v;
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (!(t0 < t1)) return null;
  return [[P[0] + t0 * d[0], P[1] + t0 * d[1]], [P[0] + t1 * d[0], P[1] + t1 * d[1]]];
}

/**
 * `line` (design §2.5): a straight stroke clipped to the plot box (domain
 * declared) or the canvas — `through` gives one or two PointRefs; with one
 * point, direction comes from `angle` (degrees, y-up) or `slope` (domain
 * units when a domain is declared, else logical). Anchors `start`/`end`
 * (the clipped endpoints), `mid`, and `point_1`[, `point_2`] (the resolved
 * `through` points themselves, un-clipped).
 */
function lineDrawable(el: SpecElement, ctx: Ctx): Drawable | null {
  const through = ((el.through ?? []) as PointRef[]).map((p) => resolvePointRef(p, ctx));
  if (through.length === 0 || through.some((p) => p === null)) { ctx.warnings.push(`line "${el.id}": through does not resolve`); return null; }
  const P = through[0]!;
  let d: Pt;
  if (through.length >= 2) d = [through[1]![0] - P[0], through[1]![1] - P[1]];
  else if (typeof el.slope === "number") {
    // domain slope → logical: scale dy by the y-scale and dx by the x-scale
    const plot = plotArea();
    const kx = ctx.domainDeclared ? (plot.x1 - plot.x0) / (ctx.domainX[1] - ctx.domainX[0]) : 1;
    const ky = ctx.domainDeclared ? (plot.y1 - plot.y0) / (ctx.domainY[1] - ctx.domainY[0]) : 1;
    d = [kx, el.slope * ky];
  } else if (typeof el.angle === "number") d = [Math.cos(el.angle * DEG), Math.sin(el.angle * DEG)];
  else { ctx.warnings.push(`line "${el.id}": needs a second point, a slope or an angle`); return null; }
  if (Math.hypot(d[0], d[1]) < 1e-9) { ctx.warnings.push(`line "${el.id}": its two points coincide`); return null; }
  const plot = plotArea();
  const box = ctx.domainDeclared ? { x0: plot.x0, x1: plot.x1, y0: plot.y0, y1: plot.y1 } : { x0: 0, x1: CANVAS.w, y0: 0, y1: CANVAS.h };
  const seg = clipToBox(P, d, box);
  if (!seg) { ctx.warnings.push(`line "${el.id}": misses the canvas`); return null; }
  const [A, B] = seg;
  const mid: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  ctx.anchors[el.id] = mid;
  const named: Record<string, Pt> = { start: A, end: B, mid };
  through.forEach((p, i) => { named[`point_${i + 1}`] = p!; });
  ctx.namedAnchors[el.id] = named;
  return { id: el.id, kind: "stroke", pts: [A, B], z: Z_STROKE, style: resolveStyle(el.style, { strokeWidth: 2.5 }), drawOpts: resolveDrawOpts(el.draw, { duration: SKETCH_MS.guides }) };
}

/**
 * `pieces: {of: "sectors"}` cuts a circle into n equal sectors, each its own
 * command-addressable id `<id>_1` … `<id>_n` (pushed to extraOrder — the
 * parent id itself draws nothing and is skipped in layout.ts's order loop).
 * Each piece is a plain filledOutline pair (no group wrapper), so it is found
 * by drawablesForId/elementRings exactly like a standalone sector.
 */
function piecesDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c = originOr(el, ctx, [CANVAS.w / 2, CANVAS.h / 2]);
  if (el.of === "strips" || el.of === "grid") return rectPiecesDrawables(el, ctx, c);
  if (el.of === "rings") return ringPiecesDrawables(el, ctx, c);
  if (el.of === "triangles") return trianglePiecesDrawables(el, ctx, c);
  if (el.of === "halving") return halvingPiecesDrawables(el, ctx, c);
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

/** A circle of points, counter-clockwise from +x. */
function circlePts(c: Pt, r: number, n = 48): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
}

/**
 * `pieces: {of: "rings"}` — n concentric annuli of equal width, `<id>_1` the
 * innermost. The wash is a KEYHOLE polygon (the outer circle, a seam in to
 * the inner circle walked the other way, and back), not an area with a hole,
 * so a morph can straighten it into a strip (design §2.4).
 */
function ringPiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  const R = el.radius ?? 120;
  const n = Math.max(1, Math.min(64, Math.round(el.n ?? 6)));
  const w = R / n;
  const style = resolveStyle(el.style);
  const out: Drawable[] = [];
  const ids: string[] = [];
  for (let k = 0; k < n; k++) {
    const rIn = k * w, rOut = (k + 1) * w;
    const id = `${el.id}_${k + 1}`;
    const outer = circlePts(c, rOut);
    const inner = rIn > 0 ? circlePts(c, rIn).reverse() : [];
    const keyhole: Pt[] = rIn > 0 ? [...outer, outer[0], inner[inner.length - 1], ...inner] : outer;
    if (style.fill) out.push({ id: `${id}_wash`, kind: "area", pts: keyhole, z: Z_AREA, style: resolveStyle(el.style, { opacity: 0.35 }), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.region }) });
    out.push({ id, kind: "stroke", pts: outer, closed: true, z: Z_STROKE, style, drawOpts: resolveDrawOpts(el.draw) });
    if (rIn > 0) out.push({ id: `${id}_body`, kind: "stroke", pts: circlePts(c, rIn), closed: true, z: Z_STROKE, style, drawOpts: resolveDrawOpts(el.draw) });
    const mid = (rIn + rOut) / 2;
    const centroid: Pt = [c[0], c[1] + mid];
    ctx.anchors[id] = centroid;
    ctx.pieces[id] = { apex: c, centroid, midAngle: 90, halfAngle: 180, radius: rOut, ring: { rIn, rOut } };
    ids.push(id);
    ctx.extraOrder.push(id);
  }
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}

/**
 * Parses `from: "vertex_k"` into a 0-based index among `n` vertices, shared
 * by both branches of `trianglePiecesDrawables` so they cannot drift apart.
 * `from` absent → `null` (the caller's own default: the centre for a
 * regular polygon, vertex_1 for a points polygon — the latter has no
 * centre option, so its caller treats `null` as index 0 itself). `from`
 * present but malformed or out of range (1..n) → a warning and index 0
 * (vertex_1) — falling back to vertex_1 rather than the centre keeps the
 * warning text honest: the author asked for a vertex fan, so they get one.
 */
function fanVertexIndex(from: unknown, n: number, id: string, warnings: string[]): number | null {
  if (from === undefined) return null;
  if (typeof from === "string") {
    const m = /^vertex_(\d+)$/.exec(from);
    if (m) {
      const k = Number(m[1]);
      if (k >= 1 && k <= n) return k - 1;
    }
  }
  warnings.push(`pieces "${id}": from "${String(from)}" is out of range (1..${n}); using vertex_1`);
  return 0;
}

/**
 * `pieces: {of: "triangles"}` — a regular polygon (`sides` + `radius`, like
 * `polygonDrawables`) fanned into triangles from its centre, or a polygon
 * (`points`) fanned from `vertex_1` — `from: "vertex_k"` picks the fan vertex
 * for either. Each triangle carries sector-like geometry (apex/centroid/
 * midAngle/halfAngle/radius/height) so the zipper and fan arrange it exactly
 * like a sector piece; `height` is the apex-to-base-midpoint distance (a
 * regular polygon's apothem when fanned from the centre), read instead of
 * `radius` by the zipper (design §2.4).
 */
function trianglePiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  let verts: Pt[];
  let apexIndex: number | null = null; // null = fan from the centre
  if (el.points && el.points.length >= 3) {
    verts = el.points as Pt[];
    apexIndex = fanVertexIndex(el.from, verts.length, el.id, ctx.warnings) ?? 0;
  } else {
    const n = Math.max(3, Math.round(el.sides ?? 6));
    const r = el.radius ?? 100;
    const rot = (el.rotation ?? 0) * DEG;
    verts = Array.from({ length: n }, (_, i): Pt => { const a = rot + Math.PI / 2 + (2 * Math.PI * i) / n; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
    apexIndex = fanVertexIndex(el.from, n, el.id, ctx.warnings);
  }
  const tris: { apex: Pt; a: Pt; b: Pt }[] = [];
  if (apexIndex === null) {
    for (let i = 0; i < verts.length; i++) tris.push({ apex: c, a: verts[i], b: verts[(i + 1) % verts.length] });
  } else {
    const apex = verts[apexIndex];
    for (let s = 1; s + 1 < verts.length; s++) tris.push({ apex, a: verts[(apexIndex + s) % verts.length], b: verts[(apexIndex + s + 1) % verts.length] });
  }
  const out: Drawable[] = [];
  const ids: string[] = [];
  tris.forEach((t, k) => {
    const id = `${el.id}_${k + 1}`;
    const pts = [t.apex, t.a, t.b];
    out.push(...filledOutline(id, pts, el));
    const base: Pt = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
    const mid = (Math.atan2(base[1] - t.apex[1], base[0] - t.apex[0]) * 180) / Math.PI;
    const da = (Math.atan2(t.a[1] - t.apex[1], t.a[0] - t.apex[0]) * 180) / Math.PI;
    const db = (Math.atan2(t.b[1] - t.apex[1], t.b[0] - t.apex[0]) * 180) / Math.PI;
    const span = Math.abs(((db - da + 540) % 360) - 180);
    const height = Math.hypot(base[0] - t.apex[0], base[1] - t.apex[1]);
    const radius = Math.max(Math.hypot(t.a[0] - t.apex[0], t.a[1] - t.apex[1]), Math.hypot(t.b[0] - t.apex[0], t.b[1] - t.apex[1]));
    const cen = centroid(pts);
    ctx.anchors[id] = cen;
    ctx.pieces[id] = { apex: t.apex, centroid: cen, midAngle: mid, halfAngle: span / 2, radius, height };
    ctx.namedAnchors[id] = { ...polygonAnchors(pts), apex: t.apex, base };
    ids.push(id);
    ctx.extraOrder.push(id);
  });
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = apexIndex === null ? c : verts[apexIndex];
  return out;
}

/**
 * `pieces: {of: "halving"}` — a width × height rectangle centred on `c`,
 * halved `n` times: odd cuts take the LEFT half of what remains, even cuts
 * the TOP half — `<id>_1` … `<id>_n` in the order cut, `<id>_rest` the
 * uncut remainder (1/2 + 1/4 + … of the whole). Plain boxes, no piece
 * geometry — a halving cell is not a wedge, so fan/zipper treat it (like a
 * strip/grid cell) as an ordinary box.
 */
function halvingPiecesDrawables(el: SpecElement, ctx: Ctx, c: Pt): Drawable[] {
  const w = el.width ?? 400, h = el.height ?? 400;
  const n = Math.max(1, Math.min(20, Math.round(el.n ?? 4)));
  let rest = { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
  const out: Drawable[] = [];
  const ids: string[] = [];
  const emit = (id: string, b: { x: number; y: number; w: number; h: number }) => {
    const pts: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    out.push(...filledOutline(id, pts, el));
    ctx.anchors[id] = [b.x + b.w / 2, b.y + b.h / 2];
    ids.push(id);
    ctx.extraOrder.push(id);
  };
  for (let k = 1; k <= n; k++) {
    if (k % 2 === 1) { emit(`${el.id}_${k}`, { ...rest, w: rest.w / 2 }); rest = { ...rest, x: rest.x + rest.w / 2, w: rest.w / 2 }; }
    else { emit(`${el.id}_${k}`, { ...rest, y: rest.y + rest.h / 2, h: rest.h / 2 }); rest = { ...rest, h: rest.h / 2 }; }
  }
  emit(`${el.id}_rest`, rest);
  ctx.pieceGroups[el.id] = ids;
  ctx.anchors[el.id] = c;
  return out;
}
