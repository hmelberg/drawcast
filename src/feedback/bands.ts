/**
 * Feedback bands and lines (spec 2026-10-03-looks-feedback-account §4.1–4.2).
 * Pure: the player scores an answer, asks bandOf for the band the viewer
 * reached, and pickLine for ONE short line to say after the author's
 * right/wrong line. Plain (the default) says nothing extra.
 */
import { FALLBACK_LINES } from "./lines";

export type Band = "perfect" | "good" | "poor" | "none";
export const BANDS: readonly Band[] = ["perfect", "good", "poor", "none"];

export type FeedbackStyle = "plain" | "warm" | "dry";
export type FeedbackReward = "auto" | "none" | "confetti" | "picture" | "joke";

export interface FeedbackSpec {
  style: FeedbackStyle;
  reward: FeedbackReward;
  lines: Partial<Record<Band, string[]>>;
}

/**
 * The band an answer reached.
 * - counted tasks (`count` > 1: cards, tree blanks, formula blanks, several
 *   guesses): all right = perfect, ≥ ⅔ = good, some = poor, none = none;
 * - a single guess (`frac`, `tolerance`): within tolerance = perfect, within
 *   twice = good, else poor;
 * - a single right/wrong answer: perfect or none.
 */
export function bandOf(r: { within?: number; count?: number; ok: boolean; frac?: number; tolerance?: number }): Band {
  if (r.count !== undefined && r.count > 1 && r.within !== undefined) {
    if (r.within >= r.count) return "perfect";
    if (r.within / r.count >= 2 / 3 - 1e-9) return "good";
    return r.within > 0 ? "poor" : "none";
  }
  if (r.frac !== undefined && r.tolerance !== undefined) {
    if (r.frac <= r.tolerance + 1e-9) return "perfect";
    if (r.frac <= 2 * r.tolerance + 1e-9) return "good";
    return "poor";
  }
  if (r.count === 1 && r.within !== undefined) return r.within >= 1 ? "perfect" : "none";
  return r.ok ? "perfect" : "none";
}

const STYLES: readonly FeedbackStyle[] = ["plain", "warm", "dry"];
const REWARDS: readonly FeedbackReward[] = ["auto", "none", "confetti", "picture", "joke"];

interface Parsed {
  style?: FeedbackStyle;
  reward?: FeedbackReward;
  lines: Partial<Record<Band, string[]>>;
}

function parse(v: unknown): Parsed {
  if (typeof v === "string") return STYLES.includes(v as FeedbackStyle) ? { style: v as FeedbackStyle, lines: {} } : { lines: {} };
  if (typeof v !== "object" || v === null) return { lines: {} };
  const o = v as Record<string, unknown>;
  const lines: Partial<Record<Band, string[]>> = {};
  for (const b of BANDS) {
    const x = o[b];
    const list = typeof x === "string" ? [x] : Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
    const kept = list.map((s) => s.trim()).filter((s) => s !== "");
    if (kept.length > 0) lines[b] = kept;
  }
  const style = STYLES.includes(o.style as FeedbackStyle) ? (o.style as FeedbackStyle) : undefined;
  const reward = REWARDS.includes(o.reward as FeedbackReward) ? (o.reward as FeedbackReward) : undefined;
  return {
    // An object that writes lines but names no style asks for more than plain.
    style: style ?? (Object.keys(lines).length > 0 ? "warm" : undefined),
    ...(reward ? { reward } : {}),
    lines,
  };
}

/**
 * The feedback in force for one question: `cast` is the spec's top-level
 * `feedback`, `ask` the question's own (either a style name or an object).
 * The ask's style and reward win; lines merge band by band, the ask's own
 * winning. Default: plain, no reward.
 */
export function resolveFeedback(cast: unknown, ask: unknown): FeedbackSpec {
  const c = parse(cast);
  const a = parse(ask);
  const style = a.style ?? c.style ?? "plain";
  const reward = a.reward ?? c.reward ?? (style === "plain" ? "none" : "auto");
  const lines: Partial<Record<Band, string[]>> = {};
  for (const b of BANDS) {
    const l = a.lines[b] ?? c.lines[b];
    if (l) lines[b] = l;
  }
  return { style, reward, lines };
}

/** A stable number for a cast (its questions, say) — the pick's seed. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isEnglish(lang: string | undefined | null): boolean {
  return !lang || lang.toLowerCase().split(/[-_]/)[0] === "en";
}

/**
 * ONE line for the band, or null: the cast's own lines first; else the
 * bundled English set, only for a cast in English (or with no `lang`);
 * never a line already said in this cast (`used`, which this adds to).
 * The pick is seeded, so a replay says the same. {vars} are left for the
 * player's speakLine to substitute.
 */
export function pickLine(fb: FeedbackSpec, band: Band, lang: string | undefined | null, seed: number, used: Set<string>): string | null {
  if (fb.style === "plain") return null;
  const own = fb.lines[band];
  const pool = own && own.length > 0 ? own : isEnglish(lang) ? FALLBACK_LINES[fb.style][band] : [];
  const fresh = pool.filter((l) => !used.has(l));
  if (fresh.length === 0) return null;
  const k = seedOf(`${seed}:${band}:${used.size}`) % fresh.length;
  const line = fresh[k];
  used.add(line);
  return line;
}
