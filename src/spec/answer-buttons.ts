// On-canvas answer buttons: a `quiz` with `on_canvas: true` answers on
// buttons drawn ON the figure — True / Myth, Yes / No, any 2–4 short
// choices — instead of the question card. The line before the quiz has said
// the question, so it is neither spoken again nor shown over the figure
// (`say_question: true` brings both back).
//
// Sugar, expanded before layout (spec/expand.ts) into ordinary things:
//
//   elements  <id>_btn_1 … <id>_btn_N   paper cards (node rect), the choice's
//                                       text, an optional icon above it
//             <id>_buttons              their group, carrying `answer_buttons`
//                                       (what stands on the page at the quiz)
//   commands  draw the buttons (quick, unnarrated, together)
//             ask {choose: buttons, answer: the right one, say_question: false}
//             hide the buttons (unless keep_buttons)
//
// So the viewer answers through the choose gate (ui/choose-gate.ts): judged,
// stored, scored, ✓/✗ on the tapped button, the right one glowing while
// `right` is spoken; a movie's pointer taps the right button.
//
// Where they go: below the figure and a bit to its right ("below and a bit
// to the side"), clear of everything on the page at that moment and of the
// caption band; when nothing fits below, beside it. The expansion places
// them from the declared positions; the layout places them again from the
// boxes as drawn (layout/answer-buttons.ts). `buttons_at` pins the centre.

import type { BBox } from "../layout/geometry";
import { CAPTION_TOP, CONTENT_TOP, MARGIN, PAGE_W } from "../layout/page";
import { CARD_PAPER } from "./cards";
import type { Command, Spec, SpecElement } from "./types";

/** The buttons' text size: big enough to read and to hit. */
export const BUTTON_FONT = 34;
const BUTTON_ICON_FONT = 28;
const BUTTON_H = 72;
/** With an icon above the text (as an icon card, spec/cards.ts CARD_ICON_H). */
const BUTTON_ICON_H = 112;
const BUTTON_MIN_W = 150;
/** Between buttons in a row / a column. */
const ROW_GAP = 22;
const COLUMN_GAP = 16;
/** The clearance the buttons keep from everything else on the page. */
export const CLEAR = 36;
/** The lowest a button may reach: the caption band and a little air. */
export const BUTTONS_FLOOR = CAPTION_TOP + 10;
/** The buttons' outline and words: the house blue. */
const BUTTON_INK = "#2f6b8f";
/** paper: as the cards' (spec/cards.ts CARD_RADIUS). */
const BUTTON_RADIUS = 10;
/** Drawn quickly: they are furniture, not a beat of the story. */
const BUTTON_DRAW = { mode: "fade" as const, duration: 0.3 };

export type ButtonsLayout = "row" | "column";

/** What the layout reads off the buttons' group (machine-written). */
export interface AnswerButtonsHint {
  /** Ids standing on the page when the quiz is asked: what to keep clear of. */
  near: string[];
  /** The buttons, in choice order. */
  buttons: string[];
  /** Pinned by the author (buttons_at / buttons_layout). */
  at?: { x: number; y: number };
  layout?: ButtonsLayout;
}

export interface ButtonSize {
  w: number;
  h: number;
}

/** One button's size: room for its words (estimated), all of a set alike. */
export function buttonSizes(texts: string[], icons: boolean): ButtonSize {
  const font = icons ? BUTTON_ICON_FONT : BUTTON_FONT;
  const longest = Math.max(...texts.map((t) => t.length), 1);
  return { w: Math.max(BUTTON_MIN_W, Math.round(0.58 * font * longest + 56)), h: icons ? BUTTON_ICON_H : BUTTON_H };
}

/** The block a set of buttons makes as a row or a column. */
export function blockSize(n: number, b: ButtonSize, layout: ButtonsLayout): ButtonSize {
  return layout === "row" ? { w: n * b.w + (n - 1) * ROW_GAP, h: b.h } : { w: b.w, h: n * b.h + (n - 1) * COLUMN_GAP };
}

