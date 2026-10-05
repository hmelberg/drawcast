// A cast's card, compiled (card lab, 2026-10-05): run in a browser with the
// engine, at publish. The engine draws the poster frame exactly as the
// poster is drawn (export/snapshot.ts posterPng: render silently, showPoster),
// and the card keeps what is on the page there — the engine's own laid-out
// drawing (layout/model.ts Drawable), simplified: fewer points, short words,
// no photos, code or formula glyphs, under a size cap. The marks (band,
// stamp…) come from the cast's `thumb:` line, placed in the corners the
// drawing leaves emptiest — fixed here, so they stand still when the poster
// replaces the drawing on the front page.

import { castCardText } from "../../netlify/lib/share-card.mts";
import { cornerSlots, kidsByTags, planThumb, type Corner } from "../../netlify/lib/thumb.mts";
import { leafDrawables, type Drawable } from "../layout/model";
import { parsePlaylistText, posterItemOf, thumbnailItemOf } from "../playlist/playlist";
import { render } from "../render";
import { iconNameOfHref } from "../spec/icon-data";
import { decodePts, encodePts } from "./points";
import { STOCK_WHEN_DROPPED, stockFor } from "./stock";
import { CARD_H, CARD_VERSION, CARD_W, type CardItem, type CardText, type CardResult, type CompiledCard } from "./types";

/** The compiled card's size cap, JSON bytes: 10 KB (Hans, 2026-10-05) — about
 *  3 KB sent, since the feed travels compressed; icons go by name. */
export const CARD_CAP = 10240;
/** A label longer than this keeps its first words. */
const TEXT_MAX = 28;
/** Point simplification tolerance, canvas units. */
const SIMPLIFY = 1.5;
/** A formula letter keeps its shape closer: its strokes are a few units wide. */
const SIMPLIFY_GLYPH = 0.6;

type Leaf = Exclude<Drawable, { kind: "group" }>;
type Pt = [number, number];

/** How closely a non-letter shape keeps its outline: in proportion to its
 *  size (a chess piece is ~60 units, ~17 px on a card — its fine curves are
 *  invisible there), never finer than SIMPLIFY. */
function toleranceFor(pts: Pt[]): number {
  if (pts.length < 3) return SIMPLIFY;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.max(SIMPLIFY, Math.min(4, diag / 30));
}

/** Ramer–Douglas–Peucker: the line's shape with fewer points. */
export function simplify(pts: Pt[], tol = SIMPLIFY): Pt[] {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > far) {
      far = d;
      at = i;
    }
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

const round = (n: number): number => Math.round(n);
const flat = (pts: Pt[], dx: number, dy: number): string => encodePts(pts.map(([x, y]) => [x + dx, y + dy]));

