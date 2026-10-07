// The page frame (spec docs/specs/2026-10-04-page-frame.md): ONE place that
// says how a drawcast page is divided, so layout, templates, cards, scales
// and lints stop repeating their own copies of the same numbers.
//
//   y 750 ┌──────────────────────────────┐
//         │   heading strip (title)      │  HEADING_Y 726, underline ≈ 693
//   y 655 ├──────────────────────────────┤  CONTENT_TOP
//         │                              │
//         │   content: the figure        │  x 60 … 940 (MARGIN)
//         │                              │
//   y 110 ├──────────────────────────────┤  CAPTION_TOP
//         │   caption band (narration)   │  HTML captions may lie over it
//   y   0 └──────────────────────────────┘
//
// Logical units, y up, like every spec coordinate. A page with no heading
// may use the strip (CONTENT_TOP_BARE). Everything here is a default the
// author can override (a template's params.box, an element's x/y/width, a
// cards element's size) — the frame is where things go when nobody says.

import type { BBox } from "./geometry";

export const PAGE_W = 1000;
export const PAGE_H = 750;
/** Left and right margin of the content area. */
export const MARGIN = 60;
/** The heading's baseline-centre y (spec/card.ts headingElements). */
export const HEADING_Y = 726;
/** The top heading's drawn text size: a one-line title across the top, 26–40
 *  (W28: one step up from 36 — a title up to about 40 characters is drawn at
 *  40; its centre at 726 keeps the words under the top edge, 750). */
export const HEADING_FONT_MAX = 40;
export function headingFont(text: string): number {
  return Math.max(26, Math.min(HEADING_FONT_MAX, Math.round(880 / (0.55 * Math.max(1, text.length)))));
}
/** Top of the content area under a heading: about 40 under the lowest
 *  underline (a 40-unit heading's, at 726 − 0.82 × 40 ≈ 693), the gap
 *  canvas.ts HEADING_GAP keeps above a plot. */
export const CONTENT_TOP = 655;
/** Top of the content area on a page with no heading. */
export const CONTENT_TOP_BARE = 700;
/** Bottom of the content area: below it the narration's captions may lie
 *  over the canvas (render/caption-place.ts overlay mode). Sized for TWO
 *  overlay lines (render/figure-style.ts .cs-caption: 1.15rem × the cast's
 *  text scale, line-height 1.35, 0.65rem padding, 0.4rem off the floor —
 *  66 px at text scale 1, 82 px at 1.3) on the stages the player actually
 *  gets: 750 / stage-px canvas units a px, so 110 holds two lines at scale 1
 *  on a stage down to 450 px tall and at scale 1.3 down to 560 px (a
 *  1440 × 860 window gives a 652 px stage: 76 / 94 units). Was 160 until
 *  2026-10-05 — about a fifth of the page held back for words that take a
 *  tenth (Hans: "after everything is put on the screen there is still a
 *  lot" of space at the bottom). A phone held upright puts the words BELOW
 *  the drawing; text the viewer must read under 85 gets its own strip
 *  (render/caption-dark.ts CAPTION_STRIP_TWO). */
export const CAPTION_TOP = 110;

/** Between two figures that share the content area (the named regions'
 *  halves, the code/figure split, a chart beside its drawing). */
export const GUTTER = 40;


/** The content area: where a page's figure goes by default. */
export function contentBox(opts: { heading?: boolean } = {}): BBox {
  const top = opts.heading === false ? CONTENT_TOP_BARE : CONTENT_TOP;
  return { x: MARGIN, y: CAPTION_TOP, w: PAGE_W - 2 * MARGIN, h: top - CAPTION_TOP };
}

/** The band figures are fitted into (regions.ts "full" and its halves, a
 *  chart beside a drawing, the code/figure split, the inset page's main box,
 *  scratch corners): the content area's height, clear of the caption band
 *  below and the heading strip above. Was y 95–655 until 2026-10-04 (a
 *  fitted chart's floor sat under the captions), 160–655 until 2026-10-05
 *  (the caption band right-sized, CAPTION_TOP). */
