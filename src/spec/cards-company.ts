// Cards with company (page frame spec 2026-10-04, W29): what else is on the
// page while a cards element is, as boxes read off the spec. `size: "auto"`
// grows the cards into the part of the content box these leave free
// (spec/cards.ts resolveCardsSize). The boxes come from the spec, as the
// cards' own geometry does, so the gate, the plan and the lint keep reading
// one number — no layout pass. What the spec cannot place makes the whole
// answer null: growth never guesses.

import type { Spec, SpecElement } from "./types";
import type { BBox } from "../layout/geometry";
import { heuristicMeasure } from "../layout/measure";
import { boxAnchor, isUniversalAnchor, type UniversalAnchor } from "../layout/anchors";
import { placeDelta } from "../layout/places";
import { contentBox } from "../layout/page";
import { fitRegion, isFitName } from "../layout/regions";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const LINE_H = 1.25;
/** A label stands off its anchor by about its leader's length. */
const LEADER = 28;

/** Draws nothing of its own on the page (a group names members measured on their own). */
const NO_INK = new Set(["group", "source", "cards"]);

export interface CardsCompany {
  /** Co-visible elements' boxes (y-up, logical units), by id. */
  boxes: { id: string; box: BBox }[];
  /** Room the followers (labels and `at: {ref}` elements on a card) need beside the cards, per side. */
  pad: { left: number; right: number; top: number; bottom: number };
}

/** Group id → its leaf members (nested groups flattened). */
function groupLeaves(els: SpecElement[]): Map<string, string[]> {
  const byId = new Map(els.map((e) => [e.id, e]));
  const out = new Map<string, string[]>();
  const leaves = (id: string, seen: Set<string>): string[] => {
    const e = byId.get(id);
    if (!e || e.type !== "group" || seen.has(id)) return [id];
    seen.add(id);
    return (e.members ?? []).flatMap((m) => leaves(m, seen));
  };
  for (const e of els) if (e.type === "group") out.set(e.id, leaves(e.id, new Set()));
  return out;
}

const idList = (raw: unknown): string[] => (typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);

/**
 * The ids on screen at the same time as the cards `id` at some point of the
 * run: the plan's rules — draw/show/reveal bring things on, erase/hide/clear
 * take them off, a group's members go with it, and an element no visibility
 * verb names joins an implicit final draw.
 */
export function coVisibleWithCards(id: string, spec: Pick<Spec, "elements" | "commands">): Set<string> {
  const els = spec.elements ?? [];
  const groups = groupLeaves(els);
  const ownsId = (x: string): boolean => x === id || x.startsWith(`${id}_`);
  const expand = (raw: unknown): string[] => idList(raw).flatMap((x) => [x, ...(groups.get(x) ?? [])]);
  const visible = new Set<string>();
  const managed = new Set<string>();
  const out = new Set<string>();
  let cardsOn = false;
  const snap = (): void => {
    if (cardsOn) for (const v of visible) if (!ownsId(v)) out.add(v);
  };
  for (const c of spec.commands ?? []) {
    const cmd = c as Record<string, unknown>;
    const on = [...expand(cmd.draw), ...expand(cmd.show), ...expand(cmd.reveal)];
    for (const x of on) {
      visible.add(x);
      managed.add(x);
      if (ownsId(x)) cardsOn = true;
    }
    snap();
    for (const x of [...expand(cmd.erase), ...expand(cmd.hide)]) {
      visible.delete(x);
      managed.add(x);
    }
    const clear = cmd.clear as { keep?: unknown } | undefined;
    if (clear !== undefined) {
      const keep = new Set(expand(clear?.keep));
      for (const x of [...visible]) {
        if (keep.has(x)) continue;
        visible.delete(x);
        managed.add(x);
      }
    }
    if (![...visible].some(ownsId)) cardsOn = false;
  }
  // The final draw: whatever no verb named, the cards too when they were never drawn by name.
  for (const e of els) {
    const ids = [e.id, ...(groups.get(e.id) ?? [])];
    if (!ids.some((x) => managed.has(x))) for (const x of ids) visible.add(x);
  }
  if ([...visible].some(ownsId)) {
    cardsOn = true;
    snap();
  }
  return out;
}

