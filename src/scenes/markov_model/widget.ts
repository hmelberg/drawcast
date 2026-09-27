// markov_model's widget body (2026-09-27): while the figure is paused the
// viewer works the model's NUMBERS where they are drawn — on the diagram's
// arrows and loops, in the transition matrix's cells, in its utility and
// cost columns — and the matrix's derived stays, the cohort trace, the
// lifetime totals and the ICER line all follow under the pointer.
//
//   a transition's probability      drag sideways ±0.01 a step (0.001 when
//   (t_label_<i>, matrix_cell_…)    the author wrote three decimals), from 0
//                                   up to what keeps the row's stay ≥ 0 —
//                                   the second option's row too, where it
//                                   inherits this transition
//   a stay (the loop's label, the   the stay is DERIVED (1 − the row's
//   matrix's diagonal)              exits): dragging it rescales that row's
//                                   exits in proportion so the stay becomes
//                                   the new value
//   the second option's values      its transitions (an entry is added for
//   (matrix_compare_…)              a transition it did not change yet), its
//                                   stay, its cost (drawn as the TOTAL a
//                                   year costs; stored as what it adds)
//   a utility, a cost               ±~1 % a step, never below 0 unless it
//                                   already was
//   any of them, tapped             a number field over it (type, Enter)
//
// Labels stay written the way the author wrote them ("0.10" stays two
// decimals, a decimal comma stays a comma). A labelled self-loop's caption
// is the stay, so it is rewritten whenever its row's exits change.
// Params are addressed by array index (states may be translated). The patch
// is always whole top-level params: `transitions`, `self_loops`, `trace`.
import type { Pt } from "../../layout/model";
import { amountScrub, decimalsOf, probabilityStep, rescaleShares, roundTo, scrubbed, writeLike } from "../number-scrub";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { compareTransitions, prob, slugify, withTextLabels, type MarkovParams, type MarkovSelfLoop, type MarkovTrace, type MarkovTransition } from "./layout";

type Layer = "base" | "compare";
export type MarkovTarget =
  | { kind: "exit"; layer: Layer; i: number; j: number; value: number; max: number; written?: string; name: string }
  | { kind: "stay"; layer: Layer; i: number; value: number; written?: string; name: string }
  | { kind: "utility" | "cost" | "compare_cost"; k: number; value: number; name: string };

/** The transitions out of state i that the matrix reads (explicit, to another drawn state), with their probability. */
function exitsOf(params: MarkovParams, transitions: MarkovTransition[], i: number): { t: MarkovTransition; j: number; p: number | null }[] {
  const s = params.states;
  return transitions.flatMap((t) => {
    const j = s.indexOf(t.to);
    return t.from === s[i] && j >= 0 && j !== i ? [{ t, j, p: prob(t.label) }] : [];
  });
}

/** Row i's exits summed, leaving out the one to state `skip`. */
function othersSum(params: MarkovParams, transitions: MarkovTransition[], i: number, skip: number): number {
  return exitsOf(params, transitions, i).reduce((a, e) => a + (e.j === skip ? 0 : (e.p ?? 0)), 0);
}

/** The second option's transition list (compare's entries over the base), or null without compare. */
function compareList(params: MarkovParams): MarkovTransition[] | null {
  return params.trace?.compare ? compareTransitions(params.transitions, params.trace.compare.transitions) : null;
}

/** A labelled self-loop entry's label for state `name`, if any. */
function loopLabel(params: MarkovParams, name: string): string | undefined {
  for (const e of params.self_loops ?? []) if (typeof e !== "string" && e.state === name) return e.label;
  return undefined;
}

/** State index by slug; -1 when none. */
const bySlug = (params: MarkovParams, slug: string): number => params.states.findIndex((s) => slugify(s) === slug);

/** "matrix_cell_<from>_<to>" → [i, j] (slugs may hold "_", so every pair is tried). */
function pairOf(params: MarkovParams, rest: string): [number, number] | null {
  const s = params.states;
  for (let i = 0; i < s.length; i++) {
    const a = slugify(s[i]);
    if (!rest.startsWith(`${a}_`)) continue;
    const j = s.findIndex((t) => slugify(t) === rest.slice(a.length + 1));
    if (j >= 0) return [i, j];
  }
  return null;
}

function exitTarget(params: MarkovParams, layer: Layer, i: number, j: number): MarkovTarget | null {
  const s = params.states;
  const base = params.transitions.find((t) => t.from === s[i] && t.to === s[j]);
  if (!base) return null; // only transitions that exist
  const list = layer === "base" ? params.transitions : compareList(params);
  if (!list) return null;
  const t = list.find((x) => x.from === s[i] && x.to === s[j])!;
  const value = prob(t.label);
  if (value === null) return null;
  let max = 1 - othersSum(params, list, i, j);
  // The second option inherits every base transition it does not change: a
  // base exit it inherits must keep ITS row's stay ≥ 0 too.
  const cmp = layer === "base" ? compareList(params) : null;
  const inherited = cmp && !(params.trace?.compare?.transitions ?? []).some((x) => x.from === s[i] && x.to === s[j]);
  if (cmp && inherited) max = Math.min(max, 1 - othersSum(params, cmp, i, j));
  const name = `${s[i]} → ${s[j]} probability${layer === "compare" ? ` (${params.trace!.compare!.name})` : ""}`;
  return { kind: "exit", layer, i, j, value, max: Math.max(0, roundTo(max, 6)), ...(t.label !== undefined ? { written: t.label } : {}), name };
}

