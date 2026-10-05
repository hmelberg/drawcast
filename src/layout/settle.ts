// Vertical settling (page frame spec 2026-10-04, W18): after layout, the
// page's figure — everything it draws over the whole run, the heading
// excepted — is moved up or down as ONE piece so the empty space above and
// below it in the content area is even. Hans 2026-10-04: "on some pages
// there is quite a lot of white space below even after everything is drawn
// (and it is still sometimes squeezed in the top half)". Horizontal
// placement already centres (cards, scales, templates); this is the
// vertical half, done once on the finished layout, never by stretching what
// an author placed.
//
// One translation, carried where every reader of positions already looks:
// the drawables, the named anchors and piece geometry move with it, and the
// layout's `fit` carries it (TemplateFit.settle) so `{data: [x, y]}`, a
// command's canvas point (`point: {at: {x, y}}`) and a guess's domain
// mapping all land where the ink now is (layout.ts domainMapping). Geometry
// that is computed from the spec rather than read off the layout — a cards
// element's slots and bins — is moved by settleCardsGeometry, which the
// renderer applies to what it hands the player and the plan.
//
// A page settles only when nothing about it moves over the run in a way a
// single base layout cannot see (animate, move, morph, …), when no part of
// it is pinned to page geometry it would leave behind (a code pane, insets,
// a camera aimed at canvas coordinates), and when the figure does not
// already fill the content area. Escape hatch: `page.valign` — "center"
// (default), "top" (the figure's top at the content area's top) or "none".

import type { BBox } from "./geometry";
import type { Drawable, Pt } from "./model";
import type { Spec } from "../spec/types";
import type { CardsGeometry } from "../spec/cards";
import { shiftDrawables } from "./place";

/** Gaps more uneven than this (logical units) are settled; less is noise.
 *  It is also the "already fills the page" rule: a figure within 30 of the
 *  content area's height (≥ 94 % of its 545) has no gaps that uneven. A
 *  separate 85 % cut was tried and left three quiz pages with their cards
 *  touching the heading (gaps above / below 2 / 69, −13 / 77) as they were.
 *  Was 60 until 2026-10-05: ants-on-earth kept its figure tight under the
 *  heading with 35 spare below it (+ the caption band) — a visible lean
 *  that the old slack called noise. 30 is about one line of tick numbers:
 *  an imbalance under it does not read as one.
 *
 *  Centred, not biased: the content area itself already sits high on the
 *  page (its centre, 382, is 36 above the middle of the room under the
 *  heading's underline, 693 … 0, because the caption band below is taller
 *  than the heading's gap above) — that is the optical lift, and the
 *  overlaid caption fills part of the band while the narration runs. A
 *  further upward bias would bring back the empty bottom this fixes. */
export const SETTLE_SLACK = 30;
/** What the figure keeps between itself and something pinned to the page. */
const PINNED_GAP = 10;

export type VAlign = "center" | "top" | "none";

/** The page's `valign` hatch (default center). */
export function pageVAlign(spec: Pick<Spec, "page">): VAlign {
  return spec.page?.valign ?? "center";
}

/**
 * How far to move `union` (y-up) inside `area` so the gaps above and below
 * are even — 0 when they already nearly are (within SETTLE_SLACK) or when
 * the figure is taller than the area. "top" lifts (or lowers) the figure's top to the area's top
 * instead. `pinned`: boxes that stay where they are (a note pinned to a
 * corner); the move stops PINNED_GAP short of any that share the figure's
 * columns. Whole units.
 */
export function settleOffset(union: BBox, area: BBox, opts: { valign?: VAlign; pinned?: BBox[] } = {}): number {
  const valign = opts.valign ?? "center";
  if (valign === "none" || !(union.h > 0) || union.h > area.h) return 0;
  const below = union.y - area.y;
  const above = area.y + area.h - (union.y + union.h);
  let dy: number;
  if (valign === "top") dy = above;
  else {
    if (Math.abs(below - above) <= SETTLE_SLACK) return 0;
    dy = (above - below) / 2;
  }
  // Something pinned in the figure's columns is a floor (or a ceiling) the
  // move may not cross — and a move that would have to go the other way is
  // no move.
  const mid = union.y + union.h / 2;
  for (const p of opts.pinned ?? []) {
    if (p.x >= union.x + union.w || p.x + p.w <= union.x) continue;
    if (dy < 0 && p.y + p.h / 2 < mid) dy = Math.min(0, Math.max(dy, p.y + p.h + PINNED_GAP - union.y));
    else if (dy > 0 && p.y + p.h / 2 > mid) dy = Math.max(0, Math.min(dy, p.y - PINNED_GAP - (union.y + union.h)));
  }
  return Math.round(dy);
}

/** Commands whose figure moves (or grows) over the run in ways the base layout does not show. */
const MOVING_VERBS = ["animate", "move", "arrange", "flip", "morph", "copy", "ghost", "trail", "run", "explore", "step"] as const;

