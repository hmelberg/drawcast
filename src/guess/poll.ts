// What people said (W16 poll-and-compare, spec/poll.ts): the vars a poll
// sets and the marks that show the study's answers beside the viewer's.
// Pure; the player draws the marks on the effects layer (movies record them).
//
//   {p}        the viewer's answer (the button's words, or the number)
//   {p.share}  the share of people who answered the same ("38%"; on a scale:
//              the bucket nearest the viewer's value)
//   {p.most}   the most common answer, {p.most.share} its share
//   {p.mean}   on a scale: the people's mean (the scale's own format)

import type { BBox } from "../layout/geometry";
import type { ScaleGeometry } from "../spec/scale";
import { GUESS_COLOR } from "./color";
import type { GuessMarks } from "./marks";

const INK = "#5b5650";
const pct = (s: number): string => `${Math.round(s * 100)}%`;

/** A choices poll: the viewer picked option `picked` (null: skipped — the movie's default stands). */
export function pollChoiceVars(store: string, labels: readonly string[], shares: readonly number[], picked: number): Record<string, string> {
  const base = store.toLowerCase();
  let most = 0;
  shares.forEach((s, i) => {
    if (s > shares[most]) most = i;
  });
  return {
    [`${base}.share`]: pct(shares[picked] ?? 0),
    [`${base}.most`]: labels[most] ?? "",
    [`${base}.most.share`]: pct(shares[most] ?? 0),
  };
}

/** The bucket nearest a value (a tie: the one listed first). */
export function nearestBucket(others: readonly { value: number; share: number }[], v: number): number {
  let best = 0;
  others.forEach((o, i) => {
    if (Math.abs(o.value - v) < Math.abs(others[best].value - v) - 1e-9) best = i;
  });
  return best;
}

/** A scale poll: the viewer's value `v`. */
export function pollScaleVars(store: string, others: readonly { value: number; share: number }[], v: number, format: (n: number) => string): Record<string, string> {
  const base = store.toLowerCase();
  let most = 0;
  others.forEach((o, i) => {
    if (o.share > others[most].share) most = i;
  });
  const w = others.reduce((s, o) => s + o.share, 0);
  const mean = w > 0 ? others.reduce((s, o) => s + o.value * o.share, 0) / w : 0;
  return {
    [`${base}.share`]: pct(others[nearestBucket(others, v)]?.share ?? 0),
    [`${base}.most`]: format(others[most]?.value ?? 0),
    [`${base}.most.share`]: pct(others[most]?.share ?? 0),
    [`${base}.mean`]: format(Math.round(mean * 10) / 10),
  };
}

const HEAD = { en: "What people chose", nb: "Hva folk valgte" } as const;

/** The study's name for the head line: "Oosterbeek et al. 2004". */
export function sourceTag(src: { authors?: string; year?: number; title?: string } | undefined): string {
  if (!src) return "";
  const who = src.authors ?? src.title ?? "";
  return src.year !== undefined ? `${who} ${src.year}`.trim() : who;
}

/**
 * The shares on the buttons: each button filled from its left edge as far
 * as its share (the viewer's own in their colour, the rest in grey), the
 * share written at its right end, the picked button outlined; over the set,
 * "What people chose" and the study. `t` (0..1) grows the fills.
 */
