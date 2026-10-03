// The sugar a spec may carry that expands into ordinary elements and
// commands before layout: a question's reveal stamp (spec/reveal-stamps.ts),
// on-canvas quiz buttons (spec/answer-buttons.ts), `card` beats (spec/card.ts), derivations (math `steps`, spec/derive.ts), a note_sheet's
// `sound: true` (spec/sound.ts), then walked groups (spec/walk.ts). One entry point, so every consumer — render, the
// compile-time lint, revise, the frames harness — expands the same way.

import { expandScratch } from "./scratch";
import { expandCards, expandDefaultHeading } from "./card";
import { expandDerivations } from "./derive";
import { expandSound } from "./sound";
import { expandWalks } from "./walk";
import { expandScales } from "./scale";
import { expandEstimates } from "./slider";
import { withIconData } from "./icon-data";
import { expandAnswerButtons } from "./answer-buttons";
import { expandSequences } from "./sequence";
import { expandRevealStamps, linkStampsToButtons } from "./reveal-stamps";
import { expandOddOneOut } from "./odd-one-out";
import { expandSpot } from "./spot";
import { expandPolls } from "./poll";
import { expandCards as expandCardSets, shuffleOrder, type CardItem } from "./cards";
import { formulaBlanks, hasBlanks } from "../formula/blanks";
import { expandEquationPreset } from "../scenes/equation_plot/presets";
import type { Spec, SpecElement } from "./types";

/** A positive seed from a string (FNV-1a, top 21 bits: shuffleOrder
 *  multiplies it by a 32-bit constant, which must stay exact in a double). */
function contentSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 11) || 1;
}

/**
 * Formula tiles (design 2026-10-03 §5.3): an ask on a math element with
 * `\blank{…}` and `others` gets its tiles as a cards element `<id>_tiles` in
 * mode fill — the right contents (each blank's TeX, tagged with its blank)
 * and the wrong ones, shuffled, in a row under the formula. Once per math id;
 * it runs before the cards expand, so the tiles expand like any cards.
 */
export function expandFormulaTiles(spec: Spec): Spec {
  const els = spec.elements ?? [];
  const added: SpecElement[] = [];
  const done = new Set(els.map((e) => e.id));
  for (const cmd of spec.commands ?? []) {
    const ask = cmd.ask;
    if (!ask || !Array.isArray(ask.others)) continue;
    const on = typeof ask.on === "string" ? ask.on : Array.isArray(ask.on) && ask.on.length === 1 ? ask.on[0] : undefined;
    const math = on === undefined ? undefined : els.find((e) => e.id === on);
    const tex = (math as { tex?: unknown } | undefined)?.tex;
    if (!math || math.type !== "math" || typeof tex !== "string" || !hasBlanks(tex)) continue;
    const id = `${math.id}_tiles`;
    if (done.has(id)) continue;
    done.add(id);
    const right: CardItem[] = formulaBlanks(math.id, tex).map((b) => ({ text: b.tex, blank: b.k }));
    // A cards element takes at most 8 items: the right ones always, then as many wrong ones as fit.
    const all: CardItem[] = [...right, ...ask.others.slice(0, Math.max(0, 8 - right.length)).map((t) => ({ text: String(t) }))];
    // Seeded by the content (the math id and every tile's text), so where
    // the right tile lands varies question to question — never just by the
    // count — yet a movie or a round-trip always sees the same row.
    const perm = shuffleOrder(all.length, contentSeed([math.id, ...all.map((t) => t.text)].join("\u0000")));
    // The row stands under the formula: the formula's centre less about half
    // its height, a gap, half a tile. A formula placed by `at` or auto-placed
    // has no x/y here — the row then sits under the canvas centre.
    const fs = typeof math.font_size === "number" ? math.font_size : 28;
    const mx = typeof math.x === "number" ? math.x : 500;
    const my = typeof math.y === "number" ? math.y : 375;
    added.push({ id, type: "cards", fill: math.id, items: perm.map((i) => all[i]), x: mx - 400, width: 800, y: Math.max(40, my - fs * 1.2 - 30 - 24) } as unknown as SpecElement);
  }
  return added.length === 0 ? spec : { ...spec, elements: [...els, ...added] };
}

/** Scales (spec/scale.ts), formula tiles, cards, derivations (math `steps`), sound, then walks — and an equation_plot
 *  `preset` written out into its params. The same object back when there is nothing to expand. */
/** A guess on a bar chart (round 7 §7): bar_guess on, so its per-bar colours
 *  skip the blue beside the guess's own. The same object back otherwise. */
export function markBarGuess(spec: Spec): Spec {
  if (spec.template !== "bar_chart" || !spec.params || spec.params.bar_guess === true) return spec;
  const asked = (spec.commands ?? []).some((c) => {
    const on = c.ask?.on;
    const ids = typeof on === "string" ? [on] : Array.isArray(on) ? on : [];
    return ids.some((id) => id === "all" || /^bar_\d+$/.test(id));
  });
  return asked ? { ...spec, params: { ...spec.params, bar_guess: true } } : spec;
}

export function expandSpec(spec: Spec): Spec {
  // Icons named by keyword take their data from `assets:` or the offline
  // cache FIRST (spec/icon-data.ts): a card's height depends on whether its
  // icon is there, and that is decided when the cards expand.
  return markBarGuess(expandWalks(expandSound(expandDerivations(expandDefaultHeading(expandCards(expandScratch(expandOddOneOut(expandCardSets(expandFormulaTiles(expandScales(expandEstimates(expandEquationPreset(withIconData(expandSpot(linkStampsToButtons(expandAnswerButtons(expandPolls(expandRevealStamps(expandSequences(spec))))))))))))))))))));
}
