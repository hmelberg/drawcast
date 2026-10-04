// The ESTIMATE SLIDER (page frame 2026-10-04, W15): a scale drawn as a
// chunky slider with a big counter over it — "How many bones does an adult
// have?". Sugar twice over: an ask's `estimate` becomes a scale element with
// `slider: true` (expandEstimates), and that scale expands like any scale
// (spec/scale.ts) — only its drawing differs:
//
//   <id>              the track, its end/tick numbers (and the caption)
//   <id>_answer       the thumb (<id>_answer_pin) and the big counter
//                     (<id>_answer_num), at the value
//
// The guess on it is the scale guess (guess/handles.ts, kind "point"): the
// same numbers, format (words on log scales, BC years), scoring and vars.
// Only the marks differ (guess/slider-marks.ts): the counter runs to the
// truth, your thumb stays faded, the gap is bracketed.

import { INK } from "../layout/model";
import type { Spec, SpecElement, AskArgs } from "./types";
import { scaleGeometry, scaleTickLabels, type ScaleElementLike, type ScaleGeometry } from "./scale";

/** The counter's size at 1× (the brief: a BIG number, ~90). */
export const COUNTER_SIZE = 88;
/** The thumb's radius and the track's half height (touch-friendly). */
export const THUMB_R = 24;
const TRACK_HALF = 9;
/** How far over the track the counter's centre stands. */
export const COUNTER_RISE = 150;
const TRACK_FILL = "#e9e3d7";
const TICK_INK = "#7a7468";

/** Is this scale a slider? */
export function isSlider(sc: Pick<ScaleElementLike, "slider"> | undefined | null): boolean {
  return sc?.slider === true;
}

/** A circle as a closed polygon (logical, y-up). */
export function circlePts(cx: number, cy: number, r: number, steps = 28): [number, number][] {
  const out: [number, number][] = [];
  for (let s = 0; s < steps; s++) out.push([cx + r * Math.cos((s / steps) * 2 * Math.PI), cy + r * Math.sin((s / steps) * 2 * Math.PI)]);
  return out;
}

/** A capsule from x0 to x1 around y, `half` high on each side. */
function capsule(x0: number, x1: number, y: number, half: number): [number, number][] {
  const out: [number, number][] = [];
  const n = 10;
  for (let s = 0; s <= n; s++) {
    const a = Math.PI / 2 + (s / n) * Math.PI;
    out.push([x0 + half * Math.cos(a), y + half * Math.sin(a)]);
  }
  for (let s = 0; s <= n; s++) {
    const a = -Math.PI / 2 + (s / n) * Math.PI;
    out.push([x1 + half * Math.cos(a), y + half * Math.sin(a)]);
  }
  return out;
}

/** Where the tick numbers' centres stand: under the thumb. */
export function sliderTickY(g: ScaleGeometry): number {
  return g.y - THUMB_R - 12 - Math.round((g.sizes?.tick ?? 22) * 0.5);
}

/** The counter's centre. */
export function counterAt(g: ScaleGeometry): [number, number] {
  return [(g.x0 + g.x1) / 2, g.y + COUNTER_RISE];
}

/** Where the track goes in a content box (y-up) with no y given: the counter
 *  over it and the numbers under it, the whole centred in the box. */
export function sliderY(box: { y: number; h: number }): number {
  return Math.round(box.y + box.h / 2 - 45);
}

/** The track, its tick numbers and the caption: `<id>` (a group) and its members. */
export function sliderLineElements(sc: ScaleElementLike, keep: Partial<SpecElement>, textScale = 1): SpecElement[] {
  const g = scaleGeometry(sc);
  const out: SpecElement[] = [
    { id: `${sc.id}_line`, type: "path", points: capsule(g.x0, g.x1, g.y, TRACK_HALF), closed: true, style: { color: TICK_INK, fill: TRACK_FILL, fill_style: "wash" } },
  ];
  const { labelled, size, text } = scaleTickLabels(g, textScale);
  const ty = sliderTickY(g);
  g.ticks.forEach((v, k) => {
    // The numbers alone, under the track: the counter writes the unit.
    out.push({ id: `${sc.id}_tick_${k + 1}_num`, type: "text", text: labelled.has(k) ? text(v) : "", x: g.xAt(v), y: ty, font_size: size, style: { color: TICK_INK } });
  });
  // Under the numbers, clear of the reveal's gap bracket and its words (guess/slider-marks.ts).
  const cap = g.sizes?.caption ?? 26;
  if (sc.label) out.push({ id: `${sc.id}_caption`, type: "text", text: sc.label, x: (g.x0 + g.x1) / 2, y: ty - Math.round(size * 0.65) - 64 - Math.round(cap * 0.5), font_size: cap, style: { color: TICK_INK } });
  out.push({ id: sc.id, type: "group", members: out.map((e) => e.id), ...keep });
  return out;
}

