// The pose of a moved-and-turned element (design §2.1): an offset in
// logical units plus a rotation about a pivot stored in the element's
// ORIGINAL frame. The pose maps an original point x to R(deg, pivot)x + offset.
// composeTurn adds a rotation by `deltaDeg` about `pivotNow` (a point in
// CURRENT coordinates) exactly:
//   R(δ,Q)(R(deg,p)x + t) = R(deg+δ,p)x + [R(δ)(p + t − Q) + Q − p]
// so the pivot stays p and only the offset changes.
import type { Pt } from "../layout/model";

export interface Turn {
  deg: number;
  pivot: Pt;
  /** Uniform scale about the same pivot (absent = 1). Rotation and uniform scaling about one point commute, so the pose is x ↦ s·R(deg)(x − p) + p + offset. */
  scale?: number;
}

/** True when the pose is still the identity, so a new pivot may be chosen. */
const isIdentity = (turn: Turn | undefined): boolean => !turn || (turn.deg === 0 && (turn.scale ?? 1) === 1);

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Rotate a vector by deg about the origin (counter-clockwise, y-up). */
export function rotateVec([x, y]: Pt, deg: number): Pt {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return [x * c - y * s, x * s + y * c];
}

export function composeTurn(offset: Pt, turn: Turn | undefined, deltaDeg: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [pivotNow[0] - offset[0], pivotNow[1] - offset[1]] : turn!.pivot;
  const deg = (turn?.deg ?? 0) + deltaDeg;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const rv = rotateVec(v, deltaDeg);
  const next: Pt = [rv[0] + pivotNow[0] - p[0], rv[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg, pivot: p, scale: turn?.scale ?? 1 } };
}

/** Add a uniform scale by `factor` about `pivotNow` (current coordinates): S(k,Q)(sR(x−p)+p+t) = ks·R(x−p) + p + [k(p + t − Q) + Q − p]. */
export function composeScale(offset: Pt, turn: Turn | undefined, factor: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [pivotNow[0] - offset[0], pivotNow[1] - offset[1]] : turn!.pivot;
  const scale = (turn?.scale ?? 1) * factor;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const next: Pt = [factor * v[0] + pivotNow[0] - p[0], factor * v[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg: turn?.deg ?? 0, pivot: p, scale } };
}

/** The pose as a point map (original → current), or its inverse. */
export function poseOf(offset: Pt, turn: Turn | undefined, inverse = false): (x: Pt) => Pt {
  const deg = turn?.deg ?? 0;
  const p: Pt = turn?.pivot ?? [0, 0];
  const s = turn?.scale ?? 1;
  if (!inverse) {
    return ([x, y]) => {
      const r = rotateVec([x - p[0], y - p[1]], deg);
      return [s * r[0] + p[0] + offset[0], s * r[1] + p[1] + offset[1]];
    };
  }
  return ([x, y]) => {
    const r = rotateVec([(x - offset[0] - p[0]) / s, (y - offset[1] - p[1]) / s], -deg);
    return [r[0] + p[0], r[1] + p[1]];
  };
}

/** Where a bounding-box centre sits under a pose (the pivot default and `to` both use it). */
export function poseCentre(box: { x: number; y: number; w: number; h: number }, offset: Pt, turn: Turn | undefined): Pt {
  return poseOf(offset, turn)([box.x + box.w / 2, box.y + box.h / 2]);
}
