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
import { wrapText } from "../layout/labels";
import type { MeasureFn } from "../layout/measure";
import { CAPTION_TOP, CONTENT_TOP, CONTENT_TOP_BARE, HEADING_Y, MARGIN, PAGE_W } from "../layout/page";
import { pageHeading } from "./card";
import { stepsArrowIds, stepsArrows, stepsColumn, stepsColumnSlots, stepsEnds, stepsExtentAdd, stepsRow, stepsSlotElements } from "./steps";

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
  /** ODD ONE OUT (spec/odd-one-out.ts): the one that does not belong. */
  odd?: boolean;
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
  /** rank: PUT THE STEPS IN ORDER — numbered slots joined by arrows (spec/steps.ts). */
  steps?: boolean;
  /** rank: a row (default) or a column of cards; sort, select, deck (round 7 §5): drop (default — the cards above the boxes), side (a column on the left, up to 8), rise (the boxes on top). */
  arrange?: "row" | "column" | "drop" | "side" | "rise";
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
  /** ODD ONE OUT (spec/odd-one-out.ts): what the others share — carried on the group for the expansion. */
  rule?: string;
  /** sort, select, deck (round 7 §3): each (default) — every card is judged as it is dropped; end — all at Answer. */
  check?: "each" | "end";
  /** paper (default), flat or outline (the plain boxes of before). */
  look?: CardsLook | string;
  /** How the cards' icons show (round 6 §8): picture (default) or drawn — copied onto every card node. */
  icon_look?: "picture" | "drawn";
  /** How large the cards are drawn (page frame 2026-10-04): a factor 0.6–2 on
   *  every size, or "auto" (default) — larger when the cards are alone on the
   *  page (expandCards writes the number it chose). */
  size?: number | "auto";
  /** compare: the question written over the cards — true, false, or other
   *  words. Default: none when the page has a heading, else the question. */
  title?: boolean | string;
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
  /** check: each (round 7) — a sort, select or deck judging every drop. */
  each?: true;
  /** sort, select, deck (round 7 §5): drop — the cards above the boxes; side — beside them; rise — below (absent: rise). */
  layout?: "drop" | "side" | "rise";
  /** The size factor every size was drawn at (absent: 1). */
  k?: number;
  /** Each card's text as drawn, a line each (absent: one line every card). */
  lines?: string[][];
  /** The cards whose text did not fit two lines at the mode's own font (it was made smaller). */
  tooLong?: number[];
  /** Made smaller than its size to stay on the page (cards shorter, text smaller). */
  squeezed?: true;
  /** compare, decide (page frame 2026-10-04): labels and values that move with each card, by card id. */
  followers?: Record<string, string[]>;
  /** rank with steps (spec/steps.ts): the arrows between the slots — drawn once the cards stand in the true order. */
  arrows?: string[];
  /** rank with steps: the slots run down a column. */
  column?: true;
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
function lookFields(look: CardsLook, style: SpecElement["style"], k = 1): Partial<SpecElement> {
  if (look === "outline") return style ? { style } : {};
  const color = style?.color;
  const fill = look === "paper" ? CARD_PAPER : typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? tint(color, 0.08) : CARD_FLAT;
  return { radius: CARD_RADIUS * k, ...(look === "paper" ? { shadow: true } : {}), style: { fill, ...style } };
}

/** True when the item has an icon that resolved (machine-written rings) — on itself or (match) on its partner. */
function hasIcon(it: CardItem): boolean {
  const on = (icon: unknown, strokes: unknown): boolean => icon !== undefined && typeof strokes === "string" && strokes !== "";
  return on(it.icon, it.icon_strokes) || on(it.match_icon, it.match_icon_strokes);
}

/** A sort bin's open box (no lid): straight under outline, rounded bottom corners under paper and flat. */
function binPoints(l: number, r: number, t: number, btm: number, look: CardsLook, k = 1): [number, number][] {
  if (look === "outline") return [[l, t], [l, btm], [r, btm], [r, t]];
  const rad = CARD_RADIUS * k;
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

/** The lowest a card (or a bin, or a compare value under its card) may reach:
 *  the top of the caption band (page frame 2026-10-04; it was 8, the canvas floor). */
const CARD_FLOOR = CAPTION_TOP;

/** check: each (round 7 §3.1.6): the counter's row under the boxes (drop, side). */
export const COUNTER_ROOM = 34;

/** Where the counter stands, centred on the boxes: drop — in the gap between
 *  the cards and the boxes (under the boxes is the bottom bar's, over the
 *  figure); side — under the boxes; rise — in the gap over the tray. */
export function counterAt(g: CardsGeometry): Pt {
  const k = g.k ?? 1;
  const bs = g.binBoxes;
  const x = (Math.min(...bs.map((b) => b.c[0] - b.w / 2)) + Math.max(...bs.map((b) => b.c[0] + b.w / 2))) / 2;
  if (g.layout === "drop") return [x, Math.max(...bs.map((b) => b.c[1] + b.h / 2)) + 21 * k];
  return [x, Math.min(...bs.map((b) => b.c[1] - b.h / 2)) - 22 * k];
}

/** sort, select, deck under drop / side (round 7 §5, §8.1): nothing stands above this by default — the top strip is the headline's. */
export const HEAD_ROOM_Y = CONTENT_TOP;

/** sort, select, deck (round 7 §5): where the cards stand against the boxes — drop unless asked; side only up to 8 cards. */
export function sortLayout(el: Pick<CardsElementLike, "arrange">, n: number): "drop" | "side" | "rise" {
  if (el.arrange === "rise") return "rise";
  return el.arrange === "side" && n <= 8 ? "side" : "drop";
}

/** The size factor `size` asks for (0.6–2); 1 for "auto" until expandCards resolves it. */
export function cardsSize(el: Pick<CardsElementLike, "size">): number {
  return isNum(el.size) ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, el.size)) : 1;
}
export const SIZE_MIN = 0.6;
export const SIZE_MAX = 2;

/** A card's text keeps this far from either side of the card (× the size). */
const TEXT_PAD = 5;
/** A card's words as the hand font draws them: about 0.46 em a letter (the
 *  layout's heuristic, 0.52, is a safe bound that would wrap words that fit). */
