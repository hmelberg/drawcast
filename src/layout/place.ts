// Relative placement (spec §3.1, §4.1): the order elements must be laid
// out in, and the shift that puts an element where `at` says.
import type { BBox } from "./geometry";
import { boxAnchor } from "./anchors";
import { boxOfId, unionBBoxForId, unionBoxes } from "./boxes";
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
  // A measure reads the geometry it measures, and a connector reads the boxes
  // it runs between, out of the drawables already emitted — so a shifted
  // endpoint has to move BEFORE it is measured or connected to.
  if (el.type === "measure" || el.type === "arrow" || el.type === "edge") {
    if (el.type === "measure" && el.of) out.push(el.of);
    for (const end of [el.from, el.to]) {
      if (end && !Array.isArray(end) && typeof end === "object" && end.ref) out.push(end.ref);
    }
  }
  return out;
}

/**
 * Every id a group reaches: its members, its nested groups AND their members.
 * Used for the fit boundary — a member may be placed against a sibling, or
 * against a nested group of its own group, but not against the outside world.
 */
function groupClosure(id: string, byId: Map<string, SpecElement>, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const m of byId.get(id)?.members ?? []) {
    out.add(m);
    if (byId.get(m)?.type === "group") for (const n of groupClosure(m, byId, seen)) out.add(n);
  }
  return out;
}

/**
 * A `fit` group scales and moves its members as one, so a member placed
 * against something OUTSIDE the group is placed against geometry the fit
 * then walks away from — the relation the spec asked for silently breaks.
 * Refuse it rather than draw it wrong.
 */
function fitBoundaryIssues(elements: SpecElement[], byId: Map<string, SpecElement>): LintIssue[] {
  const issues: LintIssue[] = [];
  const reported = new Set<string>();
  for (const g of elements) {
    if (g.type !== "group" || !g.fit) continue;
    const inside = groupClosure(g.id, byId);
    for (const id of inside) {
      const ref = relAt(byId.get(id) ?? ({} as SpecElement))?.ref;
      if (!ref || ref === g.id || inside.has(ref) || reported.has(id)) continue;
      reported.add(id);
      issues.push({ rule: "placement", ids: [id], severity: "error", message: `element "${id}": at.ref "${ref}" is outside its fit group "${g.id}"` });
    }
  }
  return issues;
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
  issues.push(...fitBoundaryIssues(elements, byId));
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

/**
 * The box an `at.ref` names: the element's own ink — or, for a `group`, the
 * union of its members' ink — else, for a `pieces` parent, which mints child
 * ids `drawablesForId` cannot reach, the union of its cells, else a zero-size
 * box at its logical anchor (a template id that exports a point but no ink).
 * Null when the id is nowhere at all.
 */
export function refBBox(ds: Drawable[], id: string, measure: MeasureFn, ctx: { pieceGroups: Record<string, string[]>; anchors: Record<string, Pt>; groups: Record<string, string[]> }): BBox | null {
  const direct = boxOfId(ds, id, measure, ctx.groups, ctx.pieceGroups);
  if (direct) return direct;
  const a = ctx.anchors[id];
  return a ? { x: a[0], y: a[1], w: 0, h: 0 } : null;
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

/**
 * The uniform scale-and-centre that puts `union` inside `target`: `p' = p*s +
 * [dx, dy]`. Uniform because a figure squeezed on one axis is a different
 * figure — the fit gives the drawing the largest size that fits, centred, and
 * leaves the slack as margin.
 */
export function fitTransform(union: BBox, target: BBox): { s: number; dx: number; dy: number } {
  const s = Math.min(target.w / union.w, target.h / union.h);
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const ux = union.x + union.w / 2, uy = union.y + union.h / 2;
  return { s, dx: cx - ux * s, dy: cy - uy * s };
}

/** Scale drawables in place about the origin, then translate (fitTransform). */
export function scaleDrawables(ds: Drawable[], s: number, dx: number, dy: number): void {
  const m = ([x, y]: Pt): Pt => [x * s + dx, y * s + dy];
  for (const d of ds) {
    // The window a code pane scrolls under travels with the pane.
    if (d.clip) d.clip = { x: d.clip.x * s + dx, y: d.clip.y * s + dy, w: d.clip.w * s, h: d.clip.h * s };
    if (d.kind === "group") { scaleDrawables(d.children, s, dx, dy); continue; }
    if (d.kind === "text") { d.pos = m(d.pos); d.fontSize *= s; continue; }
    if (d.kind === "image") { d.pos = m(d.pos); d.w *= s; d.h *= s; continue; }
    d.pts = d.pts.map(m);
    if (d.kind === "area" && d.holes) d.holes = d.holes.map((h) => h.map(m));
    if (d.kind === "stroke" && d.shapeHint) {
      d.shapeHint = d.shapeHint.type === "circle"
        ? { ...d.shapeHint, c: m(d.shapeHint.c), r: d.shapeHint.r * s }
        : { ...d.shapeHint, x: d.shapeHint.x * s + dx, y: d.shapeHint.y * s + dy, w: d.shapeHint.w * s, h: d.shapeHint.h * s };
    }
  }
}

/** Translate a record of named points in place (an element's own anchors). */
export function shiftPoints(rec: Record<string, Pt> | undefined, dx: number, dy: number): void {
  if (!rec) return;
  for (const k of Object.keys(rec)) rec[k] = [rec[k][0] + dx, rec[k][1] + dy];
}
