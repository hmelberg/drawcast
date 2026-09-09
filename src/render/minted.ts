// Minted elements (design §2.1 of round 3, §2.5 of round 2): elements the
// planner creates at plan time — a trail, a ghost — and render() appends to
// every layout it mounts, so they can be faded, erased, highlighted and
// pointed at like anything the spec declared.
import type { LayoutResult } from "../layout/layout";
import { Z_STROKE, drawablesForId, leafDrawables, type Drawable, type Pt } from "../layout/model";
import { resolveDrawOpts, resolveStyle } from "../layout/resolve";
import { poseOf, type Turn } from "./pose";
import type { TrailSpec } from "./trails";

export interface GhostSpec {
  kind: "ghost";
  id: string;
  sourceId: string;
  /** The source's pose when the ghost was minted. */
  offset: Pt;
  turn?: Turn;
  /** The source's morphed leaf points at that moment (absent = its layout points). */
  shapes?: Record<string, Pt[]>;
  opacity: number;
  /** For a template source: the boundary params the source is read at ({} for a tier-2 spec). */
  params: Record<string, number>;
}

export type MintedSpec = ({ kind: "trail" } & TrailSpec) | GhostSpec;

function trailDrawable(layout: LayoutResult, t: TrailSpec): Drawable {
  const source = t.id.replace(/_trail(_\d+)?$/, "");
  const src = leafDrawables(drawablesForId(layout.drawables, source)).find((d) => d.kind === "stroke");
  return {
    id: t.id,
    kind: "stroke",
    pts: t.pts,
    z: Z_STROKE,
    style: resolveStyle({ color: t.color ?? src?.style.color, stroke_width: t.width }),
    drawOpts: resolveDrawOpts(undefined, { duration: 1200 }),
  };
}

/** A leaf id `<src>` or `<src>_<suffix>` re-homed under the ghost id. */
function ghostLeafId(leafId: string, sourceId: string, ghostId: string): string {
  return leafId === sourceId ? ghostId : leafId.startsWith(`${sourceId}_`) ? `${ghostId}_${leafId.slice(sourceId.length + 1)}` : `${ghostId}__${leafId}`;
}

/** The source's leaves as they look NOW: morphed points, then the pose, at the ghost's opacity, drawn instantly. */
function ghostDrawables(sourceLayout: LayoutResult, g: GhostSpec): Drawable[] {
  const map = poseOf(g.offset, g.turn);
  const s = g.turn?.scale ?? 1;
  const out: Drawable[] = [];
  for (const leaf of leafDrawables(drawablesForId(sourceLayout.drawables, g.sourceId))) {
    const id = ghostLeafId(leaf.id, g.sourceId, g.id);
    const style = { ...leaf.style, opacity: leaf.style.opacity * g.opacity };
    const drawOpts = resolveDrawOpts({ mode: "instant" });
    if (leaf.kind === "text") {
      out.push({ ...leaf, id, pos: map(leaf.pos), style, drawOpts });
    } else if (leaf.kind === "image") {
      out.push({ ...leaf, id, pos: map(leaf.pos), w: leaf.w * s, h: leaf.h * s, style, drawOpts });
    } else if (leaf.kind === "stroke" && leaf.shapeHint?.type === "circle") {
      const c = map(leaf.shapeHint.c);
      out.push({ ...leaf, id, pts: [c], shapeHint: { type: "circle", c, r: leaf.shapeHint.r * s }, style, drawOpts });
    } else if (leaf.kind === "stroke" && leaf.shapeHint?.type === "rect") {
      const h = leaf.shapeHint;
      const corners: Pt[] = [[h.x, h.y], [h.x + h.w, h.y], [h.x + h.w, h.y + h.h], [h.x, h.y + h.h]];
      const { shapeHint: _drop, ...rest } = leaf;
      out.push({ ...rest, id, pts: corners.map(map), closed: true, style, drawOpts });
    } else {
      const pts = (g.shapes?.[leaf.id] ?? leaf.pts).map(map);
      out.push(leaf.kind === "area" ? { ...leaf, id, pts, holes: leaf.holes?.map((ring) => ring.map(map)), style, drawOpts } : { ...leaf, id, pts, style, drawOpts });
    }
  }
  return out;
}

/**
 * Append every minted element to a layout: trails at the end of the order
 * (drawn on top), ghosts right BEFORE their source (painted under it). An
 * id already in the order is skipped, so a cached layout can be wrapped
 * again. `layoutAt` supplies a template's boundary layout for a ghost
 * minted under animate; for a tier-2 spec it is never called ({} params
 * read the layout itself).
 */
export function withMinted(layout: LayoutResult, minted: MintedSpec[], layoutAt: (params: Record<string, number>) => LayoutResult): LayoutResult {
  if (minted.length === 0) return layout;
  const drawables = [...layout.drawables];
  const order = [...layout.order];
  for (const m of minted) {
    if (order.includes(m.id)) continue;
    if (m.kind === "trail") {
      drawables.push(trailDrawable(layout, m));
      order.push(m.id);
      continue;
    }
    const sourceLayout = Object.keys(m.params).length === 0 ? layout : layoutAt(m.params);
    const parts = ghostDrawables(sourceLayout, m);
    if (parts.length === 0) continue;
    // Under the source: insert the ghost's drawables before the source's first drawable, and its id before the source's in the order.
    const firstSrc = drawables.findIndex((d) => d.id === m.sourceId || d.id.startsWith(`${m.sourceId}_`));
    drawables.splice(firstSrc < 0 ? drawables.length : firstSrc, 0, ...parts);
    const at = order.indexOf(m.sourceId);
    order.splice(at < 0 ? order.length : at, 0, m.id);
  }
  return { ...layout, drawables, order };
}
