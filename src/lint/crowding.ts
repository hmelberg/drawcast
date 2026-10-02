// The crowding lint (2026-09-28): the blind comparison's one clear loss for
// the story-first pipeline was the page — crowded, small labels, pieces left
// over from earlier beats. Layout lint judges pairs (does this label touch
// that stroke?); this judges the PAGE at each moment a viewer sees it: how
// many words the cast has put on it at once, and how much of it is small
// print.
//
// Per draw beat, the same reveal/conceal walk lint.ts's coVisible runs:
// draw/show reveal, erase/hide/clear conceal, and every id no visibility verb
// touched joins the implicit final draw (so the last state is the whole
// figure). A text item is one non-empty text drawable — a wrapped block is
// one item — an inset's picture excluded (another page's ink, small on
// purpose).
//
// Only the CAST's own elements count: a template's texts (a decision tree's
// numbers, a chart's ticks) are its designed page, judged by its own layout;
// what crowds a page in practice is what the cast piles on top. A code
// element's pane is excluded too — its rows are a program, not labels.
//
// Warnings only, and computed by the GENERATION path (compile.ts), not by
// layoutSpec: the bundled-examples gate holds layoutSpec's issues to zero,
// and a page count is an editor's judgement, not a defect. Thresholds were
// tuned on the bundled examples so almost none trip — tests/crowding-lint.
// test.ts pins the count.

import { lintableLeaves, type LintIssue } from "./lint";
import { SUB_SUFFIXES, type Drawable, type TextDrawable } from "../layout/model";
import type { Command, Spec } from "../spec/types";

/** More of the cast's own text items than this on one page state is crowding. */
export const CROWDING_MAX_TEXTS = 14;
/**
 * The small-print line (logical units): the player's smallest viewer text
 * size (layout/text-style.ts MIN_FONT_SIZE). lint.ts's FONT_FLOOR (14) is the
 * unreadable floor and warns on its own; this flags a page where several
 * pieces of small print share the page at once.
 */
export const SMALL_TEXT = 16;
/** More texts than this under SMALL_TEXT on one page state is a warning. */
export const SMALL_TEXT_MAX = 2;

export interface CrowdingState {
  /** Index of the command after which this page state is seen; -1 for the implicit final draw. */
  beat: number;
  texts: number;
  smallest: number | null;
  small: number;
}

export interface CrowdingOpts {
  /** A group / pieces id → its member ids (layoutSpec's groups and pieceGroups). */
  expandId?: (id: string) => string[] | null | undefined;
  /** Which top-level drawables count (default: all). */
  counts?: (id: string) => boolean;
  /** The FIGURE a top-level id belongs to, when its words are one thing on
   *  the page — a population's state sets and legend: however many entries
   *  its legend has, it counts as one item, not one per text. */
  figureOf?: (id: string) => string | undefined;
}

function ids(raw: string[] | string | undefined, expandId?: CrowdingOpts["expandId"]): string[] {
  const list = typeof raw === "string" ? [raw] : raw ?? [];
  return list.flatMap((id) => {
    const kids = expandId?.(id);
    return kids && kids.length > 0 ? kids : [id];
  });
}

/**
 * The page states a viewer sees: one after every command that reveals
 * something, plus the final state (the implicit draw of everything never
 * managed). Pure; exported for the tests and the author tooling.
 */
export function crowdingStates(drawables: Drawable[], commands: Command[] | undefined, opts: CrowdingOpts = {}): CrowdingState[] {
  // Top-level drawable id → its text leaves.
  const textsOf = new Map<string, TextDrawable[]>();
  for (const top of drawables) {
    if (opts.counts && !opts.counts(top.id)) continue;
    const texts = lintableLeaves([top]).filter((d): d is TextDrawable => d.kind === "text" && d.text.trim() !== "");
    if (texts.length > 0) textsOf.set(top.id, [...(textsOf.get(top.id) ?? []), ...texts]);
  }
  // An element's sub-drawables (`<id>_text`, `<id>_value`) go with it.
  const owners = (id: string): string[] => [id, ...SUB_SUFFIXES.map((s) => `${id}_${s}`)].filter((k) => textsOf.has(k));
  const visible = new Set<string>();
  const managed = new Set<string>();
  const states: CrowdingState[] = [];
  const snapshot = (beat: number) => {
    // One figure's words are one item, sized by its smallest.
    const items = new Map<string, number>();
    for (const id of visible) {
      const texts = textsOf.get(id) ?? [];
      if (texts.length === 0) continue;
      const fig = opts.figureOf?.(id);
      const sizes = texts.map((t) => t.fontSize);
      if (fig === undefined) sizes.forEach((sz, i) => items.set(`${id}#${i}`, sz));
      else items.set(`fig:${fig}`, Math.min(items.get(`fig:${fig}`) ?? Infinity, ...sizes));
    }
    if (items.size === 0) return;
    const sizes = [...items.values()];
    states.push({ beat, texts: sizes.length, smallest: Math.min(...sizes), small: sizes.filter((s) => s < SMALL_TEXT).length });
  };
  const mark = (id: string, on: boolean) => {
    for (const o of owners(id)) {
      if (on) visible.add(o);
      else visible.delete(o);
      managed.add(o);
    }
  };
  (commands ?? []).forEach((c, i) => {
    const revealed = [...ids(c.draw, opts.expandId), ...ids(c.show, opts.expandId)];
    for (const id of revealed) mark(id, true);
    for (const id of [...ids(c.erase, opts.expandId), ...ids(c.hide, opts.expandId)]) mark(id, false);
    if (c.clear !== undefined) {
      const keep = new Set(ids(c.clear.keep, opts.expandId).flatMap(owners));
      for (const id of [...visible]) if (!keep.has(id)) mark(id, false);
    }
    if (revealed.length > 0) snapshot(i);
  });
  for (const id of textsOf.keys()) if (!managed.has(id)) visible.add(id);
  snapshot(-1);
  return states;
}

