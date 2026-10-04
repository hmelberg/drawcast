// Reveal stamps (spec docs/specs/2026-10-04-page-frame.md, round 2 W11): a
// question's `reveal` draws a short verdict — "MYTH", "46 hours awake!",
// "< 2,000 years" — beside the thing the question is about, at the moment
// the answer is revealed: WITH the `right` line (on a wrong answer, with the
// reveal line after `wrong`; in a movie, with the reveal), never after it.
// In the 50-quiz library authors drew these by hand with a draw after the
// quiz, often silently after the spoken answer, so viewers missed them.
//
//   reveal: "MYTH"                       on a quiz or an ask
//   reveal: {text, at, color, size, style: "stamp" | "label", keep}
//   reveal: true                          a quiz: the correct choice's words, upper case
//   reveal_at: <element id> | {x, y}      the same as reveal.at
//
// Sugar, expanded before layout (spec/expand.ts) into ordinary things:
//
//   element  <base>_stamp   a node (rect, no fill) — or a text for style
//                           "label" — carrying `reveal_stamp` (the hint the
//                           layout reads: what it is about, what to keep
//                           clear of, a pin)
//   command  the quiz/ask carries `reveal_stamp: <id>` (the planner makes
//            the stamp visible after the question; the player lands it with
//            the reveal line), and each later hide/erase of the figure it is
//            about hides it too (unless keep); a clear takes it like anything.
//
// Where it goes: beside the figure — the on-canvas buttons' figure (what the
// line before drew), a choose question's answer element, the guessed
// part(s), or else the last drawn thing — clear of every other ink and the
// caption band (layout/reveal-stamps.ts places it again from the boxes as
// drawn, after the on-canvas buttons have found their place).
//
// The look: slightly turned, bold, warm red for a myth / false / no and
// steel blue otherwise, a thin rounded border, and a quick stamp (it scales
// from 1.15 to 1 as it fades in) — calm, not cartoonish.

import type { BBox } from "../layout/geometry";
import { CAPTION_TOP, CONTENT_TOP, MARGIN, PAGE_W } from "../layout/page";
import { declaredBox, visibleBefore } from "./answer-buttons";
import type { Command, RevealArg, Spec, SpecElement } from "./types";

/** House warm red: a myth, a false, a no. */
export const STAMP_RED = "#b5482e";
/** House steel blue: everything else. */
export const STAMP_BLUE = "#2f6b8f";
/** The stamp's turn, degrees counter-clockwise (y up): it rises to the right. */
export const STAMP_TILT = 6;
/** The stamp's text size by default. */
export const STAMP_FONT = 48;
/** How long the stamp takes to land (scale 1.15 → 1 with the fade). */
export const STAMP_MS = 380;
/** The border's corner radius and its padding round the words. */
const STAMP_RADIUS = 8;
const PAD_X = 18;
/** The clearance a stamp keeps from other ink. */
export const STAMP_CLEAR = 22;
/** The lowest a stamp may reach: the caption band and a little air. */
const STAMP_FLOOR = CAPTION_TOP + 10;

export type StampStyle = "stamp" | "label";

/** What the layout reads off a stamp element (machine-written). */
export interface RevealStampHint {
  /** The ids the question is about: the stamp goes beside their union. */
  about: string[];
  /** Ids standing on the page when the stamp lands: what to keep clear of. */
  near: string[];
  /** Pinned by the author (reveal.at / reveal_at as a point). */
  at?: { x: number; y: number };
  style: StampStyle;
}

/** Words that read as "no": the stamp is red. English and Norwegian. */
const NEGATIVE = /^\s*[✗✘×]|^\s*(myth|myths|false|no|nope|wrong|untrue|incorrect|fake|fiction|never|not|myte|usant|nei|feil|aldri|ikke)\b/i;

/** The stamp's colour by default: red for a myth / false / no, blue otherwise. */
export function stampColor(text: string): string {
  return NEGATIVE.test(text) ? STAMP_RED : STAMP_BLUE;
}

