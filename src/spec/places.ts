// Places on a picture (spec 2026-09-30-picture-regions §4): `md:name` (a
// named region), `md@top` (a named spot), `md@[x, y]` (a point) and
// `md@[x, y, w, h]` (a box). Picture fractions are measured from the
// TOP-LEFT, y down, as fractions of the WHOLE picture — the way a screenshot
// is read, and how source.ts's PhotoRects are born — never of `view`, so
// changing what is shown never moves a region. The canvas is y-up; the flip
// happens here and nowhere else.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Spec } from "./types";
import { isUniversalAnchor, UNIVERSAL_ANCHORS } from "../layout/anchors";

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

/** `regions: "auto"` or `{auto: …}` — the map is made in the app while authoring, not written by hand. */
export function isAutoRegions(r: unknown): boolean {
  return r === "auto" || (!!r && typeof r === "object" && !Array.isArray(r) && Object.hasOwn(r, "auto"));
}

/** The hand-written boxes of a regions field ({} for auto or absent). */
export function handRegions(r: unknown): Record<string, Rect4> {
  return r && typeof r === "object" && !isAutoRegions(r) ? (r as Record<string, Rect4>) : {};
}

const NAME_RE = /^[A-Za-z_][\w-]*$/;
const inUnit = (r: Rect4) => r.every((n) => n >= -1e-9) && r[0] + r[2] <= 1 + 1e-9 && r[1] + r[3] <= 1 + 1e-9;

type Loose = Record<string, unknown>;
const asObj = (v: unknown): Loose | undefined => (v && typeof v === "object" ? (v as Loose) : undefined);

/** Every place string a command aims at: highlight/focus targets, camera.on, point.at.ref, camera.center.ref. */
export function placesInCommands(commands: unknown): string[] {
  const out: string[] = [];
  const list = (v: unknown) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    const c = asObj(v);
    if (!c) return;
    if (c.highlight) out.push(...list(asObj(c.highlight)?.target));
    if (c.focus) out.push(...list(asObj(c.focus)?.target));
    if (c.camera) {
      const cam = asObj(c.camera);
      out.push(...list(cam?.on), ...list(asObj(cam?.center)?.ref));
    }
    if (c.point) out.push(...list(asObj(asObj(c.point)?.at)?.ref));
    for (const x of Object.values(c)) if (x && typeof x === "object") walk(x);
  };
  walk(commands);
  return [...new Set(out)].filter((s) => /[:@]/.test(s));
}

/** Picture fields and the places commands aim at (spec 2026-09-30-picture-regions §3–§4). */
export function pictureErrors(spec: Spec): string[] {
  const errs: string[] = [];
  const els = spec.elements ?? [];
  for (const el of els) {
    if (/[:@]/.test(el.id)) errs.push(`element id "${el.id}" may not contain ":" or "@" (reserved for picture places)`);
    if (el.type !== "image") continue;
    const view = el.view ?? FULL_VIEW4;
    if (el.view !== undefined && (!isRect4(el.view) || !inUnit(el.view) || el.view[2] <= 0 || el.view[3] <= 0)) {
      errs.push(`${el.id}: view must be [x, y, w, h] inside 0..1 with w, h > 0`);
    }
    for (const [name, r] of Object.entries(handRegions(el.regions))) {
      if (!NAME_RE.test(name)) errs.push(`${el.id}: region name "${name}" must be a word (letters, digits, _ or -)`);
      if (!isRect4(r) || !inUnit(r)) {
        errs.push(`${el.id}: region "${name}" must be [x, y, w, h] inside 0..1`);
        continue;
      }
      const overlaps = r[0] < view[0] + view[2] && r[0] + r[2] > view[0] && r[1] < view[1] + view[3] && r[1] + r[3] > view[1];
      if (!overlaps) errs.push(`${el.id}: region "${name}" lies outside its view`);
    }
  }
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const s of placesInCommands(spec.commands)) {
    const p = parsePlace(s);
    if (!p) {
      // Only when the part before ":" / "@" is an element: an unrelated string is not ours to judge.
      const head = s.trim().split(/[:@]/)[0];
      if (byId.has(head)) errs.push(`"${s}" is not a well-formed place (${head}:name, ${head}@top, ${head}@[x, y], ${head}@[x, y, w, h])`);
      continue;
    }
    const owner = byId.get(p.owner);
    if (!owner || owner.type !== "image") {
      errs.push(`"${s}": ${p.owner} is not an image`);
      continue;
    }
    const own = handRegions(owner.regions);
    if (p.kind === "region" && !isAutoRegions(owner.regions) && !(own && Object.hasOwn(own, p.name))) {
      const names = Object.keys(own ?? {});
      errs.push(`"${s}": ${p.owner} has no region "${p.name}" — it has: ${names.length > 0 ? names.join(", ") : "none"}`);
    }
    if (p.kind === "anchor" && !isUniversalAnchor(p.anchor)) {
      errs.push(`"${s}": a picture has no anchor "${p.anchor}" — use ${UNIVERSAL_ANCHORS.slice(0, -1).join(", ")} or ${UNIVERSAL_ANCHORS[UNIVERSAL_ANCHORS.length - 1]}`);
    }
    const fractionsOk = p.kind === "point" ? p.at.every((n) => n >= 0 && n <= 1) : p.kind === "box" ? inUnit(p.box) && p.box[2] >= 0 && p.box[3] >= 0 : true;
    if (!fractionsOk) errs.push(`"${s}": fractions must lie in 0..1${p.kind === "box" ? " (x + w and y + h at most 1)" : ""}`);
  }
  return errs;
}
