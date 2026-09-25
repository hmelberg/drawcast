// The layout orchestrator: spec → backend-independent drawables + lint.
// Template routing failures fall through to tier-2 gracefully (never hard-fail).

import { scenes } from "../scenes/registry";
import { normalizeSpec } from "../spec/schema";
import { applyTextMap } from "./text-map";
import { effectiveTextStyle } from "./text-style";
import { setMathTextStyle } from "./math";
import { setMathFont, setMathHand } from "../scenes/engines";
import type { Spec } from "../spec/types";
import { coVisible, idsOf, lintLayout, FIT_SCALE_FLOOR, type LintIssue } from "../lint/lint";
import { layoutElements, type PieceGeometry } from "./tier2";
import { usesDecimalComma } from "./measures";
import { detectLang } from "../render/speech";
import type { MeasureSpec } from "./measures";
import type { CodeWindow } from "./code";
import { annotationDrawables, DEFAULT_FIT, padFor } from "./annotate";
import { obstacleBoxes, placeLabels, type LabelPin, type LabelRequest } from "./labels";
import type { BBox } from "./geometry";
import { boxOfId, unionBBoxForId, unionBoxes } from "./boxes";
import { bboxOfText } from "./geometry";
import { hasDefaultColumnInsets, INSET_MAIN } from "./inset";
import type { LayoutOverrides } from "./posed";
import { heuristicMeasure, type MeasureFn } from "./measure";
import { drawablesForId, leafDrawables, type Drawable, type Pt } from "./model";
import { frameToCanvas, linearScale, plotArea, type DataFrame } from "./canvas";
import { figureSplit } from "./figure-split";
import { fitSceneLayout, growSceneLayout, resolveTemplateBox, type TemplateFit } from "./template-fit";
import type { SceneLayout } from "../scenes/types";
import { FIT_NAMES, isFitName } from "./regions";
import { expandBoxAnimate, readParam, withOverrides } from "../render/params";

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
  /** Element id → the ids that follow it (a template's own labels, scenes/types.ts
   *  `attached`). Empty for a spec with no template. */
  attached: Record<string, string[]>;
  /** Those groups that carry a `fit` (tier2.fitGroups): their members were
   *  scaled and centred together, which excuses their mutual overlaps. */
  fitGroups: Record<string, string[]>;
  /** Geometric anchors per tier-2 element id (design §2.1). Empty for a pure template spec. */
  namedAnchors: Record<string, Record<string, Pt>>;
  /** `measure` element specs (design §2.3), keyed by the measure's own element id. Empty when the spec has no measure elements. */
  measures: Record<string, MeasureSpec>;
  /** Where the label solver put each label, as a vector from its anchor — the
   *  `pins` a tween frame hands back so the placement stops being re-solved
   *  sixty times a second (labels.ts, LabelPin). */
  labelPins: Record<string, LabelPin>;
  /** The template's fit into its box (spec/2026-09-15-template-box): absent
   *  when no box was in play or the template laid itself out in one. */
  fit?: TemplateFit;
  /** The page's data coordinates — the spec's `domain` on the default plot
   *  area, else a chart template's own (SceneLayout.frame). What
   *  `{data: [x, y]}` means, in layout and plan alike. */
  frame?: DataFrame;
}

/**
 * `overrides` (design 2026-09-10 §2.5, layout/posed.ts): the poses and morphed
 * shapes of elements something is DEFINED by. Their own ink stays in its
 * original frame (the renderer poses it); what depends on them — an
 * intersection, a region between, an arrow's end, an angle's arm, a line's
 * point, a measure — is computed from where they now stand.
 *
 * `labelPinsIn` is the continuity hint, not geometry: the label placements a
 * BOUNDARY solved, handed back so a tween frame follows them instead of
 * solving again (labels.ts, LabelPin). Absent — every call outside the
 * reprojector's frame path — and the solver runs exactly as it always has.
 */