/** A stamp's frame (unturned) for its words at a text size. */
export function stampSize(text: string, font: number): { w: number; h: number } {
  return { w: Math.max(Math.round(0.6 * font * Math.max(1, text.length) + 2 * PAD_X), Math.round(font * 2.2)), h: Math.round(font * 1.5) };
}

/** The box a w × h frame turned by `deg` covers. */
export function turnedSize(w: number, h: number, deg: number): { w: number; h: number } {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return { w: w * Math.cos(r) + h * Math.sin(r), h: w * Math.sin(r) + h * Math.cos(r) };
}

const overlaps = (a: BBox, b: BBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function unionOf(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Where a stamp goes (its centre, logical units, y up): beside the figure it
 * is about — right of it, level with its upper part — clear of every
 * obstacle by STAMP_CLEAR, inside the content area and above the caption
 * band. A spot left of the figure's middle costs extra (a free right side
 * wins), one below it a little. When nothing is clear, a tighter clearance;
 * then the figure's top-right corner, inside the page.
 */
export function placeStamp(obstacles: BBox[], about: BBox | null, size: { w: number; h: number }): { x: number; y: number } {
  const x0 = MARGIN + size.w / 2, x1 = PAGE_W - MARGIN - size.w / 2;
  const y0 = STAMP_FLOOR + size.h / 2, y1 = CONTENT_TOP - size.h / 2;
  const fig = about ?? unionOf(obstacles);
  const fcx = fig ? fig.x + fig.w / 2 : PAGE_W / 2;
  const ideal = fig ? { x: fig.x + fig.w + STAMP_CLEAR + size.w / 2, y: fig.y + fig.h * 0.65 } : { x: PAGE_W / 2, y: (y0 + y1) / 2 };
  for (const clear of [STAMP_CLEAR, 8]) {
    const grown = obstacles.map((o) => ({ x: o.x - clear, y: o.y - clear, w: o.w + 2 * clear, h: o.h + 2 * clear }));
    let best: { x: number; y: number; cost: number } | null = null;
    const STEP = 10;
    for (let x = x0; x <= x1 + 1e-9; x += STEP) {
      for (let y = y0; y <= y1 + 1e-9; y += STEP) {
        const box = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
        if (grown.some((g) => overlaps(g, box))) continue;
        const cost = Math.abs(x - ideal.x) + 1.2 * Math.abs(y - ideal.y) + (x < fcx ? 120 : 0) + (fig && y + size.h / 2 < fig.y ? 60 : 0);
        if (!best || cost < best.cost) best = { x, y, cost };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  const corner = fig ? { x: fig.x + fig.w, y: fig.y + fig.h } : { x: PAGE_W / 2, y: (y0 + y1) / 2 };
  return { x: Math.min(Math.max(corner.x, x0), Math.max(x0, x1)), y: Math.min(Math.max(corner.y, y0), Math.max(y0, y1)) };
}

// ---- before layout -----------------------------------------------------------

const idsOf = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is { x: number; y: number } => !!v && typeof v === "object" && num((v as { x?: unknown }).x) && num((v as { y?: unknown }).y);

/** A heading or the furniture of a page: never what a question is about. */
const furniture = (id: string): boolean => /^card_\d+_/.test(id) || /_btn_\d+$/.test(id) || id.endsWith("_stamp");

/** The leaf ids of an id: a group's members (recursively), else itself. */
function leaves(id: string, byId: Map<string, SpecElement>, seen = new Set<string>()): string[] {
  const el = byId.get(id);
  if (!el || el.type !== "group" || seen.has(id)) return [id];
  seen.add(id);
  return (el.members ?? []).flatMap((m) => leaves(m, byId, seen));
}

/** What a question at `k` is about when nothing names it: the last draw (or show) whose ink still stands. */
function lastDrawn(commands: Command[], k: number): string[] {
  const on = new Set(visibleBefore(commands, k));
  for (let j = k - 1; j >= 0; j--) {
    const ids = [...idsOf(commands[j].draw), ...idsOf(commands[j].show)].filter((id) => on.has(id) && !furniture(id));
    if (ids.length > 0) return ids;
  }
  return [];
}

/** The reveal a command asks for as a stamp, or null (an ask's boolean reveal keeps its old meaning). */
function stampArg(cmd: Command): { text?: string; at?: string | { x: number; y: number }; color?: string; size?: number; style?: StampStyle; keep?: boolean } | null {
  const q = cmd.quiz, a = cmd.ask;
  const r: RevealArg | undefined = q ? q.reveal : a ? (a.reveal as RevealArg | undefined) : undefined;
  const at = q ? q.reveal_at : a?.reveal_at;
  if (r === undefined || r === false) return null;
  if (r === true) return q ? { ...(at !== undefined ? { at } : {}) } : null;
  if (typeof r === "string") return { text: r, ...(at !== undefined ? { at } : {}) };
  if (typeof r === "object") return { ...r, ...(at !== undefined ? { at } : {}) };
  return null;
}

/**
 * Every quiz/ask with a stamp reveal gets its stamp element, the
 * `reveal_stamp` link on the command, and the stamp added to each later
 * hide/erase of what it is about. Runs BEFORE the on-canvas buttons expand
 * (the quiz still says what it is); linkStampsToButtons runs after them.
 * The same object back when there is none.
 */
export function expandRevealStamps(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => stampArg(c) !== null)) return spec;
  const els = spec.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  const taken = new Set(els.map((e) => e.id));
  const added: SpecElement[] = [];
  const out: Command[] = cmds.map((c) => ({ ...c }));
  /** Stamps waiting for their figure to go: [stamp id, the about ids (leaves too)]. */
  const pending: { id: string; about: Set<string> }[] = [];
  let k = 0;
  out.forEach((cmd, i) => {
    // A hide or erase of a figure takes the stamps beside it along.
    for (const verb of ["hide", "erase"] as const) {
      const ids = idsOf(cmd[verb]);
      if (ids.length === 0) continue;
      const gone = new Set(ids.flatMap((id) => [id, ...leaves(id, byId)]));
      const extra = pending.filter((p) => [...p.about].some((id) => gone.has(id)) && !gone.has(p.id)).map((p) => p.id);
      if (extra.length > 0) {
        (cmd as Record<string, unknown>)[verb] = [...ids, ...extra];
        for (const id of extra) pending.splice(pending.findIndex((p) => p.id === id), 1);
      }
    }
    if (cmd.clear !== undefined) {
      const keep = new Set(idsOf((cmd.clear as { keep?: unknown } | null)?.keep));
      // A clear that keeps the figure keeps its stamp; otherwise the stamp goes with the rest.
      const kept = pending.filter((p) => [...p.about].some((id) => keep.has(id))).map((p) => p.id);
      if (kept.length > 0) cmd.clear = { ...(cmd.clear as object), keep: [...keep, ...kept] } as Command["clear"];
      for (let j = pending.length - 1; j >= 0; j--) if (!kept.includes(pending[j].id)) pending.splice(j, 1);
    }
    const arg = stampArg(cmd);
    if (!arg) return;
    k++;
    const q = cmd.quiz, a = cmd.ask;
    // The words: the author's, or (reveal: true on a quiz) the right choice's — its button's words when it has one.
    let text = arg.text;
    if (text === undefined && q) {
      const j = q.correct - 1;
      const own = q.buttons?.[j]?.text;
      text = String(typeof own === "string" && own.trim() !== "" ? own : (q.choices[j] ?? "")).toUpperCase();
    }
    if (!text || text.trim() === "") return;
    // What it is about: a pin's element, a choose question's answer, the guessed parts, else the last drawn thing.
    const choose = a?.choose;
    const onIds = a && !choose ? idsOf(a.on).filter((id) => id !== "all" && id !== "tree") : [];
    const about =
      typeof arg.at === "string"
        ? [arg.at]
        : choose && typeof a.answer === "string"
          ? [a.answer]
          : onIds.length > 0
            ? onIds
            : lastDrawn(out, i);
    let base = typeof q?.id === "string" && q.id.trim() !== "" ? q.id : a?.store ? a.store : `reveal_${k}`;
    while (taken.has(`${base}_stamp`)) base = `${base}_${k}`;
    const id = `${base}_stamp`;
    taken.add(id);
    const style: StampStyle = arg.style ?? "stamp";
    const font = num(arg.size) && arg.size > 0 ? arg.size : style === "label" ? 34 : STAMP_FONT;
    const color = typeof arg.color === "string" && arg.color.trim() !== "" ? arg.color : stampColor(text);
    const near = visibleBefore(out, i).filter((n) => n !== id);
    const hint: RevealStampHint = { about, near, style, ...(isPoint(arg.at) ? { at: { x: arg.at.x, y: arg.at.y } } : {}) };
    // Declared placement (layout/reveal-stamps.ts places it again as drawn).
    const frame = stampSize(text, font);
    const reach = style === "stamp" ? turnedSize(frame.w, frame.h, STAMP_TILT) : frame;
    const boxes = (ids: string[]): BBox[] => ids.flatMap((n) => leaves(n, byId)).flatMap((n) => {
      const el = byId.get(n);
      const b = el ? declaredBox(el) : null;
      return b ? [b] : [];
    });
    const c = hint.at ?? placeStamp(boxes(near), unionOf(boxes(about)), reach);
    const draw = { mode: "fade" as const, duration: STAMP_MS / 1000 };
    added.push(
      (style === "stamp"
        ? { id, type: "node", shape: "rect", text, x: Math.round(c.x), y: Math.round(c.y), width: frame.w, height: frame.h, font_size: font, radius: STAMP_RADIUS, style: { color, fill: "none" }, draw, reveal_stamp: hint }
        : { id, type: "text", text, x: Math.round(c.x), y: Math.round(c.y), font_size: font, style: { color }, draw, reveal_stamp: hint }) as unknown as SpecElement,
    );
    if (arg.keep !== true) pending.push({ id, about: new Set(about.flatMap((n) => [n, ...leaves(n, byId)])) });
    // The question carries the link; the reveal itself is spent.
    if (q) {
      const { reveal: _r, reveal_at: _a, ...rest } = q;
      void _r;
      void _a;
      cmd.quiz = { ...rest, reveal_stamp: id };
    } else if (a) {
      const { reveal: _r, reveal_at: _a, ...rest } = a;
      void _r;
      void _a;
      cmd.ask = { ...rest, reveal_stamp: id };
    }
  });
  return { ...spec, elements: [...els, ...added], commands: out };
}

/**
 * After the on-canvas buttons expand: a stamp on a quiz answered on buttons
 * keeps clear of the buttons too (they stand while it lands).
 */
export function linkStampsToButtons(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  const els = spec.elements ?? [];
  let changed = false;
  const byStamp = new Map<string, string[]>();
  for (const c of cmds) {
    const id = c.ask?.reveal_stamp;
    if (typeof id === "string" && Array.isArray(c.ask!.choose)) byStamp.set(id, c.ask!.choose.map((o) => (typeof o === "string" ? o : o.id)));
  }
  if (byStamp.size === 0) return spec;
  const next = els.map((e) => {
    const hint = (e as { reveal_stamp?: RevealStampHint }).reveal_stamp;
    const more = byStamp.get(e.id);
    if (!hint || !more) return e;
    const near = [...hint.near, ...more.filter((m) => !hint.near.includes(m))];
    if (near.length === hint.near.length) return e;
    changed = true;
    return { ...e, reveal_stamp: { ...hint, near } } as SpecElement;
  });
  return changed ? { ...spec, elements: next } : spec;
}
