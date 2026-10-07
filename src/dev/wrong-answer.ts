// The frames harness's stand-in viewer (dev/frames.ts, the "answer (after the
// reveal)" tile). A reveal tile with nobody's answer on it misled reviewers:
// the live player keeps the viewer's guess beside the truth (the "You" pin,
// the drawn line, the guessed bar, ✓/✗ on the cards), so the tile has to
// show one. These pick a plausible WRONG-ish answer for each kind of
// question, as the string the question's own gate would resolve — the player
// then decodes, scores and reveals it exactly as for a viewer.
//
// Pure (no DOM), so the tests read it. Dev only: never in the build.

import { balancedSplit, defaultGuess, encodeGuess, snap, type GuessHandle } from "../guess/handles";
import { scoreGuess, type GuessTolerance } from "../guess/score";
import { scaleGeometry } from "../spec/scale";
import type { CardsGeometry } from "../spec/cards";
import { cardsTruth, checkDrop, encodeArrangement, initialArrangement, rightPick, type Arrangement } from "../cards/model";
import { answersMatch } from "../spec/answers";

export interface WrongGuessOptions extends GuessTolerance {
  /** The ask's `default` — the guess the author expects a viewer to make. */
  fallback?: string;
  /** A budget question: the bars must still add up to it. */
  budget?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** One handle's numbers moved off the truth by `share` of its range, in direction `dir`. */
function offset(h: GuessHandle, share: number, dir: 1 | -1): number[] {
  const t = h.truth;
  const span = h.max - h.min || 1;
  const fit = (v: number): number => snap(clamp(v, h.min, h.max), h.step);
  switch (h.kind) {
    case "market":
      // An under-move (or none at all): the commonest miss on a shifted curve.
      return share >= 0.8 ? t.map(() => 0) : t.map((v) => Math.round(v * (1 - share) * 100) / 100);
    case "angle": {
      if (t.length === 1) return [clamp(Math.round(t[0] + dir * share * 50), 1, 99)];
      // A whole pie: some of the largest slice given to the smallest.
      const out = t.slice();
      const big = out.indexOf(Math.max(...out));
      const small = out.indexOf(Math.min(...out));
      const move = Math.min(out[big] - 1, Math.round(share * 40));
      out[big] -= move;
      out[small] += move;
      return out;
    }
    case "point": {
      if (h.scale) {
        const g = scaleGeometry(h.scale);
        const len = g.x1 - g.x0;
        return t.map((v) => clamp(g.valueAtX(clamp(g.xAt(v) + dir * share * len, g.x0, g.x1)), g.min, g.max));
      }
      return t.map((v) => fit(v + dir * share * span));
    }
    case "curve": {
      // A line drawn near the truth at its start and drifting off it: how a
      // viewer's sketch of a trend usually misses.
      const n = t.length;
      return t.map((v, j) => fit(v + dir * share * span * (n > 1 ? 0.35 + 0.65 * (j / (n - 1)) : 1)));
    }
    default:
      return t.map((v) => fit(v + dir * share * span));
  }
}

/** Up where there is room above the truth, else down. */
function direction(h: GuessHandle): 1 | -1 {
  const mean = h.truth.reduce((a, b) => a + b, 0) / Math.max(1, h.truth.length);
  if (h.kind === "point" && h.scale) {
    const g = scaleGeometry(h.scale);
    return g.xAt(mean) <= (g.x0 + g.x1) / 2 ? 1 : -1;
  }
  return mean <= (h.min + h.max) / 2 ? 1 : -1;
}

/** How far apart a guess must stand from the truth to read as a different answer: a share of the line or axis. */
const APART = 0.15;

/** The mean distance of a guess from the truth, as a share of where it is drawn (a scale's line, else the axis). */
function apart(handles: GuessHandle[], values: number[][]): number {
  const d: number[] = [];
  handles.forEach((h, k) => {
    const g = h.kind === "point" && h.scale ? scaleGeometry(h.scale) : null;
    h.truth.forEach((t, j) => {
      const v = values[k]?.[j] ?? t;
      d.push(g ? Math.abs(g.xAt(v) - g.xAt(t)) / Math.max(1e-9, g.x1 - g.x0) : Math.abs(v - t) / Math.max(1e-9, h.max - h.min));
    });
  });
  return d.length === 0 ? 0 : d.reduce((a, b) => a + b, 0) / d.length;
}

/**
 * A wrong-ish guess on the handles, encoded as the guess gate resolves it
 * (guess/handles.ts encodeGuess). The author's `default` when it scores
 * wrong or stands plainly apart from the truth — the guess the cast's lines
 * were written for — else the truth moved by a growing share of the range
 * until it scores wrong.
 */
export function wrongGuess(handles: GuessHandle[], tol: WrongGuessOptions): string {
  const opts = { tolerance: tol.tolerance, relative: tol.relative, check: tol.check };
  const wrong = (v: number[][]): boolean => !scoreGuess(handles, v, opts).ok;
  const balance = (v: number[][]): number[][] => (tol.budget !== undefined ? balancedSplit(v, tol.budget) : v);
  // The author's default: when it scores wrong, or stands plainly apart from
  // the truth even if the scoring calls it close (a viewer making that guess
  // hears the "right" line — a reviewer should see that too).
  const authored = defaultGuess(tol.fallback, handles);
  if (authored && (wrong(balance(authored)) || apart(handles, authored) >= APART)) return encodeGuess(balance(authored));
  let last: number[][] = handles.map((h) => h.truth.slice());
  for (const share of [0.3, 0.5, 0.8]) {
    for (const flip of [false, true]) {
      // A budget: the bars move opposite ways, so the split can stay balanced and still be wrong.
      const v = balance(handles.map((h, k) => {
        const d = direction(h);
        const dir = (tol.budget !== undefined && k % 2 === 1 ? -d : d) as 1 | -1;
        return offset(h, share, flip ? (-dir as 1 | -1) : dir);
      }));
      last = v;
      if (wrong(v)) return encodeGuess(v);
    }
  }
  return encodeGuess(last);
}

/**
 * A wrong-ish arrangement of the cards, encoded as the cards gate resolves it
 * (cards/model.ts encodeArrangement): the truth with ONE thing wrong — two
 * cards swapped, one card in the wrong box (or tapped when it should not
 * be), one card placed off its value, one pick or link flipped.
 */
export function wrongArrangement(g: CardsGeometry): string {
  return encodeArrangement(g, wrongCards(g));
}

function wrongCards(g: CardsGeometry): Arrangement {
  const truth = cardsTruth(g);
  const n = g.cards.length;
  switch (g.mode) {
    case "rank": {
      const order = truth.order.slice();
      if (n >= 2) [order[0], order[1]] = [order[1], order[0]];
      return { ...truth, order };
    }
    case "sort": {
      // The card that goes wrong: a select's out-card tapped in, else the first card in a wrong box.
      const out = g.truthBin.findIndex((b) => b < 0);
      const w = out >= 0 ? out : 0;
      const wrongBox = out >= 0 ? 0 : g.bins.length > 1 ? (g.truthBin[w] + 1) % g.bins.length : -1;
      if (g.each) {
        // Judged drop by drop: every card dropped once, as the gate records it.
        let a = initialArrangement(g);
        for (const i of g.deal ?? g.cards.map((_, k) => k)) a = checkDrop(g, a, i, i === w ? wrongBox : g.truthBin[i]).arr;
        return a;
      }
      const boxes = truth.boxes.map((b) => b.filter((i) => i !== w));
      if (wrongBox >= 0) boxes[wrongBox].push(w);
      return { ...truth, boxes };
    }
    case "fill": {
      const boxes = truth.boxes.map((b) => b.slice());
      const wrongTile = g.truthBin.findIndex((b) => b < 0);
      if (wrongTile >= 0 && boxes.length > 0) boxes[0] = [wrongTile];
      else if (boxes.length >= 2) [boxes[0], boxes[1]] = [boxes[1], boxes[0]];
      else if (boxes.length === 1) boxes[0] = [];
      return { ...truth, boxes };
    }
    case "place": {
      const values = (truth.values ?? []).slice();
      const sg = g.scale;
      if (sg && values.length > 0 && typeof values[0] === "number") {
        const len = sg.x1 - sg.x0;
        const x = sg.xAt(values[0]);
        values[0] = sg.valueAtX(clamp(x + (x <= (sg.x0 + sg.x1) / 2 ? 1 : -1) * 0.3 * len, sg.x0, sg.x1));
      }
      return { ...truth, values };
    }
    case "match": {
      const links = (truth.links ?? []).slice();
      if (links.length >= 2) [links[0], links[1]] = [links[1], links[0]];
      return { ...truth, links };
    }
    case "compare": {
      const picks = (truth.picks ?? []).slice();
      if (picks.length > 0) picks[0] = 1 - rightPick(g, 0);
      return { ...truth, picks };
    }
    case "decide": {
      const best = g.best ?? [];
      const k = best.findIndex((b) => !b);
      return { ...truth, choice: k >= 0 ? k : 0 };
    }
  }
}

/** A quiz: the first choice that is not the correct one (0-based). */
export function wrongQuiz(step: { choices: string[]; correct: number }): number {
  const k = step.choices.findIndex((_, i) => i !== step.correct);
  return k >= 0 ? k : 0;
}

/** Choose on the figure: an option other than the answer (an opinion: the first). */
export function wrongChoice(step: { choose?: { id: string }[]; answer?: string }): string | null {
  const opts = step.choose ?? [];
  if (opts.length === 0) return null;
  const other = step.answer !== undefined ? opts.find((o) => !answersMatch(o.id, step.answer!)) : undefined;
  return (other ?? opts[0]).id;
}

/** A typed answer: the default when it is wrong (or nothing is judged), else one that is not the answer. */
export function wrongTyped(step: { answer?: string; fallback?: string }): string {
  if (step.answer === undefined) return step.fallback ?? "";
  if (step.fallback !== undefined && step.fallback.trim() !== "" && !answersMatch(step.fallback, step.answer)) return step.fallback;
  return /^-?\d/.test(step.answer.trim()) ? String(Number.parseFloat(step.answer) * 2 + 1) : "not sure";
}
