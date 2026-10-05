// A drawcast's card (card lab, 2026-10-05): the picture a listing shows, kept
// as TEXT. Two layers: the picture — the author's poster where it is public,
// else this drawing — and the marks over it (band, stamp, note, figures:
// netlify/lib/thumb.mts). The drawing is the engine's own laid-out drawing of
// the poster frame (layout/model.ts Drawable), simplified and compiled at
// publish (card/convert.ts), so the small renderer (card/draw.ts) only draws:
// no layout, no engine.
//
// Coordinates are the engine's logical canvas — 1000 × 750, y UP, integers.

import type { Corner, ThumbPlan } from "../../netlify/lib/thumb.mts";

export const CARD_VERSION = 1;
export const CARD_W = 1000;
export const CARD_H = 750;

/**
 * Points, compactly (round 2): integers as one string — the first point, then
 * each next point as its difference from the one before ("120 40 3 -2 5 0").
 * A line of 30 points is about a third of its JSON array. See card/points.ts.
 */
export type Pts = string;

/** A line or outline. */
export interface CardStroke {
  k: "s";
  p: Pts;
  /** Ink colour. */
  c: string;
  /** Stroke width. */
  w: number;
  /** rough.js roughness (0 = a clean line). */
  r: number;
  /** The wobble's seed (the engine's own, from the element id), so the card wobbles as the cast does. */
  sd: number;
  cl?: 1;
  /** Arrowhead: end, start, both. */
  a?: "e" | "s" | "b";
  hs?: number;
  /** Fill colour of a closed shape. */
  f?: string;
  o?: number;
  d?: 1;
  /** A true circle [cx, cy, r] or box [x, y, w, h] (the engine's shapeHint). */
  ci?: [number, number, number];
  rc?: [number, number, number, number];
}

/** A filled region. */
export interface CardArea {
  k: "a";
  p: Pts;
  /** Holes, painted even-odd: the counters of a formula's letters (an "o", an "8"). */
  hl?: Pts[];
  f: string;
  o: number;
  r: number;
  sd: number;
  /** Painted exactly (no hatching): glyph-like shapes, a formula's letters. */
  x?: 1;
}

export interface CardText {
  k: "t";
  x: number;
  y: number;
  t: string;
  /** Font size. */
  s: number;
  an: "s" | "m" | "e";
  c: string;
  /** Wrapped lines, when the engine wrapped it (pos is then the block's centre). */
  ls?: string[];
  tl?: number;
}

/**
 * An icon, centred at x, y. By NAME (`n`, an Iconify `set:name` such as
 * `twemoji:shark`) — the page fetches the drawings of every named icon on it
 * in one request (card/icons.ts) — or, for an icon the engine drew from data
 * of its own, its SVG as a data URL (`href`).
 */
export interface CardIcon {
  k: "i";
  x: number;
  y: number;
  w: number;
  h: number;
  n?: string;
  href?: string;
  o?: number;
}

export type CardItem = CardStroke | CardArea | CardText | CardIcon;

export interface CompiledCard {
  v: typeof CARD_VERSION;
  items: CardItem[];
  /** The marks (thumb.mts planThumb) and the corners they take, emptiest first — fixed at publish so they stand still when the poster replaces the drawing. */
  marks: ThumbPlan;
  corners: Corner[];
  /** The poster beside the cast (GitHub Pages), when public: it replaces the drawing once it has loaded. */
  poster?: string;
  /** 1: drawn from the cast's own thumbnail page (role: thumbnail) — its own picture, which no poster ever replaces. */
  own?: 1;
  /**
   * The picture under the words (2026-10-06): absent, the drawing — nothing
   * downloaded; "poster", the poster at `poster` (the author chose it, or the
   * drawing lost too much: a photo, a code-made chart, the size cap); or an
   * allowed image's address (thumb.mts pictureAllowed).
   */
  picture?: "poster" | string;
  /** The other thumbnails (2026-10-06): the cast's further thumbnail pages, each a whole card; the front page shows them in turn and counts which is clicked. */
  variants?: CompiledCard[];
}

/** What compiling a cast gave: the card, and what it had to leave out (for the lab's coverage table). */
export interface CardResult {
  card: CompiledCard;
  dropped: string[];
  /** The card's JSON without its icons' drawings (what the size cap counts). */
  bytes: number;
  /** The icons' drawings alone. */
  iconBytes: number;
}