const cardMeasure: MeasureFn = (text, fontSize) => ({ w: Math.max(1, text.length) * fontSize * 0.46, h: fontSize * LINE_H });
/** A line of card text, as a share of its font (the text drawable's own line advance). */
const LINE_H = 1.25;
/** Card text is made no smaller than this to fit: past it a long word runs over the edge. */
const MIN_FONT = 12;

export interface CardTextFit {
  /** The font every card of the set is drawn at. */
  font: number;
  /** Each card's text, a line each (one or two). */
  lines: string[][];
  /** How much taller a card is for its second line (0: every text on one line). */
  extra: number;
  /** The cards whose text needs a third line at the starting font (the set's font was made smaller). */
  tooLong: number[];
}

/**
 * Card texts on cards `w` wide (page frame 2026-10-04 §4): one line at `font`
 * when it fits, else two (the card grows a line taller); smaller only when
 * two lines cannot hold a text. One font for every card of the set, so the
 * cards read alike. Measured with the layout's heuristic, so the gate, the
 * plan and the lint agree with the drawing.
 */
export function fitCardTexts(texts: string[], w: number, font: number, k = 1): CardTextFit {
  const room = Math.max(1, w - 2 * TEXT_PAD * k);
  const wrap = (f: number): string[][] => texts.map((t) => wrapText(t, f, room, cardMeasure));
  const fits = (ls: string[], f: number): boolean => ls.length <= 2 && ls.every((l) => cardMeasure(l, f).w <= room);
  let f = font;
  let lines = wrap(f);
  // Three lines at the set's own font: the lint asks for fewer words (a long single word only shrinks).
  const tooLong = lines.map((ls, i) => (ls.length > 2 ? i : -1)).filter((i) => i >= 0);
  while (f > MIN_FONT && !lines.every((ls) => fits(ls, f))) lines = wrap(--f);
  // Never more than two lines: what is left runs on in the second (the lint says so).
  const two = lines.map((ls) => (ls.length > 2 ? [ls[0], ls.slice(1).join(" ")] : ls));
  const most = Math.max(1, ...two.map((ls) => ls.length));
  return { font: f, lines: two, extra: (most - 1) * f * LINE_H, tooLong };
}

/** The text fields of a geometry from its fit, beside the mode's own font at size 1 (`own`): only what differs. */
function textFields(fit: CardTextFit, own: number): Pick<CardsGeometry, "font" | "lines" | "tooLong"> {
  return {
    ...(fit.font !== own ? { font: fit.font } : {}),
    ...(fit.lines.some((ls) => ls.length > 1) ? { lines: fit.lines } : {}),
    ...(fit.tooLong.length > 0 ? { tooLong: fit.tooLong } : {}),
  };
}

/** A deck: a sort with deck: true (not a select). */
const isDeck = (el: CardsElementLike): boolean => cardsMode(el) === "sort" && el.deck === true && typeof el.select !== "string";

/** Where a mode's cards stand when `y` is not given — the anchor `y` moves;
 *  null: the layout is not moved (place follows its scale; a deck and a
 *  formula's tiles have rules of their own). */
function defaultY(el: CardsElementLike): number | null {
  const mode = cardsMode(el);
  if (mode === "decide") return 380;
  if (mode === "rank") return el.arrange === "column" ? 600 : 380;
  if (mode === "match" || mode === "compare") return 560;
  if (mode === "sort" && !isDeck(el)) return CONTENT_TOP;
  return null;
}

/** True when the set's cards carry a resolved icon (fill's tiles never do). */
function setHasIcons(el: CardsElementLike): boolean {
  return cardsMode(el) !== "fill" && cardsMode(el) !== "decide" && (el.items ?? []).map(cardItem).some(hasIcon);
}

/** A card's height before its text is fitted: an icon card, a place card (48) or a plain card, × the size. */
function naturalH(el: CardsElementLike, k: number): number {
  if (setHasIcons(el)) return CARD_ICON_H * k;
  return (cardsMode(el) === "place" ? PLACE_H : CARD_H) * k;
}
const PLACE_H = 48;

