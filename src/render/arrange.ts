// The arrange verb's geometry (design §2.3): where each target should end
// up, from its current box and, for sectors, its piece geometry. Pure —
// the planner turns the outputs into poses.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { PieceGeometry } from "../layout/tier2";
import { poseOf, type Turn } from "./pose";

export type ArrangeLayout = "row" | "zipper" | "grid" | "ring" | "stack" | "fan" | "hex";

export interface ArrangeInput {
  id: string;
  /** Current bounding box (already offset). */
  box: BBox;
  /** Current centre. */
  centre: Pt;
  piece?: PieceGeometry;
  pose: { offset: Pt; turn: Turn | undefined };
}

export interface ArrangeOutput {
  id: string;
  /** Destination for the element's centre (row/stack/grid/ring, or a non-sector in a zipper). */
  centre?: Pt;
  /** Zipper: rotate by this many degrees about pivotNow (the apex, current coordinates)… */
  rotate?: number;
  pivotNow?: Pt;
  /** …then move so the apex lands here. */
  apexTo?: Pt;
}

const DEG = Math.PI / 180;

/** A rotation delta wrapped into (−180, 180] — the short way round. */
function shortestTurn(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function centroidOf(items: ArrangeInput[]): Pt {
  const n = Math.max(1, items.length);
  return [items.reduce((s, i) => s + i.centre[0], 0) / n, items.reduce((s, i) => s + i.centre[1], 0) / n];
}

/** A sector's apex where it is NOW (its original apex through its pose). */
function apexNow(i: ArrangeInput): Pt {
  return poseOf(i.pose.offset, i.pose.turn)(i.piece!.apex);
}

export function arrangeTargets(items: ArrangeInput[], layout: ArrangeLayout, opts: { at?: Pt; gap: number; columns?: number; start?: number }): ArrangeOutput[] {
  const firstSector = items.find((i) => i.piece);
  // A fan gathers the pieces about ONE apex: with no `at`, the first sector stays where it is and the others come to it.
  const at = opts.at ?? (layout === "fan" && firstSector ? apexNow(firstSector) : centroidOf(items));
  const gap = opts.gap;
  if (layout === "zipper" && items.some((i) => i.piece)) return zipper(items, at);
  if (layout === "fan" && items.some((i) => i.piece)) return fan(items, at, opts.start ?? 0, gap);
  if (layout === "hex") return hex(items, at, gap);
  if (layout === "row" || layout === "zipper" || layout === "fan") {
    const total = items.reduce((s, i) => s + i.box.w, 0) + gap * (items.length - 1);
    let x = at[0] - total / 2;
    return items.map((i) => {
      const c: Pt = [x + i.box.w / 2, at[1]];
      x += i.box.w + gap;
      return { id: i.id, centre: c };
    });
  }
  if (layout === "stack") {
    const total = items.reduce((s, i) => s + i.box.h, 0) + gap * (items.length - 1);
    let y = at[1] - total / 2;
    return items.map((i) => {
      const c: Pt = [at[0], y + i.box.h / 2];
      y += i.box.h + gap;
      return { id: i.id, centre: c };
    });
  }
  if (layout === "grid") {
    const cols = Math.max(1, Math.round(opts.columns ?? Math.ceil(Math.sqrt(items.length))));
    const cw = Math.max(...items.map((i) => i.box.w)) + gap;
    const ch = Math.max(...items.map((i) => i.box.h)) + gap;
    const rows = Math.ceil(items.length / cols);
    const x0 = at[0] - (cols * cw - gap) / 2 + (cw - gap) / 2;
    const y0 = at[1] + (rows * ch - gap) / 2 - (ch - gap) / 2; // top row first, y-up
    return items.map((i, k) => ({ id: i.id, centre: [x0 + (k % cols) * cw, y0 - Math.floor(k / cols) * ch] as Pt }));
  }
  // ring
  const perimeter = items.reduce((s, i) => s + Math.max(i.box.w, i.box.h) + gap, 0);
  const r = Math.max(perimeter / (2 * Math.PI), 40);
  return items.map((i, k) => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / items.length;
    return { id: i.id, centre: [at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)] as Pt };
  });
}

