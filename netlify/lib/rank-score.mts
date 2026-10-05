// The front page's ranking (ranking round, 2026-10-05). Pure: counts by day
// in, one number per drawcast out, so every rule is testable with fixed dates.
//
// A like is the strongest signal (a signed-in viewer chose it) and weighs half
// as much every LIKE_HALF_LIFE days, so last week's likes beat last year's. A
// visit may be a glance: cheap, and it fades faster. Watching to the end is
// between the two. Dislikes are never shown anywhere; they only lower the
// quality factor, a like ratio that starts at one half for a drawcast nobody
// has voted on yet, so a single vote cannot swing it. A new drawcast gets a
// boost that fades over its first days, so it is seen before it can be liked.

export const LIKE_HALF_LIFE = 14;
export const VISIT_HALF_LIFE = 7;
export const DONE_HALF_LIFE = 10;
export const FRESH_HALF_LIFE = 5;
export const VISIT_WEIGHT = 0.2;
export const DONE_WEIGHT = 2;
export const FRESH_BOOST = 3;
/** The window of "Top this month". */
export const MONTH_DAYS = 30;
/** A like whose day is not known (no stats from the registry) counts as this old. */
const UNDATED_LIKE_AGE = LIKE_HALF_LIFE;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DayCounts = Record<string, number>;

export interface RankInput {
  likes: number;
  dislikes?: number;
  /** Likes by the day each was given; absent when the registry gave no stats. */
  likeDays?: DayCounts;
  visits?: DayCounts;
  done?: DayCounts;
  /** When the drawcast was first registered, ISO. */
  created?: string | null;
}

export interface RankScore {
  /** Trending: recency-weighted engagement times quality, plus the new-drawcast boost. */
  score: number;
  /** Likes in the last MONTH_DAYS days, times quality. */
  month: number;
}

function ageDays(day: string, now: number): number {
  const t = Date.parse(day.length === 10 ? `${day}T12:00:00Z` : day);
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY_MS) : Infinity;
}

/** Σ count × ½^(age / halfLife) over a day-count record. */
export function decayed(days: DayCounts | undefined, halfLife: number, now: number): number {
  let sum = 0;
  for (const [day, count] of Object.entries(days ?? {})) {
    const age = ageDays(day, now);
    if (Number.isFinite(age) && count > 0) sum += count * 0.5 ** (age / halfLife);
  }
  return sum;
}

/** The like ratio with a prior of two likes and two dislikes: ½ with no votes. */
export function quality(likes: number, dislikes: number): number {
  return (Math.max(0, likes) + 2) / (Math.max(0, likes) + Math.max(0, dislikes) + 4);
}

export function rankScore(input: RankInput, now: number): RankScore {
  const q = quality(input.likes, input.dislikes ?? 0);
  const likes = input.likeDays ? decayed(input.likeDays, LIKE_HALF_LIFE, now) : input.likes * 0.5 ** (UNDATED_LIKE_AGE / LIKE_HALF_LIFE);
  const hot = likes + VISIT_WEIGHT * decayed(input.visits, VISIT_HALF_LIFE, now) + DONE_WEIGHT * decayed(input.done, DONE_HALF_LIFE, now);
  const createdAge = input.created ? ageDays(input.created, now) : Infinity;
  const fresh = Number.isFinite(createdAge) ? FRESH_BOOST * 0.5 ** (createdAge / FRESH_HALF_LIFE) : 0;
  let month = 0;
  if (input.likeDays) {
    for (const [day, count] of Object.entries(input.likeDays)) if (ageDays(day, now) <= MONTH_DAYS) month += count;
  } else month = input.likes;
  const round = (x: number): number => Math.round(x * 1000) / 1000;
  return { score: round(hot * q + fresh), month: round(month * q) };
}

/** `v/<name>/<day>` or `d/<name>/<day>` → its parts; null for anything else. */
export function parseDayKey(key: string): { kind: "v" | "d"; name: string; day: string } | null {
  const m = /^([vd])\/(.+)\/(\d{4}-\d\d-\d\d)$/.exec(key);
  return m ? { kind: m[1] as "v" | "d", name: m[2], day: m[3] } : null;
}

/** Day counts by name, a course's lectures (`spanish/3`) folded into the course. */
export function foldDays(entries: Array<{ name: string; day: string; count: number }>): Map<string, DayCounts> {
  const out = new Map<string, DayCounts>();
  for (const e of entries) {
    const base = e.name.split("/", 1)[0];
    if (!base || !(e.count > 0)) continue;
    const per = out.get(base) ?? {};
    per[e.day] = (per[e.day] ?? 0) + e.count;
    out.set(base, per);
  }
  return out;
}
