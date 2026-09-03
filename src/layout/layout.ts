// The layout orchestrator: spec → backend-independent drawables + lint.
// Template routing failures fall through to tier-2 gracefully (never hard-fail).

import { scenes } from "../scenes/registry";
import { normalizeSpec } from "../spec/schema";
import { applyTextMap } from "./text-map";
import type { Spec } from "../spec/types";
import { coVisible, lintLayout, type LintIssue } from "../lint/lint";
import { layoutElements } from "./tier2";
import type { CodeWindow } from "./code";
import { annotationDrawables } from "./annotate";
import { placeLabels, type LabelRequest, type Obstacle } from "./labels";
import { bboxOfPts, bboxOfText, expandBox, type BBox } from "./geometry";
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
  const drawables: Drawable[] = [];
  const labelRequests: LabelRequest[] = [];
  const order: string[] = [];
  let windows: Record<string, CodeWindow> = {};
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
    const tier2 = layoutElements(spec.elements, spec.domain, seedAnchors, seedCurveSamples);
    drawables.push(...tier2.drawables);
    labelRequests.push(...tier2.labels);
    warnings.push(...tier2.warnings);
    windows = tier2.windows;
    for (const el of spec.elements) {
      // A show:none code element draws nothing (it only feeds params), so it
      // must not become a command-addressable id or an implicit final draw.
      if (el.type === "code" && el.show === "none") continue;
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
    const box = el.target ? unionBBoxForId(drawables, el.target, measure) : null;
    if (!box) {
      warnings.push(`annotation "${el.id}": unknown or empty target "${el.target}" — skipped`);
      continue;
    }
    const leaves = leafDrawables(drawablesForId(drawables, el.target!));
    const textTarget = leaves.length > 0 && leaves.every((d) => d.kind === "text");
    drawables.push(...annotationDrawables(el, box, textTarget, (msg) => warnings.push(msg)));
  }

  const issues = lintLayout(drawables, measure, spec.commands);
  if (codeEl) issues.push(...codeFigureOverlap(codeEl.id, templateIds, drawables, measure, spec));
  return { drawables, order, issues, warnings, windows };
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

/**
 * Union bbox of the leaf drawables belonging to one element id, or null.
 * Leaders and guide lines are excluded: they POINT AT the element, they are
 * not the element — including them would make annotations and gestures land
 * on the scaffolding instead of the thing (a label pushed aside by the
 * collision solver drags a long leader behind it).
 */
function unionBBoxForId(drawables: Drawable[], id: string, measure: MeasureFn): BBox | null {
  const boxes: BBox[] = [];
  for (const d of leafDrawables(drawablesForId(drawables, id))) {
    if (d.id === `${id}_leader` || d.id === `${id}_guides`) continue;
    if (d.kind === "text") {
      boxes.push(bboxOfText(d, measure));
    } else if (d.kind === "image") {
      boxes.push({ x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h });
    } else if (d.kind === "stroke" && d.shapeHint?.type === "circle") {
      const { c, r } = d.shapeHint;
      boxes.push({ x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r });
    } else if (d.kind === "stroke" && d.shapeHint?.type === "rect") {
      boxes.push({ x: d.shapeHint.x, y: d.shapeHint.y, w: d.shapeHint.w, h: d.shapeHint.h });
    } else if (d.pts.length > 0) {
      boxes.push(bboxOfPts(d.pts));
    }
  }
  if (boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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

/** Longest stroke segment kept as a single obstacle box before subdividing. */
const SEG_MAX = 48;

function obstacleBoxes(drawables: Drawable[], measure: MeasureFn): Obstacle[] {
  const obstacles: Obstacle[] = [];
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