export interface CardsExtent {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Everything the set draws, as a box: the cards at home and at the truth,
 *  the boxes, the counter, compare values under their cards and a rank's end
 *  words (not a compare title — it stands in the heading's strip). */
export function cardsExtent(g: CardsGeometry, el?: Pick<CardsElementLike, "ends" | "arrange">): CardsExtent {
  const k = g.k ?? 1;
  const e: CardsExtent = { top: -Infinity, bottom: Infinity, left: Infinity, right: -Infinity };
  const add = (l: number, r: number, b: number, t: number): void => {
    e.left = Math.min(e.left, l);
    e.right = Math.max(e.right, r);
    e.bottom = Math.min(e.bottom, b);
    e.top = Math.max(e.top, t);
  };
  const under = g.mode === "compare" ? 32 * k : 0;
  for (const p of g.deck ? g.truth : [...g.home, ...g.truth]) add(p[0] - g.w / 2, p[0] + g.w / 2, p[1] - g.h / 2 - under, p[1] + g.h / 2);
  if (g.deck && g.deal && g.deal.length > 0) {
    const s = g.deckScale ?? 1;
    const p = g.home[g.deal[0]];
    add(p[0] - (g.w * s) / 2, p[0] + (g.w * s) / 2, p[1] - (g.h * s) / 2, p[1] + (g.h * s) / 2);
  }
  for (const b of g.binBoxes) add(b.c[0] - b.w / 2, b.c[0] + b.w / 2, b.c[1] - b.h / 2, b.c[1] + b.h / 2);
  if (g.each && g.layout !== undefined && g.layout !== "rise" && g.binBoxes.length > 0) {
    const c = counterAt(g);
    add(c[0], c[0], c[1] - 12 * k, c[1] + 12 * k);
  }
  if (g.arrows) stepsExtentAdd(g.slots, g.w, g.h, g.column === true, k, Array.isArray(el?.ends) && el.ends.length === 2, add);
  else if (g.mode === "rank" && Array.isArray(el?.ends) && el.ends.length === 2 && g.slots.length > 0) {
    const first = g.slots[0], last = g.slots[g.slots.length - 1];
    if (el.arrange === "column") {
      add(first[0], first[0], first[1], first[1] + g.h / 2 + 34 * k);
      add(last[0], last[0], last[1] - g.h / 2 - 34 * k, last[1]);
    } else add(first[0], last[0], first[1] - g.h / 2 - 38 * k, first[1]);
  }
  return e;
}

export function cardsGeometry(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry {
  const k = cardsMode(el) === "fill" ? 1 : cardsSize(el);
  // Below the content area at the default place (page frame 2026-10-04): moved
  // up into it while there is room under the heading's strip, then — the
  // fullest layouts (sort 8, match 6, a column of 8) — icon cards are made
  // shorter until they clear the caption band, never below a plain card (the
  // icon scales with the card). A sort makes its own cards shorter.
  const y0 = isNum(el.y) ? null : defaultY(el);
  const at = (ch: number): CardsGeometry => {
    const g = cardsGeometryAt(el, k, ch, scaleOf, blanksOf, homesOf);
    if (y0 === null) return g;
    const e = cardsExtent(g, el);
    const dy = e.bottom < CARD_FLOOR ? Math.max(0, Math.min(CARD_FLOOR - e.bottom, CONTENT_TOP - e.top)) : e.top > CONTENT_TOP ? -Math.max(0, Math.min(e.top - CONTENT_TOP, e.bottom - CARD_FLOOR)) : 0;
    return Math.abs(dy) > 0.5 ? cardsGeometryAt({ ...el, y: y0 + dy }, k, ch, scaleOf, blanksOf, homesOf) : g;
  };
  const natural = naturalH(el, k);
  let g = at(natural);
  if (g.mode === "fill" || g.mode === "decide" || g.deck) return g;
  // Plain cards keep their height (their text would go under the readable size).
  const least = setHasIcons(el) ? CARD_H * k : natural;
  let ch = natural;
  while (ch - 2 >= least && cardsExtent(g, el).bottom < CARD_FLOOR - 0.5) g = at((ch -= 2));
  return ch < natural ? { ...g, squeezed: true } : g;
}

function cardsGeometryAt(el: CardsElementLike, k: number, ch0: number, scaleOf?: (id: string) => ScaleElementLike | undefined, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry {
  const mode = cardsMode(el);
  const x0 = isNum(el.x) ? el.x : 100;
  const width = isNum(el.width) && el.width > 200 ? el.width : 800;
  const x1 = x0 + width;
  const gap = GAP * k;
  const none = (): Pt => [0, 0];
  const base = { id: el.id, mode, truthBin: [] as number[], bins: [] as string[], binBoxes: [] as CardBox[], binSlot: none, ...(mode === "sort" && el.check !== "end" ? { each: true as const } : {}), ...(k !== 1 ? { k } : {}) };

  if (mode === "decide") {
    const opts = (el.options ?? []).slice(0, 4).map((o) => ({ text: String(o.text ?? ""), goto: o.goto, best: o.best === true }));
    const n = opts.length;
    const y = isNum(el.y) ? el.y : 380;
    const slotW = width / Math.max(1, n);
    const w = Math.min(260 * k, slotW - gap);
    const fit = fitCardTexts(opts.map((o) => o.text), w, Math.round(24 * k), k);
    const pos = opts.map((_, i) => [x0 + slotW * (i + 0.5), y] as Pt);
    return { ...base, cards: opts.map((_, i) => `${el.id}_${i + 1}`), texts: opts.map((o) => o.text), w, h: 72 * k + fit.extra, home: pos, slots: pos, truth: pos, gotos: opts.map((o) => o.goto), best: opts.map((o) => o.best), ...(el.then ? { then: el.then } : {}), ...textFields(fit, 24) };
  }

  const deck = isDeck(el);
  const items = (el.items ?? []).map(cardItem).slice(0, deck ? DECK_MAX : 8);
  const n = items.length;
  const cards = items.map((_, i) => `${el.id}_${i + 1}`);
  const texts = items.map((it) => it.text);
  // Round 5 §3.3: one resolved icon makes every card taller, so rows stay even.
  // (A formula's tiles are TeX; they carry no icons.)
  const icons = setHasIcons(el);
  // The text's font: 20 × the size; a plain card made shorter takes smaller text with it.
  const fontAt = (own: number, natural: number): number => Math.round(own * k * (icons ? 1 : Math.min(1, ch0 / natural)));

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
    const binBoxes: CardBox[] = Array.from({ length: nBlanks }, (_, b) => {
      const box = boxes?.[b];
      if (box) return { c: [box.x + box.w / 2, box.y + box.h / 2] as Pt, w: box.w, h: box.h };
      const i = truthBin.indexOf(b);
      return { c: (i >= 0 ? home[i] : [0, 0]) as Pt, w, h };
    });
    const binSlot = (b: number): Pt => binBoxes[b]?.c ?? [0, 0];
    const truth = truthBin.map((b, i) => (b >= 0 ? binSlot(b) : home[i]));
    return { ...base, cards, texts, truthBin, bins: binBoxes.map((_, b) => `blank_${b + 1}`), w, h, home, slots: home.slice(), binBoxes, binSlot, truth };
  }

  if (mode === "match") {
    const m = Math.min(6, n);
    const left = items.slice(0, m);
    const yTop = isNum(el.y) ? el.y : 560;
    const w = Math.min(260 * k, width / 2 - 60);
    const fit = fitCardTexts([...left.map((it) => it.text), ...left.map((it) => it.match ?? "")], w, fontAt(20, CARD_H * k), k);
    const CH = ch0 + fit.extra;
    const lx = x0 + w / 2, rx = x1 - w / 2;
    const rows = left.map((_, i) => yTop - i * (CH + gap));
    const perm = shuffleOrder(m, 11);
    const rightHome: Pt[] = new Array(m);
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
      pairs: m,
      ...textFields(fit, 20),
    };
  }

  if (mode === "compare") {
    const pairs = (Array.isArray(el.pairs) && el.pairs.length > 0 ? el.pairs : Array.from({ length: Math.floor(n / 2) }, (_, r) => [2 * r, 2 * r + 1]))
      .filter((p) => Array.isArray(p) && p.length === 2 && p.every((i) => Number.isInteger(i) && i >= 0 && i < n))
      .slice(0, 5) as [number, number][];
    const yTop = isNum(el.y) ? el.y : 560;
    const w = Math.min(240 * k, width / 2 - 80);
    const fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
    const CH = ch0 + fit.extra;
    const pos: Pt[] = items.map(() => [0, 0]);
    // A card used in two pairs stands in the first; pairs are rows.
    const placed = new Set<number>();
    pairs.forEach(([a, b], r) => {
      // A row: the card, its value under it, a gap (100 for plain cards).
      const y = yTop - r * (CH + 44 * k);
      if (!placed.has(a)) pos[a] = [x0 + width * 0.3, y];
      if (!placed.has(b)) pos[b] = [x0 + width * 0.7, y];
      placed.add(a).add(b);
    });
    return { ...base, cards, texts, w, h: CH, home: pos, slots: pos, truth: pos, values: items.map((it) => it.value ?? 0), rows: pairs, valueIds: items.map((_, i) => `${el.id}_v_${i + 1}`), ...textFields(fit, 20) };
  }

  if (mode === "place") {
    const sc = el.along ? scaleOf?.(el.along) : undefined;
    const sg = sc ? scaleGeometry(sc) : scaleGeometry({ id: "_", type: "scale", min: 0, max: 100, value: 50 });
    const values = items.map((it) => (isNum(it.value) ? it.value : sg.min));
    const span = sg.x1 - sg.x0;
    const perRow = n > 5 ? Math.ceil(n / 2) : n;
    const w = Math.min(150 * k, span / perRow - gap);
    const fit = fitCardTexts(texts, w, fontAt(20, PLACE_H * k), k);
    const h = ch0 + fit.extra;
    const slotW = span / perRow;
    // Under the line: clear of its tick labels (the scale's own size, not the cards').
    const trayTop = sg.y - 86 - h / 2;
    const tray: Pt[] = items.map((_, s) => [sg.x0 + slotW * ((s % perRow) + 0.5), trayTop - Math.floor(s / perRow) * (h + gap)] as Pt);
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
        let lv = levelEnd.findIndex((end) => end < x - w / 2 - 6 * k);
        if (lv < 0) {
          lv = levelEnd.length;
          levelEnd.push(-Infinity);
        }
        levelEnd[lv] = x + w / 2;
        out[i] = [x, sg.y + 40 + h / 2 + lv * (h + 8 * k)];
      }
      return out;
    };
    return { ...base, cards, texts, w, h, home, slots: tray, truth: placeAt(values), scale: sg, values, placeAt, ...textFields(fit, 20) };
  }