export function layoutSpec(
  rawSpec: Spec,
  measure: MeasureFn = heuristicMeasure,
  overrides?: LayoutOverrides,
  labelPinsIn?: Record<string, LabelPin>,
  opts: { skipDrawBeatLint?: boolean } = {},
): LayoutResult {
  const spec = normalizeSpec(rawSpec) as Spec;
  // Formulas are laid out as glyph outlines, so the font is a layout input,
  // not a render one: every math element and equation_steps step below reads
  // this (scenes/engines.ts). The viewer's override arrives already folded
  // into the text block (text-style.ts withTextStyle).
  const textStyle = effectiveTextStyle(spec);
  setMathFont(textStyle.mathFont);
  // Likewise the hand (scenes/math-hand.ts: letters and digits written with
  // Patrick Hand on MathJax's layout, on unless the block says
  // `math_hand: false`) and the text scale (layout/math.ts): a formula's
  // size follows `text.font_size` the way every text drawable does.
  setMathHand(textStyle.mathHand);
  setMathTextStyle({ scale: textStyle.scale });
  const warnings: string[] = [];
  // A template and a script on screen each get their own half of the canvas
  // before anything is laid out — the default the two used to lack, so a
  // chart no longer lands on top of the code that computed it. Since the
  // template box round every template that lays out can take a box: the
  // five data templates natively, the rest by the fit below.
  const codeEl = (spec.elements ?? []).find((e) => e.type === "code" && e.show !== "none");
  const hasTemplate = !!(spec.template && scenes[spec.template]?.layout);
  const rawBox = (spec.params ?? {})["box"];
  const requestedBox = resolveTemplateBox(rawBox);
  if (rawBox !== undefined && !requestedBox) {
    warnings.push(`template box ${JSON.stringify(rawBox)} is neither a region name (${FIT_NAMES.join(", ")}) nor {x, y, w, h} — ignored`);
  }
  const split = figureSplit({
    hasTemplate,
    templateTakesBox: hasTemplate,
    boxGiven: requestedBox !== null,
    code: codeEl ? { x: codeEl.x, width: codeEl.width, show: codeEl.show, code: codeEl.code, fontSize: codeEl.font_size } : null,
  });
  if (split.code && codeEl) Object.assign(codeEl, split.code);
  // A page with thumbnail-column insets and no box of its own keeps the template left of the column (spec 2026-09-17-inset §4.7).
  const box = requestedBox ?? split.box ?? (hasTemplate && hasDefaultColumnInsets(spec.elements) ? INSET_MAIN : null);
  const native = nativeBox(spec.template);
  // The five templates that lay themselves out in a box get the RECTANGLE —
  // a name means nothing to them. Everyone else keeps params untouched and
  // is fitted after laying out.
  if (box && native) spec.params = { ...(spec.params ?? {}), box };
  let fit: TemplateFit | undefined;
  const issues: LintIssue[] = [];
  const drawables: Drawable[] = [];
  const labelRequests: LabelRequest[] = [];
  const order: string[] = [];
  let windows: Record<string, CodeWindow> = {};
  let panes: Record<string, BBox> = {};
  let pieces: Record<string, PieceGeometry> = {};
  let pieceGroups: Record<string, string[]> = {};
  let groups: Record<string, string[]> = {};
  let attached: Record<string, string[]> = {};
  let fitGroups: Record<string, string[]> = {};
  let namedAnchors: Record<string, Record<string, Pt>> = {};
  let measures: Record<string, MeasureSpec> = {};
  let seedAnchors: Record<string, Pt> = {};
  let seedCurveSamples: Record<string, Pt[]> = {};
  let templateIds: string[] = [];
  let templateFrame: DataFrame | undefined;

  if (spec.template) {
    const scene = scenes[spec.template];
    if (!scene) {
      warnings.push(`unknown template "${spec.template}" — falling through to tier-2 elements`);
    } else if (!scene.layout) {
      warnings.push(`template "${spec.template}" is a stub — falling through to tier-2 elements`);
    } else {
      try {
        const sceneLayout = scene.layout(spec.params ?? {});
        if (box && !native) fit = fitSceneLayout(sceneLayout, box, measure) ?? undefined;
        else if (!box && !native && mayGrow(spec, scene.manifest)) fit = growSceneLayout(sceneLayout, measure) ?? undefined;
        if (fit && fit.s < FIT_SCALE_FLOOR) {
          const where = isFitName(rawBox) ? `"${rawBox}"` : JSON.stringify(fit.box);
          issues.push({
            rule: "fit-scale",
            ids: [], // a template name is not an element id (template-params does the same)
            severity: "warn",
            message:
              `template ${spec.template} is fitted at ${fit.s.toFixed(2)} into box ${where}; its labels are held at the readable floor — ` +
              `give it a taller region, or use a template with a native box`,
          });
        }
        templateIds = sceneLayout.order;
        // A `draw` of an id the template's catalog entry DECLARES but this
        // layout did not PRODUCE — `dwl_region` on a page whose `regions`
        // lacks "deadweight_loss" — used to be a plan warning ("unknown id —
        // dropped") that never reached the repair loop, so the beat shipped
        // drawing nothing (the Haiku specimen, 2026-09-22). An error here,
        // carrying the entry's own doc string: that is where a manifest names
        // the param that switches the id on. Only ids the template declares:
        // an id it never heard of is the planner's unknown-id warning.
        // A draw-beat lint: it asks whether the id existed when its draw beat
        // ran, so a relayout at a later animate stage (the examples bench,
        // the draw-beat layout below) passes skipDrawBeatLint and skips it —
        // a label that legitimately vanishes as the triangle shrinks is not
        // a beat that drew nothing.
        if (!opts.skipDrawBeatLint) issues.push(...templateIdsOff(spec, scene.manifest.element_ids ?? {}, sceneLayout));
        // The template's own group names (scenes/types.ts): a channel to the
        // planner's parent-id expansion, which until now only freehand specs
        // could reach. Set before tier-2 runs, and tier-2's own groups are
        // merged onto them below, so a spec-level group of the same name wins
        // — the author's word beats the template's.
        if (sceneLayout.groups) groups = { ...sceneLayout.groups };
        if (sceneLayout.attached) attached = { ...sceneLayout.attached };
        drawables.push(...sceneLayout.drawables);
        labelRequests.push(...sceneLayout.labels);
        order.push(...sceneLayout.order);
        seedAnchors = sceneLayout.anchors;
        if (sceneLayout.frame) templateFrame = sceneLayout.frame;
        // Scene curves arrive in logical coordinates; tier-2 thinks in the
        // spec's domain (default 0–100), so map them back before seeding.
        if (sceneLayout.curveSamples) {
          const inv = inverseDomainMapping(spec.domain ?? templateFrame, fit);
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
    // The figure writes numbers the way the voice reads them: 8,7 in a
    // Norwegian cast. spec.lang when set, else the narration's own sniff.
    const spoken = (spec.commands ?? []).map((c) => c.speak ?? "").join(" ");
    const decimalComma = usesDecimalComma(spec.lang, spoken.trim() ? detectLang(spoken) : undefined);
    const tier2 = layoutElements(spec.elements, spec.domain, seedAnchors, seedCurveSamples, { measure, seedDrawables: [...drawables], vars: spec.vars, overrides, fit, decimalComma, frame: templateFrame });
    drawables.push(...tier2.drawables);
    labelRequests.push(...tier2.labels);
    warnings.push(...tier2.warnings);
    issues.push(...tier2.issues);
    windows = tier2.windows;
    panes = tier2.panes;
    pieces = tier2.pieces;
    pieceGroups = tier2.pieceGroups;
    groups = { ...groups, ...tier2.groups };
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

  // Label placement against everything drawn so far — INCLUDING the borders
  // that are not drawn yet. An annotation is laid out last, because it may
  // mark a label; but one that marks something already drawn has a box we can
  // predict here, and a label that cannot see it will happily sit on it. The
  // prediction is the same padFor the real pass uses, so what the solver
  // avoids is what gets drawn.
  const obstacles = obstacleBoxes(drawables, measure);
  const labelIds = new Set(labelRequests.map((r) => r.id));
  for (const el of spec.elements ?? []) {
    if (el.type !== "annotation" || el.kind === "strike" || el.kind === "cross") continue;
    const targets = ([] as string[]).concat(el.target ?? []);
    if (targets.length === 0 || targets.some((id) => labelIds.has(id))) continue;
    const box = unionBoxes(targets.map((id) => boxOfId(drawables, id, measure, groups, pieceGroups)));
    if (!box) continue;
    const leaves = targets.flatMap((id) => leafDrawables(drawablesForId(drawables, id)));
    if (leaves.length === 0) continue;
    const isText = leaves.every((d) => d.kind === "text");
    const pad = padFor(
      {
        roughness: Math.max(DEFAULT_FIT.roughness, ...leaves.map((d) => d.style.roughness)),
        strokeWidth: Math.max(DEFAULT_FIT.strokeWidth, ...leaves.map((d) => d.style.strokeWidth)),
        fontSize: isText ? Math.max(...leaves.map((d) => (d.kind === "text" ? d.fontSize : 0))) : undefined,
      },
      DEFAULT_FIT.roughness,
      DEFAULT_FIT.strokeWidth,
    );
    // Solid: a drawn border is ink a label must not sit on, the same as text.
    obstacles.push({ box: { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }, solid: true, id: el.id });
  }
  const placed = placeLabels(labelRequests, obstacles, measure, labelPinsIn);
  const labelPins: Record<string, LabelPin> = {};
  for (const p of placed) {
    if (p.leader) drawables.push(p.leader);
    drawables.push(p.text);
    labelPins[p.text.id] = p.pin;
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
    // One border around all of its targets: the union of their boxes, and the
    // union of their ink for deciding what the border has to clear.
    const targets = ([] as string[]).concat(el.target ?? []);
    const found = targets.filter((id) => {
      const ok = boxOfId(drawables, id, measure, groups, pieceGroups) !== null;
      if (!ok) warnings.push(`annotation "${el.id}": unknown or empty target "${id}" — not marked`);
      return ok;
    });
    const box = unionBoxes(found.map((id) => boxOfId(drawables, id, measure, groups, pieceGroups)));
    if (!box) {
      warnings.push(`annotation "${el.id}": nothing to mark — skipped`);
      continue;
    }
    const leaves = found.flatMap((id) => leafDrawables(drawablesForId(drawables, id)));
    const textTarget = leaves.length > 0 && leaves.every((d) => d.kind === "text");
    // What the border has to clear, read off the ink itself rather than
    // assumed: the roughest stroke, the widest, and the largest font.
    const fit = {
      roughness: Math.max(DEFAULT_FIT.roughness, ...leaves.map((d) => d.style.roughness)),
      strokeWidth: Math.max(DEFAULT_FIT.strokeWidth, ...leaves.map((d) => d.style.strokeWidth)),
      fontSize: textTarget ? Math.max(...leaves.map((d) => (d.kind === "text" ? d.fontSize : 0))) : undefined,
    };
    // The target's ink, for sizing a ring: stroke points as they are, and the
    // corners of anything that occupies a box.
    const inkPts = leaves.flatMap((d) => {
      if (d.kind === "stroke" || d.kind === "area") return d.pts;
      const b = d.kind === "text" ? bboxOfText(d, measure) : { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h };
      return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as Pt[];
    });
    drawables.push(...annotationDrawables(el, box, textTarget, (msg) => warnings.push(msg), fit, inkPts));
  }

  // lint hands us TOP-LEVEL drawable ids (`n1_text`, a pieces cell, a
  // measure's number), while a group holds ELEMENT ids: resolve each to the
  // member that owns it — the same ownership tier-2 scaled by — or the
  // exemption never fires for the parts an element mints.
  const ownsId = (m: string, id: string) => id === m || id.startsWith(`${m}_`) || (pieceGroups[m] ?? []).includes(id);
  // An annotation lies ON what it marks by design (a cross over a rejected
  // formula, a ring round an answer): mark and target are one composition,
  // not an overlap (2026-09-25 example revisions).
  const annotated: [string, string[]][] = (spec.elements ?? [])
    .filter((e) => e.type === "annotation")
    .map((e) => [e.id, (Array.isArray(e.target) ? e.target : e.target !== undefined ? [e.target] : []) as string[]]);
  const marks = (x: string, y: string) => annotated.some(([id, ts]) => ownsId(id, x) && ts.some((t) => ownsId(t, y)));
  const composed = (a: string, b: string) =>
    marks(a, b) || marks(b, a) || Object.values(fitGroups).some((ls) => ls.some((m) => ownsId(m, a)) && ls.some((m) => ownsId(m, b)));
  const layoutIssues = lintLayout(drawables, measure, spec.commands, (id) => pieceGroups[id] ?? groups[id], composed);
  layoutIssues.push(...headingIntrusions(drawables, measure, spec.commands));
  const atDraw = codeEl && !opts.skipDrawBeatLint ? paramsAtFirstDraw(rawSpec, codeEl.id) : null;
  if (!codeEl || atDraw === null) {
    issues.push(...layoutIssues);
    if (codeEl) issues.push(...codeFigureOverlap(codeEl.id, templateIds, drawables, measure, spec));
  } else {
    // The panel arrives after the figure has moved: its pairs are judged on
    // the layout of THAT beat, everything else on the base layout as before.
    const ownsCode = (id: string) => id === codeEl.id || id.startsWith(`${codeEl.id}_`);
    issues.push(...layoutIssues.filter((i) => !i.ids.some(ownsCode)));
    const later = layoutSpec({ ...rawSpec, params: atDraw }, measure, overrides, labelPinsIn, { skipDrawBeatLint: true });
    issues.push(...later.issues.filter((i) => i.ids.some(ownsCode)));
    // later.warnings deliberately discarded: the base layout above already
    // carries the template's/tier-2's warnings (same spec, same elements) —
    // the draw-beat layout would only repeat them under a moved box.
  }
  const frame = pageFrame(spec.domain, templateFrame);
  // `{data: [x, y]}` on a template page means the template's own axes — and
  // a template that draws none reports no frame, so the data would silently
  // read a 0–100 domain. Say so (unless the params still wait on a script:
  // a code-fed chart reports its frame only once its data is real).
  if (spec.template && !frame && hasTemplate) {
    const usesData = /"data":\s*(\[|true)/.test(JSON.stringify({ e: spec.elements ?? [], c: spec.commands ?? [] }));
    const waiting = /"\{[A-Za-z_][\w]*\.[^"]*\}"/.test(JSON.stringify(spec.params ?? {}));
    if (usesData && !waiting) warnings.push(`template "${spec.template}" has no data axes — {data: [x, y]} reads a 0–100 domain on the plot area; place overlays with at.ref/anchor instead`);
  }
  return { drawables, order, issues, warnings, windows, panes, pieces, pieceGroups, groups, attached, fitGroups, namedAnchors, measures, labelPins, ...(fit ? { fit } : {}), ...(frame ? { frame } : {}) };
}

/** Does this template lay itself out in a `box` param? Five data templates
 *  do; every other template is fitted by template-fit.ts. */
export function nativeBox(template: string | undefined): boolean {
  if (!template) return false;
  const schema = scenes[template]?.manifest.params_schema as { properties?: Record<string, unknown> } | undefined;
  return schema?.properties?.box !== undefined;
}

/**
 * The params in force when `elementId` is first drawn: every `animate`
 * before that beat, folded — but only the keys that are actual TEMPLATE
 * params. A key folds only when `readParam` already resolves it against the
 * params accumulated so far (a `box.*` key resolves through the name-aware
 * read too, so a region's rectangle still folds). A var override
 * (`{animate: {f: 3}}`, which the player keeps under `vars.<name>`, not
 * `params`) never resolves this way, so it is dropped here and never flips
 * `animated` — nothing template-side reads it, so it cannot change what the
 * lint judges. Null when nothing template-side animates before it — the
 * layout at the base params is then the layout at that beat too. The lint
 * uses this for a code panel that arrives after the figure has moved (a
 * template that starts full and shrinks into a half to make room), so it
 * judges the pair on the ground they actually share.
 *
 * "Drawn" counts `draw`, `show`, and a play beat's `reveal` (ids it puts on
 * screen in time with the notes, and keeps).
 *
 * An element never named in any `draw`/`show`/`reveal` is still drawn — by
 * the plan's IMPLICIT final draw, after every command (render/plan.ts, the
 * trailing draw of everything left undrawn). So running off the end of the
 * commands without ever finding `elementId` means it was drawn last, after
 * every animate: fold to the end just as if a final beat had drawn it.
 */
function templateIdsOff(spec: Spec, declared: Record<string, string>, laid: SceneLayout): LintIssue[] {
  const docOf = new Map<string, string>();
  for (const [key, doc] of Object.entries(declared)) for (const id of key.split("/")) docOf.set(id.trim(), doc);
  const produced = new Set<string>([
    ...leafDrawables(laid.drawables).map((d) => d.id),
    ...laid.drawables.map((d) => d.id),
    ...laid.labels.map((l) => l.id),
    ...Object.keys(laid.groups ?? {}),
    ...(spec.elements ?? []).map((e) => e.id),
  ]);
  const seen = new Set<string>();
  const issues: LintIssue[] = [];
  for (const cmd of spec.commands ?? []) {
    for (const id of ([] as string[]).concat(cmd.draw ?? [])) {
      if (seen.has(id) || produced.has(id) || !docOf.has(id)) continue;
      seen.add(id);
      issues.push({
        rule: "template-id-off",
        ids: [], // a template's id is not a spec element (template-params does the same)
        severity: "error",
        message: `draw "${id}": template ${spec.template} did not draw it with these params — its catalog entry says: ${docOf.get(id)}`,
      });
    }
  }
  return issues;
}

export function paramsAtFirstDraw(spec: Spec, elementId: string): Record<string, unknown> | null {
  let params = spec.params ?? {};
  let animated = false;
  const owns = (id: string) => id === elementId || id.startsWith(`${elementId}_`);
  for (const cmd of spec.commands ?? []) {
    const drawn = [...idsOf(cmd.draw), ...idsOf(cmd.show), ...idsOf(cmd.reveal)];
    if (drawn.some(owns)) return animated ? params : null;
    if (cmd.animate) {
      const numeric = Object.fromEntries(
        Object.entries(expandBoxAnimate(cmd.animate)).filter(([k, v]) => typeof v === "number" && readParam(params, k) !== null),
      );
      if (Object.keys(numeric).length > 0) { params = withOverrides(params, numeric); animated = true; }
    }
  }
  return animated ? params : null;
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
  const code = unionBoxes(
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
            `give the template a box (params.box: "left" or "right"), or the code element x/width, so each has its own area`,
          severity: "warn",
        },
      ];
    }
  }
  return [];
}

