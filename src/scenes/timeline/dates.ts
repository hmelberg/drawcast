// Dates and the time axis for the timeline template: what a date string
// means, where a year lands on the axis, and which ticks the axis writes.
//
// One number space everywhere: a CALENDAR YEAR (1963; -3300 = 3300 BCE;
// -66e6 = 66 million years ago), fractional for months. Strings are a
// convenience on top — "1963", "3300 BCE", "66 Ma", "4.5 Ga", "10 ka",
// "1969-07-20", "now" — and all turn into that one number, so a view
// written in numbers can be animated and dates of both kinds mix freely.
//
// Two scales:
//   linear   calendar years spread evenly (the default — history, a project)
//   log_ago  log of years before the present: 4.5 Ga, 500 Ma, 66 Ma, 10 ka
//            and 1900 each get room (deep time, geology, human prehistory)

/** The present a `log_ago` axis counts back from (the "b2k" convention:
 *  deep-time figures are not sensitive to the exact year). */
export const PRESENT = 2000;
/** The nearest a log_ago axis goes to the present: one year ago. */
export const MIN_AGO = 1;

export type Scale = "linear" | "log_ago";

const UNIT_AGO: Record<string, number> = {
  ga: 1e9,
  bya: 1e9,
  ma: 1e6,
  mya: 1e6,
  ka: 1e3,
  kya: 1e3,
  ya: 1,
  bp: 1,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date as a calendar year, or null when it cannot be read. Numbers are
 * years as they stand. Strings: "1963", "-3300", "3300 BCE", "44 BC",
 * "800 CE", "c. 1500", "1960s", "1969-07", "1969-07-20", "66 Ma",
 * "4.5 Ga", "12 ka", "12,000 years ago", "300 BP", "now".
 */
export function parseDate(v: unknown, present = PRESENT): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase().replace(/^(c\.|ca\.|circa|~|about)\s*/, "");
  if (s === "") return null;
  if (s === "now" || s === "today" || s === "present") return present;
  // ISO: 1969-07-20, 1969-07
  const iso = /^(-?\d{1,6})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (iso) {
    const month = Math.min(12, Math.max(1, Number(iso[2])));
    const day = iso[3] ? Math.min(31, Math.max(1, Number(iso[3]))) : 1;
    return Number(iso[1]) + (month - 1) / 12 + (day - 1) / 365;
  }
  // "Jul 1969", "July 1969"
  const mon = /^([a-z]{3})[a-z]*\.?\s+(-?\d{1,6})$/.exec(s);
  if (mon && MONTHS.includes(mon[1])) return Number(mon[2]) + MONTHS.indexOf(mon[1]) / 12;
  s = s.replace(/,/g, "").replace(/\s+/g, " ");
  // A decade: "1960s" is the middle of it.
  const decade = /^(\d{2,4}0)s$/.exec(s);
  if (decade) return Number(decade[1]) + 5;
  // Years before present with a unit.
  const ago = /^(\d+(?:\.\d+)?(?:e\d+)?) ?(ga|bya|ma|mya|ka|kya|ya|bp|years? ago|yrs? ago)$/.exec(s);
  if (ago) {
    const unit = ago[2].startsWith("y") ? 1 : UNIT_AGO[ago[2]];
    return present - Number(ago[1]) * unit;
  }
  const era = /^(-?\d+(?:\.\d+)?) ?(bce|bc|b\.c\.|b\.c\.e\.|ce|ad|a\.d\.|c\.e\.)$/.exec(s);
  if (era) {
    const n = Number(era[1]);
    return era[2].startsWith("b") ? -Math.abs(n) : n;
  }
  const ad = /^(ad|a\.d\.) ?(\d+)$/.exec(s);
  if (ad) return Number(ad[2]);
  if (/^-?\d+(\.\d+)?(e\d+)?$/.test(s)) return Number(s);
  return null;
}

/** Years before the present for a calendar year (never below MIN_AGO). */
export function agoOf(year: number, present = PRESENT): number {
  return Math.max(MIN_AGO, present - year);
}

/**
 * The axis coordinate of a year: the unit the axis is LINEAR in. Linear:
 * the year itself. log_ago: −log10(years ago), so later is further right
 * and every factor of ten in the past gets the same width.
 */
export function toAxis(scale: Scale, year: number, present = PRESENT): number {
  return scale === "log_ago" ? -Math.log10(agoOf(year, present)) : year;
}

/** Inverse of toAxis. */
export function fromAxis(scale: Scale, u: number, present = PRESENT): number {
  return scale === "log_ago" ? present - Math.pow(10, -u) : u;
}

// ---------------------------------------------------------------------------
// Labels

/** A number without trailing zeros, at most `digits` decimals ("4.5", "66"). */
function short(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  return String(Math.abs(r) < 1e-9 ? 0 : r);
}