  const select = mode === "sort" && typeof el.select === "string" && !(Array.isArray(el.bins) && el.bins.length > 0);
  const bins = select ? [String(el.select)] : (el.bins ?? []).map(String).slice(0, 4);
  // select: an out card's truth is the row (-1).
  const truthBin = items.map((it) => (select ? (it.in === true ? 0 : -1) : Math.max(0, bins.indexOf(it.bin ?? ""))));
  const perm = shuffleOrder(n);
  if (deck) return deckGeometry(el, base, items.map((it) => it.text), truthBin, bins, perm, icons, x0, width, sortLayout(el, n), k);

  if (mode === "rank" && el.steps === true) {
    // Steps (spec/steps.ts): a row with room for an arrow between each two; a column when asked or when the row is too tight for the words.
    const row = stepsRow(n, x0, width, isNum(el.y) ? el.y : 380, k);
    const rowFit = fitCardTexts(texts, row.w, fontAt(20, CARD_H * k), k);
    const column = stepsColumn(el.arrange, rowFit.tooLong.length > 0, n);
    let slots = row.slots;
    let w = row.w;
    let fit = rowFit;
    if (column) {
      w = Math.min(340 * k, width);
      fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
      slots = stepsColumnSlots(n, (x0 + x1) / 2, isNum(el.y) ? el.y : 600, ch0 + fit.extra, k);
    }
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = slots[s]));
    return { ...base, cards, texts, w, h: ch0 + fit.extra, home, slots, truth: slots.slice(), arrows: stepsArrowIds(el.id, n), ...(column ? { column: true as const } : {}), ...textFields(fit, 20) };
  }

  if (mode === "rank") {
    const column = el.arrange === "column";
    let slots: Pt[];
    let w: number;
    let fit: CardTextFit;
    if (column) {
      const yTop = isNum(el.y) ? el.y : 600;
      w = Math.min(320 * k, width);
      fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
      const CH = ch0 + fit.extra;
      const cx = (x0 + x1) / 2;
      slots = items.map((_, i) => [cx, yTop - i * (CH + gap)] as Pt);
    } else {
      const y = isNum(el.y) ? el.y : 380;
      const slotW = width / Math.max(1, n);
      w = Math.min(190 * k, slotW - gap);
      fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
      slots = items.map((_, i) => [x0 + slotW * (i + 0.5), y] as Pt);
    }
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = slots[s]));
    return { ...base, cards, texts, w, h: ch0 + fit.extra, home, slots, truth: slots.slice(), ...textFields(fit, 20) };
  }

  if (select) {
    // One wide box; the cards it holds stand side by side in it (rows of as
    // many as fit), so every card can go in. drop (round 7 §5): the cards
    // above the box; side: a column on the left, the box on the right;
    // rise: the box above the cards, as before.
    const layout = sortLayout(el, n);
    const side = layout === "side";
    const perRow = side ? 1 : n > 5 ? Math.ceil(n / 2) : n;
    const slotW = side ? width / 3 : width / perRow;
    const bx0 = side ? x0 + width / 3 + gap : x0;
    const bWidth = x1 - bx0;
    const binW = bWidth - 2 * gap;
    const w = Math.min(180 * k, slotW - gap, binW - 20 * k);
    const cols = Math.max(1, Math.floor((binW - 12 * k) / (w + 10 * k)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const topY = isNum(el.y) ? el.y : CONTENT_TOP;
    const trayRows = Math.ceil(n / perRow);
    // Tap all: the cards are read where they stand, on a phone too (≥ ~10 px at 390 px).
    const fit = fitCardTexts(texts, w, fontAt(icons ? 22 : 26, CARD_H * k), k);
    const CH = ch0 + fit.extra;
    const binH = 44 * k + rows * (CH + 8 * k) + 8 * k;
    const boxTop = layout === "drop" ? topY - trayRows * (CH + gap) + gap - 40 * k : topY;
    const binBoxes: CardBox[] = [{ c: [bx0 + bWidth / 2, boxTop - binH / 2] as Pt, w: binW, h: binH }];
    const trayTop = layout === "rise" ? topY - binH - 40 * k : topY;
    const tray: Pt[] = items.map((_, s) =>
      (side ? [x0 + width / 6, trayTop - CH / 2 - s * (CH + gap)] : [x0 + slotW * ((s % perRow) + 0.5), trayTop - CH / 2 - Math.floor(s / perRow) * (CH + gap)]) as Pt,
    );
    const home: Pt[] = new Array(n);
    perm.forEach((card, s) => (home[card] = tray[s]));
    const binSlot = (_b: number, j: number): Pt => {
      const row = Math.floor(j / cols), col = j % cols;
      const inRow = Math.min(cols, n - row * cols);
      const box = binBoxes[0];
      return [box.c[0] + (col - (inRow - 1) / 2) * (w + 10 * k), box.c[1] + box.h / 2 - 44 * k - CH / 2 - row * (CH + 8 * k)];
    };
    let seen = 0;
    const truth = truthBin.map((b, i) => (b === 0 ? binSlot(0, seen++) : home[i]));
    return { ...base, mode, cards, texts, truthBin, bins, w, h: CH, home, slots: tray, binBoxes, binSlot, truth, select: true, layout, ...textFields(fit, 20), font: fit.font };
  }

  // Sort (round 7 §5): drop — the cards in a row (two when many) on top,
  // the boxes below; side — the cards a column on the left, the boxes on the
  // right; rise — the boxes on top, as before.
  const layout = sortLayout(el, n);
  const side = layout === "side";
  const nb = bins.length;
  // side: the tray takes a third — a quarter with 4 boxes, so their cards keep 20-unit text.
  const trayW = nb >= 4 ? width / 4 : width / 3;
  const bx0 = side ? x0 + trayW + gap : x0;
  const bWidth = x1 - bx0;
  const binW = bWidth / nb - 2 * gap;
  const perBin = bins.map((_, b) => truthBin.filter((t) => t === b).length);
  const perRow = side ? 1 : n > 5 ? Math.ceil(n / 2) : n;
  const slotW = side ? trayW : width / perRow;
  let w = Math.min(180 * k, slotW - gap, binW - 20 * k);
  // Any box may get every card (final fix wave E): its grid holds all n in
  // the old number of rows — more columns (the cards narrower, never under
  // 56) — and when even that is too many rows, shorter cards (fix round 2):
  // the boxes and the cards stay on the canvas. side: the boxes stand the
  // full height beside the column, so one column of wide cards fits.
  const room = side ? n : Math.max(2, ...perBin, Math.ceil(n / 2));
  let cols = 1;
  while (Math.ceil(n / cols) > room && (binW - 12 * k) / (cols + 1) - 10 * k >= 56 * k) {
    cols++;
    w = Math.min(w, (binW - 12 * k) / cols - 10 * k);
  }
  let rows = Math.max(room, Math.ceil(n / cols));
  const topY = isNum(el.y) ? el.y : CONTENT_TOP;
  const trayRows = Math.ceil(n / perRow);
  let fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
  let CH = ch0 + fit.extra;
  const boxH = (h: number): number => 52 * k + rows * (h + 8 * k);
  const trayH = (h: number): number => trayRows * (h + gap) - gap;
  // The lowest the cards or the boxes reach. side: the boxes keep the
  // counter's row under them; the column of cards needs none.
  const lowest = (h: number): number => (side ? Math.min(topY - boxH(h) - COUNTER_ROOM * k, topY - trayH(h)) : topY - boxH(h) - 40 * k - trayH(h));
  // Into the caption band (page frame 2026-10-04): more columns in each box —
  // the cards no narrower than 90 — before shorter cards.
  while (lowest(CH) < CARD_FLOOR && cols < n && (binW - 12 * k) / (cols + 1) - 10 * k >= 90 * k) {
    cols++;
    w = Math.min(w, (binW - 12 * k) / cols - 10 * k);
    rows = Math.max(2, Math.ceil(n / cols));
    fit = fitCardTexts(texts, w, fontAt(20, CARD_H * k), k);
    CH = ch0 + fit.extra;
  }
  let ch = CH;
  while (ch > 28 * k && lowest(ch) < CARD_FLOOR) ch -= 2;
  const binH = 44 * k + rows * (ch + 8 * k) + 8 * k;
  const boxTop = layout === "drop" ? topY - trayH(ch) - 40 * k : topY;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [bx0 + (bWidth / nb) * (b + 0.5), boxTop - binH / 2] as Pt, w: binW, h: binH }));
  const trayTop = layout === "rise" ? topY - binH - 40 * k : topY;
  const tray: Pt[] = items.map((_, s) =>
    (side ? [x0 + trayW / 2, trayTop - ch / 2 - s * (ch + gap)] : [x0 + slotW * ((s % perRow) + 0.5), trayTop - ch / 2 - Math.floor(s / perRow) * (ch + gap)]) as Pt,
  );
  const home: Pt[] = new Array(n);
  perm.forEach((card, s) => (home[card] = tray[s]));
  // Down the first column, then the next: a box holding no more than a
  // column's worth shows one centred column, as it always did.
  const binSlot = (b: number, j: number, count = 0): Pt => {
    const box = binBoxes[b];
    const col = Math.floor(j / rows), row = j % rows;
    const used = Math.max(1, Math.min(cols, Math.ceil(Math.max(count, j + 1) / rows)));
    return [box.c[0] + (col - (used - 1) / 2) * (w + 10 * k), box.c[1] + box.h / 2 - 44 * k - ch / 2 - row * (ch + 8 * k)];
  };
  const seen = bins.map(() => 0);
  const truth = truthBin.map((b) => binSlot(b, seen[b]++, perBin[b]));
  // Shorter cards, smaller text (narrow ones too); else the fitted size. An icon card keeps its text's size.
  const shrunk = !icons && (ch < CH || w < 90 * k) ? Math.round(Math.min(fit.font * (ch / CH), w < 90 * k ? 16 * k : fit.font)) : fit.font;
  return { ...base, mode, cards, texts, truthBin, bins, w, h: ch, home, slots: tray, binBoxes, binSlot, truth, layout, ...textFields({ ...fit, font: shrunk }, 20), ...(ch < CH ? { squeezed: true as const } : {}) };
}