export function pollChoiceMarks(boxes: readonly (BBox | undefined)[], shares: readonly number[], picked: number | null, head: { lang: "en" | "nb"; source?: string }, t = 1): GuessMarks {
  const lines: GuessMarks["lines"] = [];
  const texts: GuessMarks["texts"] = [];
  boxes.forEach((b, i) => {
    if (!b) return;
    const mine = picked === i;
    const w = Math.max(0, b.w * (shares[i] ?? 0) * t);
    if (w > 1) {
      const inset = 3;
      lines.push({
        pts: [[b.x + inset, b.y + inset], [b.x + inset + Math.max(0, w - 2 * inset), b.y + inset], [b.x + inset + Math.max(0, w - 2 * inset), b.y + b.h - inset], [b.x + inset, b.y + b.h - inset]],
        closed: true,
        fill: mine ? GUESS_COLOR : INK,
        fillOpacity: mine ? 0.28 : 0.16,
        stroke: false,
      });
    }
    texts.push({ at: [b.x + b.w - 12, b.y + b.h / 2], text: pct((shares[i] ?? 0) * t), anchor: "end", size: 22, color: mine ? GUESS_COLOR : INK });
    if (mine) {
      lines.push({ pts: [[b.x - 6, b.y - 6], [b.x + b.w + 6, b.y - 6], [b.x + b.w + 6, b.y + b.h + 6], [b.x - 6, b.y + b.h + 6]], closed: true, color: GUESS_COLOR, width: 3 });
    }
  });
  const shown = boxes.filter((b): b is BBox => b !== undefined);
  if (shown.length > 0) {
    const x0 = Math.min(...shown.map((b) => b.x)), x1 = Math.max(...shown.map((b) => b.x + b.w));
    const top = Math.max(...shown.map((b) => b.y + b.h));
    const words = head.source ? `${HEAD[head.lang]} (${head.source})` : HEAD[head.lang];
    texts.push({ at: [(x0 + x1) / 2, top + 22], text: words, anchor: "middle", size: 18, color: INK });
  }
  return { color: INK, lines, texts };
}

/** The tallest bucket's bar over a scale (logical). */
export const POLL_BAR_MAX = 110;
const BAR_W = 22;
/** Over the line: clear of the marker and the guess's own handle. */
const BAR_FLOOR = 34;

/**
 * The people's answers over a scale: a bar per bucket standing over the
 * line, as tall as its share (the tallest POLL_BAR_MAX), its share over it;
 * the bucket nearest the viewer's value in their colour.
 */
export function pollScaleMarks(g: Pick<ScaleGeometry, "xAt" | "y">, others: readonly { value: number; share: number }[], mine: number | null, head: { lang: "en" | "nb"; source?: string }, t = 1): GuessMarks {
  const lines: GuessMarks["lines"] = [];
  const texts: GuessMarks["texts"] = [];
  const max = Math.max(...others.map((o) => o.share), 1e-9);
  let top = g.y + BAR_FLOOR;
  let left = Infinity, right = -Infinity;
  others.forEach((o, i) => {
    const x = g.xAt(o.value);
    const h = (POLL_BAR_MAX * o.share * t) / max;
    const y0 = g.y + BAR_FLOOR;
    const on = mine === i;
    lines.push({ pts: [[x - BAR_W / 2, y0], [x + BAR_W / 2, y0], [x + BAR_W / 2, y0 + h], [x - BAR_W / 2, y0 + h]], closed: true, fill: on ? GUESS_COLOR : INK, fillOpacity: on ? 0.7 : 0.35, stroke: false });
    texts.push({ at: [x, y0 + h + 14], text: pct(o.share * t), anchor: "middle", size: 16, color: on ? GUESS_COLOR : INK });
    top = Math.max(top, y0 + h + 14);
    left = Math.min(left, x);
    right = Math.max(right, x);
  });
  if (others.length > 0) {
    const words = head.source ? `${HEAD[head.lang]} (${head.source})` : HEAD[head.lang];
    texts.push({ at: [(left + right) / 2, top + 26], text: words, anchor: "middle", size: 18, color: INK });
  }
  return { color: INK, lines, texts };
}

/** What the plan carries of a poll: the shares per button (choices), or the buckets (a scale), and the study's name. */
export function pollPlan(
  poll: { choices?: { share: number }[]; others?: { value: number; share: number }[]; source?: string },
  sources: readonly { id: string; authors?: string; year?: number; title?: string }[] = [],
): { shares?: number[]; others?: { value: number; share: number }[]; source?: string } {
  const tag = poll.source !== undefined ? sourceTag(sources.find((s) => s.id === poll.source)) : "";
  return {
    ...(Array.isArray(poll.choices) ? { shares: poll.choices.map((c) => c.share) } : {}),
    ...(Array.isArray(poll.others) ? { others: poll.others.map((o) => ({ value: o.value, share: o.share })) } : {}),
    ...(tag ? { source: tag } : {}),
  };
}
