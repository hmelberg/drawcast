// The `cards` element (specs 2026-10-01-rank-and-sort, 2026-10-02-more-ways-
// to-answer): cards the viewer answers with on the figure, through an ask's
// `on: <id>`. One element, several modes, chosen by its structure:
//
//   options             → DECIDE: tap one; the cast goes to its label
//   bins                → SORT into boxes (deck: true — one large card at a
//                         time, up to 30, round 6 §7)
//   select: <box title> → TAP ALL THE …: a one-box sort, items {text, in}
//   along: <scale id>   → PLACE each card on a number line (items' `value`)
//   compare / pairs     → HIGHER OR LOWER: the bigger of each pair (`value`)
//   items with `match`  → MATCH each card to its partner
//   fill: <math id>     → FILL a formula's blanks with tiles (TeX), one per
//                         box (design 2026-10-03 §5.3; set by the ask's
//                         expansion, spec/expand.ts expandFormulaTiles)
//   otherwise           → RANK: items in their TRUE order
//
// Sugar: it expands before layout (spec/expand.ts) into ordinary elements —
// node cards (<id>_1 … in TRUE order; a match's partners <id>_m_1 …), the
// boxes, end words, value labels and the like — and the group <id>, which
// carries the authored fields back (authoredCards) for the gate, the player
// and the plan. cardsGeometry says where every card is drawn (`home`), where
// the truth puts it (`truth`), and each mode's own geometry.

import type { Spec, SpecElement } from "./types";
import { INK, type Pt } from "../layout/model";
import type { BBox } from "../layout/geometry";
import { FIGURE_GROUND } from "../layout/ink";
import { authoredScales, scaleGeometry, type ScaleElementLike, type ScaleGeometry } from "./scale";

export interface CardItem {
  text: string;
  /** sort: the bin it belongs in. */
  bin?: string;
  /** place / compare: its number. */
  value?: number;
  /** match: its partner's text. */
  match?: string;
  /** fill: the blank (1-based) this tile is the truth of; none = a wrong tile. */
  blank?: number;
  /** select: the card belongs in the one box. */
  in?: boolean;
  /** An icon on the card (round 5 §3.3) — the card node's `icon`. */
  icon?: CardIcon;
  /** match: an icon on the partner card. */
  match_icon?: CardIcon;
  /** Machine-written by resolveIcons (render/icon.ts): the rings and their credit. */
  icon_strokes?: string;
  credit?: string;
  match_icon_strokes?: string;
  match_credit?: string;
}

export type CardIcon = string | { of: string; set?: string };

/** How the cards look (round 5 §3.2): paper is the default. */
export type CardsLook = "paper" | "flat" | "outline";

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
  /** fill: the math element whose blanks the tiles (items, TeX) go into. */
  fill?: string;
  /** TAP ALL THE …: the one box's title; items {text, in: true} belong in it (round 6 §7). */
  select?: string;
  /** sort: one large card at a time, centred; up to 30 items (round 6 §7). */
  deck?: boolean;
  /** paper (default), flat or outline (the plain boxes of before). */
  look?: CardsLook | string;
  /** How the cards' icons show (round 6 §8): picture (default) or drawn — copied onto every card node. */
  icon_look?: "picture" | "drawn";
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

export type CardsMode = "rank" | "sort" | "place" | "match" | "compare" | "decide" | "fill";

