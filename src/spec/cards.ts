// The `cards` element (spec 2026-10-01-rank-and-sort): cards the viewer puts
// in ORDER (rank) or sorts into BOXES (sort), answered on the figure with an
// ask's `on: <id>`. Sugar: it expands before layout (spec/expand.ts) into
// ordinary elements —
//
//   <id>_1 … <id>_n   the cards (node rects), numbered in TRUE order, laid
//                     out at their SHUFFLED places (drawing them gives
//                     nothing away)
//   <id>_end_1/2      rank: the words for the two ends ("most", "least")
//   <id>_bin_k        sort: a box (<id>_bin_k_box) and its title (_title)
//   <id>              the group of all of it, carrying the authored fields
//                     back (authoredCards) for the gate, the player and plan
//
// The truth is geometry: cardsGeometry says where every card stands now
// (shuffled), where each true slot or box slot is, and so where each card
// ends up once the question is answered.

import type { Spec, SpecElement } from "./types";
import type { Pt } from "../layout/model";

export interface CardItem {
  text: string;
  /** sort: the bin it belongs in. */
  bin?: string;
}

export interface CardsElementLike {
  id: string;
  type: "cards";
  items: (string | CardItem)[];
  bins?: string[];
  ends?: string[];
  /** rank: a row (default) or a column of cards. */
  arrange?: "row" | "column";
  x?: number;
  y?: number;
  width?: number;
  style?: SpecElement["style"];
}

export interface CardBox {
  /** Centre, logical y-up. */
  c: Pt;
  w: number;
  h: number;
}

export interface CardsGeometry {
  id: string;
  mode: "rank" | "sort";
  /** Card ids in TRUE order (<id>_1 …). */
  cards: string[];
  texts: string[];
  /** sort: each card's true bin (index into bins). */
  truthBin: number[];
  bins: string[];
  /** Card size. */
  w: number;
  h: number;
  /** Where card i is drawn (its shuffled place) — the layout's own position. */
  home: Pt[];
  /** rank: the centres of the n slots, first = the "most"/first end. */
  slots: Pt[];
  /** sort: each bin's box, and the centre of slot j inside bin k. */
  binBoxes: CardBox[];
  binSlot(k: number, j: number): Pt;
  /** Where card i stands in the truth. */
  truth: Pt[];
}

const CARD_H = 56;
const GAP = 14;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The item as {text, bin}. */
export function cardItem(it: string | CardItem): CardItem {
  return typeof it === "string" ? { text: it } : { text: String(it.text ?? ""), ...(it.bin !== undefined ? { bin: String(it.bin) } : {}) };
}

/**
 * The shuffled order: slot s holds card perm[s]. A fixed seeded shuffle,
 * then the one that leaves fewest cards in their true place among a few
 * tries — never the true order itself.
 */
export function shuffleOrder(n: number, seed = 7): number[] {
  let state = (seed * 2654435761) >>> 0 || 1;
  const rand = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  let best: number[] = [];
  let bestFixed = Infinity;
  for (let t = 0; t < 12; t++) {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    const fixed = p.filter((v, i) => v === i).length;
    if (fixed < bestFixed) {
      best = p;
      bestFixed = fixed;
    }
    if (fixed === 0) break;
  }
  if (n >= 2 && best.every((v, i) => v === i)) best = [...best.slice(1), best[0]];
  return best;
}

export function cardsGeometry(el: CardsElementLike): CardsGeometry {
  const items = (el.items ?? []).map(cardItem).slice(0, 8);
  const n = items.length;
  const bins = (el.bins ?? []).map(String).slice(0, 4);
  const mode: "rank" | "sort" = bins.length > 0 ? "sort" : "rank";
  const x0 = isNum(el.x) ? el.x : 100;
  const width = isNum(el.width) && el.width > 200 ? el.width : 800;
  const x1 = x0 + width;
  const cards = items.map((_, i) => `${el.id}_${i + 1}`);
  const texts = items.map((it) => it.text);
  const truthBin = items.map((it) => Math.max(0, bins.indexOf(it.bin ?? "")));
  const perm = shuffleOrder(n);

  if (mode === "rank") {
    const column = el.arrange === "column";
    let slots: Pt[];
    let w: number;
    if (column) {
      const yTop = isNum(el.y) ? el.y : 600;
      w = Math.min(320, width);
      const cx = (x0 + x1) / 2;
      slots = items.map((_, k) => [cx, yTop - k * (CARD_H + GAP)] as Pt);
    } else {
      const y = isNum(el.y) ? el.y : 380;
      const slotW = width / Math.max(1, n);
      w = Math.min(190, slotW - GAP);
      slots = items.map((_, k) => [x0 + slotW * (k + 0.5), y] as Pt);
    }
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = slots[s]));
    return { id: el.id, mode, cards, texts, truthBin, bins, w, h: CARD_H, home, slots, binBoxes: [], binSlot: () => [0, 0], truth: slots.slice() };
  }

  // Sort: the boxes across the top, the cards in a row (two when many) below.
  const k = bins.length;
  const binW = width / k - 2 * GAP;
  const perBin = bins.map((_, b) => truthBin.filter((t) => t === b).length);
  const rows = Math.max(2, ...perBin, Math.ceil(n / 2));
  const binTop = isNum(el.y) ? el.y : 660;
  const binH = 44 + rows * (CARD_H + 8) + 8;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [x0 + (width / k) * (b + 0.5), binTop - binH / 2] as Pt, w: binW, h: binH }));
  const perRow = n > 5 ? Math.ceil(n / 2) : n;
  const trayTop = binTop - binH - 40;
  const slotW = width / perRow;
  const w = Math.min(180, slotW - GAP, binW - 20);
  const tray: Pt[] = items.map((_, s) => [x0 + slotW * ((s % perRow) + 0.5), trayTop - CARD_H / 2 - Math.floor(s / perRow) * (CARD_H + GAP)] as Pt);
  const home: Pt[] = new Array(n);
  perm.forEach((card, s) => (home[card] = tray[s]));
  const binSlot = (b: number, j: number): Pt => {
    const box = binBoxes[b];
    return [box.c[0], box.c[1] + box.h / 2 - 44 - CARD_H / 2 - j * (CARD_H + 8)];
  };
  const seen = bins.map(() => 0);
  const truth = truthBin.map((b) => binSlot(b, seen[b]++));
  return { id: el.id, mode, cards, texts, truthBin, bins, w, h: CARD_H, home, slots: tray, binBoxes, binSlot, truth };
}

