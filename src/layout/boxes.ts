import { bboxOfPts, bboxOfText, type BBox } from "./geometry";
import type { MeasureFn } from "./measure";
import { drawablesForId, leafDrawables, type Drawable } from "./model";

/**
 * Union bbox of the leaf drawables belonging to one element id, or null.
 * Leaders and guide lines are excluded: they POINT AT the element, they are
 * not the element — including them would make annotations and gestures land
 * on the scaffolding instead of the thing (a label pushed aside by the
 * collision solver drags a long leader behind it).
 *
 * A group carrying an explicit `box` (its NOMINAL extent — an icon's declared
 * size×size slot, which its rings rarely fill edge-to-edge) short-circuits
 * this entirely: that box IS the answer, not a union to fold children into —
 * an icon's `at`/gap placement must track `size`, not how much ink a
 * particular glyph happens to have near its edges.
 */
export function unionBBoxForId(drawables: Drawable[], id: string, measure: MeasureFn): BBox | null {
  const top = drawables.find((d) => d.id === id);
  if (top?.kind === "group" && top.box) return top.box;
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
  return unionBoxes(boxes);
}

/** The smallest box containing all of them; null when there are none. */
export function unionBoxes(boxes: (BBox | null)[]): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let any = false;
  for (const b of boxes) {
    if (!b) continue;
    any = true;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The box of an element id, or — when the id names a group — the union box of
 * its flattened members. `groups` is the layout's group map (leaf ids), so a
 * group id, which draws nothing of its own, still has a box to place against.
 * `pieceGroups` covers the other kind of id with no ink under its own name: a
 * `pieces` parent, whose cells are `<id>_k` — as a group member it would
 * otherwise contribute nothing and leave the whole group boxless.
 */
export function boxOfId(
  drawables: Drawable[],
  id: string,
  measure: MeasureFn,
  groups: Record<string, string[]> = {},
  pieceGroups: Record<string, string[]> = {},
): BBox | null {
  const members = groups[id];
  if (members) return unionBoxes(members.map((m) => boxOfId(drawables, m, measure, groups, pieceGroups)));
  const own = unionBBoxForId(drawables, id, measure);
  if (own) return own;
  return unionBoxes((pieceGroups[id] ?? []).map((k) => unionBBoxForId(drawables, k, measure)));
}