/** Thousands separated with commas from five digits up: 12,000 (but 1963). */
function grouped(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  if (s.length < 5) return s;
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A span of years before present, compact: "4.5 Ga", "66 Ma", "12 ka". */
export function formatAgo(ago: number): string {
  if (ago >= 1e9) return `${short(ago / 1e9, 2)} Ga`;
  if (ago >= 1e6) return `${short(ago / 1e6, ago >= 1e7 ? 0 : 1)} Ma`;
  if (ago >= 1e4) return `${short(ago / 1e3, 0)} ka`;
  if (ago >= 1e3) return `${short(ago / 1e3, 1)} ka`;
  return `${Math.round(ago)} ya`;
}

/** A calendar year: "1963", "3300 BCE", "12,000 BCE". */
export function formatYear(year: number): string {
  // The calendar year a date falls in (Aug 1972 is 1972), exact for whole years.
  const y = year >= 0 ? Math.floor(year + 1e-6) : Math.round(year);
  return y < 0 ? `${grouped(-y)} BCE` : grouped(y);
}

/**
 * How the axis and the event labels write a year on this scale. On a
 * log_ago axis, deep time is written as an age (66 Ma) and the last ten
 * thousand years as calendar years, the way a reader thinks of them.
 */
export function formatDate(scale: Scale, year: number, present = PRESENT): string {
  if (scale === "log_ago") {
    const ago = present - year;
    if (ago >= 1e4) return formatAgo(ago);
  }
  if (Math.abs(year) >= 1e5) return formatAgo(present - year);
  return formatYear(year);
}

// ---------------------------------------------------------------------------
// Ticks

export interface Tick {
  /** Calendar year. */
  year: number;
  label: string;
  /** Lower = rounder, kept first when labels crowd. */
  rank: number;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A step of 1, 2 or 5 × 10^k giving roughly `target` intervals over `span`. */
export function niceStep(span: number, target = 6): number {
  const raw = Math.abs(span) / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/**
 * Candidate ticks over [from, to] (calendar years, from < to). The caller
 * thins them by measured label width (layout.ts), rank first, so this may
 * offer more than fit.
 */
export function ticks(scale: Scale, from: number, to: number, present = PRESENT): Tick[] {
  if (!(to > from)) return [];
  return scale === "log_ago" ? logTicks(from, to, present) : linearTicks(from, to);
}

function linearTicks(from: number, to: number): Tick[] {
  const span = to - from;
  const out: Tick[] = [];
  if (span <= 3) {
    // Months: a project plan, a trial.
    const stepM = span <= 0.75 ? 1 : span <= 1.5 ? 2 : 3;
    const start = Math.floor(from * 12);
    for (let m = start; m / 12 <= to + 1e-9; m++) {
      if (m / 12 < from - 1e-9 || m % stepM !== 0) continue;
      const year = Math.floor(m / 12);
      const mi = ((m % 12) + 12) % 12;
      out.push({ year: m / 12, label: mi === 0 ? String(year) : MONTH_NAMES[mi], rank: mi === 0 ? 0 : mi % 6 === 0 ? 1 : 2 });
    }
    return out;
  }
  const step = Math.max(1, niceStep(span, 7));
  const first = Math.ceil(from / step) * step;
  for (let y = first; y <= to + 1e-9; y += step) {
    const v = Math.round(y / step) * step;
    const rank = v % (step * 10) === 0 ? 0 : v % (step * 5) === 0 ? 1 : v % (step * 2) === 0 ? 2 : 3;
    out.push({ year: v, label: formatDate("linear", v), rank });
  }
  return out;
}

function logTicks(from: number, to: number, present: number): Tick[] {
  const aMax = agoOf(from, present);
  const aMin = agoOf(to, present);
  const out: Tick[] = [];
  const kMax = Math.ceil(Math.log10(aMax));
  const kMin = Math.floor(Math.log10(aMin));
  const decades = Math.log10(aMax / aMin);
  // Finer multipliers the fewer decades are on screen.
  const mults = decades > 5 ? [1] : decades > 2.5 ? [1, 3] : decades > 1.2 ? [1, 2, 5] : [1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let k = kMax; k >= kMin; k--) {
    for (const m of mults) {
      const ago = m * Math.pow(10, k);
      if (ago > aMax * (1 + 1e-9) || ago < aMin * (1 - 1e-9)) continue;
      const year = present - ago;
      const label = ago < 1e4 ? formatYear(year) : formatAgo(ago);
      out.push({ year, label, rank: m === 1 ? (k % 3 === 0 ? 0 : 1) : m === 5 || m === 2 ? 2 : 3 });
    }
  }
  // The present end of a view that reaches it: "now", not "1990".
  if (aMin <= 10) {
    for (let i = out.length - 1; i >= 0; i--) if (present - out[i].year <= 10) out.splice(i, 1);
    out.push({ year: present - aMin, label: "now", rank: 0 });
  }
  // Within the last ten thousand years, calendar years read better than
  // 1-2-5 ages: add round calendar ticks when fewer than two decades show.
  if (aMax < 1e4 && decades < 2) {
    return linearTicks(from, Math.min(to, present)).map((t) => ({ ...t, rank: t.rank + 1 }));
  }
  return out;
}