export const FIT_BAND: Readonly<{ y: number; h: number }> = Object.freeze({ y: CAPTION_TOP, h: CONTENT_TOP - CAPTION_TOP });

/** Under a heading, the line an ask's task stands on while the viewer
 *  answers (ui/gate-dock.ts mountTaskLine). The heading stays the page's one
 *  headline through every ask (house rule, 2026-10-07: an estimate's or a
 *  guess's question once took its place, or lay over the axis caption under
 *  it); a page that asks on its figure under a heading keeps this much
 *  height free under the underline — its heading floor drops by it, so
 *  plots, axis captions and what is placed above something start lower. */
export const TASK_LINE_H = 36;
/** What the task line itself takes under the underline, at most: one line
 *  of it (ui/gate-dock.ts taskLineFont sizes it to fit) and its gap. Axis
 *  captions — which rise above their arrow, past the floor — keep under
 *  this, across the page's width (the line may be as wide). */
export const TASK_LINE_BAND = 28;

/** The ask fields reservesTaskLine reads (spec/types.ts AskArgs). */
export interface AskLike {
  question?: string;
  on?: unknown;
  estimate?: unknown;
  choose?: unknown;
  blanks?: unknown;
  pick?: unknown;
  spot?: unknown;
  widget?: string;
  poll?: unknown;
  say_question?: boolean;
}

/** Does this ask open a gate ON the figure that stands its question as a
 *  task line under the page's heading (the guess, cards, choose, tree,
 *  formula, spot, poll and drag gates)? A typed answer or answer buttons
 *  do not; nor does a quiet one (say_question: false) or one with no question. */
export function opensFigureGate(ask: AskLike): boolean {
  if (ask.say_question === false || !ask.question || ask.question.trim() === "") return false;
  return [ask.on, ask.estimate, ask.choose, ask.blanks, ask.pick, ask.spot, ask.poll].some((v) => v !== undefined) || ask.widget === "drag";
}

/** The commands reservesTaskLine reads: what goes on and off the screen, and the asks. */
export interface PageCommandLike {
  ask?: AskLike;
  draw?: unknown;
  show?: unknown;
  erase?: unknown;
  hide?: unknown;
  clear?: { keep?: unknown } | unknown;
  card?: unknown;
}

const idsOf = (raw: unknown): string[] => (typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);

/**
 * Does a page keep the task line free under its heading? Only with a
 * heading — a bare page's ask may use the top slot as before — and an ask
 * that opens a gate on the figure. `figure` names the ids whose place the
 * reserve moves (the template's own ink, which the heading floor positions):
 * with it, only an ask that stands WITH some of that ink on screen (or that
 * draws a part of it, a guess on bar_2) reserves — a chart drawn after a
 * cards question keeps its place, and the author's notes beside it theirs.
 */
export function reservesTaskLine(page: { heading: boolean; commands?: readonly PageCommandLike[]; figure?: (id: string) => boolean }): boolean {
  if (!page.heading) return false;
  const figure = page.figure;
  const visible = new Set<string>();
  for (const c of page.commands ?? []) {
    if (c.ask !== undefined && opensFigureGate(c.ask)) {
      if (!figure) return true;
      if ([...visible, ...idsOf(c.ask.on)].some(figure)) return true;
    }
    for (const id of [...idsOf(c.draw), ...idsOf(c.show)]) visible.add(id);
    for (const id of [...idsOf(c.erase), ...idsOf(c.hide)]) visible.delete(id);
    if (c.card !== undefined) visible.clear();
    if (c.clear !== undefined) {
      const keep = new Set(idsOf((c.clear as { keep?: unknown } | null)?.keep));
      for (const id of [...visible]) if (!keep.has(id)) visible.delete(id);
    }
  }
  return false;
}