/** A label cut to its first words when it is long. */
export function shortText(t: string, max = TEXT_MAX): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let out = "";
  for (const w of s.split(" ")) {
    if ((out ? out.length + 1 : 0) + w.length > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${out || s.slice(0, max)}…`;
}

/**
 * One engine drawable as card items, or a reason it was left out. `dx`/`dy`:
 * the leaf's offset at the poster (a moved element), logical y-up.
 */
export function cardItem(d: Leaf, dx = 0, dy = 0): CardItem | string {
  const r = Number(d.style.roughness.toFixed(2));
  const sd = seedOf(d.id);
  if (d.clip) return "code";
  if (d.kind === "image") {
    // An icon is an SVG picture; a photo or portrait (a raster) is left out.
    if (!/^data:image\/svg\+xml/.test(d.href)) return "picture";
    // By name when the engine fetched it from Iconify (spec/icon-data.ts), so the card carries a few bytes, not the drawing.
    const n = iconNameOfHref(d.href);
    return { k: "i", x: round(d.pos[0] + dx), y: round(d.pos[1] + dy), w: round(d.w), h: round(d.h), ...(n ? { n } : { href: d.href }), ...(d.style.opacity < 1 ? { o: Number(d.style.opacity.toFixed(2)) } : {}) };
  }
  if (d.kind === "text") {
    if (d.font === "mono" || d.font === "c64" || d.runs) return "code";
    // A heading keeps more of its words than a label does.
    const max = d.fontSize >= 20 ? 60 : TEXT_MAX;
    const t = shortText(d.text, max);
    const lines = d.lines && d.lines.length > 1 ? d.lines.slice(0, 2).map((l) => shortText(l, max)) : undefined;
    return {
      k: "t",
      x: round(d.pos[0] + dx),
      y: round(d.pos[1] + dy),
      t,
      s: round(d.fontSize),
      an: d.anchor === "start" ? "s" : d.anchor === "end" ? "e" : "m",
      c: d.style.color,
      ...(lines ? { ls: lines } : {}),
      ...(d.tilt ? { tl: round(d.tilt) } : {}),
    };
  }
  if (d.kind === "area") {
    // A formula's letters (round 2): kept as their exact outlines, holes and
    // all — the engine has already turned the TeX into shapes, so the card
    // needs no maths library to show them.
    const glyph = !!(d.holes?.length || d.tex?.length);
    const tol = glyph ? SIMPLIFY_GLYPH : toleranceFor(d.pts as Pt[]);
    const pts = simplify(d.pts as Pt[], tol);
    const holes = (d.holes ?? []).map((h) => flat(simplify(h as Pt[], tol), dx, dy));
    return {
      k: "a",
      p: flat(pts, dx, dy),
      ...(holes.length ? { hl: holes } : {}),
      f: d.style.fill ?? d.style.color,
      o: Number(d.style.opacity.toFixed(2)),
      r,
      sd,
      ...(d.precise || glyph ? { x: 1 as const } : {}),
    };
  }
  // stroke
  const hint = d.shapeHint;
  const base = {
    k: "s" as const,
    c: d.style.color,
    w: Number(d.style.strokeWidth.toFixed(1)),
    r: d.precise ? 0 : r,
    sd,
    ...(d.closed ? { cl: 1 as const } : {}),
    ...(d.arrowhead ? { a: d.arrowhead === "end" ? ("e" as const) : d.arrowhead === "start" ? ("s" as const) : ("b" as const) } : {}),
    ...(d.headSize && d.arrowhead ? { hs: round(d.headSize) } : {}),
    ...(d.style.fill ? { f: d.style.fill } : {}),
    ...(d.style.opacity < 1 ? { o: Number(d.style.opacity.toFixed(2)) } : {}),
    ...(d.style.dash ? { d: 1 as const } : {}),
  };
  if (hint?.type === "circle") return { ...base, p: "", ci: [round(hint.c[0] + dx), round(hint.c[1] + dy), round(hint.r)] };
  if (hint?.type === "rect") return { ...base, p: "", rc: [round(hint.x + dx), round(hint.y + dy), round(hint.w), round(hint.h)] };
  return { ...base, p: flat(simplify(d.pts as Pt[], toleranceFor(d.pts as Pt[])), dx, dy) };
}

/** render/svg-backend.ts hashSeed: the engine's own wobble seed for an id. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

/** An item's box, logical y-up: [x0, y0, x1, y1]. */
export function boxOf(it: CardItem): [number, number, number, number] {
  if (it.k === "i") return [it.x - it.w / 2, it.y - it.h / 2, it.x + it.w / 2, it.y + it.h / 2];
  if (it.k === "t") {
    const lines = it.ls ?? [it.t];
    const w = Math.max(...lines.map((l) => l.length)) * it.s * 0.5;
    const h = lines.length * it.s * 1.25;
    const x0 = it.an === "s" ? it.x : it.an === "e" ? it.x - w : it.x - w / 2;
    return [x0, it.y - h / 2, x0 + w, it.y + h / 2];
  }
  if (it.k === "s" && it.ci) return [it.ci[0] - it.ci[2], it.ci[1] - it.ci[2], it.ci[0] + it.ci[2], it.ci[1] + it.ci[2]];
  if (it.k === "s" && it.rc) return [it.rc[0], it.rc[1], it.rc[0] + it.rc[2], it.rc[1] + it.rc[3]];
  const pts = decodePts(it.p);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
}

/** What an item is worth keeping when the card is over its cap: its size on the page. */
function weight(it: CardItem): number {
  const [x0, y0, x1, y1] = boxOf(it);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  return it.k === "t" ? diag * 1.5 + it.s : it.k === "i" ? diag * 3 : diag;
}

/** An item as the cap counts it: an icon by its place, its drawing kept apart. */
function lean(it: CardItem): CardItem {
  return it.k === "i" && it.href ? { ...it, href: "" } : it;
}

/** Drops the least weighty items until the card's JSON fits the cap. */
export function capItems(items: CardItem[], marksBytes: number, cap = CARD_CAP): { items: CardItem[]; dropped: number } {
  const size = (list: CardItem[]): number => JSON.stringify(list.map(lean)).length + marksBytes + 40;
  if (size(items) <= cap) return { items, dropped: 0 };
  const order = items.map((it, i) => ({ i, w: weight(it), b: JSON.stringify(lean(it)).length })).sort((a, b) => a.w - b.w);
  const gone = new Set<number>();
  let total = size(items);
  for (const o of order) {
    if (total <= cap) break;
    gone.add(o.i);
    total -= o.b + 1;
  }
  return { items: items.filter((_, i) => !gone.has(i)), dropped: gone.size };
}

/** The corners, emptiest first, judged by how much of each mark slot the drawing covers. */
export function cornersByInk(items: CardItem[]): Corner[] {
  const slots = cornerSlots();
  const ink: Record<Corner, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  for (const it of items) {
    const [x0, y0, x1, y1] = boxOf(it);
    // Slots are in SVG space (y down); the box is y-up.
    const top = CARD_H - y1;
    const bottom = CARD_H - y0;
    for (const c of Object.keys(slots) as Corner[]) {
      const s = slots[c];
      const w = Math.max(0, Math.min(x1, s.x + s.w) - Math.max(x0, s.x));
      const h = Math.max(0, Math.min(bottom, s.y + s.h) - Math.max(top, s.y));
      ink[c] += it.k === "t" ? w * h * 2 : Math.max(w, 4) * Math.max(h, 4) * (w > 0 && h > 0 ? 1 : 0);
    }
  }
  return (Object.keys(ink) as Corner[]).sort((a, b) => ink[a] - ink[b]);
}

/** A leaf's translation from its transform attribute (SVG y-down → logical y-up). */
function offsetOf(g: Element): [number, number] {
  const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?\s*\)/.exec(g.getAttribute("transform") ?? "");
  return m ? [Number(m[1]), -Number(m[2] ?? 0)] : [0, 0];
}

/** Whether a leaf's node is on the page at the poster: some ink inside it is
 *  neither hidden (the reveal hides a stroke's paths, a text's own node) nor
 *  faded out, counting every wrapper up to the figure. */
function shown(g: Element, root: Element): boolean {
  let fade = 1;
  for (let n: Element | null = g; n && n !== root; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none") return false;
    fade *= Number(cs.opacity || "1");
    const op = n.getAttribute("opacity");
    if (op !== null) fade *= Number(op);
  }
  if (fade < 0.05) return false;
  const ink = Array.from(g.querySelectorAll("path, text, image, line, polyline, polygon, circle, ellipse, rect"));
  if (ink.length === 0) return false;
  return ink.some((el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    let f = 1;
    for (let n: Element | null = el; n && n !== g; n = n.parentElement) f *= Number(getComputedStyle(n).opacity || "1");
    return f >= 0.05;
  });
}

/** The marks the cast's `thumb:` line and title give (thumb.mts planThumb). */
function marksOf(text: string): ReturnType<typeof planThumb> {
  const facts = castCardText(text);
  return planThumb(facts.thumb, { title: facts.title, format: facts.format, kids: kidsByTags(facts.tags) });
}

/**
 * A private cast's card (Hans, 2026-10-05): the headline and marks on plain
 * paper — nothing of the figure, which a private cast keeps to its readers.
 */
export function headlineCard(text: string): CardResult {
  const card: CompiledCard = { v: CARD_VERSION, items: [], marks: marksOf(text), corners: ["tr", "br", "tl", "bl"] };
  const bytes = JSON.stringify(card).length;
  return { card, dropped: [], bytes, iconBytes: 0 };
}

/**
 * The cast's compiled card, or null when it has no picture to give (no
 * poster item). Needs a document and the engine's packs loaded.
 */
export async function compileCard(text: string, opts: { private?: boolean } = {}): Promise<CardResult | null> {
  if (opts.private) return headlineCard(text);
  const playlist = parsePlaylistText(text);
  // A thumbnail page the author (or the AI) wrote wins over the poster frame.
  const own = thumbnailItemOf(playlist);
  const item = own ?? posterItemOf(playlist);
  if (!item) return null;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CARD_W}px;height:${CARD_H}px`;
  document.body.appendChild(host);
  try {
    const hd = await render(item.spec, host, { mode: "silent" });
    try {
      hd.timeline.showPoster();
      const layout = hd.timeline.reprojector?.committed?.() ?? hd.layout;
      const byId = new Map<string, Leaf>();
      for (const d of leafDrawables(layout.drawables)) if (!byId.has(d.id)) byId.set(d.id, d);
      const svg = host.querySelector("svg.cs-svg");
      if (!svg) return null;
      const items: CardItem[] = [];
      const dropped: string[] = [];
      const seen = new Set<string>();
      for (const g of Array.from(svg.querySelectorAll("[data-leaf-id]"))) {
        const id = g.getAttribute("data-leaf-id")!;
        if (seen.has(id)) continue;
        seen.add(id);
        const d = byId.get(id);
        if (!d || !shown(g, svg)) continue;
        const [dx, dy] = offsetOf(g);
        const it = cardItem(d, dx, dy);
        if (typeof it === "string") dropped.push(it);
        else items.push(it);
      }
      const marks = marksOf(text);
      let capped = capItems(items, JSON.stringify(marks).length);
      for (let i = 0; i < capped.dropped; i++) dropped.push("over the cap");
      // Too detailed for a card (a chess position, a skeleton): a stock
      // picture of its topic under the cast's own heading, when one fits.
      if (items.length && capped.dropped / items.length > STOCK_WHEN_DROPPED) {
        const facts = castCardText(text);
        const stock = stockFor(facts.title ?? "", facts.tags ?? []);
        if (stock) {
          const title: CardText = { k: "t", x: CARD_W / 2, y: CARD_H - 34, t: shortText(facts.title ?? "", 60), s: 40, an: "m", c: "#2b2b2b" };
          capped = { items: [...stock, ...(title.t ? [title] : [])], dropped: capped.dropped };
          dropped.push("stock picture");
        }
      }
      const card: CompiledCard = { v: CARD_VERSION, items: capped.items, marks, corners: cornersByInk(capped.items) };
      const all = JSON.stringify(card).length;
      const bytes = JSON.stringify({ ...card, items: card.items.map(lean) }).length;
      return { card, dropped, bytes, iconBytes: all - bytes };
    } finally {
      hd.destroy();
    }
  } finally {
    host.remove();
  }
}
