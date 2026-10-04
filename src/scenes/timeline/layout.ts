// Deterministic layout for the timeline template (rewritten 2026-09-29).
//
// A time axis with events placed by DATE, era bands beneath it, and labels
// that never overlap: the template's whole value is layout, so it does all
// of it here and the author only says what happened when.
//
//   title                                   (page furniture, top)
//
//        ┌──┐ 1972                           lanes of event labels, each a
//        │▒▒│ Grossman                       flag on a thin stem: thumbnail,
//        └──┘ demand for health              date, label, sublabel
//        │
//   ─────●───────●──────●────────────────▶   the axis (dots at the dates)
//       1960    1970   1980                  ticks, thinned to fit
//   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   eras, level 0 (widest band)
//   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   level 1, 2 … (thinner)
//
// Level of detail: events are placed in priority order into the lanes; one
// that cannot be placed without touching a label or a stem already there is
// drawn as a small dot on the axis instead, and a label that only just fits
// is drawn faint — so as a cast (or the paused viewer) zooms the `view` in,
// labels fade in as room appears, and nothing ever overlaps.
//
// The OLD form — `milestones`, 2–8 evenly spaced, no dates — still works:
// it is laid out the same calm way on an ordinal axis, with its old ids
// (`line`, `dot_<i>`, `label_<i>`, `title`) so existing casts keep drawing.

import { COLORS, SKETCH_MS, Z_STROKE, Z_TEXT, defaultDrawOpts, defaultStyle, type Drawable, type GroupDrawable, type Pt } from "../../layout/model";
import { decodePhoto } from "../../spec/trace";
import { segmentIntersectsBox, type BBox } from "../../layout/geometry";
import type { SceneCard, SceneLayout, TweenSpace } from "../types";
import { kit } from "../kit";
import { TEXT_MIN } from "../../layout/readable";
import { PRESENT, fromAxis, formatDate, parseDate, ticks as axisTicks, toAxis, type Scale } from "./dates";

export interface MilestoneSpec {
  label: string;
  sublabel?: string;
  emphasize?: boolean;
}

export interface TimelineEvent {
  id?: string;
  date: number | string;
  label: string;
  sublabel?: string;
  /** A picture's URL (resolved before layout into `strokes`). */
  image?: string;
  /** A person's name whose Wikipedia portrait to show (true = the label). */
  portrait?: string | boolean;
  links?: string[];
  cites?: string[];
  details?: string;
  /** 1 = always shown first; higher numbers give way when space is short. */
  priority?: number;
  emphasize?: boolean;
  /** The resolved picture (encodePhoto form) — filled by the resolver. */
  strokes?: string;
}

export interface TimelineEra {
  from: number | string;
  to: number | string;
  label?: string;
  /** 0 = the widest band (eon, age); deeper levels are thinner bands below it. */
  level?: number;
  color?: string;
}

export interface TimelineParams {
  title?: string;
  scale?: Scale;
  /** The year a log_ago axis counts back from (default 2000). */
  present?: number;
  events?: TimelineEvent[];
  eras?: TimelineEra[];
  /** The window on screen: from/to dates (default: everything). */
  view?: { from?: number | string; to?: number | string };
  /** Write each event's date above its label (default true). */
  show_dates?: boolean;
  start_label?: string;
  end_label?: string;
  /** The old form: 2–8 undated milestones, evenly spaced. */
  milestones?: MilestoneSpec[];
}

// ---------------------------------------------------------------------------
// Geometry constants (logical units, y-up)

/** The data span of the axis: a date at the view's edge lands here. */
export const AX0 = 70;
export const AX1 = 930;
/** Keep the composition above the caption band. */
const BOTTOM = 74;
const TOP_TITLED = 648;
const TOP_BARE = 712;
const TITLE_Y = 696;
/** Room under the axis for tick marks and their labels. */
const TICK_ZONE = 36;
/** First lane's bottom above the axis. */
const LANE_GAP0 = 20;
/** Vertical space between lanes. */
const LANE_PAD = 14;
/** Horizontal clearance between two labels in a lane. */
const MX = 18;
/** A label this many units clear of its nearest (more important) neighbour is fully opaque. */
const FADE_PX = 26;
// W30: era bands tall enough for their names at TEXT_MIN (were 32/25/21 with 18/16/14 names).
const ERA_H = [32, 26, 25];
const ERA_FS = [20, TEXT_MIN, TEXT_MIN];
const ERA_GAP = 3;
const FS_LABEL = 25;
const FS_EMPH = 27;
// W30: dates, subtitles, ticks and the axis ends at TEXT_MIN (dates were 17, ticks 16, ends 17).
const FS_DATE = TEXT_MIN;
const FS_SUB = TEXT_MIN;
const FS_TICK = TEXT_MIN;
const THUMB_H = 58;
/** Line pitch inside a label block: the text box (1.25 em) plus the lint's clearance. */
const LH = (fs: number): number => fs * 1.25 + 3;
const CANVAS_L = 10;
const CANVAS_R = 990;