/** The ids the crowding lint counts for `spec`: its own elements (and their sub-drawables), code panes excluded. */
export function castOwnIds(spec: Spec, minted: Record<string, string[]> = {}): (id: string) => boolean {
  const own = new Set((spec.elements ?? []).filter((e) => e.type !== "code").map((e) => e.id));
  // What an element of the cast mints under ids of its own (a population's
  // sets and legend) is the cast's too.
  for (const e of spec.elements ?? []) if (e.type === "population") for (const k of minted[e.id] ?? []) own.add(k);
  return (id) => own.has(id) || SUB_SUFFIXES.some((s) => id.endsWith(`_${s}`) && own.has(id.slice(0, -(s.length + 1))));
}

/** Top-level id → the population or deck it belongs to (its sets and legend, or its cards and boxes, are one figure). */
export function populationFigures(spec: Spec, minted: Record<string, string[]> = {}): (id: string) => string | undefined {
  const of = new Map<string, string>();
  for (const e of spec.elements ?? []) if (e.type === "population") for (const k of minted[e.id] ?? []) of.set(k, e.id);
  // A deck (cards with deck: true, up to 30) is one designed composition:
  // its small cards in their boxes are one figure, not thirty labels. (The
  // expanded spec keeps the flag on the cards' group.)
  const decks = (spec.elements ?? []).filter((e) => (e.type === "cards" || e.type === "group") && (e as { deck?: unknown }).deck === true).map((e) => e.id);
  const deckOf = (id: string) => decks.find((d) => id === d || new RegExp(`^${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+|bin_\\d+)(_|$)`).test(id));
  return (id) => of.get(id) ?? deckOf(id);
}

/**
 * The crowding warnings for one laid-out spec: at most one per kind (the
 * worst page state), so a crowded figure costs one line in the repair
 * feedback, not one per beat.
 */
export function lintCrowding(
  layout: { drawables: Drawable[]; groups?: Record<string, string[]>; pieceGroups?: Record<string, string[]> },
  spec: Spec,
): LintIssue[] {
  const states = crowdingStates(layout.drawables, spec.commands, {
    expandId: (id) => layout.pieceGroups?.[id] ?? layout.groups?.[id],
    counts: castOwnIds(spec, layout.pieceGroups),
    figureOf: populationFigures(spec, layout.pieceGroups),
  });
  const issues: LintIssue[] = [];
  const where = (s: CrowdingState) => (s.beat < 0 ? "on the finished page" : `after commands[${s.beat}]`);
  const crowded = states.filter((s) => s.texts > CROWDING_MAX_TEXTS).sort((a, b) => b.texts - a.texts)[0];
  if (crowded) {
    issues.push({
      rule: "crowding",
      ids: [],
      message: `${crowded.texts} text items are on the page at once ${where(crowded)} (more than ${CROWDING_MAX_TEXTS}) — erase what has served, merge labels, or say it instead of writing it`,
      severity: "warn",
    });
  }
  const small = states.filter((s) => s.small > SMALL_TEXT_MAX).sort((a, b) => b.small - a.small)[0];
  if (small) {
    issues.push({
      rule: "crowding",
      ids: [],
      message: `${small.small} texts smaller than ${SMALL_TEXT} units share the page ${where(small)} (smallest ${Math.round(small.smallest ?? 0)}) — give the figure more room or draw fewer, larger things`,
      severity: "warn",
    });
  }
  return issues;
}