/** A text's box about its x/y (the text drawable is anchored in the middle). */
function textBox(text: string, font: number, cx: number, cy: number): BBox {
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => heuristicMeasure(l, font).w));
  const h = lines.length * font * LINE_H;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function union(a: BBox | null, b: BBox): BBox {
  if (!a) return b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function ptsBox(pts: unknown): BBox | null {
  if (!Array.isArray(pts) || pts.length === 0) return null;
  let b: BBox | null = null;
  for (const p of pts) {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return null;
    b = union(b, { x: p[0], y: p[1], w: 0, h: 0 });
  }
  return b;
}

/** A box beside `host` on `side`, `gap` away (centred on the host for no side). */
function besideBox(host: BBox, w: number, h: number, side: string | undefined, gap: number): BBox {
  const cx = host.x + host.w / 2, cy = host.y + host.h / 2;
  const up = side?.startsWith("above"), down = side?.startsWith("below");
  const left = side === "left" || side?.endsWith("-left"), right = side === "right" || side?.endsWith("-right");
  const x = left ? host.x - gap - w : right ? host.x + host.w + gap : cx - w / 2;
  const y = up ? host.y + host.h + gap : down ? host.y - gap - h : cy - h / 2;
  return { x, y, w, h };
}

/**
 * Where the element draws, from the spec — null when the spec cannot say (no
 * x/y, a picture of unknown shape, data units, live bindings), "none" when it
 * draws nothing of its own. `hostBox` measures what it is placed against.
 */
export function elementBox(e: SpecElement, hostBox: (id: string) => BBox | null): BBox | null | "none" {
  if (NO_INK.has(e.type)) return "none";
  if (e.type === "code" && e.show === "none") return "none";
  if (e.bind !== undefined || e.data === true) return null;
  const font = isNum(e.font_size) ? e.font_size : 28;
  // The element's own size, about (0, 0).
  const own = ((): BBox | null => {
    switch (e.type) {
      case "text":
        return typeof e.text === "string" ? textBox(e.text, font, 0, 0) : null;
      case "math": {
        if (typeof e.tex !== "string") return null;
        const size = isNum(e.size) ? e.size : isNum(e.font_size) ? e.font_size : 36;
        const w = Math.max(20, e.tex.replace(/\\[a-zA-Z]+|[{}^_\s]/g, "x").length * size * 0.42);
        return { x: -w / 2, y: -size * 0.75, w, h: size * 1.5 };
      }
      case "icon": {
        const s = isNum(e.size) ? e.size : 100;
        return { x: -s / 2, y: -s / 2, w: s, h: s };
      }
      case "shape": {
        const shape = e.shape ?? "rect";
        if (shape === "person") {
          const s = (isNum(e.height) ? e.height : 100) / 2;
          return { x: -s * 0.6, y: -s, w: s * 1.2, h: s * 2 };
        }
        if (shape === "circle" || shape === "chance") {
          const r = isNum(e.radius) ? e.radius : 40;
          return { x: -r, y: -r, w: 2 * r, h: 2 * r };
        }
        const w = isNum(e.width) ? e.width : 160, h = isNum(e.height) ? e.height : 100;
        return { x: -w / 2, y: -h / 2, w, h };
      }
      case "ellipse": {
        const rx = isNum(e.rx) ? e.rx : 150, ry = isNum(e.ry) ? e.ry : 100;
        const rot = e.rotation;
        const r = isNum(rot) && rot % 180 !== 0 ? Math.max(rx, ry) : 0;
        return r > 0 ? { x: -r, y: -r, w: 2 * r, h: 2 * r } : { x: -rx, y: -ry, w: 2 * rx, h: 2 * ry };
      }
      default:
        return null;
    }
  })();
  // Points in canvas units: the box is the points'.
  if (e.type === "path" || e.type === "polygon" || e.type === "line") {
    const b = ptsBox(e.points);
    if (b) return b;
    if (e.type !== "line") return null;
  }
  if (e.type === "arrow" || e.type === "line") {
    const end = (v: unknown): BBox | null => {
      if (Array.isArray(v) && isNum(v[0]) && isNum(v[1])) return { x: v[0], y: v[1], w: 0, h: 0 };
      if (typeof v === "string") {
        const h = hostBox(v);
        return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2, w: 0, h: 0 } : null;
      }
      if (v && typeof v === "object") {
        const r = v as { ref?: unknown; x?: unknown; y?: unknown; data?: unknown };
        if (r.data !== undefined) return null;
        if (isNum(r.x) && isNum(r.y)) return { x: r.x, y: r.y, w: 0, h: 0 };
        if (typeof r.ref === "string") {
          const h = hostBox(r.ref);
          return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2, w: 0, h: 0 } : null;
        }
      }
      return null;
    };
    const a = end(e.from), b = end(e.to);
    return a && b ? union(a, b) : null;
  }
  if (e.type === "label") {
    const host = typeof e.attach_to === "string" ? hostBox(e.attach_to) : null;
    if (!host || typeof e.text !== "string") return null;
    const t = textBox(e.text, font, 0, 0);
    // The label hangs off its host's anchor point (the centre) on its side, past a leader.
    const c = { x: host.x + host.w / 2, y: host.y + host.h / 2, w: 0, h: 0 };
    return union(host, besideBox(c, t.w, t.h, e.side ?? "above-right", LEADER));
  }
  if (!own) return null;
  const at = e.at;
  if (Array.isArray(at)) return isNum(at[0]) && isNum(at[1]) ? { ...own, x: own.x + at[0], y: own.y + at[1] } : null;
  if (at && typeof at === "object") {
    if (at.place !== undefined) {
      if (!isUniversalAnchor(at.place)) return null;
      const [dx, dy] = placeDelta(own, at.place as UniversalAnchor, e.anchor);
      return { ...own, x: own.x + dx, y: own.y + dy };
    }
    if (typeof at.ref === "string") {
      const host = hostBox(at.ref);
      if (!host) return null;
      const off = Array.isArray(at.offset) && isNum(at.offset[0]) && isNum(at.offset[1]) ? at.offset : [0, 0];
      if (at.side !== undefined) {
        const b = besideBox(host, own.w, own.h, at.side, isNum(at.gap) ? at.gap : 10);
        return { ...b, x: b.x + off[0], y: b.y + off[1] };
      }
      const p = boxAnchor(host, typeof at.anchor === "string" ? at.anchor : "center");
      return { ...own, x: own.x + p[0] + off[0], y: own.y + p[1] + off[1] };
    }
    if (isNum(at.x) && isNum(at.y) && at.data === undefined && at.canvas === undefined) return { ...own, x: own.x + at.x, y: own.y + at.y };
    return null;
  }
  if (!isNum(e.x) || !isNum(e.y)) return null;
  return { ...own, x: own.x + e.x, y: own.y + e.y };
}

