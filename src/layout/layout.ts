// The layout orchestrator: spec → backend-independent drawables + lint.
// Template routing failures fall through to tier-2 gracefully (never hard-fail).

import { scenes } from "../scenes/registry";
import { normalizeSpec } from "../spec/schema";
import { applyTextMap } from "./text-map";
import type { Spec } from "../spec/types";
import { coVisible, lintLayout, type LintIssue } from "../lint/lint";
import { layoutElements, type PieceGeometry } from "./tier2";
import type { MeasureSpec } from "./measures";
import type { CodeWindow } from "./code";
import { annotationDrawables } from "./annotate";
import { obstacleBoxes, placeLabels, type LabelRequest } from "./labels";
import type { BBox } from "./geometry";
import { boxOfId, unionBBoxForId } from "./boxes";
import { heuristicMeasure, type MeasureFn } from "./measure";
import { drawablesForId, leafDrawables, type Drawable, type Pt } from "./model";
import { linearScale, plotArea } from "./canvas";
import { figureSplit } from "./figure-split";

export interface LayoutResult {
  drawables: Drawable[];
  /** Command-addressable element ids in natural draw order. */
  order: string[];
  issues: LintIssue[];
  warnings: string[];
  /** Windowed code panes (el.lines), keyed by element id — the plan scrolls
   *  their lines so the highest visible one is the window's bottom row. */
  windows?: Record<string, CodeWindow>;
  /** Each drawn code pane's text rectangle (logical, y-up), keyed by element
   *  id — where ui/code-editor lays its text area down. Absent for a panel
   *  that draws no code. */
  panes?: Record<string, BBox>;
  /** Per-piece geometry from `pieces` elements (apex/centroid/angles), keyed
   *  by the piece's own id `<parentId>_<k>` — what move (rotate) and arrange
   *  read. Empty when the spec has no pieces elements. */
  pieces: Record<string, PieceGeometry>;
  /** `pieces` parent element id → its child piece ids, in order; also a line-less
   *  `measure` (area, perimeter) → its text id. Empty when neither occurs. */
  pieceGroups: Record<string, string[]>;
  /** `group` element id → its members, flattened to leaf element ids — one id
   *  the commands can draw, move or highlight as a single thing. */
  groups: Record<string, string[]>;
  /** Those groups that carry a `fit` (tier2.fitGroups): their members were
   *  scaled and centred together, which excuses their mutual overlaps. */
  fitGroups: Record<string, string[]>;
  /** Geometric anchors per tier-2 element id (design §2.1). Empty for a pure template spec. */
  namedAnchors: Record<string, Record<string, Pt>>;
  /** `measure` element specs (design §2.3), keyed by the measure's own element id. Empty when the spec has no measure elements. */
  measures: Record<string, MeasureSpec>;
}