/** A deck holds at most this many cards (round 6 §7). */
export const DECK_MAX = 30;
/** The lowest a deck's boxes reach: the canvas floor (see deckGeometry). */
const DECK_FLOOR = 8;

/**
 * deck (round 6 §7, round 7 §5): the boxes hold the cards small, in a
 * grid each (columns as the box's width and the most cards it may get
 * allow); the dealt card stands over the boxes (drop, default), on their
 * left (side) or under them (rise), drawn `deckScale` times larger. Every card is the same node, so
 * the truth and the plan stay plain offsets; only the gate and the movie
 * scale the dealt card. A deck's card text is one line (a word or two: the
 * deck-text lint); the size factor `k` scales its small cards and boxes.
 */
function deckGeometry(
  el: CardsElementLike,
  base: Pick<CardsGeometry, "id" | "mode" | "truthBin" | "bins" | "binBoxes" | "binSlot" | "each" | "k">,
  texts: string[],
  truthBin: number[],
  bins: string[],
  deal: number[],
  icons: boolean,
  x0: number,
  width: number,
  layout: "drop" | "side" | "rise",
  k: number,
): CardsGeometry {
  const n = texts.length;
  const nb = Math.max(1, bins.length);
  const side = layout === "side";
  // side: the boxes across the right two-thirds, the dealt card in the left third.
  const bx0 = side ? x0 + width / 3 + GAP * k : x0;
  const bWidth = x0 + width - bx0;
  const binW = bWidth / nb - 2 * GAP * k;
  // drop / side: the dealt card stays under the headline's strip (HEAD_ROOM_Y); rise: as before.
  const topY = isNum(el.y) ? el.y : layout === "rise" ? 720 : HEAD_ROOM_Y;
  const h0 = (icons ? CARD_H : 32) * k;
  const PAD = 8 * k, GX = 8 * k, GY = 6 * k, TITLE = 40 * k;
  // A deck still stands on the canvas floor, not over the caption band (page
  // frame 2026-10-04 — left as it was: at the band, a 30-card deck's boxes
  // lose a column and the dealt card half its size). The counter's row under.
  const floor = DECK_FLOOR + COUNTER_ROOM;
  // Room for the boxes: rise — the dealt card needs about 150 under them;
  // drop — about 150 over them; side — all of it.
  const maxH = layout === "rise" ? topY - 170 : layout === "drop" ? topY - 170 - floor : topY - floor;
  // Any box may get every card (final fix wave E): the grid holds all n —
  // more columns while the cards stay wide enough to read, then shorter cards.
  const cap = Math.max(1, n);
  const heightFor = (cols: number, h: number): number => TITLE + Math.ceil(cap / cols) * (h + GY) + PAD;
  const widthFor = (cols: number): number => Math.min(200 * k, (binW - 2 * PAD - (cols - 1) * GX) / cols);
  // The tallest card each column count allows (the card's own height at most).
  const fitH = (cols: number): number => Math.min(h0, Math.floor((maxH - TITLE - PAD) / Math.ceil(cap / cols) - GY));
  let cols = 1;
  // Columns before height: the boxes keep to about half the canvas when they can.
  const comfy = Math.min(maxH, 360);
  while (cols < 6 && heightFor(cols, h0) > comfy && widthFor(cols + 1) >= 80 * k) cols++;
  // Still too tall: as many more columns as make the cards tallest (no
  // narrower than 56), then shorter cards (never under 16), their text with them.
  for (let c = cols + 1; c <= 8 && fitH(cols) < h0 && widthFor(c) >= 56 * k; c++) if (fitH(c) > fitH(cols)) cols = c;
  const w = widthFor(cols);
  const rows = Math.ceil(cap / cols);
  const h = Math.max(16, fitH(cols));
  const binH = heightFor(cols, h);
  // drop: the boxes stand on the floor, the dealt card over them.
  const binTop = layout === "drop" ? floor + binH : topY;
  const binBoxes: CardBox[] = bins.map((_, b) => ({ c: [bx0 + (bWidth / nb) * (b + 0.5), binTop - binH / 2] as Pt, w: binW, h: binH }));
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
  // about 600 wide — on a 390 px phone its text is ~17 px — as tall as its room allows.
  let deckScale: number;
  let cx: number;
  let cy: number;
  if (layout === "rise") {
    // check: each — the counter stands just under the boxes: the dealt card keeps clear of it.
    const under = 24 + (base.each ? COUNTER_ROOM : 0);
    deckScale = Math.max(1, Math.min(600 / w, (icons ? 160 : 110) / h, (boxBottom - 16 - under) / h));
    const bigH = h * deckScale;
    cx = x0 + width / 2;
    cy = Math.max(bigH / 2 + 12, Math.min(boxBottom - bigH / 2 - under, boxBottom / 2));
  } else if (layout === "drop") {
    // Over the boxes: the dealt card flies down into one.
    // The counter stands in the gap between the dealt card and the boxes.
    deckScale = Math.max(1, Math.min(600 / w, (icons ? 160 : 110) / h, (topY - binTop - 64) / h));
    const bigH = h * deckScale;
    cx = x0 + width / 2;
    cy = Math.min(topY - bigH / 2 - 12, Math.max(binTop + bigH / 2 + 48, (topY + binTop) / 2));
  } else {
    // side: in the left third, level with the boxes.
    deckScale = Math.max(1, Math.min((width / 3 - GAP * k) / w, (icons ? 160 : 110) / h, (topY - floor) / h));
    cx = x0 + width / 6;
    cy = (topY + floor) / 2;
  }
  // Every card waits in the middle; only the top one is drawn (cardsElements:
  // the others are not the group's members — the deal shows each in turn).
  const home: Pt[] = deal.map(() => [cx, cy] as Pt);
  // The truth fills each box in the order the cards are dealt.
  const seen = bins.map(() => 0);
  const truth: Pt[] = new Array(n);
  for (const card of deal) truth[card] = binSlot(truthBin[card], seen[truthBin[card]]++);
  const cards = texts.map((_, i) => `${el.id}_${i + 1}`);
  // Never under 14 (the readable floor): an icon card's text included.
  const font = Math.max(14, Math.round((icons ? 14 : 15) * k * Math.min(1, h / h0)));
  return { ...base, cards, texts, truthBin, bins, w, h, home, slots: home.slice(), binBoxes, binSlot, truth, deck: true, deal, deckScale, font, layout };
}

