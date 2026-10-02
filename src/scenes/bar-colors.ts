// A bar chart's colours from its labels (round 7 §7): bars that count one
// quantity over ordered levels — numbers, years, ranges or bins, months,
// weekdays — share one colour; bars that are different things get one each.
// The labels may be Norwegian (a translated cast). Pure; the kit carries it
// to the bar_chart body.

export type BarColors = "each" | "same";

const CALENDAR = new Set([
  // months — English, Norwegian; long and short
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "januar", "februar", "mars", "mai", "juni", "juli", "oktober", "desember", "okt", "des",
  // weekdays
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag",
  "man", "tir", "ons", "tor", "fre", "lør", "søn",
]);

const ORDERED: RegExp[] = [
  // 12, 1 200, 3.5, <5, ≥10, 65+, 40 %, 1990s
  /^[<>≤≥]?\s*[-−]?\d[\d\s.,]*\s*(%|\+|s)?$/,
  // 0–9, 10-19, 2019–20
  /^[-−]?\d[\d.,]*\s*[-–—/]\s*[-−]?\d[\d.,]*\s*%?$/,
];

const ordered = (label: string): boolean => {
  const l = label.trim().toLowerCase().replace(/\.$/, "");
  return ORDERED.some((r) => r.test(l)) || CALENDAR.has(l);
};

/** "same" when every label is an ordered level (none: same); else "each". */
export function barColorsFor(labels: readonly string[]): BarColors {
  const ls = labels.map((l) => String(l).trim()).filter((l) => l !== "");
  return ls.every(ordered) ? "same" : "each";
}