/** Soft washes for eras, cycled per level when the author gives no colour. */
export const ERA_TONES = ["#e5c07b", "#9dbf9e", "#c3a6d8", "#e8a58d", "#94bfd6", "#d6c29a"];

const width = (s: string, fs: number): number => kit.textWidth(s, fs);

// ---------------------------------------------------------------------------
// Params → a model

interface Ev {
  key: string;
  index: number;
  year: number;
  label: string;
  sub?: string;
  date?: string;
  photo: { href: string; aspect: number; round: boolean } | null;
  rank: number;
  emph: boolean;
  /** Block size: thumbnail + text column. */
  w: number;
  h: number;
  thumbW: number;
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The part id for event i: `event_<id>` when the author gave a usable id, else `event_<i>`. */
export function eventIds(events: readonly { id?: unknown }[]): string[] {
  const seen = new Set<string>();
  return events.map((e, i) => {
    let id = typeof e.id === "string" && ID_RE.test(e.id) ? `event_${e.id}` : `event_${i}`;
    if (seen.has(id)) id = `event_${i}`;
    seen.add(id);
    return id;
  });
}

function scaleOf(p: TimelineParams): Scale {
  return p.scale === "log_ago" ? "log_ago" : "linear";
}

function presentOf(p: TimelineParams): number {
  return typeof p.present === "number" && Number.isFinite(p.present) ? p.present : PRESENT;
}

function blockOf(label: string, sub: string | undefined, date: string | undefined, emph: boolean, photo: Ev["photo"]): { w: number; h: number; thumbW: number } {
  const fs = emph ? FS_EMPH : FS_LABEL;
  const textW = Math.max(width(label, fs), date ? width(date, FS_DATE) : 0, sub ? width(sub, FS_SUB) : 0);
  const textH = (date ? LH(FS_DATE) : 0) + LH(fs) + (sub ? LH(FS_SUB) : 0);
  const thumbW = photo ? Math.max(36, Math.min(66, THUMB_H / photo.aspect)) : 0;
  return { w: thumbW + (photo ? 8 : 0) + textW + 4, h: Math.max(photo ? THUMB_H : 0, textH), thumbW };
}

/** Events with readable dates, as the layout needs them (input order kept). */
export function readEvents(p: TimelineParams): Ev[] {
  const scale = scaleOf(p);
  const present = presentOf(p);
  const list = Array.isArray(p.events) ? p.events : [];
  const ids = eventIds(list);
  const showDates = p.show_dates !== false;
  const out: Ev[] = [];
  list.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const year = parseDate(e.date, present);
    if (year === null) return;
    const label = typeof e.label === "string" ? e.label.trim() : "";
    const sub = typeof e.sublabel === "string" && e.sublabel.trim() !== "" ? e.sublabel.trim() : undefined;
    const photoRaw = typeof e.strokes === "string" ? decodePhoto(e.strokes) : null;
    const photo = photoRaw ? { ...photoRaw, round: !!e.portrait } : null;
    const emph = e.emphasize === true;
    const date = showDates ? formatDate(scale, year, present) : undefined;
    const pr = typeof e.priority === "number" && Number.isFinite(e.priority) ? e.priority : emph ? 1 : 2;
    out.push({ key: ids[i], index: i, year, label, sub, date, photo, rank: pr, emph, ...blockOf(label, sub, date, emph, photo) });
  });
  return out;
}

interface EraM {
  id: string;
  from: number;
  to: number;
  label: string;
  level: number;
  color: string;
}

function readEras(p: TimelineParams): EraM[] {
  const present = presentOf(p);
  const list = Array.isArray(p.eras) ? p.eras : [];
  const perLevel = new Map<number, number>();
  const out: EraM[] = [];
  list.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const a = parseDate(e.from, present);
    const b = parseDate(e.to, present);
    if (a === null || b === null || a === b) return;
    const level = typeof e.level === "number" && e.level >= 0 ? Math.min(4, Math.floor(e.level)) : 0;
    const k = perLevel.get(level) ?? 0;
    perLevel.set(level, k + 1);
    const color = typeof e.color === "string" && e.color.trim() !== "" ? e.color : ERA_TONES[(k + level * 2) % ERA_TONES.length];
    out.push({ id: `era_${i}`, from: Math.min(a, b), to: Math.max(a, b), label: typeof e.label === "string" ? e.label.trim() : "", level, color });
  });
  return out;
}

/**
 * The whole data extent (padded) — the default view — as calendar years.
 * On log_ago the padding is in the axis's own (log) units.
 */
