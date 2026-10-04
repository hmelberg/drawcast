// The `sequence` element (page frame round 2, W12): a run of pictures shown
// one at a time — True/Myth, "which of these animals …", a quiz run. The
// CURRENT one stands large in the middle of the content area with its name
// under it; the ones already done shrink into a small row along the top (a
// progress strip, under the heading); the ones not reached yet are not shown
// (`show_upcoming: "dots"` draws a small placeholder in each free slot).
//
// Before it, a cast placed every big picture by hand at the centre, hid the
// one before, and built a row of small copies at the end by hand — dozens of
// coordinates and hides for one idea. Here the author writes the items and
// draws them in turn; everything else is the engine's.
//
// Sugar, expanded before layout (spec/expand.ts), like the cards and the
// on-canvas buttons, into ordinary things:
//
//   elements  <id>_1 … <id>_N    the pictures: an icon (`icon`, keyword or a
//                                fallback list), a paper card (`text`), or a
//                                group around an element the author drew
//                                (a string item names it)
//             <id>_k_label       the name under item k (`label`)
//             <id>_k_mark        its verdict in the strip (`mark`)
//             <id>_dot_k         an upcoming placeholder (show_upcoming)
//             <id>_strip, <id>   groups of every picture (highlight them)
//   commands  drawing <id>_k (or the bare <id>: the next one) first sends
//             the current item into its slot in the strip — its name hidden,
//             a short move that shrinks it there, its mark drawn — then draws
//             item k with its name. Drawing <id>_strip at the end sends the
//             last one in too, and (recap, the default) lays the whole row
//             out large across the middle for the closing line.
//
// Positions come from the content area (layout/page.ts contentBox): the
// pictures, the strip and the recap row all fit inside it, so the page frame
// holds without the author knowing it. Hatches: `at` (the picture's centre),
// `size` (the picture's size), `strip` (top, bottom or none), `recap: false`.

import { CAPTION_TOP, CONTENT_TOP, CONTENT_TOP_BARE, MARGIN, PAGE_W } from "../layout/page";
import { CARD_PAPER, pageHasHeading } from "./cards";
import { declaredBox } from "./answer-buttons";
import { iconAsk } from "./icon-data";
import type { Command, Spec, SpecElement } from "./types";

/** An item: an element the author drew (its id), or one the sequence makes. */
export type SequenceItem =
  | string
  | {
      /** A picture by keyword, or keywords tried in order, or {of, set, or}. */
      icon?: string | string[] | { of: string; set?: string; or?: string[] };
      /** A paper card with these words (instead of an icon). */
      text?: string;
      /** The name under the picture, a few words. */
      label?: string;
      /** In the strip once done: a short word ("Myth") or a colour ("#b5482e"). */
      mark?: string | { text: string; color?: string };
      /** Ids of top-level `sources` this item stands for (W28): its picture and
       *  its name carry them, so their info card names the study, as any
       *  element's `cites` does. */
      cites?: string[] | string;
      /** Machine-written icon data (spec/icon-data.ts iconSlots), copied onto the icon. */
      icon_strokes?: string;
      credit?: string;
    };

export interface SequenceElementLike {
  id: string;
  type: "sequence";
  items: SequenceItem[];
  at?: { x?: number; y?: number };
  size?: number;
  strip?: "top" | "bottom" | "none";
  show_upcoming?: "dots" | "none";
  recap?: boolean;
}

/** The current picture's size when nothing says otherwise (an icon's box). */
export const SEQ_SIZE = 300;
/** The name under it. */
export const SEQ_LABEL_FONT = 44;
const LABEL_GAP = 14;
/** A done item's size in the strip, at most. */
export const STRIP_SIZE = 70;
/** Centre to centre in the strip, at most: a row, not a scatter. */
const STRIP_PITCH = 110;
/** The strip keeps this from the content area's edge, and this from the picture. */
const STRIP_EDGE = 10;
const STRIP_CLEAR = 22;
const MARK_FONT = 22;
const MARK_GAP = 6;
/** The recap row's items, at most, and the gap between them. */
const RECAP_SIZE = 150;
const RECAP_GAP = 30;
/** The share of the content area's width the recap row may take. */
const RECAP_WIDTH = 0.85;
/** A paper card item (text): its box at the full size, and its words. */
const CARD_W = 520;
const CARD_FONT = 40;
/** Seconds for the shrink into the strip (and the recap): a short glide. */
export const SEQ_MOVE_SECONDS = 0.6;
const DOT_R = 7;
const DOT_INK = "#b9b2a6";
const MARK_INK = "#3d3833";

