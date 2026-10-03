// What an estimate slider's guess leaves (spec/slider.ts, W15): the slider's
// own thumb and counter run from your guess to the truth (the reveal's
// values), while your thumb stays where you put it — blue, faded — with your
// number over it, and a bracket under the track spans the gap, written in
// ink. Pure: guess/reveal.ts (beside) and guess/marks.ts (morph, a ghost)
// call it for a handle on a slider.

import type { Pt } from "../layout/model";
import { INK } from "../layout/model";
import { scaleGeometry, type ScaleGeometry } from "../spec/scale";
import { circlePts, isSlider, sliderTickY, THUMB_R } from "../spec/slider";
import { GUESS_COLOR } from "./color";
import type { GuessHandle } from "./handles";
import { ratioText, signedScale, type GuessMarkLine, type GuessMarkText } from "./marks";

const YOURS = GUESS_COLOR;
/** Your number over your thumb. */
const MINE_SIZE = 30;

/** Is this guess on an estimate slider? */
export function onSlider(h: GuessHandle): boolean {
  return h.kind === "point" && isSlider(h.scale);
}

const ease = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** The slider's own value `p` of the way through the reveal: yours → the truth (the counter runs). */
export function sliderRevealValue(guess: number, truth: number, p: number): number {
  return guess + (truth - guess) * ease(p);
}

/** The bracket's height: under the track's numbers. */
export function sliderBracketY(g: ScaleGeometry): number {
  return sliderTickY(g) - Math.round((g.sizes?.tick ?? 22) * 0.65) - 12;
}

/** The gap as words: "+56 bones" on a linear slider, "×4.3" on a log one. */
function gapText(g: ScaleGeometry, truth: number, guess: number): string {
  return g.kind === "log" ? ratioText(truth, guess) : signedScale(g.format, truth - guess);
}

/**
 * The marks: your thumb (filled at `fill` strength, outlined) and your number
 * when it stands clear of the truth; once the truth has moved (`p` > 0) the
 * bracket from yours to where the truth's thumb is, and at the end the gap.
 * `dashed`: a ghost (morph, a guess kept back) — outline only, dashed.
 */
export function sliderMarks(
  h: GuessHandle,
  guess: number,
  p: number,
  opts: { fade?: number; dashed?: boolean } = {},
): { fills: GuessMarkLine[]; lines: GuessMarkLine[]; texts: GuessMarkText[] } {
  const fills: GuessMarkLine[] = [];
  const lines: GuessMarkLine[] = [];
  const texts: GuessMarkText[] = [];
  if (!h.scale) return { fills, lines, texts };
  const g = scaleGeometry(h.scale);
  const fade = opts.fade ?? 1;
  const x = g.xAt(guess);
  const ring = circlePts(x, g.y, THUMB_R);
  if (opts.dashed) lines.push({ pts: ring, closed: true, dashed: true, color: YOURS, opacity: fade });
  else {
    fills.push({ pts: ring, fill: YOURS, fillOpacity: 0.45 * fade, stroke: false, color: YOURS });
    lines.push({ pts: ring, closed: true, width: 2.5, color: YOURS, opacity: fade });
  }
  const truth = h.truth[0];
  const xt = g.xAt(truth);
  // Your number over your thumb — once the truth's thumb has left it.
  const xNow = g.xAt(sliderRevealValue(guess, truth, p));
  if (Math.abs(xNow - x) > THUMB_R * 2.2 || p <= 0) {
    texts.push({ at: [x, g.y + THUMB_R + 24], text: g.format(guess), anchor: "middle", color: YOURS, size: MINE_SIZE, opacity: fade });
  }
  if (p > 0 && Math.abs(xt - x) > 4) {
    const x1 = x + (xt - x) * ease(p);
    const by = sliderBracketY(g);
    lines.push({ pts: [[x, by + 6], [x, by], [x1, by], [x1, by + 6]] as Pt[], color: INK, width: 2.5 });
    if (p >= 1) texts.push({ at: [(x + x1) / 2, by - 22], text: gapText(g, truth, guess), anchor: "middle", color: INK, size: 28, gap: true, ...(fade < 1 ? { opacity: fade } : {}) });
  }
  return { fills, lines, texts };
}
