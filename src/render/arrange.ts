// The arrange verb's geometry (design §2.3): where each target should end
// up, from its current box and, for sectors, its piece geometry. Pure —
// the planner turns the outputs into poses.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { PieceGeometry } from "../layout/tier2";
import type { Turn } from "./pose";

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

function centroidOf(items: ArrangeInput[]): Pt {
  const n = Math.max(1, items.length);
  return [items.reduce((s, i) => s + i.centre[0], 0) / n, items.reduce((s, i) => s + i.centre[1], 0) / n];
}

export function arrangeTargets(items: ArrangeInput[], layout: "row" | "zipper" | "grid" | "ring" | "stack", opts: { at?: Pt; gap: number; columns?: number }): ArrangeOutput[] {
  const at = opts.at ?? centroidOf(items);
  const gap = opts.gap;
  if (layout === "zipper" && items.some((i) => i.piece)) return zipper(items, at);
  if (layout === "row" || layout === "zipper") {
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
    return { id: i.id, rotate: targetMid - midNow, pivotNow: i.piece!.apex, apexTo };
  });
  if (others.length > 0) {
    const row = arrangeTargets(others, "row", { at: [at[0], at[1] - r], gap: 10 });
    out.push(...row);
  }
  return out;
}
