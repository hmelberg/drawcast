// Permanent punctuation marks, drawn natively: an annotation element
// references a target and becomes ordinary stroke drawables computed from the
// target's laid-out bbox — so it animates, exports, zooms, scrubs, and erases
// with no special machinery. The vocabulary is deliberately small (box /
// circle / strike / cross): transient emphasis belongs to the highlight verb
// and the point laser, area emphasis to region shading. Runs as a final
// layout pass — after label placement, so placed labels are valid targets.

import { CANVAS } from "./canvas";
import type { BBox } from "./geometry";
import { Z_STROKE, Z_TEXT, defaultStyle, type Drawable, type Pt } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { AnnotationKind, SpecElement } from "../spec/types";

/** Breathing room, once everything measurable has been accounted for. */
const BASE_PAD = 3;
const ANNOTATE_MS = 700;

/**
 * How far the hand-drawn wobble strays BEYOND the clean path it was computed
 * from. rough.js applies roughness and bowing at render time, so every box
 * built from layout geometry is built from a path the ink does not follow.
 *
 * Measured against a 200 × 100 rectangle over 40 seeds: 2.5 units at
 * roughness 0.8, 3.8 at 1.2, 5.1 at 1.6, 7.0 at 2.2 — linear in roughness at
 * about 3.2 units per unit of roughness. The default roughness is 1.4, so the
 * old flat PAD of 6 was left with essentially no clearance once the target's
 * own half-stroke was subtracted, which is why ink touched its own border.
 */
export function strayOf(roughness: number): number {
  return 3.2 * roughness;
}

/** What the border has to clear: the target's ink, and its own. */
export interface TargetFit {
  /** The roughest stroke among the target's leaves. */
  roughness: number;
  /** The widest stroke among them — half of it sits outside the path. */
  strokeWidth: number;
  /** The largest font among them, when the target is text. */
  fontSize?: number;
}

export const DEFAULT_FIT: TargetFit = { roughness: 1.4, strokeWidth: 3.5 };

/** Half the paper halo SVG text is painted with, so it stays legible over a
 *  stroke (svg-backend paints stroke-width 5 under paint-order: stroke). */
const TEXT_HALO = 2.5;

/**
 * The gap between the target's box and the border, in logical units.
 *
 * Every term is a real distance, and the two kinds of target are genuinely
 * different: a STROKE is drawn by rough.js and wanders (and half its width
 * sits outside its own path), while TEXT is an SVG glyph that does not wander
 * at all — it only carries its paper halo. Charging text for a wobble it
 * never has would float a boxed word in too much air; not charging a stroke
 * for the wobble it does have is what let ink cross its own border.
 *
 * The border itself always wanders, inward, so its own stray counts too. The
 * font term is the one piece of taste: a big word wants proportionally more
 * air than a small one.
 */
export function padFor(fit: TargetFit, ownRoughness: number, ownStrokeWidth: number): number {
  const target = fit.fontSize !== undefined ? TEXT_HALO : strayOf(fit.roughness) + fit.strokeWidth / 2;
  return BASE_PAD + target + strayOf(ownRoughness) + ownStrokeWidth / 2 + (fit.fontSize ?? 0) * 0.08;
}
const KINDS: AnnotationKind[] = ["box", "circle", "strike", "cross"];

function clampX(x: number): number {
  return Math.min(Math.max(x, 4), CANVAS.w - 4);
}
function clampY(y: number): number {
  return Math.min(Math.max(y, 4), CANVAS.h - 4);
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (2 * Math.PI * i) / 28;
    pts.push([clampX(cx + rx * Math.cos(a)), clampY(cy + ry * Math.sin(a))]);
  }
  return pts;
}

/** Default mark per target: text reads best boxed, shapes ringed. */
export function defaultKind(textTarget: boolean): AnnotationKind {
  return textTarget ? "box" : "circle";
}

/**
 * How much an ellipse of the box's own proportions has to grow to contain the
 * target's ink. A rectangle-filling word needs √2 — its corners are the part
 * that pokes out. A round target needs nothing: the ring can hug it. Reading
 * the ink instead of the bounding rectangle is the difference between a ring
 * that fits a dome and one that clears its corners for no reason.
 */
function ellipseGrowth(pts: Pt[], cx: number, cy: number, rx: number, ry: number): number {
  let k = 1;
  for (const [x, y] of pts) {
    const t = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (t > k) k = t;
  }
  return Math.min(k, Math.SQRT2);
}

export function annotationDrawables(
  el: SpecElement,
  box: BBox,
  textTarget: boolean,
  onWarn?: (msg: string) => void,
  fit: TargetFit = DEFAULT_FIT,
  ink: Pt[] = [],
): Drawable[] {
  let kind = el.kind ?? defaultKind(textTarget);
  if (!KINDS.includes(kind)) {
    // Old specs may carry retired kinds (underline/highlight) — degrade, don't crash.
    onWarn?.(`annotation "${el.id}": retired/unknown kind "${kind}" — using ${defaultKind(textTarget)}`);
    kind = defaultKind(textTarget);
  }
  const cy = box.y + box.h / 2;
  const style = resolveStyle(el.style, { strokeWidth: 3.5 });
  const PAD = padFor(fit, style.roughness, style.strokeWidth);
  const x0 = clampX(box.x - PAD);
  const x1 = clampX(box.x + box.w + PAD);
  const drawOpts = resolveDrawOpts(el.draw, { duration: ANNOTATE_MS });

  switch (kind) {
    case "box": {
      const y0 = clampY(box.y - PAD);
      const y1 = clampY(box.y + box.h + PAD);
      const bx0 = x0;
      const bx1 = x1;
      return [
        {
          id: el.id,
          kind: "stroke",
          pts: [
            [bx0, y0],
            [bx1, y0],
            [bx1, y1],
            [bx0, y1],
          ],
          closed: true,
          z: Z_STROKE,
          style,
          drawOpts,
        },
      ];
    }
    case "circle": {
      const cx = box.x + box.w / 2;
      const rx = box.w / 2 + PAD;
      const ry = box.h / 2 + PAD;
      // Sized to the ink: √2 for a word that fills its box, 1 for a round
      // target, whatever the shape actually needs in between.
      const k = ink.length > 0 ? ellipseGrowth(ink, cx, cy, rx, ry) : Math.SQRT2;
      return [
        {
          id: el.id,
          kind: "stroke",
          pts: ellipsePts(cx, cy, rx * k, ry * k),
          closed: true,
          z: Z_STROKE,
          style,
          drawOpts,
        },
      ];
    }
    case "strike":
      return [
        {
          id: el.id,
          kind: "stroke",
          pts: [
            [x0, clampY(cy - 2)],
            [x1, clampY(cy + 3)],
          ],
          z: Z_TEXT, // a strike-through crosses OVER the text
          style,
          drawOpts,
        },
      ];
    case "cross": {
      const y0 = clampY(box.y - 2);
      const y1 = clampY(box.y + box.h + 2);
      const a: Drawable = {
        id: `${el.id}_a`,
        kind: "stroke",
        pts: [
          [x0, y1],
          [x1, y0],
        ],
        z: Z_TEXT,
        style,
        drawOpts,
      };
      const b: Drawable = {
        id: `${el.id}_b`,
        kind: "stroke",
        pts: [
          [x0, y0],
          [x1, y1],
        ],
        z: Z_TEXT,
        style,
        drawOpts,
      };
      return [{ id: el.id, kind: "group", children: [a, b], z: Z_TEXT, style: defaultStyle(), drawOpts }];
    }
  }
}