/** Union bbox per command-addressable element id (logical units), for the gesture verbs. */
export function elementBBoxes(layout: Pick<LayoutResult, "drawables" | "order">, measure: MeasureFn = heuristicMeasure): Map<string, BBox> {
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

/** Spec domain → logical canvas. With a `fit`, the standard plot area is
 *  where the template's axes WERE; the fit says where they are now.
 *  No domain: coordinates are canvas coordinates and never follow a
 *  template's fit (tier-3 rule). */
/**
 * May a template page be enlarged to fill the canvas (template-fit.ts
 * growSceneLayout)? Not when something would stay behind: an overlay at
 * fixed canvas coordinates (a text at x/y, a path's points, an arrow end at
 * {x, y}) — the card's own heading aside; not a widget or an interactive
 * figure, whose hit areas are fixed geometry; and not a page that animates
 * the template's params, where a grown figure would breathe as its extent
 * changes.
 */
function mayGrow(spec: Spec, manifest: { widget?: true; interactions?: unknown[]; grow?: boolean }): boolean {
  if (manifest.grow === false || manifest.widget || (manifest.interactions?.length ?? 0) > 0) return false;
  if ((spec.commands ?? []).some((c) => c.animate && Object.keys(c.animate).some((k) => !k.startsWith("vars.")))) return false;
  const fixed = (p: unknown): boolean => {
    if (!p || typeof p !== "object") return false;
    if (Array.isArray(p)) return p.length === 2 && typeof p[0] === "number";
    const o = p as { x?: unknown; y?: unknown; ref?: unknown; data?: unknown; on?: unknown };
    return o.ref === undefined && o.data === undefined && o.on === undefined && typeof o.x === "number" && typeof o.y === "number";
  };
  for (const el of spec.elements ?? []) {
    if (/^card_\d+_/.test(el.id) || el.type === "label" || el.type === "group") continue;
    const at = el.at as { ref?: unknown; place?: unknown } | undefined;
    const placedRel = !!at && !Array.isArray(at) && (at.ref !== undefined || at.place !== undefined);
    if (!placedRel && (typeof el.x === "number" || typeof el.y === "number")) return false;
    if (el.points && el.data !== true) return false;
    if (fixed(el.from) || fixed(el.to) || fixed(el.at)) return false;
  }
  return true;
}

/** The page's data frame: the spec's `domain` on the default plot area, else a template's own. */
export function pageFrame(domain: Spec["domain"], templateFrame?: DataFrame): DataFrame | undefined {
  if (domain) return { x: domain.x ?? [0, 100], y: domain.y ?? [0, 100], box: plotArea() };
  return templateFrame;
}

const isFrame = (d: Spec["domain"] | DataFrame | undefined): d is DataFrame => !!d && "box" in d;

/**
 * Data → logical for the planner's positions, fit included. Given a spec
 * `domain` (or a frame built from one) — or a template's frame, for the
 * `{data: [x, y]}` form. Nothing given: logical in, logical out.
 */
export function domainMapping(domain: Spec["domain"] | DataFrame | undefined, fit?: TemplateFit): { toLogical: (p: Pt) => Pt; deltaToLogical: (d: Pt) => Pt } {
  if (!domain) return { toLogical: (p) => p, deltaToLogical: (d) => d };
  const f: DataFrame = isFrame(domain) ? domain : { x: domain.x ?? [0, 100], y: domain.y ?? [0, 100], box: plotArea() };
  const s = fit?.s ?? 1, dx = fit?.dx ?? 0, dy = fit?.dy ?? 0;
  const post = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  const postDelta = ([a, b]: Pt): Pt => [a * s, b * s];
  const map = frameToCanvas(f);
  const fx = (f.box.x1 - f.box.x0) / (f.x[1] - f.x[0] || 1);
  const fy = (f.box.y1 - f.box.y0) / (f.y[1] - f.y[0] || 1);
  return {
    toLogical: (p) => post(map(p)),
    deltaToLogical: ([a, b]) => postDelta([a * fx, b * fy]),
  };
}

/** Logical canvas → data (the inverse of domainMapping, fit included). */
export function inverseDomainMapping(domain: Spec["domain"] | DataFrame | undefined, fit?: TemplateFit): (p: Pt) => Pt {
  const s = fit?.s ?? 1, dx = fit?.dx ?? 0, dy = fit?.dy ?? 0;
  const f: DataFrame = isFrame(domain) ? domain : { x: domain?.x ?? [0, 100], y: domain?.y ?? [0, 100], box: plotArea() };
  const ix = linearScale([f.box.x0, f.box.x1], f.x);
  const iy = linearScale([f.box.y0, f.box.y1], f.y);
  return ([x, y]) => [ix((x - dx) / s), iy((y - dy) / s)];
}

/**
 * The card's heading (the top strip, `card_<n>_title` over `card_<n>_line`)
 * belongs to the heading alone: a figure that reaches up into it — a lung
 * outline through the underline — passed every other rule, because a stroke
 * only GRAZING a text's box is allowed by design and stroke–stroke is never
 * checked (2026-09-25 example revisions). Leaves of other drawables that rise
 * above the underline within the heading's width are reported.
 */
function headingIntrusions(drawables: Drawable[], measure: MeasureFn, commands?: Spec["commands"]): LintIssue[] {
  // The top heading only (its underline sits near the top edge); the TV-style
  // centre card is sketched mid-canvas and erased again.
  const lines = drawables.filter((d) => /^card_\d+_line$/.test(d.id) && d.kind === "stroke" && d.pts.every((p) => p[1] > 600));
  if (lines.length === 0) return [];
  const prefix = lines[0].id.replace(/_line$/, "");
  const title = drawables.find((d) => d.id === `${prefix}_title`);
  if (!title || title.kind !== "text") return [];
  const underline = Math.min(...lines.flatMap((d) => (d.kind === "stroke" ? d.pts.map((p) => p[1]) : [])));
  const tb = bboxOfText(title, measure);
  const inStrip = (x: number, y: number) => y > underline + 2 && x > tb.x && x < tb.x + tb.w;
  // Only what is on screen WITH the heading: a template's own title that the
  // cast hides before the card never shares the strip with it.
  const together = coVisible(commands, drawables.map((d) => d.id));
  const issues: LintIssue[] = [];
  for (const d of drawables) {
    if (/^card_\d+_/.test(d.id) || !together(title.id, d.id)) continue;
    let hit: [number, number] | null = null;
    for (const leaf of leafDrawables([d])) {
      if (leaf.kind === "stroke" || leaf.kind === "area") {
        const p = leaf.pts.find(([x, y]) => inStrip(x, y));
        if (p) { hit = p; break; }
      } else if (leaf.kind === "text") {
        const b = bboxOfText(leaf, measure);
        if (b.y + b.h > underline + 2 && b.x + b.w > tb.x && b.x < tb.x + tb.w) { hit = [b.x, b.y + b.h]; break; }
      }
    }
    if (hit) {
      issues.push({ rule: "heading-intrusion", ids: [d.id], message: `"${d.id}" reaches into the card heading (y ${Math.round(hit[1])}, above its underline at ${Math.round(underline)}) — fit the figure lower (a template's params.box, or a lower position)`, severity: "warn" });
    }
  }
  return issues;
}