function stayTarget(params: MarkovParams, layer: Layer, i: number, written?: string): MarkovTarget | null {
  const list = layer === "base" ? params.transitions : compareList(params);
  if (!list) return null;
  const exits = exitsOf(params, list, i);
  // A stay moves only by moving exits: none (an absorbing state), or one that
  // is not a probability, and there is nothing to rescale.
  if (exits.length === 0 || exits.some((e) => e.p === null)) return null;
  const derived = 1 - exits.reduce((a, e) => a + (e.p ?? 0), 0);
  const shown = written !== undefined ? prob(written) : null;
  const like = written ?? exits.find((e) => e.t.label !== undefined)?.t.label;
  const name = `${params.states[i]} stay probability${layer === "compare" ? ` (${params.trace!.compare!.name})` : ""}`;
  return { kind: "stay", layer, i, value: roundTo(shown ?? Math.max(0, derived), 6), ...(like !== undefined ? { written: like } : {}), name };
}

/** What a press on part `id` takes hold of, or null. */
export function markovTarget(id: string, scene: WidgetScene): MarkovTarget | null {
  const params = withTextLabels(scene.params as unknown as MarkovParams);
  if (!Array.isArray(params.states) || !Array.isArray(params.transitions)) return null;
  const s = params.states;
  const tr = params.trace;
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^t_label_(\d+)$/))) {
    const t = params.transitions[Number(m[1])];
    if (!t) return null;
    const i = s.indexOf(t.from), j = s.indexOf(t.to);
    return i >= 0 && j >= 0 && i !== j ? exitTarget(params, "base", i, j) : null;
  }
  if ((m = id.match(/^loop_label_(.+)$/))) {
    const i = bySlug(params, m[1]);
    const label = i >= 0 ? loopLabel(params, s[i]) : undefined;
    return label !== undefined && prob(label) !== null ? stayTarget(params, "base", i, label) : null;
  }
  // A pair of state slugs first; "matrix_compare_cost_<s>" is not one (unless
  // a state's slug makes it one) and falls through to the columns below.
  const pair = (m = id.match(/^matrix_(cell|compare)_(.+)$/)) ? pairOf(params, m[2]) : null;
  if (m && pair) {
    const layer: Layer = m[1] === "cell" ? "base" : "compare";
    return pair[0] === pair[1] ? stayTarget(params, layer, pair[0]) : exitTarget(params, layer, pair[0], pair[1]);
  }
  if ((m = id.match(/^matrix_(utility|cost|compare_cost)_(.+)$/))) {
    const k = bySlug(params, m[2]);
    if (k < 0 || !tr) return null;
    if (m[1] === "utility") return { kind: "utility", k, value: tr.utility?.[k] ?? 0, name: `QALYs a year in ${s[k]}` };
    if (m[1] === "cost") return { kind: "cost", k, value: tr.cost?.[k] ?? 0, name: `Cost a year in ${s[k]}` };
    if (!tr.compare) return null;
    return { kind: "compare_cost", k, value: (tr.cost?.[k] ?? 0) + (tr.compare.cost?.[k] ?? 0), name: `${tr.compare.name}: cost a year in ${s[k]}` };
  }
  return null;
}

/** The value a sideways drag of dx sets, from the target's value at the press. */
export function markovScrub(t: MarkovTarget, dx: number): number {
  if (t.kind === "exit") return scrubbed(t.value, dx, probabilityStep(t.written), 0, t.max);
  if (t.kind === "stay") return scrubbed(t.value, dx, probabilityStep(t.written), 0, 1);
  const { step, min } = amountScrub(t.value, t.kind === "utility" ? 0.01 : 1);
  return scrubbed(t.value, dx, step, min);
}

/** The number field a tap on the target opens. */
export function markovField(t: MarkovTarget): EditField {
  if (t.kind === "exit" || t.kind === "stay") return { value: t.value, label: t.name, min: 0, max: t.kind === "exit" ? t.max : 1, step: probabilityStep(t.written) };
  const { step, min } = amountScrub(t.value, t.kind === "utility" ? 0.01 : 1);
  return { value: t.value, label: t.name, ...(Number.isFinite(min) && t.kind !== "utility" ? { min } : {}), step };
}

/** Self-loops with state i's caption rewritten to the stay its exits now leave. */
function loopsWithStay(params: MarkovParams, transitions: MarkovTransition[], i: number, stay?: number): MarkovSelfLoop[] | undefined {
  const name = params.states[i];
  const label = loopLabel(params, name);
  if (label === undefined || prob(label) === null) return undefined;
  const s = stay ?? 1 - exitsOf(params, transitions, i).reduce((a, e) => a + (e.p ?? 0), 0);
  const places = Math.max(2, decimalsOf(label), ...exitsOf(params, transitions, i).map((e) => (e.t.label ? decimalsOf(e.t.label) : 0)));
  const text = writeLike(roundTo(Math.max(0, s), places), label, places);
  return (params.self_loops ?? []).map((e) => (typeof e !== "string" && e.state === name ? { ...e, label: text } : e));
}