export function dataExtent(p: TimelineParams): [number, number] {
  const scale = scaleOf(p);
  const present = presentOf(p);
  const years: number[] = [];
  for (const e of readEvents(p)) years.push(e.year);
  for (const e of readEras(p)) years.push(e.from, e.to);
  if (years.length === 0) return scale === "log_ago" ? [present - 1e9, present - 1] : [present - 10, present];
  let lo = Math.min(...years);
  let hi = Math.max(...years);
  if (scale === "log_ago") {
    let u0 = toAxis(scale, lo, present);
    let u1 = toAxis(scale, Math.min(hi, present - 1), present);
    if (u1 - u0 < 0.5) {
      u0 -= 0.25;
      u1 += 0.25;
    }
    const pad = (u1 - u0) * 0.03;
    return [fromAxis(scale, u0 - pad, present), Math.min(present - 1, fromAxis(scale, u1 + pad, present))];
  }
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const pad = (hi - lo) * 0.04;
  return [lo - pad, hi + pad];
}

/** The view on screen, as calendar years (from < to), in the scale's own terms. */
export function viewOf(p: TimelineParams): [number, number] {
  const scale = scaleOf(p);
  const present = presentOf(p);
  const [d0, d1] = dataExtent(p);
  const v = p.view && typeof p.view === "object" ? p.view : {};
  let a = parseDate(v.from, present) ?? d0;
  let b = parseDate(v.to, present) ?? d1;
  if (a > b) [a, b] = [b, a];
  if (scale === "log_ago") {
    b = Math.min(b, present - 1);
    if (!(a < b)) a = b - 10;
  } else if (!(b - a > 1e-6)) {
    b = a + 1;
  }
  return [a, b];
}

// ---------------------------------------------------------------------------
// Placement

export interface Placed {
  lane: number;
  /** Block rectangle (y-up). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** "r": flag to the right of the stem; "l": to its left; "c": centred over it. */
  side: "r" | "l" | "c";
  /** 0..1 — how clear of its more important neighbours the label is. */
  opacity: number;
  /** Where the leader meets the label (x): the date's own x unless it leans. */
  ax: number;
}

interface PlaceIn {
  key: string;
  x: number;
  w: number;
  h: number;
  rank: number;
  emph: boolean;
  index: number;
}

/**
 * Place labels into lanes above the axis, most important first. Returns a
 * placement per key, or none for an event that becomes a dot. Pure: the
 * same inputs always give the same picture (and the tests pin it).
 */
export function placeLabels(items: readonly PlaceIn[], axisY: number, pitch: number, lanes: number, mode: "flag" | "center", below = 0): Map<string, Placed> {
  const order = [...items].sort((a, b) => a.rank - b.rank || Number(b.emph) - Number(a.emph) || a.index - b.index);
  const minRank = order.length > 0 ? order[0].rank : 0;
  let best = placeInOrder(order, minRank, axisY, pitch, lanes, mode, below);
  // Greedy placement can box in a top-priority event (an emphasized one
  // placed first takes the lane it needed): retry with the ones left out
  // placed first, and keep whichever shows more of the top priority.
  const score = (m: Map<string, Placed>): number => order.filter((o) => o.rank === minRank && m.has(o.key)).length * 1000 + m.size;
  for (let round = 0; round < 3; round++) {
    const missing = order.filter((o) => o.rank === minRank && !best.has(o.key));
    if (missing.length === 0) break;
    const next = placeInOrder([...missing, ...order.filter((o) => !missing.includes(o))], minRank, axisY, pitch, lanes, mode, below);
    if (score(next) <= score(best)) break;
    best = next;
  }
  return best;
}

