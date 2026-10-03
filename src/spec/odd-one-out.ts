// ODD ONE OUT (spec 2026-10-04-page-frame, W13): four or five things, one
// of which does not belong; the viewer taps it.
//
// Two ways to write it:
//
//   cards  {"id": "zoo", "type": "cards", "items": [{"text": "Whale"}, …,
//           {"text": "Shark", "odd": true}], "rule": "All four are mammals; the shark is a fish."}
//          then {"ask": {"question": "Which one is not a mammal? Tap it.", "on": "zoo"}}
//   choose {"ask": {"question": "…", "choose": ["a", "b", "c"], "answer": "c", "rule": "…"}}
//          over things already drawn.
//
// Sugar, expanded after the cards (spec/expand.ts) into ordinary things, so
// the viewer answers through the choose gate (ui/choose-gate.ts — ✓/✗ on the
// tapped thing, the odd one glowing while `right` is spoken; a movie's
// pointer taps it):
//
//   the cards' ask          → ask {choose: the cards left to right, answer: the odd card, rule}
//   elements <base>_odd     an annotation ringing the odd one
//            <base>_rule    the rule, quiet, under the options (when there is a rule)
//   ask.reveal_draw         [<base>_odd, <base>_rule] — drawn as the answer is revealed
//
// <base> is the cards' id, or odd_<k> for the k-th choose ask with a rule.

import type { BBox } from "../layout/geometry";
import { CAPTION_TOP, PAGE_W } from "../layout/page";
import { declaredBox } from "./answer-buttons";
import type { AskArgs, Command, Spec, SpecElement } from "./types";

/** The rule's look: quiet, a size under the cards' text. */
const RULE_FONT = 24;
const RULE_INK = "#6b655a";
/** Between the options' lowest edge and the rule's middle. */
const RULE_GAP = 34;
/** The rule never reaches into the caption band. */
const RULE_FLOOR = CAPTION_TOP + 20;

type Loose = Record<string, unknown>;

/** The odd item's index (0-based) of a cards element's raw items, or -1. Exactly one counts. */
export function oddIndex(items: unknown): number {
  if (!Array.isArray(items)) return -1;
  const odd = items.flatMap((it, i) => (it && typeof it === "object" && (it as Loose).odd === true ? [i] : []));
  return odd.length === 1 ? odd[0] : -1;
}

const onOf = (ask: AskArgs): string | undefined =>
  typeof ask.on === "string" ? ask.on : Array.isArray(ask.on) && ask.on.length === 1 ? ask.on[0] : undefined;

