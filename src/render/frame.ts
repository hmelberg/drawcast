// The frame the player would PAINT at a scene state, as plain drawables — the
// pure counterpart of svg-backend.ts's buildNodes (which composes the same
// state into DOM nodes). The inset element embeds another page's final frame
// this way (spec 2026-09-17-inset §4.3); nothing here touches a DOM.
import { unionBoxes } from "../layout/boxes";
import { bboxOfPts, bboxOfText, type BBox } from "../layout/geometry";
import type { LayoutResult } from "../layout/layout";
import type { MeasureFn } from "../layout/measure";
import { drawablesForId, leafDrawables, type Drawable, type GroupDrawable } from "../layout/model";
import { mapDrawable, type LeafDrawable } from "../layout/posed";
import type { SceneState } from "./plan";
import { poseOf } from "./pose";

export interface Frame {
  /** The visible leaves in visible order, posed, faded, re-homed under `${prefix}__p${k}`. */
  drawables: Drawable[];
  /** Union box per visible element id, as posed. */
  boxes: Record<string, BBox>;
}

export function frameDrawables(layout: Pick<LayoutResult, "drawables">, state: SceneState, prefix: string, measure: MeasureFn): Frame {
  const drawables: Drawable[] = [];
  const boxes: Record<string, BBox> = {};
  let k = 0;
  const nextId = (): string => `${prefix}__p${k++}`;
  for (const id of state.visible) {
    const opacity = state.opacities[id] ?? 1;
    if (opacity <= 0) continue;
    const turn = state.turns[id];
    const map = poseOf(state.offsets[id] ?? [0, 0], turn);
    const scale = turn?.scale ?? 1;
    const posed: Drawable[] = [];
    for (const d of drawablesForId(layout.drawables, id)) {
      posed.push(rehome(withTexts(mapDrawable(d, map, scale, state.shapes[id]), state.texts[id]), nextId, opacity));
    }
    drawables.push(...posed);
    const box = unionBoxes(leafDrawables(posed).map((d) => leafBBox(d, measure)));
    if (box) boxes[id] = box;
  }
  return { drawables, boxes };
}

function rehome(d: Drawable, nextId: () => string, opacity: number): Drawable {
  if (d.kind === "group") {
    const g: GroupDrawable = { ...d, id: nextId(), children: d.children.map((c) => rehome(c, nextId, opacity)) };
    return g;
  }
  return { ...d, id: nextId(), style: opacity < 1 ? { ...d.style, opacity: d.style.opacity * opacity } : d.style };
}

/** A morph/text step's replacement text for a leaf (state.texts: element → leaf id → text). */
function withTexts(d: Drawable, texts: Record<string, string> | undefined): Drawable {
  if (!texts) return d;
  if (d.kind === "group") return { ...d, children: d.children.map((c) => withTexts(c, texts)) };
  if (d.kind === "text" && texts[d.id] !== undefined) return { ...d, text: texts[d.id] };
  return d;
}

/** The box of one painted leaf, in its own units; null for a leaf with no extent. */
export function leafBBox(d: LeafDrawable, measure: MeasureFn): BBox | null {
  if (d.kind === "text") return bboxOfText(d, measure);
  if (d.kind === "image") return { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h };
  if (d.kind === "stroke" && d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    return { x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r };
  }
  return d.pts.length > 0 ? bboxOfPts(d.pts) : null;
}
