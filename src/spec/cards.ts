// The `cards` element (specs 2026-10-01-rank-and-sort, 2026-10-02-more-ways-
// to-answer): cards the viewer answers with on the figure, through an ask's
// `on: <id>`. One element, several modes, chosen by its structure:
//
//   options             → DECIDE: tap one; the cast goes to its label
//   bins                → SORT into boxes
//   along: <scale id>   → PLACE each card on a number line (items' `value`)
//   compare / pairs     → HIGHER OR LOWER: the bigger of each pair (`value`)
//   items with `match`  → MATCH each card to its partner
//   otherwise           → RANK: items in their TRUE order
//
// Sugar: it expands before layout (spec/expand.ts) into ordinary elements —
// node cards (<id>_1 … in TRUE order; a match's partners <id>_m_1 …), the
// boxes, end words, value labels and the like — and the group <id>, which
// carries the authored fields back (authoredCards) for the gate, the player
// and the plan. cardsGeometry says where every card is drawn (`home`), where
// the truth puts it (`truth`), and each mode's own geometry.

import type { Spec, SpecElement } from "./types";
import type { Pt } from "../layout/model";
import { authoredScales, scaleGeometry, type ScaleElementLike, type ScaleGeometry } from "./scale";

export interface CardItem {
  text: string;
  /** sort: the bin it belongs in. */
  bin?: string;
  /** place / compare: its number. */
  value?: number;
  /** match: its partner's text. */
  match?: string;
}

export interface CardOption {
  text: string;
  /** decide: the label the cast goes to. */
  goto?: string;
  /** decide: the best choice — then the decision is scored. */
  best?: boolean;
}