type XY = { x: number; y: number };

export interface SequenceGeometry {
  /** The current picture's centre and size. */
  centre: XY;
  size: number;
  /** The name's centre y (under the picture). */
  labelY: number;
  /** Each item's slot in the strip (empty with strip: "none"), and the size there. */
  slots: XY[];
  stripSize: number;
  /** A mark's centre y under its slot. */
  markY: number;
  /** The recap row's centre y, and the largest an item grows to there. */
  recapY: number;
  recapSize: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hasLabels = (el: SequenceElementLike): boolean => el.items.some((it) => typeof it === "object" && typeof it.label === "string" && it.label.trim() !== "");
const hasMarks = (el: SequenceElementLike): boolean => el.items.some((it) => typeof it === "object" && it.mark !== undefined);

/** Centres of n slots of `pitch`, centred on x. */
function row(n: number, pitch: number, x: number, y: number): XY[] {
  return Array.from({ length: n }, (_, i) => ({ x: Math.round((x + (i - (n - 1) / 2) * pitch) * 10) / 10, y }));
}

/**
 * Where everything goes, from the content area: the strip along its top
 * (or bottom), the picture and its name centred in what is left, the recap
 * row across the middle. `heading`: the page has one (the content area's
 * top is under it).
 */
export function sequenceGeometry(el: SequenceElementLike, heading: boolean): SequenceGeometry {
  const n = el.items.length;
  const top = heading ? CONTENT_TOP : CONTENT_TOP_BARE;
  const bottom = CAPTION_TOP;
  const width = PAGE_W - 2 * MARGIN;
  const strip = el.strip ?? "top";
  const pitch = Math.min(STRIP_PITCH, width / Math.max(1, n));
  const stripSize = Math.min(STRIP_SIZE, Math.round(pitch * 0.78));
  const marks = hasMarks(el) ? MARK_GAP + MARK_FONT : 0;
  let lo = bottom + STRIP_EDGE;
  let hi = top - STRIP_EDGE;
  let slots: XY[] = [];
  let markY = 0;
  if (strip === "top") {
    const y = top - STRIP_EDGE - stripSize / 2;
    slots = row(n, pitch, PAGE_W / 2, y);
    markY = y - stripSize / 2 - MARK_GAP - MARK_FONT / 2;
    hi = y - stripSize / 2 - marks - STRIP_CLEAR;
  } else if (strip === "bottom") {
    const y = bottom + STRIP_EDGE + marks + stripSize / 2;
    slots = row(n, pitch, PAGE_W / 2, y);
    markY = y - stripSize / 2 - MARK_GAP - MARK_FONT / 2;
    lo = y + stripSize / 2 + STRIP_CLEAR;
  }
  const labelPart = hasLabels(el) ? LABEL_GAP + SEQ_LABEL_FONT : 0;
  const size = Math.max(60, Math.min(num(el.size) ? el.size : SEQ_SIZE, hi - lo - labelPart));
  const block = size + labelPart;
  const cx = num(el.at?.x) ? el.at!.x! : PAGE_W / 2;
  const cy = num(el.at?.y) ? el.at!.y! : Math.round((lo + hi) / 2 + block / 2 - size / 2);
  const recapSize = Math.min(RECAP_SIZE, Math.floor((width - (n - 1) * RECAP_GAP) / Math.max(1, n)));
  return { centre: { x: cx, y: cy }, size, labelY: cy - size / 2 - LABEL_GAP - SEQ_LABEL_FONT / 2, slots, stripSize, markY, recapY: Math.round((top + bottom) / 2), recapSize };
}

/** An item's `cites`, as a list (a single id may be written bare). */
export function itemCites(item: SequenceItem): string[] {
  if (typeof item !== "object" || item === null) return [];
  const c = item.cites;
  return (typeof c === "string" ? [c] : Array.isArray(c) ? c : []).filter((x): x is string => typeof x === "string" && x !== "");
}

/** Every source id an element cites — its own `cites`, and a sequence's items' (W28). */
export function elementCites(el: SpecElement): string[] {
  const own = Array.isArray(el.cites) ? el.cites : typeof el.cites === "string" ? [el.cites] : [];
  const items = el.type === ("sequence" as SpecElement["type"]) && Array.isArray(el.items) ? (el.items as SequenceItem[]).flatMap(itemCites) : [];
  return [...own, ...items];
}

/** The ids an item has: its picture, and its name and mark when it has them. */
export function itemIds(seqId: string, k: number): { picture: string; label: string; mark: string; dot: string } {
  return { picture: `${seqId}_${k}`, label: `${seqId}_${k}_label`, mark: `${seqId}_${k}_mark`, dot: `${seqId}_dot_${k}` };
}

const idsOf = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** How wide/high an item's picture is drawn at the full size, to scale it into a slot. */
function pictureExtent(item: SequenceItem, size: number, byId: Map<string, SpecElement>): number | null {
  if (typeof item === "string") {
    const el = byId.get(item);
    const box = el ? declaredBox(el) : null;
    return box ? Math.max(box.w, box.h) : null;
  }
  if (typeof item.text === "string" && item.icon === undefined) return Math.min(CARD_W, PAGE_W - 2 * MARGIN);
  return size;
}

/** The elements of one sequence: pictures, names, marks, dots and the groups. */
function sequenceElements(el: SequenceElementLike, g: SequenceGeometry, byId: Map<string, SpecElement>, placed: Map<string, SpecElement>): SpecElement[] {
  const out: SpecElement[] = [];
  const pictures: string[] = [];
  el.items.forEach((item, i) => {
    const k = i + 1;
    const ids = itemIds(el.id, k);
    pictures.push(ids.picture);
    const cites = typeof item === "object" ? itemCites(item) : [];
    const cited = cites.length > 0 ? { cites } : {};
    if (typeof item === "string") {
      // An element the author drew: a group around it, so <id>_k names it.
      out.push({ id: ids.picture, type: "group", members: [item] } as unknown as SpecElement);
      const own = byId.get(item);
      // Placed in the middle when it says nowhere itself (an icon, a node, a text …).
      if (own && !num(own.x) && !num(own.y) && own.at === undefined && ["icon", "image", "node", "text", "portrait"].includes(own.type)) {
        placed.set(item, { ...own, x: g.centre.x, y: g.centre.y, ...(own.type === "icon" && !num(own.size) ? { size: g.size } : {}) });
      }
    } else if (item.icon !== undefined) {
      const ask = iconAsk(item.icon);
      out.push({
        id: ids.picture,
        type: "icon",
        of: ask?.of ?? "",
        ...(ask?.set ? { set: ask.set } : {}),
        ...(ask?.or ? { or: ask.or } : {}),
        icon_look: "picture",
        size: g.size,
        x: g.centre.x,
        y: g.centre.y,
        ...(typeof item.icon_strokes === "string" ? { strokes: item.icon_strokes } : {}),
        ...(typeof item.credit === "string" ? { credit: item.credit } : {}),
        ...(typeof (item as { icon_key?: unknown }).icon_key === "string" ? { icon_key: (item as { icon_key: string }).icon_key } : {}),
        ...cited,
      } as unknown as SpecElement);
    } else {
      const w = Math.min(CARD_W, PAGE_W - 2 * MARGIN);
      out.push({
        id: ids.picture,
        type: "node",
        shape: "rect",
        text: item.text ?? "",
        x: g.centre.x,
        y: g.centre.y,
        width: w,
        height: Math.round(Math.min(g.size, w * 0.5)),
        font_size: CARD_FONT,
        radius: 12,
        shadow: true,
        style: { fill: CARD_PAPER },
        ...cited,
      } as unknown as SpecElement);
    }
    if (typeof item === "object" && typeof item.label === "string" && item.label.trim() !== "") {
      out.push({ id: ids.label, type: "text", text: item.label, font_size: SEQ_LABEL_FONT, x: g.centre.x, y: Math.round(g.labelY), ...cited } as unknown as SpecElement);
    }
    const slot = g.slots[i];
    if (typeof item === "object" && item.mark !== undefined && slot) {
      const m = typeof item.mark === "string" ? { text: item.mark } : item.mark;
      const colour = /^#[0-9a-fA-F]{3,8}$/.test(m.text) ? m.text : null;
      out.push(
        colour
          ? ({ id: ids.mark, type: "shape", shape: "rect", x: slot.x, y: g.markY, width: Math.round(g.stripSize * 0.8), height: 8, style: { color: colour, fill: colour } } as unknown as SpecElement)
          : ({ id: ids.mark, type: "text", text: m.text, font_size: MARK_FONT, x: slot.x, y: Math.round(g.markY), style: { color: m.color ?? MARK_INK } } as unknown as SpecElement),
      );
    }
    if (el.show_upcoming === "dots" && slot) {
      out.push({ id: ids.dot, type: "shape", shape: "circle", x: slot.x, y: slot.y, radius: DOT_R, style: { color: DOT_INK, fill: DOT_INK } } as unknown as SpecElement);
    }
  });
  // The strip carries the marks too: the recap moves them with their pictures.
  const marks = out.filter((e) => e.id.endsWith("_mark") && e.id.startsWith(`${el.id}_`)).map((e) => e.id);
  out.push({ id: `${el.id}_strip`, type: "group", members: [...pictures, ...marks] } as unknown as SpecElement);
  out.push({ id: el.id, type: "group", members: [...pictures] } as unknown as SpecElement);
  return out;
}

interface RunState {
  el: SequenceElementLike;
  g: SequenceGeometry;
  /** Each item's drawn extent at full size (null: unknown — scaled by a guess). */
  extent: (number | null)[];
  /** Items drawn so far (1-based), in order; the last one not in the strip is current. */
  drawn: Set<number>;
  current: number | null;
  /** The size each item is shown at now, in the units of its extent (1 = as laid out). */
  scale: number[];
  /** Items whose placeholder dot stands in its slot (show_upcoming: "dots"). */
  dots: Set<number>;
  recapped: boolean;
}

/** The commands that send the current item into its slot: name hidden, a shrinking glide, its mark and its dot. */
function toStrip(r: RunState, k: number): Command[] {
  const ids = itemIds(r.el.id, k);
  const item = r.el.items[k - 1];
  const out: Command[] = [];
  const named = typeof item === "object" && typeof item.label === "string" && item.label.trim() !== "";
  const slot = r.g.slots[k - 1];
  if (!slot) {
    // strip: "none" — the done item simply goes.
    out.push({ hide: [ids.picture, ...(named ? [ids.label] : [])] });
    return out;
  }
  if (named) out.push({ hide: [ids.label] });
  const ext = r.extent[k - 1];
  const target = ext ? r.g.stripSize / ext : 0.25;
  const scale = Math.round((target / r.scale[k - 1]) * 1000) / 1000;
  r.scale[k - 1] = target;
  if (r.dots.delete(k)) out.push({ hide: [ids.dot] });
  out.push({ move: { target: ids.picture, to: { x: slot.x, y: slot.y }, scale, duration: SEQ_MOVE_SECONDS } } as Command);
  if (typeof item === "object" && item.mark !== undefined) out.push({ draw: [ids.mark], parallel: true });
  return out;
}

/** The closing row: the whole strip glides to the middle of the content
 *  area and grows, as ONE move of its group (so the items keep their
 *  spacing and arrive together), as large as the width allows. Items never
 *  drawn would stretch the group's box: then each goes on its own. */
function toRecap(r: RunState): Command[] {
  const out: Command[] = [];
  const n = r.el.items.length;
  if (r.dots.size > 0) out.push({ hide: [...r.dots].map((k) => itemIds(r.el.id, k).dot) });
  r.dots.clear();
  const top = r.g.slots[0].y, mid = r.g.recapY;
  if (r.drawn.size === n) {
    const span = r.g.slots[n - 1].x - r.g.slots[0].x + r.g.stripSize;
    // Not edge to edge: a circle or a box drawn round the last items must still fit.
    const grow = Math.round(Math.min(r.g.recapSize / r.g.stripSize, (RECAP_WIDTH * (PAGE_W - 2 * MARGIN)) / span) * 1000) / 1000;
    out.push({ move: { target: `${r.el.id}_strip`, to: { x: PAGE_W / 2, y: mid }, scale: grow, duration: SEQ_MOVE_SECONDS } } as Command);
    r.scale = r.scale.map((s) => s * grow);
    return out;
  }
  r.el.items.forEach((_, i) => {
    if (!r.drawn.has(i + 1)) return;
    out.push({ move: { target: itemIds(r.el.id, i + 1).picture, by: [0, mid - top], duration: SEQ_MOVE_SECONDS / 2 } } as Command);
  });
  return out;
}

/**
 * Every `sequence` element becomes its pictures, names, marks and groups,
 * and its commands are written out (see the header). The same object back
 * when there is none.
 */
export function expandSequences(spec: Spec): Spec {
  const els = spec.elements ?? [];
  if (!els.some((e) => (e.type as string) === "sequence")) return spec;
  const heading = pageHasHeading(spec);
  const byId = new Map(els.map((e) => [e.id, e] as const));
  const placed = new Map<string, SpecElement>();
  const runs: RunState[] = [];
  const added: SpecElement[] = [];
  for (const e of els) {
    if ((e.type as string) !== "sequence") continue;
    const el = e as unknown as SequenceElementLike;
    const items = Array.isArray(el.items) ? el.items : [];
    const seq = { ...el, items };
    const g = sequenceGeometry(seq, heading);
    added.push(...sequenceElements(seq, g, byId, placed));
    runs.push({ el: seq, g, extent: items.map((it) => pictureExtent(it, g.size, byId)), drawn: new Set(), current: null, scale: items.map(() => 1), dots: new Set(), recapped: false });
  }
  const elements = [...els.filter((e) => (e.type as string) !== "sequence").map((e) => placed.get(e.id) ?? e), ...added];

  const out: Command[] = [];
  for (const cmd of spec.commands ?? []) {
    let c: Command = cmd;
    const before: Command[] = [];
    for (const r of runs) {
      const id = r.el.id;
      const n = r.el.items.length;
      // Removals: the current item erased or hidden by the author leaves the
      // run, and takes its name with it.
      for (const key of ["erase", "hide"] as const) {
        const gone = idsOf(c[key]);
        const k = r.current;
        if (k === null || !gone.includes(itemIds(id, k).picture)) continue;
        r.current = null;
        const label = itemIds(id, k).label;
        if (elements.some((e) => e.id === label) && !gone.includes(label)) c = { ...c, [key]: [...gone, label] };
      }
      const draws = [...idsOf(c.draw), ...idsOf(c.show)];
      if (draws.length === 0) continue;
      const key = c.draw !== undefined ? "draw" : "show";
      let list = idsOf(c[key]);
      // The bare id: the next item.
      if (list.includes(id)) {
        const next = Array.from({ length: n }, (_, i) => i + 1).find((k) => !r.drawn.has(k));
        list = list.flatMap((x) => (x === id ? (next !== undefined ? [itemIds(id, next).picture] : []) : [x]));
      }
      // The strip: the last item joins it, and (recap) the row comes to the middle.
      if (list.includes(`${id}_strip`)) {
        list = list.filter((x) => x !== `${id}_strip`);
        if (r.current !== null) before.push(...toStrip(r, r.current));
        r.current = null;
        if (r.el.recap !== false && !r.recapped && r.g.slots.length > 0) {
          before.push(...toRecap(r));
          r.recapped = true;
        }
      }
      // Items drawn: the current one goes to the strip first; each brings its name.
      const items = list.map((x) => Array.from({ length: n }, (_, i) => i + 1).find((k) => itemIds(id, k).picture === x)).filter((k): k is number => k !== undefined);
      for (const k of items) {
        if (r.drawn.has(k) && r.current !== k) continue;
        if (r.current !== null && r.current !== k) before.push(...toStrip(r, r.current));
        if (r.drawn.size === 0 && r.el.show_upcoming === "dots" && r.g.slots.length > 0) {
          // The placeholders arrive with the first item: one per slot still to fill.
          for (let j = 1; j <= n; j++) r.dots.add(j);
          if (r.dots.size > 0) before.push({ draw: [...r.dots].map((j) => itemIds(id, j).dot), parallel: true });
        }
        r.drawn.add(k);
        r.current = k;
        const item = r.el.items[k - 1];
        const label = itemIds(id, k).label;
        if (typeof item === "object" && typeof item.label === "string" && item.label.trim() !== "" && !list.includes(label)) {
          const at = list.indexOf(itemIds(id, k).picture);
          list = [...list.slice(0, at + 1), label, ...list.slice(at + 1)];
        }
      }
      if (list.join("\u0000") !== idsOf(c[key]).join("\u0000")) {
        if (list.length > 0) c = { ...c, [key]: list };
        else {
          const { [key]: _drop, parallel: _p, ...rest } = c;
          void _drop;
          void _p;
          c = rest as Command;
        }
      }
    }
    out.push(...before);
    if (Object.keys(c).length > 0) out.push(c);
  }
  return { ...spec, elements, commands: out };
}
