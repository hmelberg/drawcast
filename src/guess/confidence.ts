// CONFIDENCE BET (page-frame spec round 2, W16): a quiz with
// `confidence: true` asks, after the pick, how sure the viewer was — three
// buttons on the figure, "50/50", "Fairly sure", "Certain" (55 / 75 / 95 %).
// Over the cast the bets are scored for calibration, Brier-style: each bet
// p against the outcome (1 right, 0 wrong), and the gap between how sure the
// viewer said they were (mean p) and how often they were right. Published as
// {calib} (a short phrase) and {calib.score} (0–100, 100 = a perfect bet).
//
// Pure: the player draws the buttons with the guess marks (effects layer,
// so movies record them) and asks through the choose gate.

import type { BBox } from "../layout/geometry";
import { blockSize, buttonCentres, placeBlock, placeButtons } from "../spec/answer-buttons";
import { CARD_PAPER } from "../spec/cards";
import { GUESS_COLOR } from "./color";
import type { GuessMarks } from "./marks";

/** The three bets, in button order. */
export const CONFIDENCE_LEVELS = [0.55, 0.75, 0.95] as const;
/** What a movie bets (it answers right): "Fairly sure". */
export const MOVIE_LEVEL = 1;

type Lang = "en" | "nb";

const WORDS: Record<Lang, { levels: [string, string, string]; how: string; well: string; over: string; overMuch: string; under: string }> = {
  en: { levels: ["50/50", "Fairly sure", "Certain"], how: "How sure are you?", well: "well calibrated", over: "a bit overconfident", overMuch: "overconfident", under: "underconfident" },
  nb: { levels: ["50/50", "Ganske sikker", "Helt sikker"], how: "Hvor sikker er du?", well: "godt kalibrert", over: "litt for skråsikker", overMuch: "for skråsikker", under: "for forsiktig" },
};

export function confidenceLabels(lang: Lang): [string, string, string] {
  return WORDS[lang].levels;
}
export function confidenceHow(lang: Lang): string {
  return WORDS[lang].how;
}

/** One bet: how sure (0–1) and whether the answer was right. */
export interface Bet {
  p: number;
  ok: boolean;
}

/** The mean Brier score of the bets: (p − outcome)², 0 = perfect, 1 = certain and wrong. */
export function brier(bets: readonly Bet[]): number {
  if (bets.length === 0) return 0;
  return bets.reduce((s, b) => s + (b.p - (b.ok ? 1 : 0)) ** 2, 0) / bets.length;
}

/** How far the bets were from calibrated: mean confidence minus the share right (+ overconfident). */
export function confidenceBias(bets: readonly Bet[]): number {
  if (bets.length === 0) return 0;
  const sure = bets.reduce((s, b) => s + b.p, 0) / bets.length;
  const right = bets.filter((b) => b.ok).length / bets.length;
  return sure - right;
}

/** Within this of the share right counts as calibrated: with a handful of
 *  questions the share right moves in big steps (thirds, quarters). */
const CALIBRATED = 0.25;
/** Past this, "overconfident" without "a bit". */
const VERY = 0.45;

export type CalibBand = "well" | "over" | "overMuch" | "under";

export function calibBand(bets: readonly Bet[]): CalibBand {
  const bias = confidenceBias(bets);
  if (bias > VERY + 1e-9) return "overMuch";
  if (bias > CALIBRATED + 1e-9) return "over";
  if (bias < -CALIBRATED - 1e-9) return "under";
  return "well";
}

/** {calib}, {calib.score} (100 − 100 × Brier, rounded) and {calib.n}; nothing before the first bet. */
export function calibVars(bets: readonly Bet[], lang: Lang): Record<string, string> {
  if (bets.length === 0) return {};
  return {
    calib: WORDS[lang][calibBand(bets)],
    "calib.score": String(Math.round(100 * (1 - brier(bets)))),
    "calib.n": String(bets.length),
  };
}

// ---- the buttons ----------------------------------------------------------

/** One button's size, the same for every language (sized for the longest label). */
export const CONFIDENCE_BUTTON = { w: 220, h: 60 } as const;
const FONT = 28;
const INK = "#2f6b8f";

/**
 * Where the three buttons go: as on-canvas answer buttons go (below the
 * figure and a bit to its right, clear of `obstacles` — what stands on the
 * page), logical units, y up. Their boxes, in level order.
 */
export function confidenceBoxes(obstacles: BBox[]): BBox[] {
  // A row reads as one scale from unsure to sure: a row wherever one fits,
  // else whatever the answer buttons' placement finds.
  const row = placeBlock(obstacles, blockSize(3, CONFIDENCE_BUTTON, "row"));
  const { centres } = row ? { centres: buttonCentres(3, CONFIDENCE_BUTTON, "row", row) } : placeButtons(obstacles, 3, CONFIDENCE_BUTTON);
  return centres.map((c) => ({ x: Math.round(c.x - CONFIDENCE_BUTTON.w / 2), y: Math.round(c.y - CONFIDENCE_BUTTON.h / 2), w: CONFIDENCE_BUTTON.w, h: CONFIDENCE_BUTTON.h }));
}

const rect = (b: BBox): [number, number][] => [
  [b.x, b.y],
  [b.x + b.w, b.y],
  [b.x + b.w, b.y + b.h],
  [b.x, b.y + b.h],
];
const grow = (b: BBox, d: number): BBox => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/**
 * The buttons as marks: paper boxes with their words, "How sure are you?"
 * over them; the chosen one (`picked`) filled in the viewer's colour, the
 * others faded. `answered`: the box of the answer they picked (an on-canvas
 * button), outlined so it stays marked while they bet.
 */
export function confidenceMarks(boxes: readonly BBox[], labels: readonly string[], how: string, picked: number | null = null, answered?: BBox): GuessMarks {
  const lines: GuessMarks["lines"] = [];
  const texts: GuessMarks["texts"] = [];
  if (answered) lines.push({ pts: rect(grow(answered, 6)), closed: true, color: GUESS_COLOR, width: 3 });
  boxes.forEach((b, i) => {
    const on = picked === i;
    const off = picked !== null && !on;
    // The bet: a tint of the viewer's colour, the words in it (a paper halo
    // under the letters would blur white words on a dark fill).
    lines.push({ pts: rect(b), closed: true, fill: on ? GUESS_COLOR : CARD_PAPER, fillOpacity: on ? 0.22 : 1, color: on ? GUESS_COLOR : INK, width: on ? 4 : 2, ...(off ? { opacity: 0.45 } : {}) });
    texts.push({ at: [b.x + b.w / 2, b.y + b.h / 2], text: labels[i] ?? "", anchor: "middle", size: FONT, color: on ? GUESS_COLOR : INK, ...(off ? { opacity: 0.45 } : {}) });
  });
  if (boxes.length > 0 && picked === null) {
    const x0 = Math.min(...boxes.map((b) => b.x)), x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.max(...boxes.map((b) => b.y + b.h));
    texts.push({ at: [(x0 + x1) / 2, top + 22], text: how, anchor: "middle", size: 24, color: INK });
  }
  return { color: INK, lines, texts };
}