export interface CardsElementLike {
  id: string;
  type: "cards";
  items?: (string | CardItem)[];
  bins?: string[];
  ends?: string[];
  /** rank: a row (default) or a column of cards. */
  arrange?: "row" | "column";
  /** place: the scale element the cards go on. */
  along?: string;
  /** compare: the question each pair answers ("more deaths per year"). */
  compare?: string;
  /** compare: the pairs, as item indices (default: consecutive items). */
  pairs?: number[][];
  /** compare: written after each value. */
  unit?: string;
  /** decide: the choices. */
  options?: CardOption[];
  /** decide: where every branch meets again. */
  then?: string;
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

export type CardsMode = "rank" | "sort" | "place" | "match" | "compare" | "decide";

export interface CardsGeometry {
  id: string;
  mode: CardsMode;
  /** Every card id, in the order the arrays below index (TRUE order). */
  cards: string[];
  texts: string[];
  /** sort: each card's true bin (index into bins). */
  truthBin: number[];
  bins: string[];
  /** Card size. */
  w: number;
  h: number;
  /** Where each card is drawn — the layout's own position. */
  home: Pt[];
  /** rank: the slots, first = the first end; sort/place: the row the cards start in. */
  slots: Pt[];
  /** sort: each bin's box, and the centre of slot j inside bin k. */
  binBoxes: CardBox[];
  binSlot(k: number, j: number): Pt;
  /** Where each card stands in the truth. */
  truth: Pt[];
  // —— place ——
  scale?: ScaleGeometry;
  values?: number[];
  /** place: where cards with these values (null = not placed) stand. */
  placeAt?(values: (number | null)[]): Pt[];
  // —— match: cards = [left 0..n-1, right 0..n-1]; right i is left i's partner ——
  pairs?: number;
  // —— compare: pairs of card indices; each card's value and its label's id ——
  rows?: [number, number][];
  valueIds?: string[];
  // —— decide ——
  gotos?: (string | undefined)[];
  best?: boolean[];
  then?: string;
}

const CARD_H = 56;
const GAP = 14;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The item as {text, …}. */
export function cardItem(it: string | CardItem): CardItem {
  if (typeof it === "string") return { text: it };
  return {
    text: String(it.text ?? ""),
    ...(it.bin !== undefined ? { bin: String(it.bin) } : {}),
    ...(isNum(it.value) ? { value: it.value } : {}),
    ...(it.match !== undefined ? { match: String(it.match) } : {}),
  };
}

export function cardsMode(el: CardsElementLike): CardsMode {
  if (Array.isArray(el.options) && el.options.length > 0) return "decide";
  if (Array.isArray(el.bins) && el.bins.length > 0) return "sort";
  if (typeof el.along === "string") return "place";
  if (el.compare !== undefined || Array.isArray(el.pairs)) return "compare";
  if ((el.items ?? []).some((it) => typeof it === "object" && it !== null && (it as CardItem).match !== undefined)) return "match";
  return "rank";
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

function groupThousands(v: number): string {
  const s = Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  return Math.abs(v) >= 10000 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : s;
}

/** A compare card's value as written: grouped, with the unit. */
export function compareValueText(v: number, unit?: string): string {
  const n = groupThousands(v);
  return unit ? (unit === "%" ? `${n}%` : `${n} ${unit}`) : n;
}

export function cardsGeometry(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined): CardsGeometry {
  const mode = cardsMode(el);
  const x0 = isNum(el.x) ? el.x : 100;
  const width = isNum(el.width) && el.width > 200 ? el.width : 800;
  const x1 = x0 + width;
  const none = (): Pt => [0, 0];
  const base = { id: el.id, mode, truthBin: [] as number[], bins: [] as string[], binBoxes: [] as CardBox[], binSlot: none };

  if (mode === "decide") {
    const opts = (el.options ?? []).slice(0, 4).map((o) => ({ text: String(o.text ?? ""), goto: o.goto, best: o.best === true }));
    const n = opts.length;
    const y = isNum(el.y) ? el.y : 380;
    const slotW = width / Math.max(1, n);
    const w = Math.min(260, slotW - GAP);
    const pos = opts.map((_, k) => [x0 + slotW * (k + 0.5), y] as Pt);
    return { ...base, cards: opts.map((_, i) => `${el.id}_${i + 1}`), texts: opts.map((o) => o.text), w, h: 72, home: pos, slots: pos, truth: pos, gotos: opts.map((o) => o.goto), best: opts.map((o) => o.best), ...(el.then ? { then: el.then } : {}) };
  }

  const items = (el.items ?? []).map(cardItem).slice(0, 8);
  const n = items.length;
  const cards = items.map((_, i) => `${el.id}_${i + 1}`);
  const texts = items.map((it) => it.text);

  if (mode === "match") {
    const k = Math.min(6, n);
    const left = items.slice(0, k);
    const yTop = isNum(el.y) ? el.y : 560;
    const w = Math.min(260, width / 2 - 60);
    const lx = x0 + w / 2, rx = x1 - w / 2;
    const rows = left.map((_, i) => yTop - i * (CARD_H + GAP));
    const perm = shuffleOrder(k, 11);
    const rightHome: Pt[] = new Array(k);
    perm.forEach((card, s) => (rightHome[card] = [rx, rows[s]]));
    const leftPos = rows.map((y) => [lx, y] as Pt);
    const rightTruth = rows.map((y) => [rx, y] as Pt);
    return {
      ...base,
      cards: [...left.map((_, i) => `${el.id}_${i + 1}`), ...left.map((_, i) => `${el.id}_m_${i + 1}`)],
      texts: [...left.map((it) => it.text), ...left.map((it) => it.match ?? "")],
      w,
      h: CARD_H,
      home: [...leftPos, ...rightHome],
      slots: rightTruth,
      truth: [...leftPos, ...rightTruth],
      pairs: k,
    };
  }

  if (mode === "compare") {
    const pairs = (Array.isArray(el.pairs) && el.pairs.length > 0 ? el.pairs : Array.from({ length: Math.floor(n / 2) }, (_, r) => [2 * r, 2 * r + 1]))
      .filter((p) => Array.isArray(p) && p.length === 2 && p.every((i) => Number.isInteger(i) && i >= 0 && i < n))
      .slice(0, 5) as [number, number][];
    const yTop = isNum(el.y) ? el.y : 560;
    const w = Math.min(240, width / 2 - 80);
    const pos: Pt[] = items.map(() => [0, 0]);
    // A card used in two pairs stands in the first; pairs are rows.
    const placed = new Set<number>();
    pairs.forEach(([a, b], r) => {
      const y = yTop - r * 100;
      if (!placed.has(a)) pos[a] = [x0 + width * 0.3, y];
      if (!placed.has(b)) pos[b] = [x0 + width * 0.7, y];
      placed.add(a).add(b);
    });
    return { ...base, cards, texts, w, h: CARD_H, home: pos, slots: pos, truth: pos, values: items.map((it) => it.value ?? 0), rows: pairs, valueIds: items.map((_, i) => `${el.id}_v_${i + 1}`) };
  }

  if (mode === "place") {
    const sc = el.along ? scaleOf?.(el.along) : undefined;
    const sg = sc ? scaleGeometry(sc) : scaleGeometry({ id: "_", type: "scale", min: 0, max: 100, value: 50 });
    const values = items.map((it) => (isNum(it.value) ? it.value : sg.min));
    const span = sg.x1 - sg.x0;
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    const w = Math.min(150, span / perRow - GAP);
    const h = 48;
    const slotW = span / perRow;
    const trayTop = sg.y - 110;
    const tray: Pt[] = items.map((_, s) => [sg.x0 + slotW * ((s % perRow) + 0.5), trayTop - Math.floor(s / perRow) * (h + GAP)] as Pt);
    const perm = shuffleOrder(n, 5);
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = tray[s]));
    // Cards on the line stand above it, in levels so that none overlap.
    const placeAt = (vals: (number | null)[]): Pt[] => {
      const out: Pt[] = home.slice();
      const order = vals.map((v, i) => ({ v, i })).filter((o): o is { v: number; i: number } => o.v !== null).sort((a, b) => sg.xAt(a.v) - sg.xAt(b.v));
      const levelEnd: number[] = [];
      for (const { v, i } of order) {
        const x = sg.xAt(v);
        let lv = levelEnd.findIndex((end) => end < x - w / 2 - 6);
        if (lv < 0) {
          lv = levelEnd.length;
          levelEnd.push(-Infinity);
        }
        levelEnd[lv] = x + w / 2;
        out[i] = [x, sg.y + 64 + lv * (h + 8)];
      }
      return out;
    };
    return { ...base, cards, texts, w, h, home, slots: tray, truth: placeAt(values), scale: sg, values, placeAt };
  }