function unionOf(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where the rule is written: under the options, or over them when below would reach the caption band. */
export function rulePlace(options: BBox | null): { x: number; y: number } {
  if (!options) return { x: PAGE_W / 2, y: RULE_FLOOR + RULE_FONT };
  const x = options.x + options.w / 2;
  const below = options.y - RULE_GAP;
  return below >= RULE_FLOOR ? { x, y: below } : { x, y: options.y + options.h + RULE_GAP };
}

/**
 * The cards form becomes a choose ask, and every choose ask with a rule (or
 * from odd cards) gets its ring and rule. The same object back when there is
 * nothing to expand; an ask that already carries reveal_draw is left alone.
 */
export function expandOddOneOut(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  const els = spec.elements ?? [];
  const byId = new Map(els.map((e) => [e.id, e]));
  // Cards groups (spec/cards.ts carries items and rule on the group) with one odd item.
  const oddSets = new Map<string, { odd: string; cards: string[]; rule?: string }>();
  for (const el of els) {
    const e = el as unknown as Loose;
    if (el.type !== "group" || !Array.isArray(e.items)) continue;
    const k = oddIndex(e.items);
    if (k < 0) continue;
    const cards = (e.items as unknown[]).map((_, i) => `${el.id}_${i + 1}`).filter((id) => byId.has(id));
    if (cards.length !== (e.items as unknown[]).length) continue;
    // Left to right, as they stand: the 1–9 keys and Tab follow the eye.
    const x = (id: string): number => {
      const v = (byId.get(id) as unknown as Loose).x;
      return typeof v === "number" ? v : 0;
    };
    cards.sort((a, b) => x(a) - x(b));
    oddSets.set(el.id, { odd: `${el.id}_${k + 1}`, cards, ...(typeof e.rule === "string" && e.rule.trim() !== "" ? { rule: e.rule.trim() } : {}) });
  }
  if (oddSets.size === 0 && !cmds.some((c) => c.ask?.choose !== undefined && typeof c.ask.rule === "string" && c.ask.reveal_draw === undefined)) return spec;

  const taken = new Set(els.map((e) => e.id));
  const added: SpecElement[] = [];
  let ordinal = 0;
  const out: Command[] = cmds.map((cmd) => {
    const ask = cmd.ask;
    if (!ask || ask.reveal_draw !== undefined) return cmd;
    const on = onOf(ask);
    const set = on !== undefined ? oddSets.get(on) : undefined;
    let next: AskArgs;
    let base: string;
    if (set && on !== undefined && ask.choose === undefined) {
      const { on: _on, tolerance: _t, ...rest } = ask;
      next = { ...rest, choose: set.cards, answer: set.odd, ...(set.rule !== undefined && rest.rule === undefined ? { rule: set.rule } : {}) };
      base = on;
    } else if (Array.isArray(ask.choose) && typeof ask.rule === "string" && typeof ask.answer === "string") {
      next = { ...ask };
      do base = `odd_${++ordinal}`;
      while (taken.has(`${base}_odd`) || taken.has(`${base}_rule`));
    } else return cmd;

    const answer = next.answer!;
    const ids = (next.choose ?? []).map((o) => (typeof o === "string" ? o : o.id));
    const reveal: string[] = [];
    const ring = `${base}_odd`;
    if (!taken.has(ring)) {
      added.push({ id: ring, type: "annotation", kind: "circle", target: [answer] } as SpecElement);
      taken.add(ring);
      reveal.push(ring);
    }
    const rule = typeof next.rule === "string" ? next.rule.trim() : "";
    const ruleId = `${base}_rule`;
    if (rule !== "" && !taken.has(ruleId)) {
      const boxes = ids.flatMap((id) => {
        const el = byId.get(id);
        const b = el ? declaredBox(el) : null;
        return b ? [b] : [];
      });
      const at = rulePlace(unionOf(boxes));
      added.push({ id: ruleId, type: "text", text: rule, x: Math.round(at.x), y: Math.round(at.y), font_size: RULE_FONT, style: { color: RULE_INK } } as SpecElement);
      taken.add(ruleId);
      reveal.push(ruleId);
    }
    return { ...cmd, ask: { ...next, ...(reveal.length > 0 ? { reveal_draw: reveal } : {}) } };
  });
  return added.length === 0 && out.every((c, i) => c === cmds[i]) ? spec : { ...spec, elements: [...els, ...added], commands: out };
}

/** What is wrong with the odd-one-out sets and rules of an authored spec (schema.ts semanticErrors). */
export function oddErrors(spec: Pick<Spec, "elements" | "commands">): string[] {
  const errs: string[] = [];
  const oddCards = new Set<string>();
  for (const el of spec.elements ?? []) {
    if (el.type !== "cards") continue;
    const e = el as unknown as Loose;
    const items = Array.isArray(e.items) ? (e.items as unknown[]) : [];
    const n = items.filter((it) => it && typeof it === "object" && (it as Loose).odd === true).length;
    if (n === 0) {
      if (e.rule !== undefined) errs.push(`${el.id}: rule belongs to an odd one out — mark one item odd: true`);
      continue;
    }
    oddCards.add(el.id);
    if (n > 1) errs.push(`${el.id}: an odd one out has exactly one item with odd: true (${n} have it)`);
    if (items.length < 3 || items.length > 6) errs.push(`${el.id}: an odd one out shows 3–6 cards (${items.length} given)`);
    const clash = (["bins", "select", "along", "compare", "pairs", "options", "fill", "ends", "deck"] as const).filter((k) => e[k] !== undefined);
    if (clash.length > 0) errs.push(`${el.id}: an odd one out is tapped, not ranked or sorted — leave out ${clash.join(", ")}`);
  }
  (spec.commands ?? []).forEach((cmd, i) => {
    const a = cmd.ask;
    if (!a || a.rule === undefined) return;
    const on = onOf(a);
    const fromCards = on !== undefined && oddCards.has(on);
    if (!fromCards && !(Array.isArray(a.choose) && typeof a.answer === "string")) {
      errs.push(`commands[${i}]: ask.rule needs choose with answer (the odd one), or on: odd-one-out cards`);
    }
  });
  return errs;
}