/** The ordinary elements a cards element stands for. */
export function cardsElements(el: CardsElementLike): SpecElement[] {
  const g = cardsGeometry(el);
  const out: SpecElement[] = [];
  if (g.mode === "sort") {
    g.binBoxes.forEach((b, k) => {
      const id = `${el.id}_bin_${k + 1}`;
      const l = b.c[0] - b.w / 2, r = b.c[0] + b.w / 2, t = b.c[1] + b.h / 2, btm = b.c[1] - b.h / 2;
      // An open box: no lid, so it reads as somewhere to put things.
      out.push({ id: `${id}_box`, type: "path", points: [[l, t], [l, btm], [r, btm], [r, t]], style: { color: "#7a7468" } });
      out.push({ id: `${id}_title`, type: "text", text: g.bins[k], x: b.c[0], y: t - 22, font_size: 24 });
      out.push({ id, type: "group", members: [`${id}_box`, `${id}_title`] });
    });
  }
  g.cards.forEach((id, i) => {
    out.push({ id, type: "node", shape: "rect", text: g.texts[i], x: g.home[i][0], y: g.home[i][1], width: g.w, height: g.h, font_size: 20, ...(el.style ? { style: el.style } : {}) });
  });
  if (g.mode === "rank" && Array.isArray(el.ends) && el.ends.length === 2) {
    const first = g.slots[0], last = g.slots[g.slots.length - 1];
    const column = el.arrange === "column";
    const at = (p: Pt, sign: 1 | -1): [number, number] => (column ? [p[0], p[1] + sign * (g.h / 2 + 22)] : [p[0], p[1] - g.h / 2 - 26]);
    out.push({ id: `${el.id}_end_1`, type: "text", text: column ? `↑ ${el.ends[0]}` : `← ${el.ends[0]}`, x: at(first, 1)[0], y: at(first, 1)[1], font_size: 20, style: { color: "#7a7468" } });
    out.push({ id: `${el.id}_end_2`, type: "text", text: column ? `↓ ${el.ends[1]}` : `${el.ends[1]} →`, x: at(last, -1)[0], y: at(last, -1)[1], font_size: 20, style: { color: "#7a7468" } });
  }
  const keep: Partial<SpecElement> & Record<string, unknown> = { items: el.items };
  if (el.bins !== undefined) keep["bins"] = el.bins;
  if (el.ends !== undefined) keep["ends"] = el.ends;
  if (el.arrange !== undefined) keep["arrange"] = el.arrange;
  if (el.x !== undefined) keep["x"] = el.x;
  if (el.y !== undefined) keep["y"] = el.y;
  if (el.width !== undefined) keep["width"] = el.width;
  out.push({ id: el.id, type: "group", members: out.map((e) => e.id), ...(keep as Partial<SpecElement>) });
  return out;
}

/** The cards elements of an expanded spec, read back from their groups. */
export function authoredCards(spec: Pick<Spec, "elements">): CardsElementLike[] {
  const out: CardsElementLike[] = [];
  for (const el of spec.elements ?? []) {
    const e = el as SpecElement & { items?: unknown };
    if (e.type !== "group" || !Array.isArray(e.items) || !(e.members ?? []).includes(`${e.id}_1`)) continue;
    out.push({
      id: e.id,
      type: "cards",
      items: e.items as (string | CardItem)[],
      ...((e as { bins?: string[] }).bins ? { bins: (e as { bins: string[] }).bins } : {}),
      ...((e as { ends?: string[] }).ends ? { ends: (e as { ends: string[] }).ends } : {}),
      ...((e as { arrange?: string }).arrange === "column" ? { arrange: "column" as const } : {}),
      ...(e.x !== undefined ? { x: e.x } : {}),
      ...(e.y !== undefined ? { y: e.y } : {}),
      ...(e.width !== undefined ? { width: e.width } : {}),
    });
  }
  return out;
}

export function expandCards(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some((e) => (e as { type: string }).type === "cards")) return spec;
  const out: SpecElement[] = [];
  for (const el of els) {
    if ((el as { type: string }).type === "cards") out.push(...cardsElements(el as unknown as CardsElementLike));
    else out.push(el);
  }
  return { ...spec, elements: out };
}