/** Each button's centre in a block centred at `c` (row: left to right; column: top down). */
export function buttonCentres(n: number, b: ButtonSize, layout: ButtonsLayout, c: { x: number; y: number }): { x: number; y: number }[] {
  const block = blockSize(n, b, layout);
  return Array.from({ length: n }, (_, i) =>
    layout === "row"
      ? { x: c.x - block.w / 2 + b.w / 2 + i * (b.w + ROW_GAP), y: c.y }
      : { x: c.x, y: c.y + block.h / 2 - b.h / 2 - i * (b.h + COLUMN_GAP) },
  );
}

const overlaps = (a: BBox, b: BBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a block of buttons goes (its centre, logical units, y up): the spot
 * clear of every obstacle (by CLEAR), inside the content area and above the
 * caption band, nearest to "below the figure, a bit to its right". A spot
 * left of the figure's middle costs extra, so a free right side wins over
 * a free left one. Null when no spot is clear.
 */
export function placeBlock(obstacles: BBox[], block: ButtonSize): { x: number; y: number; cost: number } | null {
  const fig = unionOf(obstacles);
  const x0 = MARGIN + block.w / 2, x1 = PAGE_W - MARGIN - block.w / 2;
  const y0 = BUTTONS_FLOOR + block.h / 2, y1 = CONTENT_TOP - block.h / 2;
  if (x0 > x1 || y0 > y1) return null;
  const fcx = fig ? fig.x + fig.w / 2 : PAGE_W / 2;
  const ideal = fig ? { x: fcx + Math.max(90, fig.w * 0.25), y: fig.y - CLEAR - block.h / 2 } : { x: PAGE_W / 2 + 90, y: y0 };
  const grown = obstacles.map((o) => ({ x: o.x - CLEAR, y: o.y - CLEAR, w: o.w + 2 * CLEAR, h: o.h + 2 * CLEAR }));
  let best: { x: number; y: number; cost: number } | null = null;
  const STEP = 10;
  for (let x = x0; x <= x1 + 1e-9; x += STEP) {
    for (let y = y0; y <= y1 + 1e-9; y += STEP) {
      const box = { x: x - block.w / 2, y: y - block.h / 2, w: block.w, h: block.h };
      if (grown.some((g) => overlaps(g, box))) continue;
      const cost = Math.abs(x - ideal.x) + 1.5 * Math.abs(y - ideal.y) + (x < fcx ? 150 : 0);
      if (!best || cost < best.cost) best = { x, y, cost };
    }
  }
  return best;
}

function unionOf(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A column costs a little more than a row: a row reads as one answer line. */
const COLUMN_COST = 40;

/**
 * Where the buttons go and in what arrangement: the author's pins first;
 * else the cheaper of a row and a column (placeBlock); else, when nothing
 * is clear, the content area's bottom-right corner as a row.
 */
export function placeButtons(
  obstacles: BBox[],
  n: number,
  b: ButtonSize,
  pin: { at?: { x: number; y: number }; layout?: ButtonsLayout } = {},
): { layout: ButtonsLayout; centres: { x: number; y: number }[] } {
  const layouts: ButtonsLayout[] = pin.layout ? [pin.layout] : ["row", "column"];
  if (pin.at) {
    const layout = layouts[0];
    return { layout, centres: buttonCentres(n, b, layout, pin.at) };
  }
  let pick: { layout: ButtonsLayout; c: { x: number; y: number }; cost: number } | null = null;
  for (const layout of layouts) {
    const spot = placeBlock(obstacles, blockSize(n, b, layout));
    if (!spot) continue;
    const cost = spot.cost + (layout === "column" ? COLUMN_COST : 0);
    if (!pick || cost < pick.cost) pick = { layout, c: { x: spot.x, y: spot.y }, cost };
  }
  if (!pick) {
    // A row too wide for the page stands as a column instead (a poll's four wide buttons).
    const layout = layouts.length > 1 && blockSize(n, b, "row").w > PAGE_W - 2 * MARGIN ? "column" : layouts[0];
    const block = blockSize(n, b, layout);
    const c = { x: Math.max(PAGE_W / 2, PAGE_W - MARGIN - block.w / 2), y: BUTTONS_FLOOR + block.h / 2 };
    return { layout, centres: buttonCentres(n, b, layout, c) };
  }
  return { layout: pick.layout, centres: buttonCentres(n, b, pick.layout, pick.c) };
}

// ---- before layout: the declared positions --------------------------------

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** An element's box from what it declares (icons, text, nodes, shapes); null when it does not say. */
export function declaredBox(el: SpecElement): BBox | null {
  const e = el as unknown as Record<string, unknown>;
  if (!num(e.x) || !num(e.y)) return null;
  const x = e.x, y = e.y;
  if (el.type === "icon" || el.type === "image" || el.type === "portrait") {
    const s = num(e.size) ? e.size : num(e.width) ? e.width : 120;
    const hgt = num(e.height) ? e.height : s;
    return { x: x - s / 2, y: y - hgt / 2, w: s, h: hgt };
  }
  if (el.type === "text") {
    const fs = num(e.font_size) ? e.font_size : 26;
    const w = num(e.width) ? e.width : 0.55 * fs * String(e.text ?? "").length;
    return { x: x - w / 2, y: y - fs / 2, w, h: fs };
  }
  if (num(e.width) && num(e.height)) return { x: x - e.width / 2, y: y - e.height / 2, w: e.width, h: e.height };
  if (num(e.r)) return { x: x - e.r, y: y - e.r, w: 2 * e.r, h: 2 * e.r };
  return null;
}

const idsOf = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** What stands on the page just before command `upto`: draws and shows in, hides, erases and clears out (gotos are not followed). */
export function visibleBefore(commands: Command[], upto: number): string[] {
  const on = new Set<string>();
  for (const cmd of commands.slice(0, upto)) {
    for (const id of [...idsOf(cmd.draw), ...idsOf(cmd.show)]) on.add(id);
    for (const id of [...idsOf(cmd.hide), ...idsOf(cmd.erase)]) on.delete(id);
    if (cmd.clear !== undefined) {
      const keep = new Set(idsOf((cmd.clear as { keep?: unknown } | null)?.keep));
      for (const id of [...on]) if (!keep.has(id)) on.delete(id);
    }
  }
  return [...on];
}

/** The leaf ids of an id: a group's members (recursively), else itself. */
function leaves(id: string, byId: Map<string, SpecElement>, seen = new Set<string>()): string[] {
  const el = byId.get(id);
  if (!el || el.type !== "group" || seen.has(id)) return [id];
  seen.add(id);
  return (el.members ?? []).flatMap((m) => leaves(m, byId, seen));
}

/**
 * A set of answer buttons and their group (with the layout's hint): ids
 * `<base>_btn_1…N`, placed clear of `near` (what stands on the page). `wider`
 * adds room at each button's right end (a poll writes its share there).
 * Shared by on-canvas quizzes and polls (spec/poll.ts).
 */
export function buttonSet(
  base: string,
  texts: string[],
  icons: unknown[],
  near: string[],
  byId: Map<string, SpecElement>,
  pin: { at?: { x: number; y: number }; layout?: ButtonsLayout },
  wider = 0,
  /** Each button's look as written (a quiz's buttons[j], a poll's choices[j]):
   *  the icon data the resolver filled there (spec/icon-data.ts iconSlots)
   *  rides onto the button's node, as on any icon node. */
  hosts: unknown[] = [],
): { ids: string[]; elements: SpecElement[] } {
  const n = texts.length;
  const hasIcons = icons.some((i) => i !== undefined);
  const size0 = buttonSizes(texts, hasIcons);
  const size = { w: size0.w + wider, h: size0.h };
  const ids = texts.map((_, j) => `${base}_btn_${j + 1}`);
  const boxes = near.flatMap((id) => leaves(id, byId)).map((id) => byId.get(id)).flatMap((el) => (el ? [declaredBox(el)].filter((b): b is BBox => b !== null) : []));
  const { centres } = placeButtons(boxes, n, size, pin);
  const elements: SpecElement[] = ids.map((id, j) => {
    const icon = icons[j];
    return {
      id,
      type: "node",
      shape: "rect",
      text: texts[j],
      x: Math.round(centres[j].x),
      y: Math.round(centres[j].y),
      width: size.w,
      height: size.h,
      font_size: hasIcons ? BUTTON_ICON_FONT : BUTTON_FONT,
      radius: BUTTON_RADIUS,
      shadow: true,
      style: { fill: CARD_PAPER, color: BUTTON_INK },
      draw: BUTTON_DRAW,
      ...(icon !== undefined ? { icon, ...iconDataOf(hosts[j]) } : {}),
    } as unknown as SpecElement;
  });
  const hint: AnswerButtonsHint = { near, buttons: ids, ...pin };
  elements.push({ id: `${base}_buttons`, type: "group", members: ids, answer_buttons: hint } as unknown as SpecElement);
  return { ids, elements };
}

/** A button look's resolved icon data and credit, for its node. */
function iconDataOf(host: unknown): Record<string, unknown> {
  if (typeof host !== "object" || host === null) return {};
  const h = host as Record<string, unknown>;
  return { ...(h.icon_strokes !== undefined ? { icon_strokes: h.icon_strokes } : {}), ...(typeof h.credit === "string" ? { credit: h.credit } : {}) };
}

/** The keys a quiz command keeps for the buttons; everything else of it goes to the ask. */
const BUTTON_KEYS = ["on_canvas", "id", "buttons", "buttons_at", "buttons_layout", "say_question", "keep_buttons", "choices", "correct"] as const;

/**
 * Every `quiz` with on_canvas: true becomes its buttons, an ask with choose
 * and a hide. The same object back when there is none.
 */
export function expandAnswerButtons(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => c.quiz?.on_canvas === true)) return spec;
  const els = spec.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  const taken = new Set(els.map((e) => e.id));
  const added: SpecElement[] = [];
  const out: Command[] = [];
  let k = 0;
  cmds.forEach((cmd) => {
    const q = cmd.quiz;
    if (!q || q.on_canvas !== true) {
      out.push(cmd);
      return;
    }
    k++;
    let base = typeof q.id === "string" && q.id.trim() !== "" ? q.id : `quiz_${k}`;
    while (taken.has(`${base}_buttons`)) base = `${base}_${k}`;
    const looks = q.choices.map((_, j) => q.buttons?.[j] ?? {});
    const texts = q.choices.map((c, j) => (typeof looks[j].text === "string" && looks[j].text!.trim() !== "" ? looks[j].text! : c));
    const pin = { ...(q.buttons_at ? { at: q.buttons_at } : {}), ...(q.buttons_layout ? { layout: q.buttons_layout } : {}) };
    const set = buttonSet(base, texts, looks.map((l) => l.icon), visibleBefore(out, out.length), byId, pin, 0, looks);
    added.push(...set.elements);
    for (const el of set.elements) taken.add(el.id);
    const ids = set.ids;

    // The command's other keys (a paired speak, a voice) ride on the ask.
    const { quiz: _q, ...rest } = cmd;
    void _q;
    const ask: Record<string, unknown> = { question: q.question, choose: ids, answer: ids[q.correct - 1] };
    for (const [key, v] of Object.entries(q)) {
      if (v === undefined || (BUTTON_KEYS as readonly string[]).includes(key) || key === "question") continue;
      ask[key] = v;
    }
    if (q.say_question !== true) ask.say_question = false;
    out.push({ draw: ids, parallel: true });
    out.push({ ...rest, ask: ask as unknown as Command["ask"] });
    if (q.keep_buttons !== true) out.push({ hide: ids });
  });
  return { ...spec, elements: [...els, ...added], commands: out };
}
