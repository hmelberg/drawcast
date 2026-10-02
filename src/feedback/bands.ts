/**
 * Feedback bands and lines (spec 2026-10-03-looks-feedback-account §4.1–4.2).
 * Pure: the player scores an answer, asks bandOf for the band the viewer
 * reached, and pickLine for ONE short line to say after the author's
 * right/wrong line. Plain (the default) says nothing extra.
 */
import { FALLBACK_LINES } from "./lines";
import { JOKES } from "./jokes";

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
 * - a single guess (`frac`, `tolerance`): within tolerance = perfect; else
 *   good when within 25 % of the true value (`rel`, the error as a fraction
 *   of the truth), or — with no `rel` (the truth is 0) — within twice the
 *   tolerance; else poor. (Measured against the axis alone, "good" was far
 *   too generous on a wide axis: 50 for 163 on 0–400.);
 * - a single right/wrong answer: perfect or none.
 */
/** A single guess off by at most this fraction of the truth is "good". */
export const GOOD_REL = 0.25;

export function bandOf(r: { within?: number; count?: number; ok: boolean; frac?: number; tolerance?: number; rel?: number | null }): Band {
  if (r.count !== undefined && r.count > 1 && r.within !== undefined) {
    if (r.within >= r.count) return "perfect";
    if (r.within / r.count >= 2 / 3 - 1e-9) return "good";
    return r.within > 0 ? "poor" : "none";
  }
  if (r.frac !== undefined && r.tolerance !== undefined) {
    if (r.frac <= r.tolerance + 1e-9) return "perfect";
    const close = r.rel !== undefined && r.rel !== null ? r.rel <= GOOD_REL + 1e-9 : r.frac <= 2 * r.tolerance + 1e-9;
    return close ? "good" : "poor";
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
    // Lines without a style take the cast's style (resolveFeedback decides).
    ...(style ? { style } : {}),
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
  const anyLines = Object.keys(a.lines).length > 0 || Object.keys(c.lines).length > 0;
  // Lines with no style anywhere ask for more than plain: warm.
  const style = a.style ?? c.style ?? (anyLines ? "warm" : "plain");
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

export function isEnglish(lang: string | undefined | null): boolean {
  return !lang || lang.toLowerCase().split(/[-_]/)[0] === "en";
}

/** Every line pickLine (or a joke reward, English casts only) could say for this feedback — what a subtitle track must translate. */
export function feedbackLines(fb: FeedbackSpec, lang: string | undefined | null): string[] {
  const style = fb.style;
  const jokes = fb.reward === "joke" && isEnglish(lang) ? [...JOKES] : [];
  if (style === "plain") return jokes;
  return [...BANDS.flatMap((b) => fb.lines[b] ?? (isEnglish(lang) ? FALLBACK_LINES[style][b] : [])), ...jokes];
}

/**
 * ONE line for the band, or null: the cast's own lines first; else the
 * bundled English set, only for a cast in English (or with no `lang`);
 * no line said twice in this cast until the band's lines are used up, then
 * they come round again (`used`, which this adds to).
 * The pick is seeded, so a replay says the same. {vars} are left for the
 * player's speakLine to substitute.
 */
export function pickLine(fb: FeedbackSpec, band: Band, lang: string | undefined | null, seed: number, used: Set<string>): string | null {
  if (fb.style === "plain") return null;
  const own = fb.lines[band];
  const pool = own && own.length > 0 ? own : isEnglish(lang) ? FALLBACK_LINES[fb.style][band] : [];
  let fresh = pool.filter((l) => !used.has(l));
  if (fresh.length === 0 && pool.length > 0) {
    // Used up: the band's lines come round again — but not the one just said
    // (the latest of them in `used`, which keeps insertion order).
    const last = [...used].filter((l) => pool.includes(l)).pop();
    for (const l of pool) used.delete(l);
    fresh = pool.length > 1 ? pool.filter((l) => l !== last) : pool.slice();
  }
  if (fresh.length === 0) return null;
  const k = seedOf(`${seed}:${band}:${used.size}`) % fresh.length;
  const line = fresh[k];
  used.add(line);
  return line;
}

/**
 * A guess's band: one number by how far off it is (perfect as judged, good
 * within 25 % of the truth — `pct`, percent of the truth, null when it is 0 —
 * else twice the tolerance);
 * several numbers by how many are close, kept in step with the verdict (a
 * right answer is at least good, a wrong one at most good); a market curve
 * by its check — right is perfect, else how many of its two moves are close.
 */
export function guessBand(s: { ok: boolean; within: number; count: number; meanFrac: number; pct?: number | null }, tolerance: number, market: boolean): Band {
  if (market) return s.ok ? "perfect" : s.within > 0 ? "poor" : "none";
  if (s.count <= 1) {
    if (s.ok) return "perfect";
    const rel = s.pct !== undefined && s.pct !== null ? s.pct / 100 : null;
    const b = bandOf({ ok: false, frac: s.meanFrac, tolerance, rel });
    return b === "perfect" ? "good" : b;
  }
  const b = bandOf({ ok: s.ok, within: s.within, count: s.count });
  if (s.ok && (b === "poor" || b === "none")) return "good";
  if (!s.ok && b === "perfect") return "good";
  return b;
}