/** Sector pieces zipped into the πr² rectangle: even pieces point up with the apex below the midline, odd pieces point down with the apex above it, apexes stepping by r·sin(halfAngle). */
function zipper(items: ArrangeInput[], at: Pt): ArrangeOutput[] {
  const sectors = items.filter((i) => i.piece);
  const others = items.filter((i) => !i.piece);
  const r = sectors[0].piece!.radius;
  const s = r * Math.sin(sectors[0].piece!.halfAngle * DEG);
  const width = s * (sectors.length - 1);
  const x0 = at[0] - width / 2;
  const out: ArrangeOutput[] = sectors.map((i, k) => {
    const up = k % 2 === 0;
    const targetMid = up ? 90 : -90;
    const apexTo: Pt = [x0 + k * s, at[1] + (up ? -r / 2 : r / 2)];
    // A piece may already carry a turn (an earlier `move` rotate): its
    // mid-direction is midAngle + that turn, so the delta undoes it too —
    // otherwise the slice zips in at the wrong angle.
    const midNow = i.piece!.midAngle + (i.pose.turn?.deg ?? 0);
    // Normalised into (−180, 180]: a raw difference of angles can be any size
    // (a slice at midAngle −345° wanting +90° asks for 435°), and the player
    // tweens the delta linearly — so an un-normalised delta spins the slice
    // more than a full turn on its way to a destination one nudge away.
    return { id: i.id, rotate: shortestTurn(targetMid - midNow), pivotNow: i.piece!.apex, apexTo };
  });
  if (others.length > 0) {
    const row = arrangeTargets(others, "row", { at: [at[0], at[1] - r], gap: 10 });
    out.push(...row);
  }
  return out;
}

/**
 * Sectors laid side by side about ONE apex at `at`: the first piece begins
 * at `start` degrees (counter-clockwise from +x) and each next one continues
 * where the previous ended — the angle-sum proof (three corners torn off
 * and set on a line make a half turn). Each piece is turned about its own
 * apex and slid so that apex lands on `at`. Non-sector targets line up in a
 * row above the fan.
 */
function fan(items: ArrangeInput[], at: Pt, start: number, gap: number): ArrangeOutput[] {
  const sectors = items.filter((i) => i.piece);
  const others = items.filter((i) => !i.piece);
  let angle = start;
  const out: ArrangeOutput[] = sectors.map((i) => {
    const half = i.piece!.halfAngle;
    const targetMid = angle + half;
    angle += 2 * half;
    const midNow = i.piece!.midAngle + (i.pose.turn?.deg ?? 0);
    return { id: i.id, rotate: shortestTurn(targetMid - midNow), pivotNow: i.piece!.apex, apexTo: at };
  });
  if (others.length > 0) {
    const r = Math.max(...sectors.map((i) => i.piece!.radius));
    out.push(...arrangeTargets(others, "row", { at: [at[0], at[1] + r + 40], gap }));
  }
  return out;
}

/**
 * A honeycomb: the first target sits at `at`, the next six around it, then
 * a ring of twelve, and so on — neighbours one flat-to-flat distance apart
 * (the smaller side of the first target's box, plus `gap`). A flat-topped
 * hexagon (wider than tall) has its neighbours at 30° + 60°k, a pointy-topped
 * one at 60°k; any other shape gets the pointy-top lattice.
 */
function hex(items: ArrangeInput[], at: Pt, gap: number): ArrangeOutput[] {
  if (items.length === 0) return [];
  const w = items[0].box.w;
  const h = items[0].box.h;
  const d = Math.min(w, h) + gap;
  const base = w > h ? 30 : 0;
  const dir = (k: number): Pt => [Math.cos((base + 60 * k) * DEG), Math.sin((base + 60 * k) * DEG)];
  const positions: Pt[] = [at];
  for (let ring = 1; positions.length < items.length; ring++) {
    for (let k = 0; k < 6 && positions.length < items.length; k++) {
      const a = dir(k);
      const b = dir((k + 1) % 6);
      const corner: Pt = [at[0] + ring * d * a[0], at[1] + ring * d * a[1]];
      const next: Pt = [at[0] + ring * d * b[0], at[1] + ring * d * b[1]];
      for (let j = 0; j < ring && positions.length < items.length; j++) {
        positions.push([corner[0] + ((next[0] - corner[0]) * j) / ring, corner[1] + ((next[1] - corner[1]) * j) / ring]);
      }
    }
  }
  return items.map((i, k) => ({ id: i.id, centre: positions[k] }));
}