/** The authored fields a cards group carries back (authoredCards). `size` is
 *  the number expandCards chose, so the gate and the plan draw the same set. */
const CARRIED = ["items", "rule", "bins", "ends", "steps", "arrange", "along", "compare", "pairs", "unit", "options", "then", "fill", "select", "deck", "check", "size", "x", "y", "width"] as const;

/** compare: the words over the cards — `title` as given; by default the
 *  question, unless the page has a heading of its own (page frame 2026-10-04:
 *  the two said the same thing twice). Null: none. */
export function compareTitle(el: Pick<CardsElementLike, "title" | "compare">, heading: boolean): string | null {
  if (el.title === false) return null;
  if (typeof el.title === "string") return el.title.trim() !== "" ? el.title : null;
  if (el.title === true || !heading) return typeof el.compare === "string" && el.compare.trim() !== "" ? el.compare : null;
  return null;
}

/** The ordinary elements a cards element stands for. */
export function cardsElements(el: CardsElementLike, scaleOf?: (id: string) => ScaleElementLike | undefined): SpecElement[] {
  const g = cardsGeometry(el, scaleOf);
  const k = g.k ?? 1;
  const out: SpecElement[] = [];
  const quiet = { color: "#7a7468" };
  const look = cardsLook(el);
  const looks = lookFields(look, el.style, k);
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
    g.binBoxes.forEach((b, i) => {
      const id = `${el.id}_bin_${i + 1}`;
      const l = b.c[0] - b.w / 2, r = b.c[0] + b.w / 2, t = b.c[1] + b.h / 2, btm = b.c[1] - b.h / 2;
      // An open box: no lid, so it reads as somewhere to put things.
      out.push({ id: `${id}_box`, type: "path", points: binPoints(l, r, t, btm, look, k), style: quiet });
      out.push({ id: `${id}_title`, type: "text", text: g.bins[i], x: b.c[0], y: t - 22 * k, font_size: Math.round(24 * k) });
      out.push({ id, type: "group", members: [`${id}_box`, `${id}_title`] });
    });
  }
  const title = g.mode === "compare" ? compareTitle(el, false) : null;
  if (title !== null) {
    const top = Math.max(...g.home.map((p) => p[1])) + g.h / 2 + 40 * k;
    out.push({ id: `${el.id}_title`, type: "text", text: title, x: 500, y: Math.min(720, top), font_size: Math.round(24 * k) });
  }
  // Steps: the numbered places, under the cards.
  if (g.arrows) out.push(...stepsSlotElements(el.id, g.slots, g.w, g.h, g.column === true, k));
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
    // Two lines (page frame 2026-10-04 §4): the node draws a "\n" as a line break.
    const text = g.lines?.[i]?.join("\n") ?? g.texts[i];
    out.push({ id, type: "node", shape: "rect", text, x: g.home[i][0], y: g.home[i][1], width: g.w, height: g.h, font_size: g.font ?? (g.mode === "decide" ? 24 : 20), ...looks, ...iconOf(i) });
  });
  if (g.arrows && Array.isArray(el.ends) && el.ends.length === 2) out.push(...stepsEnds(el.id, el.ends, g.slots, g.h, g.column === true, k));
  else if (g.mode === "rank" && Array.isArray(el.ends) && el.ends.length === 2) {
    const first = g.slots[0], last = g.slots[g.slots.length - 1];
    const column = el.arrange === "column";
    const at = (p: Pt, sign: 1 | -1): [number, number] => (column ? [p[0], p[1] + sign * (g.h / 2 + 22 * k)] : [p[0], p[1] - g.h / 2 - 26 * k]);
    const fs = Math.round(20 * k);
    out.push({ id: `${el.id}_end_1`, type: "text", text: column ? `↑ ${el.ends[0]}` : `← ${el.ends[0]}`, x: at(first, 1)[0], y: at(first, 1)[1], font_size: fs, style: quiet });
    out.push({ id: `${el.id}_end_2`, type: "text", text: column ? `↓ ${el.ends[1]}` : `${el.ends[1]} →`, x: at(last, -1)[0], y: at(last, -1)[1], font_size: fs, style: quiet });
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
      out.push({ id, type: "text", text: compareValueText(g.values![i], el.unit), x: g.home[i][0], y: g.home[i][1] - g.h / 2 - 20 * k, font_size: Math.round(20 * k), style: { color: "#3f6fb5" } });
    });
  }
  // Steps: the arrows stand outside the group — the answer draws them.
  if (g.arrows) out.push(...stepsArrows(el.id, g.slots, g.w, g.h, g.column === true, k));
  const keep: Record<string, unknown> = {};
  for (const f of CARRIED) {
    if (el[f] !== undefined) keep[f] = el[f];
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
    if (e.type !== "group" || !CARD_FIELDS.some((f) => Array.isArray(e[f])) || !(e.members ?? []).includes(first)) continue;
    const c: CardsElementLike = { id: e.id, type: "cards" };
    for (const f of CARRIED) {
      if (e[f] !== undefined) (c as unknown as Record<string, unknown>)[f] = e[f];
    }
    out.push(c);
  }
  return out;
}