export interface CardsGeometry {
  id: string;
  mode: CardsMode;
  /** Every card id, in the order the arrays below index (TRUE order). */
  cards: string[];
  texts: string[];
  /** sort: each card's true bin (index into bins); fill: its blank (0-based), -1 for a wrong tile. */
  truthBin: number[];
  bins: string[];
  /** Card size. */
  w: number;
  h: number;
  /** Where each card is drawn — the layout's own position. */
  home: Pt[];
  /** rank: the slots, first = the first end; sort/place: the row the cards start in. */
  slots: Pt[];
  /** sort: each bin's box, and the centre of slot j inside bin k; fill: each blank's box (one slot, its centre). */
  binBoxes: CardBox[];
  /** `count`: how many cards the box holds now — a short last row is centred (sort). */
  binSlot(k: number, j: number, count?: number): Pt;
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
  // —— sort with deck: true (round 6 §7) ——
  deck?: boolean;
  /** deck: the order the cards are dealt (card indices); deal[0] is on top. */
  deal?: number[];
  /** deck: how much larger the card being dealt is drawn (about its centre). */
  deckScale?: number;
  /** select: a one-box sort whose out cards stay in the row (truthBin -1). */
  select?: boolean;
  /** The cards' font size, when not the mode's own (a deck's small cards). */
  font?: number;
}

const CARD_H = 56;
/** A card with an icon above its text (round 5 §3.3) — every card of the element, so rows stay even. */
export const CARD_ICON_H = 96;
const GAP = 14;

/** paper: the card's fill. */
export const CARD_PAPER = "#fffdf8";
/** paper / flat: the corner radius. */
const CARD_RADIUS = 10;