export function layoutSpec(rawSpec: Spec, measure: MeasureFn = heuristicMeasure): LayoutResult {
  const spec = normalizeSpec(rawSpec) as Spec;
  // A template and a script on screen each get their own half of the canvas
  // before anything is laid out — the default the two used to lack, so a
  // chart no longer lands on top of the code that computed it.
  const codeEl = (spec.elements ?? []).find((e) => e.type === "code" && e.show !== "none");
  const split = figureSplit({
    hasTemplate: !!(spec.template && scenes[spec.template]?.layout),
    templateTakesBox: templateTakesBox(spec.template),
    boxGiven: isFigureBox((spec.params ?? {})["box"]),
    code: codeEl ? { x: codeEl.x, width: codeEl.width, show: codeEl.show, code: codeEl.code, fontSize: codeEl.font_size } : null,
  });
  if (split.code && codeEl) Object.assign(codeEl, split.code);
  if (split.box) spec.params = { ...(spec.params ?? {}), box: split.box };
  const warnings: string[] = [];
  const issues: LintIssue[] = [];
  const drawables: Drawable[] = [];
  const labelRequests: LabelRequest[] = [];
  const order: string[] = [];
  let windows: Record<string, CodeWindow> = {};
  let panes: Record<string, BBox> = {};
  let pieces: Record<string, PieceGeometry> = {};
  let pieceGroups: Record<string, string[]> = {};
  let groups: Record<string, string[]> = {};
  let fitGroups: Record<string, string[]> = {};
  let namedAnchors: Record<string, Record<string, Pt>> = {};
  let measures: Record<string, MeasureSpec> = {};
  let seedAnchors: Record<string, Pt> = {};
  let seedCurveSamples: Record<string, Pt[]> = {};
  let templateIds: string[] = [];

  if (spec.template) {
    const scene = scenes[spec.template];
    if (!scene) {
      warnings.push(`unknown template "${spec.template}" — falling through to tier-2 elements`);
    } else if (!scene.layout) {
      warnings.push(`template "${spec.template}" is a stub — falling through to tier-2 elements`);
    } else {
      try {
        const sceneLayout = scene.layout(spec.params ?? {});
        templateIds = sceneLayout.order;
        drawables.push(...sceneLayout.drawables);
        labelRequests.push(...sceneLayout.labels);
        order.push(...sceneLayout.order);
        seedAnchors = sceneLayout.anchors;
        // Scene curves arrive in logical coordinates; tier-2 thinks in the
        // spec's domain (default 0–100), so map them back before seeding.
        if (sceneLayout.curveSamples) {
          const inv = inverseDomainMapping(spec.domain);
          seedCurveSamples = Object.fromEntries(
            Object.entries(sceneLayout.curveSamples).map(([id, pts]) => [id, pts.map(inv)]),
          );
        }
      } catch (err) {
        warnings.push(`template "${spec.template}" layout failed (${(err as Error).message}) — falling through to tier-2 elements`);
      }
    }
  }

  if (spec.elements && spec.elements.length > 0) {
    // `drawables` here is the template's output — an at.ref may name a template id.
    const tier2 = layoutElements(spec.elements, spec.domain, seedAnchors, seedCurveSamples, { measure, seedDrawables: [...drawables] });
    drawables.push(...tier2.drawables);
    labelRequests.push(...tier2.labels);
    warnings.push(...tier2.warnings);
    issues.push(...tier2.issues);
    windows = tier2.windows;
    panes = tier2.panes;
    pieces = tier2.pieces;
    pieceGroups = tier2.pieceGroups;
    groups = tier2.groups;
    fitGroups = tier2.fitGroups;
    namedAnchors = tier2.namedAnchors;
    measures = tier2.measures;
    for (const el of spec.elements) {
      // A show:none code element draws nothing (it only feeds params), so it
      // must not become a command-addressable id or an implicit final draw.
      if (el.type === "code" && el.show === "none") continue;
      // A pieces element's parent id draws nothing itself — its n pieces
      // (already in tier2.extraOrder) are the command-addressable elements.
      if (el.type === "pieces") continue;
      // A group is the same kind of stand-in: it draws nothing itself, its
      // members do. The plan expands the group id to them (expandGroup).
      if (el.type === "group") continue;
      // Same for a line-less measure (area/perimeter): it draws no dimension
      // line of its own, only the number, which tier-2 registers as the group
      // `pieceGroups[<id>] = ["label_<id>"]`. Leaving the parent in the order
      // would end the cast with a phantom `{draw: ["<id>"]}` painting nothing.
      if (el.type === "measure" && pieceGroups[el.id]) continue;
      if (!order.includes(el.id)) order.push(el.id);
    }
    // Ids tier-2 minted itself (a source element's quote highlights) come
    // AFTER their element — order is also paint order, and a highlighter
    // sweep belongs on top of the page it marks.
    for (const id of tier2.extraOrder) {
      if (!order.includes(id)) order.push(id);
    }
  }

  // A translated copy carries the template's own computed captions here,
  // because those words are in the layout code and never in the spec. Doing it
  // BEFORE the solver means obstacles, placement and annotation boxes are all
  // measured against the words that actually get drawn.
  if (spec.text_map) applyTextMap(drawables, labelRequests, spec.text_map);

  // Label placement against everything drawn so far.
  const obstacles = obstacleBoxes(drawables, measure);
  const placed = placeLabels(labelRequests, obstacles, measure);
  for (const p of placed) {
    if (p.leader) drawables.push(p.leader);
    drawables.push(p.text);
  }
  for (const req of labelRequests) {
    if (!order.includes(req.id)) order.push(req.id);
  }

  // Annotations last: they mark ALREADY-placed geometry (labels included),
  // whether the target came from a template or from tier-2 elements.
  for (const el of spec.elements ?? []) {
    if (el.type !== "annotation") continue;
    // boxOfId, not unionBBoxForId: a `group` files its ink under its MEMBERS'
    // ids and a line-less `measure` (what: area/perimeter) draws only its
    // text, so reading the drawables directly reported both as unknown
    // targets and skipped the mark (C2).
    const box = el.target ? boxOfId(drawables, el.target, measure, groups, pieceGroups) : null;
    if (!box) {
      warnings.push(`annotation "${el.id}": unknown or empty target "${el.target}" — skipped`);
      continue;
    }
    const leaves = leafDrawables(drawablesForId(drawables, el.target!));
    const textTarget = leaves.length > 0 && leaves.every((d) => d.kind === "text");
    drawables.push(...annotationDrawables(el, box, textTarget, (msg) => warnings.push(msg)));
  }

  // lint hands us TOP-LEVEL drawable ids (`n1_text`, a pieces cell, a
  // measure's number), while a group holds ELEMENT ids: resolve each to the
  // member that owns it — the same ownership tier-2 scaled by — or the
  // exemption never fires for the parts an element mints.
  const ownsId = (m: string, id: string) => id === m || id.startsWith(`${m}_`) || (pieceGroups[m] ?? []).includes(id);
  const composed = (a: string, b: string) =>
    Object.values(fitGroups).some((ls) => ls.some((m) => ownsId(m, a)) && ls.some((m) => ownsId(m, b)));
  issues.push(...lintLayout(drawables, measure, spec.commands, (id) => pieceGroups[id] ?? groups[id], composed));
  if (codeEl) issues.push(...codeFigureOverlap(codeEl.id, templateIds, drawables, measure, spec));
  return { drawables, order, issues, warnings, windows, panes, pieces, pieceGroups, groups, fitGroups, namedAnchors, measures };
}