/**
 * What moves with each card when the cards slide (page frame 2026-10-04): a
 * compare card's value, and the labels attached to a card (`attach_to`, with
 * their leaders). The player nudges them with their card, the plan offsets
 * them with it after the ask, and an erase or hide of the card takes the value.
 */
export function cardFollowers(spec: Pick<Spec, "elements">, g: Pick<CardsGeometry, "cards" | "valueIds">): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const cardIx = new Map(g.cards.map((c, i) => [c, i]));
  g.cards.forEach((c, i) => {
    const v = g.valueIds?.[i];
    if (v !== undefined) out[c] = [v];
  });
  for (const e of spec.elements ?? []) {
    const to = (e as { attach_to?: unknown }).attach_to;
    if (e.type !== "label" || typeof to !== "string" || !cardIx.has(to)) continue;
    (out[to] ??= []).push(e.id, `${e.id}_leader`);
  }
  return out;
}

/** The geometry of a spec's cards element by id — with its scale looked up and what follows each card. */
export function cardsGeometryIn(spec: Pick<Spec, "elements">, id: string, blanksOf?: BlanksOf, homesOf?: HomesOf): CardsGeometry | null {
  const el = authoredCards(spec).find((c) => c.id === id);
  if (!el) return null;
  const scales = authoredScales(spec);
  const g = cardsGeometry(el, (sid) => scales.find((s) => s.id === sid), blanksOf, homesOf);
  const followers = cardFollowers(spec, g);
  return Object.keys(followers).length > 0 ? { ...g, followers } : g;
}

