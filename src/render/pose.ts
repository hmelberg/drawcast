// The pose of a moved, turned, scaled and possibly mirrored element (design
// §2.1, §2.3): x ↦ s·R(deg)·Mᵐ(x − p) + p + offset, with the pivot p stored in
// the element's ORIGINAL frame and M the reflection across the vertical line
// through p (x ↦ −x relative to p), applied BEFORE the rotation.
//   composeTurn:  R(δ,Q)(T(x)) = s·R(deg+δ)·Mᵐ(x−p) + p + [R(δ)(p + t − Q) + Q − p]
//   composeScale: S(k,Q)(T(x)) = ks·R(deg)·Mᵐ(x−p) + p + [k(p + t − Q) + Q − p]
//   composeFlip:  Refl_{Q,φ}(y) = R(2φ+180)·M·(y − Q) + Q and M·R(θ) = R(−θ)·M, so
//                 deg' = 2φ + 180 − deg, m' = ¬m, offset' = R(2φ+180)·M·(p + t − Q) + Q − p
import type { Pt } from "../layout/model";

export interface Turn {
  deg: number;
  pivot: Pt;
  /** Uniform scale about the same pivot (absent = 1). */
  scale?: number;
  /** Reflected across the vertical line through the pivot, before the rotation (absent = false). */
  mirror?: boolean;
}

/** True when the pose is still the identity, so a new pivot may be chosen. */
export const isIdentity = (turn: Turn | undefined): boolean => !turn || (turn.deg === 0 && (turn.scale ?? 1) === 1 && !turn.mirror);

const rad = (deg: number): number => (deg * Math.PI) / 180;
const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;

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
  return { offset: next, turn: { deg, pivot: p, scale: turn?.scale ?? 1, mirror: turn?.mirror ?? false } };
}

export function composeScale(offset: Pt, turn: Turn | undefined, factor: number, pivotNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [pivotNow[0] - offset[0], pivotNow[1] - offset[1]] : turn!.pivot;
  const scale = (turn?.scale ?? 1) * factor;
  const v: Pt = [p[0] + offset[0] - pivotNow[0], p[1] + offset[1] - pivotNow[1]];
  const next: Pt = [factor * v[0] + pivotNow[0] - p[0], factor * v[1] + pivotNow[1] - p[1]];
  return { offset: next, turn: { deg: turn?.deg ?? 0, pivot: p, scale, mirror: turn?.mirror ?? false } };
}

/** Reflect across the line through `lineNow` (current coordinates) at `phiDeg` degrees from +x (counter-clockwise). */
export function composeFlip(offset: Pt, turn: Turn | undefined, phiDeg: number, lineNow: Pt): { offset: Pt; turn: Turn } {
  const p: Pt = isIdentity(turn) ? [lineNow[0] - offset[0], lineNow[1] - offset[1]] : turn!.pivot;
  const rot = 2 * phiDeg + 180;
  const deg = normDeg(rot - (turn?.deg ?? 0));
  const v: Pt = [p[0] + offset[0] - lineNow[0], p[1] + offset[1] - lineNow[1]];
  const rv = rotateVec([-v[0], v[1]], rot);
  const next: Pt = [rv[0] + lineNow[0] - p[0], rv[1] + lineNow[1] - p[1]];
  return { offset: next, turn: { deg, pivot: p, scale: turn?.scale ?? 1, mirror: !(turn?.mirror ?? false) } };
}

/** The pose as a point map (original → current), or its inverse. */
export function poseOf(offset: Pt, turn: Turn | undefined, inverse = false): (x: Pt) => Pt {
  const deg = turn?.deg ?? 0;
  const p: Pt = turn?.pivot ?? [0, 0];
  const s = turn?.scale ?? 1;
  const m = turn?.mirror ?? false;
  if (!inverse) {
    return ([x, y]) => {
      const r = rotateVec([m ? -(x - p[0]) : x - p[0], y - p[1]], deg);
      return [s * r[0] + p[0] + offset[0], s * r[1] + p[1] + offset[1]];
    };
  }
  return ([x, y]) => {
    const r = rotateVec([(x - offset[0] - p[0]) / s, (y - offset[1] - p[1]) / s], -deg);
    return [(m ? -r[0] : r[0]) + p[0], r[1] + p[1]];
  };
}

/** Where a bounding-box centre sits under a pose (the pivot default and `to` both use it). */
export function poseCentre(box: { x: number; y: number; w: number; h: number }, offset: Pt, turn: Turn | undefined): Pt {
  return poseOf(offset, turn)([box.x + box.w / 2, box.y + box.h / 2]);
}