  const bins = (el.bins ?? []).map(String).slice(0, 4);
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
    return { ...base, cards, texts, w, h: CARD_H, home, slots, truth: slots.slice() };
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
  return { ...base, mode, cards, texts, truthBin, bins, w, h: CARD_H, home, slots: tray, binBoxes, binSlot, truth };
}

/** The ordinary elements a cards element stands for. */
export function cardsElements(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined): SpecElement[] {
  const g = cardsGeometry(el, scaleOf);
  const out: SpecElement[] = [];
  const quiet = { color: "#7a7468" };
  if (g.mode === "sort") {
    g.binBoxes.forEach((b, k) => {
      const id = `${el.id}_bin_${k + 1}`;
      const l = b.c[0] - b.w / 2, r = b.c[0] + b.w / 2, t = b.c[1] + b.h / 2, btm = b.c[1] - b.h / 2;
      // An open box: no lid, so it reads as somewhere to put things.
      out.push({ id: `${id}_box`, type: "path", points: [[l, t], [l, btm], [r, btm], [r, t]], style: quiet });
      out.push({ id: `${id}_title`, type: "text", text: g.bins[k], x: b.c[0], y: t - 22, font_size: 24 });
      out.push({ id, type: "group", members: [`${id}_box`, `${id}_title`] });
    });
  }
  if (g.mode === "compare" && el.compare) {
    const top = Math.max(...g.home.map((p) => p[1])) + g.h / 2 + 40;
    out.push({ id: `${el.id}_title`, type: "text", text: el.compare, x: 500, y: Math.min(720, top), font_size: 24 });
  }
  g.cards.forEach((id, i) => {
    out.push({ id, type: "node", shape: "rect", text: g.texts[i], x: g.home[i][0], y: g.home[i][1], width: g.w, height: g.h, font_size: g.mode === "decide" ? 24 : 20, ...(el.style ? { style: el.style } : {}) });
  });
  if (g.mode === "rank" && Array.isArray(el.ends) && el.ends.length === 2) {
    const first = g.slots[0], last = g.slots[g.slots.length - 1];
    const column = el.arrange === "column";
    const at = (p: Pt, sign: 1 | -1): [number, number] => (column ? [p[0], p[1] + sign * (g.h / 2 + 22)] : [p[0], p[1] - g.h / 2 - 26]);
    out.push({ id: `${el.id}_end_1`, type: "text", text: column ? `↑ ${el.ends[0]}` : `← ${el.ends[0]}`, x: at(first, 1)[0], y: at(first, 1)[1], font_size: 20, style: quiet });
    out.push({ id: `${el.id}_end_2`, type: "text", text: column ? `↓ ${el.ends[1]}` : `${el.ends[1]} →`, x: at(last, -1)[0], y: at(last, -1)[1], font_size: 20, style: quiet });
  }
  const members = out.map((e) => e.id);
  // A compare card's value is written under it — OUTSIDE the group, so
  // drawing the cards gives nothing away; the question reveals each.
  if (g.mode === "compare" && g.valueIds && g.values) {
    g.valueIds.forEach((id, i) => {
      out.push({ id, type: "text", text: compareValueText(g.values![i], el.unit), x: g.home[i][0], y: g.home[i][1] - g.h / 2 - 20, font_size: 20, style: { color: "#3f6fb5" } });
    });
  }
  const keep: Record<string, unknown> = {};
  for (const k of ["items", "bins", "ends", "arrange", "along", "compare", "pairs", "unit", "options", "then", "x", "y", "width"] as const) {
    if (el[k] !== undefined) keep[k] = el[k];
  }
  out.push({ id: el.id, type: "group", members, ...(keep as Partial<SpecElement>) });
  return out;
}