/** The thumb and the counter at value v: `<id>_answer` and its two members. */
export function sliderValueElements(sc: ScaleElementLike, v: number): SpecElement[] {
  const g = scaleGeometry(sc);
  const color = sc.style?.color ?? INK;
  const [cx, cy] = counterAt(g);
  return [
    { id: `${sc.id}_answer_pin`, type: "path", points: circlePts(g.xAt(v), g.y, THUMB_R), closed: true, style: { color, fill: color, fill_style: "wash" } },
    { id: `${sc.id}_answer_num`, type: "text", text: g.format(v), x: cx, y: cy, font_size: COUNTER_SIZE, style: { color } },
    { id: `${sc.id}_answer`, type: "group", members: [`${sc.id}_answer_pin`, `${sc.id}_answer_num`] },
  ];
}

/** An ask's estimate: the slider's numbers. */
export interface EstimateArgs {
  min: number;
  max: number;
  value: number;
  unit?: string;
  log?: boolean;
  label?: string;
  tick_format?: "words" | "numerals" | "power";
  era?: "BC" | "BCE" | "none";
}

/** The scale an ask's estimate draws: `estimate_<n>` (n counts the estimates). */
export function estimateId(n: number): string {
  return `estimate_${n}`;
}

/**
 * `ask.estimate` (W15) → a slider scale element and `on` its id, the ask
 * waiting for Done (release: false). The ask draws the slider itself (the
 * guess shows a slider's track too: guess/handles.ts). The same object back
 * when there is none.
 */
export function expandEstimates(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => c.ask?.estimate !== undefined)) return spec;
  const ids = new Set((spec.elements ?? []).map((e) => e.id));
  const added: SpecElement[] = [];
  let n = 0;
  const commands = cmds.map((c) => {
    const est = c.ask?.estimate as EstimateArgs | undefined;
    if (!c.ask || !est || typeof est !== "object") return c;
    n += 1;
    let id = estimateId(n);
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const el: Record<string, unknown> = { id, type: "scale", slider: true, min: est.min, max: est.max, value: est.value };
    for (const f of ["unit", "log", "label", "tick_format", "era"] as const) if (est[f] !== undefined) el[f] = est[f];
    added.push(el as unknown as SpecElement);
    const { estimate: _e, ...rest } = c.ask;
    void _e;
    const ask: AskArgs = { ...rest, on: id, ...(rest.release === undefined ? { release: false } : {}) };
    return { ...c, ask };
  });
  return { ...spec, elements: [...(spec.elements ?? []), ...added], commands };
}

/** What the validator says of an ask's estimate (before it expands): its numbers, and never with `on`. */
export function estimateErrors(spec: Spec): string[] {
  const out: string[] = [];
  (spec.commands ?? []).forEach((c, i) => {
    const est = c.ask?.estimate as EstimateArgs | undefined;
    if (!c.ask || est === undefined) return;
    if (c.ask.on !== undefined) out.push(`commands[${i}]: ask.estimate draws its own slider — leave out on`);
    if (!(est.max > est.min)) out.push(`commands[${i}]: ask.estimate needs max above min`);
    else if (!(est.value >= est.min && est.value <= est.max)) out.push(`commands[${i}]: ask.estimate.value must lie between min and max`);
    if (est.log === true && !(est.min > 0)) out.push(`commands[${i}]: ask.estimate with log needs min above 0`);
  });
  return out;
}