/** Element types the cards may share the page with and still be alone on it: words about them. */
const WORDS = new Set(["text", "label", "annotation"]);

/** The page has a heading: a `card` command, a heading already expanded, or
 *  the default heading spec/card.ts pageHeading will draw (its rule: the
 *  title or `heading` text, unless `heading: false`, a book part, an end
 *  page, a page with no commands, or one already drawing in the strip). */
export function pageHasHeading(spec: Spec): boolean {
  if ((spec.commands ?? []).some((c) => (c as { card?: unknown }).card !== undefined)) return true;
  if ((spec.elements ?? []).some((e) => /^card_\d+_title$/.test(e.id) && e.y === HEADING_Y)) return true;
  return pageHeading(spec) !== null;
}

/** Alone on the page (page frame §3): nothing else drawn but words (text,
 *  labels, annotations) and — placing cards — the scale they go on. */
export function cardsAlone(el: CardsElementLike, spec: Pick<Spec, "elements" | "template">): boolean {
  if (spec.template) return false;
  const scale = cardsMode(el) === "place" ? el.along : undefined;
  return (spec.elements ?? []).every((e) => e.id === el.id || WORDS.has(e.type) || (scale !== undefined && (e.id === scale || e.id.startsWith(`${scale}_`))));
}

/** The largest size "auto" grows to, and its step. */
const AUTO_MAX = 1.6;
const AUTO_STEP = 0.05;

/**
 * `size: "auto"` (the default) as a number (page frame 2026-10-04 §3): cards
 * alone on the page take the largest size up to ×1.6 whose layout fits the
 * content area — under the heading, over the caption band, and over any words
 * the author put under the cards — whole: no card made shorter, no text made
 * smaller than its size. Moved to the middle of that room unless the author
 * gave `y`; across the content area's width unless they gave `x` or `width`.
 * With company, or when nothing fits, the element stays as it is (size 1).
 */
export function resolveCardsSize(el: CardsElementLike, spec: Pick<Spec, "elements" | "commands" | "title" | "template">, scaleOf?: (id: string) => ScaleElementLike | undefined): CardsElementLike {
  if (el.size !== undefined && el.size !== "auto") return el;
  const mode = cardsMode(el);
  if (mode === "fill" || isDeck(el) || !cardsAlone(el, spec)) return el;
  const heading = pageHasHeading(spec);
  const top = heading || (mode === "compare" && compareTitle(el, heading) !== null) ? CONTENT_TOP : CONTENT_TOP_BARE;
  const wide = isNum(el.x) || isNum(el.width) ? {} : { x: MARGIN, width: PAGE_W - 2 * MARGIN };
  // Words the author put under the cards (a gloss, a verdict): the cards stay over them.
  const under = cardsExtent(cardsGeometry({ ...el, ...wide, size: 1 }, scaleOf), el).bottom;
  let floor = CAPTION_TOP;
  for (const e of spec.elements ?? []) {
    if (e.type !== "text" || !isNum(e.y) || e.y >= under) continue;
    floor = Math.max(floor, e.y + (isNum(e.font_size) ? e.font_size : 28) * 0.65 + 12);
  }
  const y0 = isNum(el.y) ? null : defaultY(el);
  for (let s = Math.round(AUTO_MAX / AUTO_STEP); s >= Math.round(1 / AUTO_STEP); s--) {
    const k = Math.round(s * AUTO_STEP * 100) / 100;
    const cand: CardsElementLike = { ...el, ...wide, size: k };
    const g = cardsGeometryAt(cand, k, naturalH(cand, k), scaleOf);
    if (g.squeezed || (k > 1 && g.tooLong)) continue;
    const e = cardsExtent(g, cand);
    if (e.left < MARGIN - 0.5 || e.right > PAGE_W - MARGIN + 0.5) continue;
    if (y0 === null) {
      if (e.bottom >= floor && e.top <= top) return cand;
      continue;
    }
    if (e.top - e.bottom > top - floor) continue;
    return { ...cand, y: Math.round((y0 + (top + floor) / 2 - (e.top + e.bottom) / 2) * 10) / 10 };
  }
  return { ...el, ...wide };
}

export function expandCards(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some((e) => (e as { type: string }).type === "cards")) return spec;
  // Scales are expanded first (spec/expand.ts): their groups carry them. A
  // spec read before expansion (the lint) names its scales as authored.
  const scales = authoredScales(spec);
  const scaleOf = (sid: string): ScaleElementLike | undefined => scales.find((s) => s.id === sid) ?? (els.find((e) => e.id === sid && e.type === "scale") as unknown as ScaleElementLike | undefined);
  const heading = pageHasHeading(spec);
  const out: SpecElement[] = [];
  for (const el of els) {
    if ((el as { type: string }).type !== "cards") {
      out.push(el);
      continue;
    }
    const c = resolveCardsSize(el as unknown as CardsElementLike, spec, scaleOf);
    // A cast that draws or points at the title by name keeps it (casts written before 2026-10-04).
    const named = c.title === undefined && JSON.stringify(spec.commands ?? []).includes(`"${c.id}_title"`);
    out.push(...cardsElements({ ...c, title: named ? true : compareTitle(c, heading) ?? false }, scaleOf));
  }
  return { ...spec, elements: out };
}
