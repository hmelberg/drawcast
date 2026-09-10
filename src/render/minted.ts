// Minted elements (design §2.1 of round 3, §2.5 of round 2): elements the
// planner creates at plan time — a trail, a ghost — and render() appends to
// every layout it mounts, so they can be faded, erased, highlighted and
// pointed at like anything the spec declared.
import type { LayoutResult } from "../layout/layout";
import { Z_STROKE, drawablesForId, leafDrawables, type Drawable, type Pt } from "../layout/model";
import { resolveDrawOpts, resolveStyle } from "../layout/resolve";
import { mapLeaf, type LayoutOverrides } from "../layout/posed";
import { poseOf, type Turn } from "./pose";
import { cutTrail, type TrailSpec } from "./trails";

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
  /** null = a tier-2 spec: read the wrapped layout itself. An object = a
   *  template spec: the boundary params the source is read at through
   *  `layoutAt` ({} is the template's own base params, still routed through
   *  `layoutAt` — never assumed to equal the wrapped layout, which may be a
   *  later animation frame). */
  params: Record<string, number> | null;
  /** The source poses and shapes the ghost's boundary layout is read under
   *  (design 2026-09-10 §2.5): a ghost of a dependent sits where the
   *  dependent stood at that boundary, not where the base layout puts it. */
  overrides?: LayoutOverrides;
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
    // The same point map the posed lookup view uses (layout/posed.ts).
    out.push({ ...mapLeaf(leaf, map, s, g.shapes), id, style, drawOpts });
  }
  return out;
}

/**
 * Append every minted element to a layout: trails at the end of the order
 * (drawn on top), ghosts right BEFORE their source (painted under it). An
 * id already in the order is skipped, so a cached layout can be wrapped
 * again. `layoutAt` supplies a template's boundary layout for a ghost's
 * source — called whenever `params` is non-null (a template spec), so a
 * ghost minted at the base params (`{}`) is still read through `layoutAt`
 * rather than through whatever layout happens to be getting wrapped (which,
 * under a live tween, is a later animation frame — the ghost must stay
 * frozen at ITS OWN params, never at the wrapped layout's). For a tier-2
 * spec (`params: null`) `layoutAt` is never called; the wrapped layout IS
 * the source layout.
 */
export function withMinted(
  layout: LayoutResult,
  minted: MintedSpec[],
  layoutAt: (params: Record<string, number>, overrides?: LayoutOverrides) => LayoutResult,
  /** A trail mid-sweep (design 2026-09-10 §2.4): id → fraction of its length drawn so far. */
  trailProgress: Record<string, number> = {},
): LayoutResult {
  if (minted.length === 0) return layout;
  const drawables = [...layout.drawables];
  const order = [...layout.order];
  for (const m of minted) {
    if (order.includes(m.id)) continue;
    if (m.kind === "trail") {
      const p = trailProgress[m.id];
      drawables.push(trailDrawable(layout, p === undefined ? m : { ...m, pts: cutTrail(m.pts, p) }));
      order.push(m.id);
      continue;
    }
    const sourceLayout = m.params === null ? layout : layoutAt(m.params, m.overrides);
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
