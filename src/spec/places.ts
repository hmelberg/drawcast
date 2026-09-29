// Places on a picture (spec 2026-09-30-picture-regions §4): `md:name` (a
// named region), `md@top` (a named spot), `md@[x, y]` (a point) and
// `md@[x, y, w, h]` (a box). Picture fractions are measured from the
// TOP-LEFT, y down, as fractions of the WHOLE picture — the way a screenshot
// is read, and how source.ts's PhotoRects are born — never of `view`, so
// changing what is shown never moves a region. The canvas is y-up; the flip
// happens here and nowhere else.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

export type Rect4 = [number, number, number, number];

export type Place =
  | { kind: "region"; owner: string; name: string }
  | { kind: "anchor"; owner: string; anchor: string }
  | { kind: "point"; owner: string; at: [number, number] }
  | { kind: "box"; owner: string; box: Rect4 };

export const FULL_VIEW4: Rect4 = [0, 0, 1, 1];

const ID = "[A-Za-z_][\\w-]*";
const REGION_RE = new RegExp(`^(${ID}):(${ID})$`);
const AT_RE = new RegExp(`^(${ID})@(.+)$`);

/** The place `s` names, or null when `s` is a plain id (or not a well-formed place). */
export function parsePlace(s: string): Place | null {
  const t = s.trim();
  const r = REGION_RE.exec(t);
  if (r) return { kind: "region", owner: r[1], name: r[2] };
  const a = AT_RE.exec(t);
  if (!a) return null;
  const rest = a[2].trim();
  if (/^[A-Za-z_]\w*$/.test(rest)) return { kind: "anchor", owner: a[1], anchor: rest };
  const inner = /^\[(.*)\]$/.exec(rest)?.[1];
  if (inner === undefined) return null;
  const nums = inner.split(",").map((x) => (x.trim() === "" ? NaN : Number(x)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) return { kind: "point", owner: a[1], at: [nums[0], nums[1]] };
  if (nums.length === 4) return { kind: "box", owner: a[1], box: nums as Rect4 };
  return null;
}

export function isRect4(v: unknown): v is Rect4 {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** The shown picture on the canvas (logical, y-up) and which part of the whole picture it shows. */
export interface PictureFrame {
  rect: BBox;
  view: Rect4;
}

/** A box in whole-picture fractions (top-left origin) → a canvas box (y-up). */
export function fractionBox(f: PictureFrame, r: Rect4): BBox {
  const [vx, vy, vw, vh] = f.view;
  const sx = f.rect.w / vw;
  const sy = f.rect.h / vh;
  const x = f.rect.x + (r[0] - vx) * sx;
  const top = f.rect.y + f.rect.h - (r[1] - vy) * sy;
  const h = r[3] * sy;
  return { x, y: top - h, w: r[2] * sx, h };
}

export function fractionPoint(f: PictureFrame, p: [number, number]): Pt {
  const b = fractionBox(f, [p[0], p[1], 0, 0]);
  return [b.x, b.y];
}