/**
 * Why this page must not be settled, or null when it may be. The layout's
 * own facts come in `facts`: a template that laid itself out in (or was
 * fitted to) a box, a world larger than the page, an interactive template.
 */
export function settleBlocker(
  spec: Spec,
  facts: { heading: boolean; templateBoxed: boolean; world: boolean; interactive: boolean },
): string | null {
  if (pageVAlign(spec) === "none") return "page.valign none";
  // The figure is settled UNDER the heading. A page with none — heading:
  // false, no title, an author who drew in the strip — was composed on the
  // whole canvas by hand, and keeps it.
  if (!facts.heading) return "no heading";
  if (spec.book !== undefined) return "a book page";
  // Nothing plays, so nothing is a page yet: a template's preview, a figure
  // laid out on its own (the default heading draws only with commands too).
  if ((spec.commands ?? []).length === 0) return "no commands";
  if (facts.templateBoxed) return "the template is placed in its box";
  if (facts.world) return "the template's world is larger than the page";
  if (facts.interactive) return "an interactive template";
  if (spec.vars && Object.keys(spec.vars).length > 0) return "live vars";
  for (const el of spec.elements ?? []) {
    if (el.type === "inset") return "insets";
    if (el.type === "code" && el.show !== "none") return "a code pane";
  }
  const commands = spec.commands ?? [];
  // The verbs first: they are what every tween frame of an animated cast
  // hits, and they need no stringifying.
  for (const cmd of commands) {
    const verb = MOVING_VERBS.find((v) => (cmd as Record<string, unknown>)[v] !== undefined);
    if (verb) return `a ${verb} command`;
  }
  // (A guess on a scale settles with the page: its handle carries the line
  // where the layout drew it — guess/handles.ts scaleHandle, from fit.settle.)
  for (const cmd of commands) {
    // Canvas units the plan does not map (`{canvas: [x, y]}`), and a camera
    // aimed at numbers rather than at a part.
    if (JSON.stringify(cmd).includes('"canvas":')) return "canvas coordinates in a command";
    if (cmd.camera && /"(x|y|w|h|box)":/.test(JSON.stringify(cmd.camera))) return "a camera at canvas coordinates";
  }
  return null;
}

/**
 * The ids that stay where they are: anything pinned to the page (`at:
 * {place}`), and what is placed against it or labels it — and the card
 * headings (`card_<n>_…`), which the caller leaves out by name.
 */
export function pinnedIds(elements: Spec["elements"], groups: Record<string, string[]>): Set<string> {
  const els = elements ?? [];
  const pinned = new Set<string>();
  for (const el of els) {
    const at = el.at as { place?: unknown } | undefined;
    if (at && !Array.isArray(at) && at.place !== undefined) pinned.add(el.id);
  }
  let grew = pinned.size > 0;
  while (grew) {
    grew = false;
    for (const el of els) {
      if (pinned.has(el.id)) continue;
      const ref = (el.at as { ref?: unknown } | undefined)?.ref;
      const host = typeof ref === "string" ? ref : el.type === "label" ? el.attach_to : undefined;
      if (host !== undefined && pinned.has(host)) {
        pinned.add(el.id);
        grew = true;
      }
    }
  }
  for (const id of [...pinned]) for (const m of groups[id] ?? []) pinned.add(m);
  return pinned;
}

/** Translate top-level drawables (and the window a code pane scrolls under) by dy, in place. */
export function shiftAll(ds: Drawable[], dy: number): void {
  shiftDrawables(ds, 0, dy);
  const clips = (list: Drawable[]): void => {
    for (const d of list) {
      if (d.clip) d.clip = { ...d.clip, y: d.clip.y + dy };
      if (d.kind === "group") clips(d.children);
    }
  };
  clips(ds);
}

const up = (p: Pt, dy: number): Pt => [p[0], p[1] + dy];

/**
 * A cards element's geometry where a settled page draws it: every position
 * it holds moved by dy (its homes, slots, bins, truth, its scale's line).
 * The geometry is computed from the spec (spec/cards.ts), the cards from the
 * layout — this keeps the two together. dy 0 or no geometry: as it was.
 */
export function settleCardsGeometry<G extends CardsGeometry | null>(g: G, dy: number): G {
  if (!g || dy === 0) return g;
  const src = g as CardsGeometry;
  const out: CardsGeometry = {
    ...src,
    home: src.home.map((p) => up(p, dy)),
    slots: src.slots.map((p) => up(p, dy)),
    truth: src.truth.map((p) => up(p, dy)),
    binBoxes: src.binBoxes.map((b) => ({ ...b, c: up(b.c, dy) })),
    binSlot: (k, j, count) => up(src.binSlot(k, j, count), dy),
  };
  if (src.placeAt) out.placeAt = (values) => src.placeAt!(values).map((p) => up(p, dy));
  if (src.scale) out.scale = { ...src.scale, y: src.scale.y + dy };
  return out as G;
}