/** The template's box: `params.box` (a region name or {x, y, w, h}), else the content area. */
export function templateBox(spec: Pick<Spec, "params">): BBox {
  const raw = (spec.params ?? {})["box"];
  if (isFitName(raw)) return fitRegion(raw);
  if (raw && typeof raw === "object") {
    const b = raw as Record<string, unknown>;
    if (isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h) && b.w > 0 && b.h > 0) return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  return contentBox();
}

/**
 * The followers of cards `id` — labels attached to a card, elements placed
 * `at: {ref: <card>}` — and the room they need beside the set, per side.
 */
export function followerRoom(id: string, els: SpecElement[]): { pad: CardsCompany["pad"]; followers: Set<string> } {
  const isCard = (x: string): boolean => x.startsWith(`${id}_`) || x === id;
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  const followers = new Set<string>();
  for (const e of els) {
    const ref = e.type === "label" ? e.attach_to : !Array.isArray(e.at) ? e.at?.ref : undefined;
    if (typeof ref !== "string" || !isCard(ref)) continue;
    followers.add(e.id);
    const font = isNum(e.font_size) ? e.font_size : e.type === "label" ? 28 : 22;
    const t = typeof e.text === "string" ? textBox(e.text, font, 0, 0) : { x: 0, y: 0, w: 60, h: font * LINE_H };
    const side = e.type === "label" ? e.side ?? "above-right" : !Array.isArray(e.at) ? e.at?.side : undefined;
    const gap = (!Array.isArray(e.at) && isNum(e.at?.gap) ? e.at.gap : 10) + (e.type === "label" ? LEADER : 0);
    if (side === undefined) continue;
    if (side === "left" || side.endsWith("-left")) pad.left = Math.max(pad.left, t.w + gap);
    if (side === "right" || side.endsWith("-right")) pad.right = Math.max(pad.right, t.w + gap);
    if (side.startsWith("above")) pad.top = Math.max(pad.top, t.h + gap);
    if (side.startsWith("below")) pad.bottom = Math.max(pad.bottom, t.h + gap);
  }
  return { pad, followers };
}

/**
 * The company of cards `id`: the boxes of everything on screen with them at
 * some point (their own parts, their followers, `own` — the scale a placing
 * set goes on — and the card headings excepted), and the room their
 * followers need beside them. Null when one of them cannot be placed from
 * the spec, or the page has live vars.
 */
export function cardsCompany(id: string, spec: Pick<Spec, "elements" | "commands" | "template" | "params" | "vars">, own: ReadonlySet<string> = new Set()): CardsCompany | null {
  if (spec.vars && Object.keys(spec.vars).length > 0) return null;
  const els = spec.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  const groups = groupLeaves(els);
  const isCard = (x: string): boolean => x.startsWith(`${id}_`) || x === id;
  const mine = (x: string): boolean => isCard(x) || own.has(x) || [...own].some((o) => x.startsWith(`${o}_`)) || /^card_\d+_/.test(x);
  const memo = new Map<string, BBox | null>();
  const boxOf = (x: string, depth = 0): BBox | null => {
    if (memo.has(x)) return memo.get(x)!;
    const e = byId.get(x);
    let b: BBox | null = null;
    if (e && depth < 8) {
      if (e.type === "group") {
        for (const m of groups.get(x) ?? []) {
          const mb = boxOf(m, depth + 1);
          if (mb) b = union(b, mb);
        }
      } else {
        const r = elementBox(e, (h) => boxOf(h, depth + 1));
        b = r === "none" ? null : r;
      }
    }
    memo.set(x, b);
    return b;
  };
  const { pad, followers } = followerRoom(id, els);
  const boxes: { id: string; box: BBox }[] = [];
  if (spec.template) boxes.push({ id: spec.template, box: templateBox(spec) });
  const seen = coVisibleWithCards(id, spec);
  for (const x of seen) {
    if (mine(x) || followers.has(x) || followers.has(`${x}`.replace(/_leader$/, ""))) continue;
    const e = byId.get(x);
    if (!e || e.type === "group") continue; // a group's members are in the set on their own; an unknown id draws nothing we know of
    const r = elementBox(e, (h) => boxOf(h));
    if (r === "none") continue;
    if (r === null) return null;
    boxes.push({ id: x, box: r });
  }
  return { boxes, pad };
}