function unionOfBoxes(boxes: (BBox | null)[]): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Does this template accept a `box`? Most own the whole canvas instead. */
function templateTakesBox(template: string | undefined): boolean {
  if (!template) return false;
  const schema = scenes[template]?.manifest.params_schema as { properties?: Record<string, unknown> } | undefined;
  return schema?.properties?.box !== undefined;
}

function isFigureBox(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k] as number));
}

/**
 * The one thing the split cannot fix by default: an author who placed the
 * script and the figure on the same ground. Only pairs that are actually on
 * screen together count — a code panel erased before the chart is drawn was
 * never in its way — and only a real overlap, not a graze.
 */
function codeFigureOverlap(codeId: string, templateIds: string[], drawables: Drawable[], measure: MeasureFn, spec: Spec): LintIssue[] {
  if (templateIds.length === 0) return [];
  // The panel's INK, not a nominal box: its frame (when it has one), its
  // lines and its output pane are separate top-level drawables, and with
  // frame: "none" the group itself draws nothing at all. Empty space inside a
  // frameless panel is not something a figure can overlap.
  const code = unionOfBoxes(
    drawables
      .filter((d) => d.id === codeId || d.id.startsWith(`${codeId}_`))
      .map((d) => unionBBoxForId(drawables, d.id, measure)),
  );
  if (!code) return [];
  // No pieces expansion here: the ids compared are a code element's and the
  // template's own, neither of which can be a pieces parent.
  const together = coVisible(spec.commands, drawables.map((d) => d.id));
  for (const id of templateIds) {
    if (!together(codeId, id)) continue;
    const b = unionBBoxForId(drawables, id, measure);
    if (!b) continue;
    const overlapW = Math.min(code.x + code.w, b.x + b.w) - Math.max(code.x, b.x);
    const overlapH = Math.min(code.y + code.h, b.y + b.h) - Math.max(code.y, b.y);
    if (overlapW > 20 && overlapH > 20) {
      return [
        {
          rule: "overlap-code-figure",
          ids: [codeId, id],
          message:
            `code panel "${codeId}" and the ${spec.template} figure ("${id}") are drawn on the same ground — ` +
            `give the code element x/width, or the template a box, so each has its own area`,
          severity: "warn",
        },
      ];
    }
  }
  return [];
}

/** Union bbox per command-addressable element id (logical units), for the gesture verbs. */
export function elementBBoxes(layout: LayoutResult, measure: MeasureFn = heuristicMeasure): Map<string, BBox> {
  const map = new Map<string, BBox>();
  for (const id of layout.order) {
    const box = unionBBoxForId(layout.drawables, id, measure);
    if (box) map.set(id, box);
  }
  return map;
}

/**
 * Closed outlines per element id, the companion to elementBBoxes. Only closed
 * geometry contributes — an area, or a stroke drawn with `closed: true`. An id
 * with none is absent from the map, and hit-testing falls back to its box.
 */
export function elementRings(layout: Pick<LayoutResult, "drawables" | "order">): Map<string, Pt[][]> {
  const map = new Map<string, Pt[][]>();
  for (const id of layout.order) {
    const rings: Pt[][] = [];
    for (const d of leafDrawables(drawablesForId(layout.drawables, id))) {
      if (d.kind === "area" && d.pts.length >= 3) rings.push(d.pts);
      else if (d.kind === "stroke" && d.closed && d.pts.length >= 3) rings.push(d.pts);
    }
    if (rings.length > 0) map.set(id, rings);
  }
  return map;
}

/**
 * Domain → logical mappings for the gesture verbs, matching tier-2's
 * convention: coordinates are mapped only when a domain is declared.
 */
export function domainMapping(domain: Spec["domain"]): { toLogical: (p: Pt) => Pt; deltaToLogical: (d: Pt) => Pt } {
  if (!domain) return { toLogical: (p) => p, deltaToLogical: (d) => d };
  const plot = plotArea();
  const dx = domain.x ?? [0, 100];
  const dy = domain.y ?? [0, 100];
  const sx = linearScale(dx, [plot.x0, plot.x1]);
  const sy = linearScale(dy, [plot.y0, plot.y1]);
  const fx = (plot.x1 - plot.x0) / (dx[1] - dx[0] || 1);
  const fy = (plot.y1 - plot.y0) / (dy[1] - dy[0] || 1);
  return {
    toLogical: ([x, y]) => [sx(x), sy(y)],
    deltaToLogical: ([a, b]) => [a * fx, b * fy],
  };
}

/** Logical → spec-domain mapping (inverse of tier-2's scales; default domain 0–100). */
function inverseDomainMapping(domain: Spec["domain"]): (p: Pt) => Pt {
  const plot = plotArea();
  const dx = domain?.x ?? [0, 100];
  const dy = domain?.y ?? [0, 100];
  const ix = linearScale([plot.x0, plot.x1], dx);
  const iy = linearScale([plot.y0, plot.y1], dy);
  return ([x, y]) => [ix(x), iy(y)];
}

