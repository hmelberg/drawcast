// Which Wikipedia article does a word on the canvas mean? The drawcast's OWN
// words decide: "Mercury" in a figure about protons and thermometers is the
// element, in one about orbits it is the planet, and the figure already says
// which — in its title, its narration, its other labels, its params.
//
// Pure and deterministic on purpose: this is string arithmetic in the browser,
// NOT a model call. There is no API key, no token cost, and nothing happens
// until a viewer actually clicks. The only network access is one keyless
// Wikipedia search (src/ui/infocard.ts), and its answers are scored here.
//
// The scoring is strict by design (see THRESHOLD): a confident wrong summary
// is worse than a "did you mean" row, so anything short of clear evidence
// falls back to offering the viewer the choice.

import type { Spec } from "../spec/types";

/** One search hit, as both Wikipedia search APIs return it. */
export interface WikiCandidate {
  title: string;
  /** The one-line "short description" ("First planet from the Sun"). */
  description: string;
  /** Thumbnail URL, when the page has one. */
  thumbnail?: string;
}

export type WikiMatch =
  /** Clear winner: show its summary in the card. */
  | { kind: "confident"; page: WikiCandidate }
  /** Several plausible senses: let the viewer pick (Hans's rule). */
  | { kind: "choice"; pages: WikiCandidate[] }
  /** Nothing on Wikipedia fits this figure: plain Search only, as before. */
  | { kind: "none" };

const STOP = new Set(
  ("a an the of in on to for and or is are was were be by with from as at it its this that these those how what why " +
    "when where which who into out up down over under more most one two both same other than then so we you they " +
    "will can may not but all own each every we're it's here there just now new use used using make made get")
    .split(" "),
);

/**
 * Crude suffix stripping — enough to fuse orbit/orbits/orbiting and
 * singer/singers. A real stemmer would be a dependency for no measurable gain
 * at this scale (six candidates, one short description each).
 */
function stem(t: string): string {
  return t
    .replace(/(ies)$/, "y")
    .replace(/(sses|shes|ches)$/, "s")
    .replace(/(ing|ed|es|s)$/, "");
}

/** Content words of a piece of text, stemmed and stopword-free. */
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-zà-öø-ÿ]{3,}/g) ?? []).filter((t) => !STOP.has(t)).map(stem);
}

/**
 * Everything the drawcast says about itself: title, narration, question text,
 * every label and axis caption, the template name, and any string param. This
 * is the context that disambiguates, and it costs nothing to collect — it is
 * already in memory.
 */
export function contextWords(spec: Spec): Set<string> {
  const parts: string[] = [spec.title ?? "", spec.template ?? ""];
  for (const c of spec.commands ?? []) {
    parts.push(c.speak ?? "", c.quiz?.question ?? "", c.quiz?.right ?? "", c.ask?.question ?? "", c.ask?.right ?? "");
  }
  for (const e of spec.elements ?? []) {
    parts.push(e.text ?? "", e.x_label ?? "", e.y_label ?? "", e.of ?? "");
  }
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(spec.params ?? {});
  return new Set(words(parts.join(" ")));
}

/** The longest phrase worth looking up — past this it is a sentence, not a term. */
const PHRASE_MAX = 90;

/**
 * A selected stretch of caption, reduced to the term inside it, or null when
 * the selection is not one. A drag almost always catches a leading space or a
 * trailing comma, and line-wrapped narration arrives with newlines in it.
 */
export function selectedPhrase(raw: string): string | null {
  const phrase = raw
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
  if (phrase.length > PHRASE_MAX) return null;
  // The same bar the canvas words clear: three characters with two letters in
  // a row, so a stray "a" or "42" is not offered as something to look up.
  return phrase.length >= 3 && /[\p{L}]{2}/u.test(phrase) ? phrase : null;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A page that only lists other pages is never a destination. */
function isDisambiguation(c: WikiCandidate): boolean {
  return /topics referred to by the same term|disambiguation/i.test(c.description);
}

/**
 * How well one candidate fits this figure, in [0, 1.25].
 *
 * TWO signals, and both are needed. Description overlap alone was measured
 * WRONG: in a figure about waves it ranked "Pulse-amplitude modulation" above
 * the article "Amplitude", because the longer description happened to share
 * more words. For a generic term, an exact title match is itself the strongest
 * evidence there is — so title and context each carry their own weight.
 */
export function scoreCandidate(cand: WikiCandidate, context: ReadonlySet<string>, label: string): number {
  if (isDisambiguation(cand)) return -1;
  const t = norm(cand.title);
  const l = norm(label);
  const d = words(cand.description);
  const overlap = d.length > 0 ? d.filter((w) => context.has(w)).length / d.length : 0;
  // Title evidence, strongest first: the article IS the term; the article is
  // the term plus a parenthesized sense ("Mercury (element)"); the article
  // merely contains it ("Mercury Records" — weak, usually a proper noun).
  const title = t === l ? 0.55 : t.startsWith(`${l} (`) ? 0.4 : t.startsWith(l) || t.endsWith(l) ? 0.12 : 0;
  return overlap * 0.7 + title;
}

/**
 * The threshold, deliberately strict (Hans, 2026-08-29). Measured over ten
 * cases: five cleared it, and all five were right. The other five — a genuinely
 * ambiguous "Mercury" in a music figure, an off-topic word, a term whose
 * article is titled something else — fall to the "did you mean" row, which
 * costs the viewer one click. Loosening this buys a few more automatic
 * summaries and eventually buys a confidently WRONG one, which is the trade
 * that was rejected.
 */
const THRESHOLD = { score: 0.45, gap: 0.15 } as const;

/** How many senses the "did you mean" row offers before it becomes a list. */
const CHOICES = 3;

/**
 * Rank the candidates against the figure and decide what the card should do:
 * show one summary, offer a choice, or stay quiet and leave plain Search.
 */
export function matchWiki(candidates: readonly WikiCandidate[], context: ReadonlySet<string>, label: string): WikiMatch {
  const ranked = candidates
    .map((c) => ({ c, s: scoreCandidate(c, context, label) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s);
  if (ranked.length === 0) return { kind: "none" };
  const [best, second] = ranked;
  if (best.s >= THRESHOLD.score && best.s - (second?.s ?? 0) >= THRESHOLD.gap) {
    return { kind: "confident", page: best.c };
  }
  // Nothing scored enough to be worth ASKING about either: every candidate is
  // just a word that happens to share a string with the label.
  const plausible = ranked.filter((r) => r.s >= 0.2).slice(0, CHOICES);
  return plausible.length >= 2 ? { kind: "choice", pages: plausible.map((r) => r.c) } : { kind: "none" };
}