function placeInOrder(order: readonly PlaceIn[], minRank: number, axisY: number, pitch: number, lanes: number, mode: "flag" | "center", below: number): Map<string, Placed> {
  // Lanes above the axis are 0, 1, 2 …; lanes below it (the milestones
  // form, which has no ticks or eras there) are −1, −2 … — tried in turn,
  // so labels alternate sides before they climb.
  const laneList: number[] = [];
  for (let k = 0; k < Math.max(lanes, below); k++) {
    if (k < lanes) laneList.push(k);
    if (k < below) laneList.push(-(k + 1));
  }
  const placed: { key: string; x: number; p: Placed; leader: [Pt, Pt] }[] = [];
  const out = new Map<string, Placed>();
  const done = new Set<string>();
  const sides: ("r" | "l" | "c")[] = mode === "center" ? ["c"] : ["r", "l"];
  // A leader may lean a little when the straight stem is blocked: the label
  // slides sideways, never far from its date.
  const shifts = mode === "center" ? [0, 24, -24, 48, -48] : [0, 26, -26, 56, -56, 90, -90, 130, -130, 180, -180];
  const grow = (b: { x0: number; x1: number; y0: number; y1: number }, d: number): BBox => ({ x: b.x0 - d, y: b.y0 - d, w: b.x1 - b.x0 + 2 * d, h: b.y1 - b.y0 + 2 * d });
  for (const it of order) {
    let best: { p: Placed; leader: [Pt, Pt] } | null = null;
    let bestCost = Infinity;
    // Stems of events not yet placed: a label low down that covers them
    // leaves them nowhere to go (a staircase keeps them free).
    const waiting = order.filter((o) => o !== it && !done.has(o.key)).map((o) => o.x);
    for (const k of laneList) {
      const up = k >= 0;
      const g0 = mode === "center" ? LANE_GAP0 + 10 : LANE_GAP0;
      const y0 = up ? axisY + g0 + k * pitch : axisY - g0 - (-k - 1) * pitch - it.h;
      const y1 = y0 + it.h;
      const depth = up ? k : -k - 0.5;
      for (const side of sides) {
        for (const dx of shifts) {
          const ax = it.x + dx;
          const x0 = side === "r" ? ax : side === "l" ? ax - it.w : ax - it.w / 2;
          const x1 = x0 + it.w;
          if (x0 < CANVAS_L || x1 > CANVAS_R) continue;
          const cost0 = depth + Math.abs(dx) / 45 + (side === "l" ? 0.15 : 0);
          if (cost0 >= bestCost) continue;
          const foot: Pt = [it.x, up ? axisY + 5 : axisY - 5];
          const head: Pt = [ax, !up ? y1 + 2 : side === "c" ? y0 - 2 : y0 + Math.min(8, it.h / 3)];
          const box = { x0, x1, y0, y1 };
          let gap = Infinity;
          let ok = true;
          for (const q of placed) {
            if (q.p.lane === k) {
              const g = Math.max(q.p.x0 - x1, x0 - q.p.x1);
              if (g < MX) {
                ok = false;
                break;
              }
              gap = Math.min(gap, g - MX);
            }
            // Their leader must miss this label; this leader must miss theirs.
            if (segmentIntersectsBox(q.leader[0], q.leader[1], grow(box, 5)) || segmentIntersectsBox(foot, head, grow(q.p, 5))) {
              ok = false;
              break;
            }
            // Leaders never cross, and never run so close they read as one.
            if (segmentsCross(foot, head, q.leader[0], q.leader[1]) || Math.abs(q.x - it.x) < 5) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          let covered = 0;
          for (const wx of waiting) if (wx >= x0 - 6 && wx <= x1 + 6) covered++;
          const cost = cost0 + covered * (k === 0 ? 2 : k === -1 ? 0.6 : 0.3 / Math.abs(depth));
          if (cost >= bestCost) continue;
          const opacity = it.rank <= minRank || it.emph || mode === "center" ? 1 : 0.7 + 0.3 * Math.max(0, Math.min(1, gap / FADE_PX));
          best = { p: { lane: k, x0, x1, y0, y1, side, opacity, ax }, leader: [foot, head] };
          bestCost = cost;
        }
      }
    }
    done.add(it.key);
    if (best) {
      placed.push({ key: it.key, x: it.x, p: best.p, leader: best.leader });
      out.set(it.key, best.p);
    }
  }
  return out;
}

/** Proper crossing of two segments (touching ends do not count). */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** How many lanes placing every item needs (capped): the budget the axis is centred for. */
function lanesNeeded(items: readonly PlaceIn[], pitch: number, cap: number, mode: "flag" | "center"): number {
  const all = placeLabels(items, 0, pitch, cap, mode);
  let n = 0;
  for (const p of all.values()) n = Math.max(n, p.lane + 1);
  return Math.max(1, n);
}

// ---------------------------------------------------------------------------
// Drawing helpers

const text = (id: string, pos: Pt, s: string, fs: number, color: string, anchor: "start" | "middle" | "end", opacity = 1): Drawable => ({
  ...kit.text(id, pos, s, { fontSize: fs, color, anchor, ...(opacity < 1 ? { opacity } : {}) }),
  z: Z_TEXT,
});

const group = (id: string, children: Drawable[]): GroupDrawable => ({ id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children });

function dot(id: string, c: Pt, r: number, color: string, opacity = 1): Drawable {
  return kit.stroke(id, kit.polygon(c, r, 10), { closed: true, color, fill: color, strokeWidth: 1.6, ms: SKETCH_MS.dot, ...(opacity < 1 ? { opacity } : {}) });
}

/** The label block's drawables for an event: thumbnail, date, label, sublabel. */
function blockDrawables(id: string, e: { label: string; sub?: string; date?: string; photo: Ev["photo"]; emph: boolean; thumbW: number }, p: Placed, opacity: number): Drawable[] {
  const out: Drawable[] = [];
  const color = e.emph ? COLORS.accent : COLORS.ink;
  const fs = e.emph ? FS_EMPH : FS_LABEL;
  const lines: { s: string; fs: number; color: string; key: string }[] = [];
  if (e.date) lines.push({ s: e.date, fs: FS_DATE, color: COLORS.guide, key: "date" });
  lines.push({ s: e.label, fs, color, key: "label" });
  if (e.sub) lines.push({ s: e.sub, fs: FS_SUB, color: COLORS.guide, key: "sub" });
  const textH = lines.reduce((s, l) => s + LH(l.fs), 0);
  const blockH = p.y1 - p.y0;
  // Text column: beside the thumbnail, on the side away from the stem.
  const hasThumb = !!e.photo;
  const inset = 8;
  let tx: number;
  let anchor: "start" | "middle" | "end";
  if (p.side === "c") {
    tx = hasThumb ? p.x0 + e.thumbW + 8 : (p.x0 + p.x1) / 2;
    anchor = hasThumb ? "start" : "middle";
  } else if (p.side === "r") {
    tx = p.x0 + inset + (hasThumb ? e.thumbW + 8 : 0);
    anchor = "start";
  } else {
    tx = p.x1 - inset - (hasThumb ? e.thumbW + 8 : 0);
    anchor = "end";
  }
  if (hasThumb && e.photo) {
    const tw = e.thumbW;
    const tx0 = p.side === "l" ? p.x1 - tw : p.side === "r" ? p.x0 + inset : p.x0;
    const ty0 = p.y0 + (blockH - THUMB_H) / 2;
    const c: Pt = [tx0 + tw / 2, ty0 + THUMB_H / 2];
    out.push({
      id: `${id}__thumb`,
      kind: "image",
      href: e.photo.href,
      pos: c,
      w: tw,
      h: THUMB_H,
      reveal: "develop",
      z: Z_STROKE,
      style: defaultStyle({ opacity }),
      drawOpts: defaultDrawOpts("fade", 500),
    });
    out.push(kit.stroke(`${id}__frame`, kit.rect(tx0, ty0, tw, THUMB_H), { closed: true, color: COLORS.ink, strokeWidth: 1.4, ms: 300, ...(opacity < 1 ? { opacity } : {}) }));
  }
  // Text lines stacked from the block's top, vertically centred against the thumbnail.
  let y = p.y0 + (blockH + textH) / 2;
  for (const l of lines) {
    const h = LH(l.fs);
    out.push(text(`${id}__${l.key}`, [tx, y - h / 2], l.s, l.fs, l.color, anchor, opacity));
    y -= h;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The layout

export function layoutTimeline(params: TimelineParams): SceneLayout {
  const P = (params ?? {}) as TimelineParams;
  if (!Array.isArray(P.events) || P.events.length === 0) {
    if (Array.isArray(P.milestones) && P.milestones.length > 0) return layoutMilestones(P);
  }
  return layoutDated(P);
}

/** Vertical frame shared by both forms: where the axis sits and how many lanes fit. */
function verticalFrame(title: boolean, eraLevels: number, pitch: number, lanesWanted: (cap: number) => number): { axisY: number; lanes: number; stripTop: number } {
  const top = title ? TOP_TITLED : TOP_BARE;
  let stripH = 0;
  for (let l = 0; l < eraLevels; l++) stripH += ERA_H[Math.min(l, ERA_H.length - 1)] + ERA_GAP;
  const axisMin = BOTTOM + stripH + TICK_ZONE;
  const cap = Math.max(1, Math.floor((top - axisMin - LANE_GAP0 + LANE_PAD) / pitch));
  const lanes = Math.min(cap, lanesWanted(cap));
  const height = stripH + TICK_ZONE + LANE_GAP0 + lanes * pitch - LANE_PAD;
  const free = Math.max(0, top - BOTTOM - height);
  const axisY = axisMin + free * 0.5;
  return { axisY, lanes: cap, stripTop: axisY - TICK_ZONE };
}

function layoutDated(P: TimelineParams): SceneLayout {
  const scale = scaleOf(P);
  const present = presentOf(P);
  const events = readEvents(P);
  const eras = readEras(P);
  const [v0, v1] = viewOf(P);
  const u0 = toAxis(scale, v0, present);
  const u1 = toAxis(scale, v1, present);
  const xOfU = (u: number): number => AX0 + ((u - u0) / (u1 - u0)) * (AX1 - AX0);
  const xOf = (year: number): number => xOfU(toAxis(scale, year, present));

  const drawables: Drawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};
  const push = (d: Drawable): void => {
    drawables.push(d);
    order.push(d.id);
  };

  // Lanes: pitch from the tallest block, the budget from placing every
  // event over the WHOLE data extent — independent of the view, so the axis
  // does not jump while a cast zooms.
  const pitch = Math.max(40, ...events.map((e) => e.h)) + LANE_PAD;
  const levels = eras.length > 0 ? Math.max(...eras.map((e) => e.level)) + 1 : 0;
  const [d0, d1] = dataExtent(P);
  const du0 = toAxis(scale, d0, present);
  const du1 = toAxis(scale, d1, present);
  const xFull = (year: number): number => AX0 + ((toAxis(scale, year, present) - du0) / (du1 - du0)) * (AX1 - AX0);
  const fullItems = events.map((e) => ({ key: e.key, x: xFull(e.year), w: e.w, h: e.h, rank: e.rank, emph: e.emph, index: e.index }));
  const vf = verticalFrame(!!P.title, levels, pitch, (cap) => lanesNeeded(fullItems, pitch, cap, "flag"));
  const A = vf.axisY;

  // ---- title
  if (P.title) {
    push(kit.text("title", [500, TITLE_Y], P.title, { fontSize: 30 }));
    anchors["title"] = [500, TITLE_Y];
  }

  // ---- axis: the line, its ticks (thinned by width, roundest first)
  const axisKids: Drawable[] = [kit.stroke("axis__line", [[AX0 - 22, A], [AX1 + 26, A]], { arrowhead: "end", strokeWidth: 2.6, ms: SKETCH_MS.axis })];
  const reserved: [number, number][] = [];
  if (P.start_label) {
    const w = width(P.start_label, FS_TICK);
    axisKids.push(text("axis__start", [AX0 - 22, A - 21], P.start_label, FS_TICK, COLORS.guide, "start"));
    reserved.push([AX0 - 22, AX0 - 22 + w]);
  }
  if (P.end_label) {
    const w = width(P.end_label, FS_TICK);
    axisKids.push(text("axis__end", [AX1 + 26, A - 21], P.end_label, FS_TICK, COLORS.guide, "end"));
    reserved.push([AX1 + 26 - w, AX1 + 26]);
  }
  const cands = axisTicks(scale, v0, v1, present)
    .map((t) => ({ ...t, x: xOf(t.year) }))
    .filter((t) => t.x >= AX0 - 1 && t.x <= AX1 + 1);
  const kept: { x0: number; x1: number }[] = [...reserved.map(([a, b]) => ({ x0: a, x1: b }))];
  const chosen: typeof cands = [];
  for (const t of [...cands].sort((a, b) => a.rank - b.rank || a.x - b.x)) {
    const w = width(t.label, FS_TICK);
    const box = { x0: t.x - w / 2 - 10, x1: t.x + w / 2 + 10 };
    if (box.x0 < CANVAS_L || box.x1 > CANVAS_R) continue;
    if (kept.some((k) => box.x0 < k.x1 && box.x1 > k.x0)) continue;
    kept.push(box);
    chosen.push(t);
  }
  chosen.sort((a, b) => a.x - b.x);
  chosen.forEach((t, i) => {
    axisKids.push(kit.stroke(`axis__tick_${i}`, [[t.x, A], [t.x, A - 7]], { color: COLORS.guide, strokeWidth: 1.6, ms: 120 }));
    axisKids.push(text(`axis__tick_${i}_label`, [t.x, A - 20], t.label, FS_TICK, COLORS.guide, "middle"));
  });
  push(group("axis", axisKids));
  anchors["axis"] = [(AX0 + AX1) / 2, A];

  // ---- eras: bands beneath the tick labels, level 0 on top
  const levelY: number[] = [];
  {
    let y = vf.stripTop;
    for (let l = 0; l < levels; l++) {
      const h = ERA_H[Math.min(l, ERA_H.length - 1)];
      levelY.push(y - h); // band bottom
      y -= h + ERA_GAP;
    }
  }
  const eraIds: string[] = [];
  for (const era of eras) {
    const xa = Math.max(AX0, xOf(era.from));
    const xb = Math.min(AX1, xOf(era.to));
    const h = ERA_H[Math.min(era.level, ERA_H.length - 1)];
    const y0 = levelY[era.level];
    const kids: Drawable[] = [];
    if (xb - xa >= 1.5) {
      kids.push(kit.area(`${era.id}__band`, kit.rect(xa, y0, xb - xa, h), era.color, { opacity: 0.5, ms: 500 }));
      kids.push(kit.stroke(`${era.id}__edge`, kit.rect(xa, y0, xb - xa, h), { closed: true, color: era.color, strokeWidth: 1.3, ms: 400, opacity: 0.9 }));
      const fs = ERA_FS[Math.min(era.level, ERA_FS.length - 1)];
      const fitted = fitText(era.label, fs, xb - xa - 10);
      if (fitted) kids.push(text(`${era.id}__label`, [(xa + xb) / 2, y0 + h / 2], fitted, fs, COLORS.ink, "middle"));
      anchors[era.id] = [(xa + xb) / 2, y0 + h / 2];
    }
    push(group(era.id, kids));
    eraIds.push(era.id);
  }

  // ---- events
  const visibleEvents = events.filter((e) => {
    const x = xOf(e.year);
    return x >= AX0 - 0.5 && x <= AX1 + 0.5;
  });
  const items = visibleEvents.map((e) => ({ key: e.key, x: xOf(e.year), w: e.w, h: e.h, rank: e.rank, emph: e.emph, index: e.index }));
  const placed = placeLabels(items, A, pitch, vf.lanes, "flag");
  const byDate = [...events].sort((a, b) => a.year - b.year || a.index - b.index);
  const eventIdsOut: string[] = [];
  for (const e of byDate) {
    const x = xOf(e.year);
    const inView = x >= AX0 - 0.5 && x <= AX1 + 0.5;
    const kids: Drawable[] = [];
    const p = inView ? placed.get(e.key) : undefined;
    const color = e.emph ? COLORS.accent : COLORS.ink;
    if (inView && p) {
      const op = p.opacity;
      kids.push(dot(`${e.key}__dot`, [x, A], e.emph ? 6.5 : 5, color));
      // A flag's pole runs up the label's edge to its top; a centred label sits on its stem.
      const pole: Pt[] = p.side === "c" ? [[x, A + 5], [p.ax, p.y0 - 2]] : p.ax === x ? [[x, A + 5], [x, p.y1 - 3]] : [[x, A + 5], [p.ax, p.y0], [p.ax, p.y1 - 3]];
      kids.push(kit.stroke(`${e.key}__stem`, pole, { color: COLORS.guide, strokeWidth: 1.4, ms: 260, ...(op < 1 ? { opacity: Math.max(0.25, op) } : {}) }));
      kids.push(...blockDrawables(e.key, e, p, op));
    } else if (inView) {
      kids.push(dot(`${e.key}__dot`, [x, A], 3.4, e.emph ? COLORS.accent : COLORS.guide));
    }
    push(group(e.key, kids));
    eventIdsOut.push(e.key);
    anchors[e.key] = [x, A];
  }

  const frame = {
    x: [u0, u1] as [number, number],
    y: [BOTTOM - A, 750 - A] as [number, number],
    box: { x0: AX0, x1: AX1, y0: BOTTOM, y1: 750 },
  };
  return {
    drawables,
    labels: [],
    anchors,
    order,
    frame,
    groups: { events: eventIdsOut, eras: eraIds },
  };
}

/** The label if it fits in `room`, else shortened with an ellipsis, else nothing. */
export function fitText(s: string, fs: number, room: number): string | null {
  if (!s) return null;
  if (width(s, fs) <= room) return s;
  for (let n = s.length - 1; n >= 3; n--) {
    const t = `${s.slice(0, n).trimEnd()}…`;
    if (width(t, fs) <= room) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The old form: undated milestones on an ordinal axis

function layoutMilestones(P: TimelineParams): SceneLayout {
  const ms = (P.milestones ?? []).slice(0, 8).filter((m) => m && typeof m.label === "string");
  const n = ms.length;
  const drawables: Drawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};
  const attached: Record<string, string[]> = {};
  const push = (d: Drawable): void => {
    drawables.push(d);
    order.push(d.id);
  };
  const blocks = ms.map((m) => blockOf(m.label, m.sublabel, undefined, m.emphasize === true, null));
  // The ends need half a label of room: spread between them.
  const half = (i: number): number => (blocks[i] ? blocks[i].w / 2 : 0);
  const left = Math.max(AX0 + 20, CANVAS_L + half(0) + 6);
  const right = Math.min(AX1 - 20, CANVAS_R - half(n - 1) - 6);
  const xs = ms.map((_, i) => (n <= 1 ? 500 : left + ((right - left) * i) / (n - 1)));
  const pitch = Math.max(40, ...blocks.map((b) => b.h)) + LANE_PAD;
  const items = ms.map((m, i) => ({ key: String(i), x: xs[i], w: blocks[i].w, h: blocks[i].h, rank: 1, emph: m.emphasize === true, index: i }));
  // Labels alternate above and below the line (there are no ticks or eras
  // here); place them about a trial axis, then centre what they need.
  const top = P.title ? TOP_TITLED : TOP_BARE;
  const mid = (top + BOTTOM) / 2;
  const half2 = (top - BOTTOM) / 2;
  const capSide = Math.max(1, Math.floor((half2 - LANE_GAP0 + LANE_PAD) / pitch));
  let placed = placeLabels(items, mid, pitch, capSide, "center", capSide);
  for (let extra = 1; placed.size < n && extra <= 6; extra++) placed = placeLabels(items, mid, pitch, capSide + extra, "center", capSide);
  let lo = mid - 12;
  let hi = mid + 12;
  for (const p of placed.values()) {
    lo = Math.min(lo, p.y0);
    hi = Math.max(hi, p.y1);
  }
  const shift = (top + BOTTOM) / 2 - (lo + hi) / 2;
  for (const p of placed.values()) {
    p.y0 += shift;
    p.y1 += shift;
  }
  const A = mid + shift;

  const lineKids: Drawable[] = [kit.stroke("line__arrow", [[AX0 - 10, A], [AX1 + 20, A]], { arrowhead: "end", strokeWidth: 2.8, ms: SKETCH_MS.axis })];
  if (P.start_label) lineKids.push(text("line__start", [AX0 - 10, A - 22], P.start_label, 18, COLORS.guide, "start"));
  if (P.end_label) lineKids.push(text("line__end", [AX1 + 20, A - 22], P.end_label, 18, COLORS.guide, "end"));
  push(group("line", lineKids));
  anchors["line"] = [(AX0 + AX1) / 2, A];

  ms.forEach((m, i) => {
    const emph = m.emphasize === true;
    const color = emph ? COLORS.accent : COLORS.ink;
    const c: Pt = [xs[i], A];
    push(dot(`dot_${i}`, c, emph ? 9 : 6.5, color));
    anchors[`dot_${i}`] = c;
    const p = placed.get(String(i));
    const kids: Drawable[] = [];
    if (p) {
      const up = p.y0 > A;
      kids.push(kit.stroke(`label_${i}__stem`, up ? [[c[0], A + 8], [p.ax, p.y0 - 2]] : [[c[0], A - 8], [p.ax, p.y1 + 2]], { color: COLORS.guide, strokeWidth: 1.4, ms: 240 }));
      kids.push(...blockDrawables(`label_${i}`, { label: m.label, sub: m.sublabel, photo: null, emph, thumbW: 0 }, p, 1));
      anchors[`label_${i}`] = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2];
    }
    push(group(`label_${i}`, kids));
    attached[`dot_${i}`] = [`label_${i}`];
  });

  if (P.title) {
    push(kit.text("title", [500, TITLE_Y], P.title, { fontSize: 30 }));
    anchors["title"] = [500, TITLE_Y];
  }
  return { drawables, labels: [], anchors, order, attached };
}

// ---------------------------------------------------------------------------
// What the rest of the app reads from params (registry.ts)

/** Info cards for events and eras: name, links, details, cited sources, the portrait's person. */
export function timelineCards(p: TimelineParams): Record<string, SceneCard> {
  const out: Record<string, SceneCard> = {};
  const list = Array.isArray(p?.events) ? p.events : [];
  const ids = eventIds(list);
  list.forEach((e, i) => {
    if (!e || typeof e !== "object" || typeof e.label !== "string") return;
    const person = typeof e.portrait === "string" && e.portrait.trim() !== "" ? e.portrait.trim() : e.portrait === true ? e.label.trim() : undefined;
    const links = (Array.isArray(e.links) ? e.links : typeof e.links === "string" ? [e.links] : []).filter((l): l is string => typeof l === "string" && l.trim() !== "");
    const cites = (Array.isArray(e.cites) ? e.cites : typeof e.cites === "string" ? [e.cites] : []).filter((c): c is string => typeof c === "string");
    const date = parseDate(e.date, presentOf(p));
    const when = date === null ? "" : ` (${formatDate(scaleOf(p), date, presentOf(p))})`;
    const name = e.sublabel ? `${e.label.trim()} — ${e.sublabel.trim()}${when}` : `${e.label.trim()}${when}`;
    out[ids[i]] = {
      name,
      ...(links.length > 0 ? { links } : {}),
      ...(typeof e.details === "string" && e.details.trim() !== "" ? { details: e.details.trim() } : {}),
      ...(cites.length > 0 ? { cites } : {}),
      ...(person ? { wiki: person } : {}),
    };
  });
  (Array.isArray(p?.eras) ? p.eras : []).forEach((e, i) => {
    if (e && typeof e.label === "string" && e.label.trim() !== "") out[`era_${i}`] = { name: e.label.trim() };
  });
  return out;
}

/** The pictures to resolve before layout: a portrait by name, else an image URL. */
export function timelinePictures(p: TimelineParams): { target: Record<string, unknown>; of?: string; url?: string }[] {
  const out: { target: Record<string, unknown>; of?: string; url?: string }[] = [];
  for (const e of Array.isArray(p?.events) ? p.events : []) {
    if (!e || typeof e !== "object" || typeof e.strokes === "string") continue;
    const target = e as unknown as Record<string, unknown>;
    if (typeof e.image === "string" && /^https?:\/\//.test(e.image.trim())) out.push({ target, url: e.image.trim() });
    else if (typeof e.portrait === "string" && e.portrait.trim() !== "") out.push({ target, of: e.portrait.trim() });
    else if (e.portrait === true && typeof e.label === "string" && e.label.trim() !== "") out.push({ target, of: e.label.trim() });
  }
  return out;
}

/** On a log_ago axis the view glides by equal factors of "years ago". */
export function timelineTweenSpace(key: string, p: TimelineParams): TweenSpace | null {
  if (scaleOf(p) !== "log_ago") return null;
  if (key !== "view.from" && key !== "view.to") return null;
  return { kind: "log", origin: presentOf(p), sign: -1 };
}