const CARD_FIELDS = ["items", "options"] as const;

/** The cards elements of an expanded spec, read back from their groups. */
export function authoredCards(spec: Pick<Spec, "elements">): CardsElementLike[] {
  const out: CardsElementLike[] = [];
  for (const el of spec.elements ?? []) {
    const e = el as SpecElement & Record<string, unknown>;
    if (e.type !== "group" || !CARD_FIELDS.some((k) => Array.isArray(e[k])) || !(e.members ?? []).includes(`${e.id}_1`)) continue;
    const c: CardsElementLike = { id: e.id, type: "cards" };
    for (const k of ["items", "bins", "ends", "arrange", "along", "compare", "pairs", "unit", "options", "then", "x", "y", "width"] as const) {
      if (e[k] !== undefined) (c as unknown as Record<string, unknown>)[k] = e[k];
    }
    out.push(c);
  }
  return out;
}

/** The geometry of a spec's cards element by id — with its scale looked up. */
export function cardsGeometryIn(spec: Pick<Spec, "elements">, id: string): CardsGeometry | null {
  const el = authoredCards(spec).find((c) => c.id === id);
  if (!el) return null;
  const scales = authoredScales(spec);
  return cardsGeometry(el, (sid) => scales.find((s) => s.id === sid));
}

export function expandCards(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some((e) => (e as { type: string }).type === "cards")) return spec;
  // Scales are expanded first (spec/expand.ts): their groups carry them.
  const scales = authoredScales(spec);
  const scaleOf = (sid: string): ScaleElementLike | undefined => scales.find((s) => s.id === sid);
  const out: SpecElement[] = [];
  for (const el of els) {
    if ((el as { type: string }).type === "cards") out.push(...cardsElements(el as unknown as CardsElementLike, scaleOf));
    else out.push(el);
  }
  return { ...spec, elements: out };
}