/** Row i's exits in `list` rescaled so they leave `stay`; returns the new labels by `to` index. */
function rescaledRow(params: MarkovParams, list: MarkovTransition[], i: number, stay: number): Map<number, string> {
  const exits = exitsOf(params, list, i);
  const places = Math.min(4, Math.max(2, decimalsOf(roundTo(stay, 6)), ...exits.map((e) => (e.t.label ? decimalsOf(e.t.label) : 0))));
  const next = rescaleShares(exits.map((e) => e.p ?? 0), 1 - roundTo(stay, places), places);
  return new Map(exits.map((e, k) => [e.j, writeLike(next[k], e.t.label, places)]));
}

/** The second option's `compare.transitions` with (from, to) set to label. */
function withCompareEntries(params: MarkovParams, labels: Map<number, string>, i: number): MarkovTransition[] {
  const s = params.states;
  const out = (params.trace?.compare?.transitions ?? []).map((t) => ({ ...t }));
  for (const [j, label] of labels) {
    const at = out.find((t) => t.from === s[i] && t.to === s[j]);
    if (at) at.label = label;
    else out.push({ from: s[i], to: s[j], label });
  }
  return out;
}

const padded = (a: number[] | undefined, n: number): number[] => Array.from({ length: n }, (_, k) => a?.[k] ?? 0);

/** The patch that puts the target at v. */
export function markovPatch(t: MarkovTarget, v: number, params: MarkovParams): Record<string, unknown> {
  const s = params.states;
  const tr: MarkovTrace = params.trace ?? {};
  if (t.kind === "exit") {
    if (t.layer === "base") {
      const transitions = params.transitions.map((x) => (x.from === s[t.i] && x.to === s[t.j] ? { ...x, label: writeLike(v, x.label, Math.max(2, decimalsOf(t.written ?? ""))) } : x));
      const loops = loopsWithStay(params, transitions, t.i);
      return { transitions, ...(loops ? { self_loops: loops } : {}) };
    }
    const label = writeLike(v, t.written, Math.max(2, decimalsOf(t.written ?? "")));
    return { trace: { ...tr, compare: { ...tr.compare!, transitions: withCompareEntries(params, new Map([[t.j, label]]), t.i) } } };
  }
  if (t.kind === "stay") {
    if (t.layer === "base") {
      const labels = rescaledRow(params, params.transitions, t.i, v);
      const transitions = params.transitions.map((x) => {
        const j = s.indexOf(x.to);
        return x.from === s[t.i] && labels.has(j) ? { ...x, label: labels.get(j)! } : x;
      });
      const loops = loopsWithStay(params, transitions, t.i, v);
      return { transitions, ...(loops ? { self_loops: loops } : {}) };
    }
    const labels = rescaledRow(params, compareList(params)!, t.i, v);
    return { trace: { ...tr, compare: { ...tr.compare!, transitions: withCompareEntries(params, labels, t.i) } } };
  }
  const n = s.length;
  if (t.kind === "utility") {
    const utility = padded(tr.utility, n);
    utility[t.k] = v;
    return { trace: { ...tr, utility } };
  }
  if (t.kind === "cost") {
    const cost = padded(tr.cost, n);
    cost[t.k] = v;
    return { trace: { ...tr, cost } };
  }
  // The drawn value is the year's TOTAL; what compare stores is what it adds.
  const extra = padded(tr.compare?.cost, n);
  extra[t.k] = roundTo(v - (tr.cost?.[t.k] ?? 0), 6);
  return { trace: { ...tr, compare: { ...tr.compare!, cost: extra } } };
}

/** Every drawn part that holds a number the viewer may change. */
export function markovParts(scene: WidgetScene): string[] {
  return scene.ids.filter((id) => /^(t_label_|loop_label_|matrix_(cell|compare|utility|cost|compare_cost)_)/.test(id) && markovTarget(id, scene) !== null);
}

export function markovWidget(): WidgetBody {
  return {
    live: true,
    parts: markovParts,
    editable(id: string, _point: Pt, scene: WidgetScene) {
      const t = markovTarget(id, scene);
      return t ? markovField(t) : null;
    },
    init: () => ({}),
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      // A label an animate left as a number is text again in the patch.
      const params = withTextLabels(scene.params as unknown as MarkovParams);
      if (event.type === "input") {
        const t = markovTarget(event.id, scene);
        return { state, effects: t ? [{ patch: markovPatch(t, event.value, params) }] : [] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return { state, effects: [] };
      if (!event.from) return { state, effects: [] };
      const t = markovTarget(event.id, scene);
      if (!t) return { state, effects: [] };
      return { state, effects: [{ patch: markovPatch(t, markovScrub(t, event.point[0] - event.from[0]), params) }] };
    },
  };
}