/** `ink` at `share` over `ground`, as a hex colour (both #rrggbb). */
function tint(ink: string, share: number, ground = FIGURE_GROUND): string {
  const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(ground, i) * (1 - share) + ch(ink, i) * share).toString(16).padStart(2, "0")).join("")}`;
}

/** flat: a soft tint of the ink (8 %) over the figure's sheet. */
export const CARD_FLAT = tint(INK, 0.08);

export function cardsLook(el: Pick<CardsElementLike, "look">): CardsLook {
  return el.look === "flat" || el.look === "outline" ? el.look : "paper";
}

/** A card node's look fields: radius, shadow and a fill — an authored style wins for colours. Outline: none, as before. */
function lookFields(look: CardsLook, style: SpecElement["style"]): Partial<SpecElement> {
  if (look === "outline") return style ? { style } : {};
  const color = style?.color;
  const fill = look === "paper" ? CARD_PAPER : typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? tint(color, 0.08) : CARD_FLAT;
  return { radius: CARD_RADIUS, ...(look === "paper" ? { shadow: true } : {}), style: { fill, ...style } };
}

/** True when the item has an icon that resolved (machine-written rings) — on itself or (match) on its partner. */
function hasIcon(it: CardItem): boolean {
  const on = (icon: unknown, strokes: unknown): boolean => icon !== undefined && typeof strokes === "string" && strokes !== "";
  return on(it.icon, it.icon_strokes) || on(it.match_icon, it.match_icon_strokes);
}

/** A sort bin's open box (no lid): straight under outline, rounded bottom corners under paper and flat. */
function binPoints(l: number, r: number, t: number, btm: number, look: CardsLook): [number, number][] {
  if (look === "outline") return [[l, t], [l, btm], [r, btm], [r, t]];
  const rad = CARD_RADIUS;
  const arc = (cx: number, cy: number, from: number, to: number): [number, number][] =>
    [0, 1, 2, 3, 4].map((k) => {
      const a = from + ((to - from) * k) / 4;
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    });
  // Down the left side, round the bottom-left corner, along, round the bottom-right, up.
  return [[l, t], ...arc(l + rad, btm + rad, Math.PI, 1.5 * Math.PI), ...arc(r - rad, btm + rad, 1.5 * Math.PI, 2 * Math.PI), [r, t]];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The item as {text, …}. */
export function cardItem(it: string | CardItem): CardItem {
  if (typeof it === "string") return { text: it };
  const str = (v: unknown): v is string => typeof v === "string" && v !== "";
  return {
    text: String(it.text ?? ""),
    ...(it.bin !== undefined ? { bin: String(it.bin) } : {}),
    ...(isNum(it.value) ? { value: it.value } : {}),
    ...(it.match !== undefined ? { match: String(it.match) } : {}),
    ...(Number.isInteger(it.blank) && (it.blank as number) >= 1 ? { blank: it.blank } : {}),
    ...(it.in === true ? { in: true } : {}),
    ...(it.icon !== undefined ? { icon: it.icon } : {}),
    ...(it.match_icon !== undefined ? { match_icon: it.match_icon } : {}),
    ...(str(it.icon_strokes) ? { icon_strokes: it.icon_strokes } : {}),
    ...(str(it.credit) ? { credit: it.credit } : {}),
    ...(str(it.match_icon_strokes) ? { match_icon_strokes: it.match_icon_strokes } : {}),
    ...(str(it.match_credit) ? { match_credit: it.match_credit } : {}),
  };
}

export function cardsMode(el: CardsElementLike): CardsMode {
  if (typeof el.fill === "string") return "fill";
  if (Array.isArray(el.options) && el.options.length > 0) return "decide";
  if (Array.isArray(el.bins) && el.bins.length > 0) return "sort";
  if (typeof el.select === "string") return "sort";
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

/** fill: a tile's size from its TeX. */
export const TILE_H = 48;
export const tileWidth = (tex: string): number => Math.max(56, 22 * Math.pow(tex.length, 0.8));

/** A blank's box lookup: the math element's blank boxes in order (layout boxes), or null. */
export type BlanksOf = (mathId: string) => BBox[] | null;
/** fill: where layout drew a tile (its centre), or null — layout moves the
 *  tile row under the formula as placed (layout/tier2.ts placeFormulaTiles). */
export type HomesOf = (cardId: string) => Pt | null;

/** The lowest a card (or a bin, or a compare value under its card) may reach: just above the canvas floor. */
const CARD_FLOOR = 8;

/** The lowest point the geometry draws: cards at home and at the truth, sort bins, compare values. */
function lowestOf(g: CardsGeometry): number {
  const ys = [...g.home, ...g.truth].map((p) => p[1] - g.h / 2 - (g.mode === "compare" ? 32 : 0));
  for (const b of g.binBoxes) ys.push(b.c[1] - b.h / 2);
  return Math.min(...ys);
}

export function cardsGeometry(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry {
  // Icon cards are taller (96); when the fullest layouts (sort 8, match 6,
  // a column of 8) would run off the canvas floor, they shrink — never
  // below a plain card — until they fit. The icon scales with the card.
  let g = cardsGeometryAt(el, CARD_ICON_H, scaleOf, blanksOf, homesOf);
  for (let ch = CARD_ICON_H - 2; g.h > CARD_H && ch >= CARD_H && lowestOf(g) < CARD_FLOOR; ch -= 2) {
    g = cardsGeometryAt(el, ch, scaleOf, blanksOf, homesOf);
  }
  return g;
}

function cardsGeometryAt(el: CardsElementLike, iconH: number, scaleOf?: (id: string) => ScaleElementLike | undefined, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry {
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

  const deck = mode === "sort" && el.deck === true && typeof el.select !== "string";
  const items = (el.items ?? []).map(cardItem).slice(0, deck ? DECK_MAX : 8);
  const n = items.length;
  const cards = items.map((_, i) => `${el.id}_${i + 1}`);
  const texts = items.map((it) => it.text);
  // Round 5 §3.3: one resolved icon makes every card taller, so rows stay even.
  // (A formula's tiles are TeX; they carry no icons.)
  const icons = mode !== "fill" && items.some(hasIcon);
  const CH = icons ? iconH : CARD_H;

  if (mode === "fill") {
    // The tiles in a row (two when many), centred in [x0, x1]; the boxes are
    // the formula's blanks as laid out, one tile each.
    const w = Math.min(180, Math.max(...texts.map(tileWidth), 56));
    const h = TILE_H;
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    const rowW = perRow * w + (perRow - 1) * GAP;
    const left = (x0 + x1) / 2 - rowW / 2;
    const yTop = isNum(el.y) ? el.y : 200;
    const tray: Pt[] = items.map((_, s) => [left + (s % perRow) * (w + GAP) + w / 2, yTop - Math.floor(s / perRow) * (h + GAP)] as Pt);
    // The expansion shuffles the items already; they are drawn as listed —
    // where layout put them when it says (the row follows the formula).
    const home = tray.map((p, i) => homesOf?.(cards[i]) ?? p);
    const nBlanks = Math.max(0, ...items.map((it) => it.blank ?? 0));
    const truthBin = items.map((it) => (it.blank !== undefined && it.blank <= nBlanks ? it.blank - 1 : -1));
    const boxes = el.fill ? blanksOf?.(el.fill) ?? null : null;
    // Without the layout's boxes (before layout), each blank stands where its
    // true tile does — consistent, if not where the formula draws it.
    const binBoxes: CardBox[] = Array.from({ length: nBlanks }, (_, k) => {
      const b = boxes?.[k];
      if (b) return { c: [b.x + b.w / 2, b.y + b.h / 2] as Pt, w: b.w, h: b.h };
      const i = truthBin.indexOf(k);
      return { c: (i >= 0 ? home[i] : [0, 0]) as Pt, w, h };
    });
    const binSlot = (k: number): Pt => binBoxes[k]?.c ?? [0, 0];
    const truth = truthBin.map((k, i) => (k >= 0 ? binSlot(k) : home[i]));
    return { ...base, cards, texts, truthBin, bins: binBoxes.map((_, k) => `blank_${k + 1}`), w, h, home, slots: home.slice(), binBoxes, binSlot, truth };
  }

  if (mode === "match") {
    const k = Math.min(6, n);
    const left = items.slice(0, k);
    const yTop = isNum(el.y) ? el.y : 560;
    const w = Math.min(260, width / 2 - 60);
    const lx = x0 + w / 2, rx = x1 - w / 2;
    const rows = left.map((_, i) => yTop - i * (CH + GAP));
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
      h: CH,
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
      // A row: the card, its value under it, a gap (100 for plain cards).
      const y = yTop - r * (CH + 44);
      if (!placed.has(a)) pos[a] = [x0 + width * 0.3, y];
      if (!placed.has(b)) pos[b] = [x0 + width * 0.7, y];
      placed.add(a).add(b);
    });
    return { ...base, cards, texts, w, h: CH, home: pos, slots: pos, truth: pos, values: items.map((it) => it.value ?? 0), rows: pairs, valueIds: items.map((_, i) => `${el.id}_v_${i + 1}`) };
  }

  if (mode === "place") {
    const sc = el.along ? scaleOf?.(el.along) : undefined;
    const sg = sc ? scaleGeometry(sc) : scaleGeometry({ id: "_", type: "scale", min: 0, max: 100, value: 50 });
    const values = items.map((it) => (isNum(it.value) ? it.value : sg.min));
    const span = sg.x1 - sg.x0;
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    const w = Math.min(150, span / perRow - GAP);
    const h = icons ? CH : 48;
    const slotW = span / perRow;
    const trayTop = sg.y - 86 - h / 2;
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
        out[i] = [x, sg.y + 40 + h / 2 + lv * (h + 8)];
      }
      return out;
    };
    return { ...base, cards, texts, w, h, home, slots: tray, truth: placeAt(values), scale: sg, values, placeAt };
  }

  const select = mode === "sort" && typeof el.select === "string" && !(Array.isArray(el.bins) && el.bins.length > 0);
  const bins = select ? [String(el.select)] : (el.bins ?? []).map(String).slice(0, 4);
  // select: an out card's truth is the row (-1).
  const truthBin = items.map((it) => (select ? (it.in === true ? 0 : -1) : Math.max(0, bins.indexOf(it.bin ?? ""))));
  const perm = shuffleOrder(n);
  if (deck) return deckGeometry(el, base, items.map((it) => it.text), truthBin, bins, perm, icons, x0, width);

  if (mode === "rank") {
    const column = el.arrange === "column";
    let slots: Pt[];
    let w: number;
    if (column) {
      const yTop = isNum(el.y) ? el.y : 600;
      w = Math.min(320, width);
      const cx = (x0 + x1) / 2;
      slots = items.map((_, k) => [cx, yTop - k * (CH + GAP)] as Pt);
    } else {
      const y = isNum(el.y) ? el.y : 380;
      const slotW = width / Math.max(1, n);
      w = Math.min(190, slotW - GAP);
      slots = items.map((_, k) => [x0 + slotW * (k + 0.5), y] as Pt);
    }
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = slots[s]));
    return { ...base, cards, texts, w, h: CH, home, slots, truth: slots.slice() };
  }

  if (select) {
    // One wide box across the top; the cards it holds stand side by side in
    // it (rows of as many as fit), so every card can go in.
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    const slotW = width / perRow;
    const w = Math.min(180, slotW - GAP);
    const binW = width - 2 * GAP;
    const cols = Math.max(1, Math.floor((binW - 12) / (w + 10)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const binTop = isNum(el.y) ? el.y : 660;
    const binH = 44 + rows * (CH + 8) + 8;
    const binBoxes: CardBox[] = [{ c: [x0 + width / 2, binTop - binH / 2] as Pt, w: binW, h: binH }];
    const trayTop = binTop - binH - 40;
    const tray: Pt[] = items.map((_, s) => [x0 + slotW * ((s % perRow) + 0.5), trayTop - CH / 2 - Math.floor(s / perRow) * (CH + GAP)] as Pt);
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = tray[s]));
    const binSlot = (_b: number, j: number): Pt => {
      const row = Math.floor(j / cols), col = j % cols;
      const inRow = Math.min(cols, n - row * cols);
      const box = binBoxes[0];
      return [box.c[0] + (col - (inRow - 1) / 2) * (w + 10), box.c[1] + box.h / 2 - 44 - CH / 2 - row * (CH + 8)];
    };
    let seen = 0;
    const truth = truthBin.map((b, i) => (b === 0 ? binSlot(0, seen++) : home[i]));
    // Tap all: the cards are read where they stand, on a phone too (≥ ~10 px at 390 px).
    return { ...base, mode, cards, texts, truthBin, bins, w, h: CH, home, slots: tray, binBoxes, binSlot, truth, select: true, font: icons ? 22 : 26 };
  }

  // Sort: the boxes across the top, the cards in a row (two when many) below.
  const k = bins.length;
  const binW = width / k - 2 * GAP;
  const perBin = bins.map((_, b) => truthBin.filter((t) => t === b).length);
  const perRow = n > 5 ? Math.ceil(n / 2) : n;
  const slotW = width / perRow;
  let w = Math.min(180, slotW - GAP, binW - 20);
  // Any box may get every card (final fix wave E): its grid holds all n in
  // the old number of rows — more columns (the cards narrower, never under
  // 56) — and when even that is too many rows, shorter cards (fix round 2):
  // the boxes and the row of cards below them stay on the canvas.
  const room = Math.max(2, ...perBin, Math.ceil(n / 2));
  let cols = 1;
  while (Math.ceil(n / cols) > room && (binW - 12) / (cols + 1) - 10 >= 56) {
    cols++;
    w = Math.min(w, (binW - 12) / cols - 10);
  }
  const rows = Math.max(room, Math.ceil(n / cols));
  const binTop = isNum(el.y) ? el.y : 660;
  const trayRows = Math.ceil(n / perRow);
  const lowest = (h: number): number => binTop - (52 + rows * (h + 8)) - 40 - trayRows * (h + GAP) + GAP;
  let ch = CH;
  while (ch > 28 && lowest(ch) < CARD_FLOOR) ch -= 2;
  const binH = 44 + rows * (ch + 8) + 8;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [x0 + (width / k) * (b + 0.5), binTop - binH / 2] as Pt, w: binW, h: binH }));
  const trayTop = binTop - binH - 40;
  const tray: Pt[] = items.map((_, s) => [x0 + slotW * ((s % perRow) + 0.5), trayTop - ch / 2 - Math.floor(s / perRow) * (ch + GAP)] as Pt);
  const home: Pt[] = new Array(n);
  perm.forEach((card, s) => (home[card] = tray[s]));
  // Down the first column, then the next: a box holding no more than a
  // column's worth shows one centred column, as it always did.
  const binSlot = (b: number, j: number, count = 0): Pt => {
    const box = binBoxes[b];
    const col = Math.floor(j / rows), row = j % rows;
    const used = Math.max(1, Math.min(cols, Math.ceil(Math.max(count, j + 1) / rows)));
    return [box.c[0] + (col - (used - 1) / 2) * (w + 10), box.c[1] + box.h / 2 - 44 - ch / 2 - row * (ch + 8)];
  };
  const seen = bins.map(() => 0);
  const truth = truthBin.map((b) => binSlot(b, seen[b]++, perBin[b]));
  // Shorter cards, smaller text (narrow ones too); else the mode's own size.
  const font = ch < CH || w < 90 ? Math.round(Math.min(20 * (ch / CH), w < 90 ? 16 : 20)) : undefined;
  return { ...base, mode, cards, texts, truthBin, bins, w, h: ch, home, slots: tray, binBoxes, binSlot, truth, ...(font !== undefined && !icons ? { font } : {}) };
}

/** A deck holds at most this many cards (round 6 §7). */
export const DECK_MAX = 30;

/**
 * deck (round 6 §7): the boxes across the top hold the cards small, in a
 * grid each (columns as the box's width and the most cards it may get
 * allow); the cards wait in one stack centred below them, and the card being
 * dealt is drawn `deckScale` times larger. Every card is the same node, so
 * the truth and the plan stay plain offsets; only the gate and the movie
 * scale the dealt card.
 */
function deckGeometry(
  el: CardsElementLike,
  base: Pick<CardsGeometry, "id" | "mode" | "truthBin" | "bins" | "binBoxes" | "binSlot">,
  texts: string[],
  truthBin: number[],
  bins: string[],
  deal: number[],
  icons: boolean,
  x0: number,
  width: number,
): CardsGeometry {
  const n = texts.length;
  const k = Math.max(1, bins.length);
  const binW = width / k - 2 * GAP;
  const binTop = isNum(el.y) ? el.y : 720;
  const h0 = icons ? CARD_H : 32;
  const PAD = 8, GX = 8, GY = 6, TITLE = 40;
  // Room for the boxes: the dealt card needs about 150 under them.
  const maxH = binTop - 170;
  // Any box may get every card (final fix wave E): the grid holds all n —
  // more columns while the cards stay wide enough to read, then shorter cards.
  const cap = Math.max(1, n);
  const heightFor = (cols: number, h: number): number => TITLE + Math.ceil(cap / cols) * (h + GY) + PAD;
  const widthFor = (cols: number): number => Math.min(200, (binW - 2 * PAD - (cols - 1) * GX) / cols);
  // The tallest card each column count allows (the card's own height at most).
  const fitH = (cols: number): number => Math.min(h0, Math.floor((maxH - TITLE - PAD) / Math.ceil(cap / cols) - GY));
  let cols = 1;
  // Columns before height: the boxes keep to about half the canvas when they can.
  const comfy = Math.min(maxH, 360);
  while (cols < 6 && heightFor(cols, h0) > comfy && widthFor(cols + 1) >= 80) cols++;
  // Still too tall: as many more columns as make the cards tallest (no
  // narrower than 56), then shorter cards (never under 16), their text with them.
  for (let c = cols + 1; c <= 8 && fitH(cols) < h0 && widthFor(c) >= 56; c++) if (fitH(c) > fitH(cols)) cols = c;
  const w = widthFor(cols);
  const rows = Math.ceil(cap / cols);
  const h = Math.max(16, fitH(cols));
  const binH = heightFor(cols, h);
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [x0 + (width / k) * (b + 0.5), binTop - binH / 2] as Pt, w: binW, h: binH }));
  const binSlot = (b: number, j: number): Pt => {
    const box = binBoxes[b];
    if (!box) return [0, 0];
    // Past the grid, cards pile on the first slots, a little offset.
    const layer = Math.floor(j / (rows * cols));
    const q = j % (rows * cols);
    const row = Math.floor(q / cols), col = q % cols;
    const left = box.c[0] - ((cols - 1) * (w + GX)) / 2;
    return [left + col * (w + GX) + layer * 5, box.c[1] + box.h / 2 - TITLE - h / 2 - row * (h + GY) - layer * 5];
  };
  const boxBottom = binTop - binH;
  // The dealt card by the canvas, not by the small card (final fix wave E):
  // about 600 wide — on a 390 px phone its text is ~17 px — as tall as the
  // room under the boxes allows.
  const deckScale = Math.max(1, Math.min(600 / w, (icons ? 160 : 110) / h, (boxBottom - 40) / h));
  const bigH = h * deckScale;
  const cx = x0 + width / 2;
  const cy = Math.max(bigH / 2 + 12, Math.min(boxBottom - bigH / 2 - 24, boxBottom / 2));
  // Every card waits in the middle; only the top one is drawn (cardsElements:
  // the others are not the group's members — the deal shows each in turn).
  const home: Pt[] = deal.map(() => [cx, cy] as Pt);
  // The truth fills each box in the order the cards are dealt.
  const seen = bins.map(() => 0);
  const truth: Pt[] = new Array(n);
  for (const card of deal) truth[card] = binSlot(truthBin[card], seen[truthBin[card]]++);
  const cards = texts.map((_, i) => `${el.id}_${i + 1}`);
  const font = Math.round((icons ? 13 : 15) * Math.min(1, h / h0));
  return { ...base, cards, texts, truthBin, bins, w, h, home, slots: home.slice(), binBoxes, binSlot, truth, deck: true, deal, deckScale, font };
}

/** The authored fields a cards group carries back (authoredCards). */
const CARRIED = ["items", "bins", "ends", "arrange", "along", "compare", "pairs", "unit", "options", "then", "fill", "select", "deck", "x", "y", "width"] as const;

/** The ordinary elements a cards element stands for. */
export function cardsElements(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined): SpecElement[] {
  const g = cardsGeometry(el, scaleOf);
  const out: SpecElement[] = [];
  const quiet = { color: "#7a7468" };
  const look = cardsLook(el);
  const looks = lookFields(look, el.style);
  // Each card's icon fields (round 5 §3.3), by card index: a match's partners take match_icon.
  const items = (el.items ?? []).map(cardItem);
  const iconOf = (i: number): Partial<SpecElement> => {
    if (g.mode === "decide" || g.mode === "fill") return {};
    const partner = g.mode === "match" && i >= (g.pairs ?? 0);
    const it = items[partner ? i - (g.pairs ?? 0) : i];
    if (!it) return {};
    const icon = partner ? it.match_icon : it.icon;
    if (icon === undefined) return {};
    const strokes = partner ? it.match_icon_strokes : it.icon_strokes;
    const credit = partner ? it.match_credit : it.credit;
    const iconLook = el.icon_look === "picture" || el.icon_look === "drawn" ? { icon_look: el.icon_look } : {};
    return { icon, ...(strokes ? { icon_strokes: strokes } : {}), ...(credit ? { credit } : {}), ...iconLook } as Partial<SpecElement>;
  };
  if (g.mode === "sort") {
    g.binBoxes.forEach((b, k) => {
      const id = `${el.id}_bin_${k + 1}`;
      const l = b.c[0] - b.w / 2, r = b.c[0] + b.w / 2, t = b.c[1] + b.h / 2, btm = b.c[1] - b.h / 2;
      // An open box: no lid, so it reads as somewhere to put things.
      out.push({ id: `${id}_box`, type: "path", points: binPoints(l, r, t, btm, look), style: quiet });
      out.push({ id: `${id}_title`, type: "text", text: g.bins[k], x: b.c[0], y: t - 22, font_size: 24 });
      out.push({ id, type: "group", members: [`${id}_box`, `${id}_title`] });
    });
  }
  if (g.mode === "compare" && el.compare) {
    const top = Math.max(...g.home.map((p) => p[1])) + g.h / 2 + 40;
    out.push({ id: `${el.id}_title`, type: "text", text: el.compare, x: 500, y: Math.min(720, top), font_size: 24 });
  }
  // A deck is drawn as a stack: the card dealt first is drawn last, on top.
  const drawOrder = g.deal ? [...g.deal].reverse() : g.cards.map((_, i) => i);
  drawOrder.forEach((i) => {
    const id = g.cards[i];
    if (g.mode === "fill") {
      // A tile: a box with its TeX drawn as math (size 22) — the node's `tex`
      // (layout/tier2.ts), drawn as `<card>_text` so it moves with the card.
      out.push({ id, type: "node", shape: "rect", tex: g.texts[i], x: g.home[i][0], y: g.home[i][1], width: g.w, height: g.h, font_size: 22, ...looks });
      return;
    }
    out.push({ id, type: "node", shape: "rect", text: g.texts[i], x: g.home[i][0], y: g.home[i][1], width: g.w, height: g.h, font_size: g.font ?? (g.mode === "decide" ? 24 : 20), ...looks, ...iconOf(i) });
  });
  if (g.mode === "rank" && Array.isArray(el.ends) && el.ends.length === 2) {
    const first = g.slots[0], last = g.slots[g.slots.length - 1];
    const column = el.arrange === "column";
    const at = (p: Pt, sign: 1 | -1): [number, number] => (column ? [p[0], p[1] + sign * (g.h / 2 + 22)] : [p[0], p[1] - g.h / 2 - 26]);
    out.push({ id: `${el.id}_end_1`, type: "text", text: column ? `↑ ${el.ends[0]}` : `← ${el.ends[0]}`, x: at(first, 1)[0], y: at(first, 1)[1], font_size: 20, style: quiet });
    out.push({ id: `${el.id}_end_2`, type: "text", text: column ? `↓ ${el.ends[1]}` : `${el.ends[1]} →`, x: at(last, -1)[0], y: at(last, -1)[1], font_size: 20, style: quiet });
  }
  // A deck: the cards still to come are not drawn with the group (a card's
  // text is drawn over every card's paper, so a stack would show through);
  // the deal shows each in turn, and the question shows them all after.
  const waiting = new Set((g.deal ?? []).slice(1).map((i) => g.cards[i]));
  const members = out.map((e) => e.id).filter((id) => !waiting.has(id));
  // A compare card's value is written under it — OUTSIDE the group, so
  // drawing the cards gives nothing away; the question reveals each.
  if (g.mode === "compare" && g.valueIds && g.values) {
    g.valueIds.forEach((id, i) => {
      out.push({ id, type: "text", text: compareValueText(g.values![i], el.unit), x: g.home[i][0], y: g.home[i][1] - g.h / 2 - 20, font_size: 20, style: { color: "#3f6fb5" } });
    });
  }
  const keep: Record<string, unknown> = {};
  for (const k of CARRIED) {
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
    // A deck's group holds its top card only, which need not be card 1.
    const first = e.deck === true ? `${e.id}_bin_1` : `${e.id}_1`;
    if (e.type !== "group" || !CARD_FIELDS.some((k) => Array.isArray(e[k])) || !(e.members ?? []).includes(first)) continue;
    const c: CardsElementLike = { id: e.id, type: "cards" };
    for (const k of CARRIED) {
      if (e[k] !== undefined) (c as unknown as Record<string, unknown>)[k] = e[k];
    }
    out.push(c);
  }
  return out;
}

/** The geometry of a spec's cards element by id — with its scale looked up. */
export function cardsGeometryIn(spec: Pick<Spec, "elements">, id: string, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry | null {
  const el = authoredCards(spec).find((c) => c.id === id);
  if (!el) return null;
  const scales = authoredScales(spec);
  return cardsGeometry(el, (sid) => scales.find((s) => s.id === sid), blanksOf, homesOf);
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
