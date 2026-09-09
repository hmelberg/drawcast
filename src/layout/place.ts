// Relative placement (spec §3.1, §4.1): the order elements must be laid
// out in, and the shift that puts an element where `at` says.
import type { BBox } from "./geometry";
import { boxAnchor } from "./anchors";
import { unionBBoxForId, unionBoxes } from "./boxes";
import type { MeasureFn } from "./measure";
import type { Drawable, Pt } from "./model";
import type { LintIssue } from "../lint/lint";
import type { Side, SpecElement } from "../spec/types";

/** The object form of `at` — the array form is `angle`'s vertex point. */
export type RelPlacement = Exclude<NonNullable<SpecElement["at"]>, [number, number]>;

const OPPOSITE: Record<Side, string> = {
  above: "bottom", below: "top", left: "right", right: "left",
  "above-left": "bottom_right", "above-right": "bottom_left", "below-left": "top_right", "below-right": "top_left",
};

/** `at` in its object form, or undefined for `angle`'s `[x, y]` vertex. */
export const relAt = (el: SpecElement): RelPlacement | undefined => (el.at && !Array.isArray(el.at) ? el.at : undefined);

function deps(el: SpecElement): string[] {
  const out: string[] = [];
  const ref = relAt(el)?.ref;
  if (ref) out.push(ref);
  if (el.type === "label" && el.attach_to) out.push(el.attach_to);
  if (el.type === "group") out.push(...(el.members ?? []));
  // A measure reads the geometry it measures out of the drawables already
  // emitted, so a shifted target has to move BEFORE it is measured.
  if (el.type === "measure") {
    if (el.of) out.push(el.of);
    for (const end of [el.from, el.to]) {
      if (end && !Array.isArray(end) && typeof end === "object" && end.ref) out.push(end.ref);
    }
  }
  return out;
}

/** Topological order over at.ref / attach_to / members. Unknown refs and
 *  cycles are `placement` errors; the offending elements keep their spec
 *  position so layout still emits something. Template-exported ids (not
 *  in `elements`) are allowed refs — pass them in `known`. */
export function placementOrder(elements: SpecElement[], known: Set<string> = new Set()): { order: SpecElement[]; issues: LintIssue[] } {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const issues: LintIssue[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // unvisited / on stack / done
  const order: SpecElement[] = [];
  const visit = (el: SpecElement): void => {
    const s = state.get(el.id);
    if (s === 2) return;
    if (s === 1) { issues.push({ rule: "placement", ids: [el.id], severity: "error", message: `element "${el.id}": placement cycle through at.ref/attach_to/members` }); return; }
    state.set(el.id, 1);
    for (const d of deps(el)) {
      const dep = byId.get(d);
      if (dep) visit(dep);
      else if (!known.has(d) && relAt(el)?.ref === d) issues.push({ rule: "placement", ids: [el.id], severity: "error", message: `element "${el.id}": unknown ref "${d}" in at` });
    }
    state.set(el.id, 2);
    order.push(el);
  };
  for (const el of elements) visit(el);
  return { order, issues };
}

/**
 * The box of everything ONE element just emitted — `mine` is that element's
 * slice of the drawables, so every id in it is the element's own: its id, its
 * sub-drawables, and the child ids it minted (a `pieces` element's cells,
 * which `drawablesForId` does not reach from the parent id). Leaders and
 * guides are left out, as they are everywhere else.
 */
export function ownBBox(mine: Drawable[], id: string, measure: MeasureFn): BBox | null {
  const ids = [...new Set(mine.map((d) => d.id))].filter((i) => i !== `${id}_leader` && i !== `${id}_guides`);
  return unionBoxes(ids.map((i) => unionBBoxForId(mine, i, measure)));
}

/** dx, dy that moves `own` so that at.side / at.anchor holds against `ref`. */
export function relativeDelta(own: BBox, ref: BBox, refAnchors: Record<string, Pt>, at: RelPlacement, ownAnchor: string | undefined): Pt {
  const gap = at.gap ?? 8;
  let target: Pt;
  let ownName: string;
  if (at.side) {
    const s = at.side;
    const cx = ref.x + ref.w / 2, cy = ref.y + ref.h / 2;
    const xs = s.endsWith("left") ? ref.x - gap : s.endsWith("right") ? ref.x + ref.w + gap : cx;
    const ys = s.startsWith("above") ? ref.y + ref.h + gap : s.startsWith("below") ? ref.y - gap : cy;
    target = [xs, ys];
    ownName = ownAnchor ?? OPPOSITE[s];
  } else {
    const name = at.anchor ?? "center";
    target = refAnchors[name] ?? boxAnchor(ref, name);
    ownName = ownAnchor ?? "center";
  }
  const from = boxAnchor(own, ownName);
  const [ox, oy] = at.offset ?? [0, 0];
  return [target[0] - from[0] + ox, target[1] - from[1] + oy];
}

/** Translate drawables in place (pts, pos, shapeHint, children). */
export function shiftDrawables(ds: Drawable[], dx: number, dy: number): void {
  for (const d of ds) {
    if (d.kind === "group") { shiftDrawables(d.children, dx, dy); continue; }
    if (d.kind === "text" || d.kind === "image") { d.pos = [d.pos[0] + dx, d.pos[1] + dy]; continue; }
    d.pts = d.pts.map(([x, y]): Pt => [x + dx, y + dy]);
    if (d.kind === "area" && d.holes) d.holes = d.holes.map((h) => h.map(([x, y]): Pt => [x + dx, y + dy]));
    if (d.kind === "stroke" && d.shapeHint) {
      d.shapeHint = d.shapeHint.type === "circle"
        ? { ...d.shapeHint, c: [d.shapeHint.c[0] + dx, d.shapeHint.c[1] + dy] }
        : { ...d.shapeHint, x: d.shapeHint.x + dx, y: d.shapeHint.y + dy };
    }
  }
}

/** Translate a record of named points in place (an element's own anchors). */
export function shiftPoints(rec: Record<string, Pt> | undefined, dx: number, dy: number): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) rec[k] = [rec[k][0] + dx, rec[k][1] + dy];
}
