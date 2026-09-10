// Per-frame interpolation of a step's poses and shapes (design 2026-09-10
// §2.5): the same arithmetic the handle path always used, pulled out so the
// relayout path can feed the reprojector the very same numbers.
import type { Squash } from "./backend";
import { pathPosition } from "./effects";
import type { Pt } from "../layout/model";
import type { MorphItem, SceneState, TransformItem } from "./plan";
import type { Turn } from "./pose";

/** A plain move: every id's offset at eased time e, from where it stood. */
export function moveFrame(step: { ids: string[]; path: Pt[] }, before: SceneState, e: number): Record<string, Pt> {
  const [px, py] = pathPosition(step.path, e);
  const out: Record<string, Pt> = {};
  for (const id of step.ids) {
    const [bx, by] = before.offsets[id] ?? [0, 0];
    out[id] = [bx + px, by + py];
  }
  return out;
}

/** A transform (rotate/scale/arrange/flip): each item's pose at eased time e; a flip holds its two half-poses and carries the turn-over squash. */
export function transformFrame(items: TransformItem[], e: number): { offsets: Record<string, Pt>; turns: Record<string, Turn>; squash: Record<string, Squash> } {
  const offsets: Record<string, Pt> = {};
  const turns: Record<string, Turn> = {};
  const squash: Record<string, Squash> = {};
  for (const it of items) {
    if (it.flip) {
      const half = e < 0.5;
      const pose = half ? it.from : it.to;
      offsets[it.id] = pose.offset;
      turns[it.id] = pose.turn;
      if (e < 1) squash[it.id] = { at: it.flip.at, angle: it.flip.angle, k: half ? 1 - 2 * e : 2 * e - 1 };
      continue;
    }
    offsets[it.id] = [it.from.offset[0] + (it.to.offset[0] - it.from.offset[0]) * e, it.from.offset[1] + (it.to.offset[1] - it.from.offset[1]) * e];
    turns[it.id] = {
      deg: it.from.turn.deg + (it.to.turn.deg - it.from.turn.deg) * e,
      pivot: it.to.turn.pivot,
      scale: (it.from.turn.scale ?? 1) + ((it.to.turn.scale ?? 1) - (it.from.turn.scale ?? 1)) * e,
      mirror: it.to.turn.mirror ?? false,
    };
  }
  return { offsets, turns, squash };
}

/** A morph: each item's leaf points at eased time e, over the leaves it already had. */
export function morphFrame(items: MorphItem[], before: SceneState, e: number): Record<string, Record<string, Pt[]>> {
  const out: Record<string, Record<string, Pt[]>> = {};
  for (const it of items) {
    const pts: Record<string, Pt[]> = { ...(before.shapes[it.id] ?? {}) };
    for (const leaf of it.leaves) pts[leaf.leafId] = leaf.from.map((p, i): Pt => [p[0] + (leaf.to[i][0] - p[0]) * e, p[1] + (leaf.to[i][1] - p[1]) * e]);
    out[it.id] = pts;
  }
  return out;
}
