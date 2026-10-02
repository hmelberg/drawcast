/**
 * Rewards after an answer (spec 2026-10-03-looks-feedback-account §4.3).
 * Pure: the player asks rewardFor which one a LIVE answer earns, and the UI
 * plays it (src/ui/rewards.ts). Never in movies or exports and never on a
 * skip — the player does not ask then.
 */
import type { BBox } from "../layout/geometry";
import type { Band, FeedbackSpec } from "./bands";
import { seedOf } from "./bands";
import { JOKES } from "./jokes";

export type RewardKind = "sparkle" | "confetti" | "picture" | "joke";

/** What the player tells the UI after a live answer's band line (PlayerCallbacks.onReward). */
export interface RewardEvent {
  kind: RewardKind;
  band: Band;
  /** The answered part's box (logical units, y-up), or null (a quiz). */
  box: BBox | null;
  /** Right answers in a row, counting this one. */
  streak: number;
  /** How many rewards this cast has played before this one (picks the picture). */
  n: number;
}

/**
 * A long task: four or more items to judge (cards), or several parts
 * (blanks, numbers, a tree's blanks and its pick).
 */
export function isLong(r: { items?: number; parts?: number }): boolean {
  return (r.items ?? 0) >= 4 || (r.parts ?? 0) >= 2;
}

/**
 * The reward an answer earns, or null.
 * - `none`: nothing.
 * - `auto`: a perfect long task, or every third right answer in a row
 *   (`streak` 3, 6, 9 …, counting this one) → confetti; any other right
 *   answer → sparkle.
 * - `confetti`: confetti for any perfect answer.
 * - `picture`: a reaction picture for perfect and for none (good and poor
 *   get nothing — a picture for "nearly" reads as mockery).
 * - `joke`: a joke after a perfect long task; otherwise as `auto`.
 * Under style plain a joke or a picture earns nothing (plain = no extras).
 */
export function rewardFor(fb: FeedbackSpec, band: Band, long: boolean, streak: number): RewardKind | null {
  if (fb.reward === "none") return null;
  // Plain is no extras: a joke or a picture plays only with a style (the lint warns).
  if (fb.style === "plain" && (fb.reward === "joke" || fb.reward === "picture")) return null;
  const right = band === "perfect";
  if (fb.reward === "picture") return right || band === "none" ? "picture" : null;
  if (fb.reward === "confetti") return right ? "confetti" : null;
  if (fb.reward === "joke" && right && long) return "joke";
  if (!right) return null;
  // Every third right answer in a row (3, 6, 9 …); the others sparkle.
  return long || (streak > 0 && streak % 3 === 0) ? "confetti" : "sparkle";
}

/** One joke, seeded (a replay says the same), never one already said (`used`, which this adds to). */
export function pickJoke(seed: number, used: Set<string>): string | null {
  const fresh = JOKES.filter((j) => !used.has(j));
  if (fresh.length === 0) return null;
  const j = fresh[seedOf(`${seed}:joke:${used.size}`) % fresh.length];
  used.add(j);
  return j;
}

/** A reaction picture: a twemoji (CC BY 4.0) by its Iconify name, and the character for alt text. */
export interface ReactionPicture {
  name: string;
  char: string;
}

export const REACTION_PICTURES: Record<"perfect" | "none", readonly ReactionPicture[]> = {
  perfect: [
    { name: "party-popper", char: "🎉" },
    { name: "trophy", char: "🏆" },
  ],
  none: [
    { name: "person-facepalming", char: "🤦" },
    { name: "see-no-evil-monkey", char: "🙈" },
  ],
};

/** The picture for a band (perfect or none; else null), alternating by `n`. */
export function pictureFor(band: Band, n: number): ReactionPicture | null {
  if (band !== "perfect" && band !== "none") return null;
  const set = REACTION_PICTURES[band];
  return set[Math.abs(Math.trunc(n)) % set.length];
}

/** The credit the reaction pictures owe — kept off the canvas, in the player's credits menu. */
export const TWEMOJI_CREDIT = "Reaction pictures: Twemoji by Twitter, Inc. and contributors · CC BY 4.0";

/** The credit lines a cast's rewards owe: the twemoji line when any question can show a picture. */
export function rewardCredits(steps: readonly { kind: string; feedback?: FeedbackSpec }[]): string[] {
  return steps.some((s) => (s.kind === "ask" || s.kind === "quiz") && s.feedback?.reward === "picture") ? [TWEMOJI_CREDIT] : [];
}
