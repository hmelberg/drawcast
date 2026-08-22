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

const PAD = 6;
const ANNOTATE_MS = 700;
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

export function annotationDrawables(
  el: SpecElement,
  box: BBox,
  textTarget: boolean,
  onWarn?: (msg: string) => void,
): Drawable[] {
  let kind = el.kind ?? defaultKind(textTarget);
  if (!KINDS.includes(kind)) {
    // Old specs may carry retired kinds (underline/highlight) — degrade, don't crash.
    onWarn?.(`annotation "${el.id}": retired/unknown kind "${kind}" — using ${defaultKind(textTarget)}`);
    kind = defaultKind(textTarget);
  }
  const cy = box.y + box.h / 2;
  const x0 = clampX(box.x - PAD);
  const x1 = clampX(box.x + box.w + PAD);
  const style = resolveStyle(el.style, { strokeWidth: 3.5 });
  const drawOpts = resolveDrawOpts(el.draw, { duration: ANNOTATE_MS });

  switch (kind) {
    case "box": {
      const y0 = clampY(box.y - PAD - 2);
      const y1 = clampY(box.y + box.h + PAD + 2);
      const bx0 = clampX(box.x - PAD - 4);
      const bx1 = clampX(box.x + box.w + PAD + 4);
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
    case "circle":
      return [
        {
          id: el.id,
          kind: "stroke",
          pts: ellipsePts(box.x + box.w / 2, cy, box.w / 2 + PAD + 10, box.h / 2 + PAD + 6),
          closed: true,
          z: Z_STROKE,
          style,
          drawOpts,
        },
      ];
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
