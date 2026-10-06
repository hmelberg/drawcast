// The front page's pure half (2026-10-03, plan "drawcast.app front page"):
// what a card shows, which format an item is, which items a chip or a search
// keeps. No DOM here, so the node suite tests it as-is; home.ts draws.
//
// Formats, not one category: a drawcast is exactly one of Drawcast / Quiz /
// Xplanation / Course (topic is a separate thing — tags). Course is already
// a kind in the registry, so it is known for every item; the other three
// come from the curated list until the registry carries a format (delivery 2).

import type { CatalogueItem } from "../catalogue";
import { normalizeName } from "../names";

export type HomeFormat = "drawcast" | "quiz" | "xplanation" | "course";

/** The chips, in order: "" is All. */
export const FORMAT_CHIPS: readonly { id: "" | HomeFormat; label: string }[] = [
  { id: "", label: "All" },
  { id: "drawcast", label: "Drawcasts" },
  { id: "quiz", label: "Quiz" },
  { id: "xplanation", label: "Xplanations" },
  { id: "course", label: "Courses" },
];

export const FORMAT_BADGE: Record<HomeFormat, string> = {
  drawcast: "Drawcast",
  quiz: "Quiz",
  xplanation: "Xplanation",
  course: "Course",
};

/** One curated entry (src/home/featured.json): a published name, by hand. */
export interface FeaturedEntry {
  name: string;
  title: string;
  format: HomeFormat;
  tags: string[];
  /** Shown as "by <owner>"; optional, the catalogue's owner when absent. */
  owner?: string;
  /** A course's lecture count, for its card. */
  lectures?: number;
}

/** What a card needs, from either source. */
export interface HomeCard {
  name: string;
  title: string;
  owner: string;
  format?: HomeFormat;
  /** "Course · 6 lectures" / "updated 2026-10-01" — one quiet line. */
  meta: string;
  private: boolean;
  tags: string[];
}

const FORMATS = new Set<HomeFormat>(["drawcast", "quiz", "xplanation", "course"]);

/** The curated list, narrowed: a bad entry is dropped, never shown half blank;
 *  a name that could never resolve (reserved, malformed) is dropped too. */
export function parseFeatured(raw: unknown): FeaturedEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: FeaturedEntry[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const name = typeof e.name === "string" ? normalizeName(e.name) : null;
    if (!name || seen.has(name) || typeof e.title !== "string" || !FORMATS.has(e.format as HomeFormat)) continue;
    seen.add(name);
    out.push({
      name,
      title: e.title,
      format: e.format as HomeFormat,
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim().toLowerCase()) : [],
      ...(typeof e.owner === "string" ? { owner: e.owner } : {}),
      ...(typeof e.lectures === "number" && e.lectures > 0 ? { lectures: e.lectures } : {}),
    });
  }
  return out;
}

/** Where a card goes, in this tab: the name's watch address
 *  (drawcast.app/w/<name> — a real path, which search engines follow and a
 *  hash is not) wherever Netlify serves the site; `#<name>` on a local dev
 *  server, which has no /w/ rewrite. */
export function homeHref(name: string, host: string = typeof location !== "undefined" ? location.hostname : ""): string {
  const local = host === "" || host === "localhost" || /^127\.|^\[?::1\]?$|^192\.168\./.test(host);
  return local ? `#${name}` : `/w/${name}`;
}

/** The card picture: the published poster, through drawcast.app's card
 *  function (CDN-cached; the generic card when there is no poster).
 *  Absolute, so local dev and deploy previews show the real pictures too. */
export function thumbUrl(name: string): string {
  return `https://www.drawcast.app/card/${name}.png`;
}

function lecturesText(n: number): string {
  return `${n} lecture${n === 1 ? "" : "s"}`;
}

export function cardFromFeatured(e: FeaturedEntry): HomeCard {
  return {
    name: e.name,
    title: e.title,
    owner: e.owner ?? "",
    format: e.format,
    meta: e.format === "course" && e.lectures ? lecturesText(e.lectures) : "",
    private: false,
    tags: e.tags,
  };
}

/** A catalogue item as a card. Its format: Course from the registry's kind;
 *  otherwise the curated list's, when the name is curated. */
export function cardFromCatalogue(item: CatalogueItem, featured: ReadonlyMap<string, FeaturedEntry>): HomeCard {
  const f = featured.get(item.name);
  // The registry's own format (since 2026-10-03) first; the curated list's for
  // items registered before formats existed.
  const format: HomeFormat | undefined = item.kind === "course" ? "course" : (item.format ?? f?.format);
  const parts = [item.kind === "course" ? lecturesText(item.lectures) : "", item.updated ? `updated ${item.updated.slice(0, 10)}` : ""].filter(Boolean);
  return {
    name: item.name,
    title: item.title || f?.title || item.name,
    owner: item.owner,
    ...(format ? { format } : {}),
    meta: parts.join(" · "),
    private: item.private,
    tags: item.tags.length ? item.tags : (f?.tags ?? []),
  };
}

/** One list per source, merged: first appearance wins, so a curated card's
 *  wording beats the catalogue's when both name the same drawcast. */
export function mergeCards(...lists: HomeCard[][]): HomeCard[] {
  const seen = new Set<string>();
  const out: HomeCard[] = [];
  for (const list of lists) for (const c of list) if (!seen.has(c.name)) (seen.add(c.name), out.push(c));
  return out;
}

/** A search over the curated list (the catalogue searches titles on the
 *  server): every word must appear in the title or a tag. */
export function matchesSearch(card: HomeCard, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${card.title} ${card.tags.join(" ")}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ---- Topics (2026-10-06): drawcast.app/#chess, ?topic=chess ----

/** A tag as a link word: "History of science" → "history-of-science". */
export function topicSlug(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Words that mean another topic. */
export const TOPIC_ALIASES: Readonly<Record<string, string>> = { math: "mathematics", maths: "mathematics" };

/** The topic a link word asks for: its slug, through the aliases. */
export function topicOf(word: string): string {
  const slug = topicSlug(word);
  return TOPIC_ALIASES[slug] ?? slug;
}

export function hasTopic(tags: readonly string[], topic: string): boolean {
  return tags.some((t) => topicSlug(t) === topic);
}

/** "history-of-science" → "History of science", for a page title. */
export function topicLabel(topic: string): string {
  const words = topic.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The topic rows: every tag two or more curated drawcasts share, most used first. */
export function tagRows(featured: FeaturedEntry[], min = 2): { tag: string; entries: FeaturedEntry[] }[] {
  const by = new Map<string, FeaturedEntry[]>();
  for (const e of featured) for (const t of e.tags) by.set(t, [...(by.get(t) ?? []), e]);
  return [...by.entries()]
    .filter(([, entries]) => entries.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([tag, entries]) => ({ tag, entries }));
}

/**
 * The watch page's "Up next" (home/watch.ts): what to offer beside the
 * drawcast being watched. Curated drawcasts sharing its topic tags first
 * (two points a shared tag), the same format next (one point), ties in the
 * curated order; then the rest of the curated list; then the catalogue's
 * newest. Never the one being watched. A drawcast not in the curated list
 * (or a course lecture, `name/3`) gets the curated list in its own order.
 */
export function upNext(current: string | undefined, featured: FeaturedEntry[], newest: HomeCard[], max = 12): HomeCard[] {
  const base = current?.split("/", 1)[0];
  const me = featured.find((e) => e.name === base);
  const others = featured.filter((e) => e.name !== base);
  const score = (e: FeaturedEntry): number => (me ? e.tags.filter((t) => me.tags.includes(t)).length * 2 + (e.format === me.format ? 1 : 0) : 0);
  const ranked = others.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.e);
  return mergeCards(ranked.map(cardFromFeatured), newest.filter((c) => c.name !== base)).slice(0, max);
}

/** One name's visits over the last 30 days (netlify/functions/rank.mts). */
export interface RankEntry {
  name: string;
  visits: number;
  /** Every visit since counting began (2026-09-29); only from rank?all=1. */
  total?: number;
}

/** What one 👍 is worth against visits in the Popular order: a like is a
 *  deliberate act by a signed-in viewer, a visit may be a glance. */
export const LIKE_WEIGHT = 5;

/** The rank list by drawcast: a course's lectures (`spanish/3`) count for
 *  the course; most visited first. */
export function rankByBase(ranks: RankEntry[]): RankEntry[] {
  const totals = new Map<string, number>();
  for (const r of ranks) {
    const base = r.name.split("/", 1)[0];
    if (base) totals.set(base, (totals.get(base) ?? 0) + Math.max(0, r.visits));
  }
  return [...totals.entries()].map(([name, visits]) => ({ name, visits })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
}

/** The Popular row: the ranked names the catalogue knows (a private or
 *  unlisted name is not in its answer, so it never shows), ordered by visits
 *  plus likes. Items the catalogue returned but the rank did not name are
 *  left out (an older registry ignores `names=` and answers its newest). */
export function popularItems(ranks: RankEntry[], items: CatalogueItem[]): CatalogueItem[] {
  const visits = new Map(ranks.map((r) => [r.name, r.visits]));
  const score = (i: CatalogueItem): number => (visits.get(i.name) ?? 0) + LIKE_WEIGHT * i.likes;
  return items
    .filter((i) => visits.has(i.name) && !i.private)
    .map((i, at) => ({ i, at, s: score(i) }))
    .sort((a, b) => b.s - a.s || a.at - b.at)
    .map((x) => x.i);
}

/**
 * A course's "Up next" (delivery 3): watching lecture N of a course, the
 * lectures after it come first, in order (`course/N+1` …), before anything
 * else. Each is called by its own title when the course.md beside the
 * lecture gave one (`titles`, published lectures in order), else
 * "<course> — lecture 4"; the quiet line says "Lecture 4 of 6".
 */
export function courseNext(
  watchName: string | undefined,
  course: Pick<CatalogueItem, "name" | "title" | "lectures" | "owner"> | null,
  titles: readonly string[] = [],
): HomeCard[] {
  const m = /^([^/]+)\/(\d+)$/.exec(watchName ?? "");
  if (!m || !course || course.name !== m[1]) return [];
  const out: HomeCard[] = [];
  for (let k = Number(m[2]) + 1; k <= course.lectures; k++) {
    const own = titles[k - 1]?.trim();
    out.push({ name: `${course.name}/${k}`, title: own || `${course.title || course.name} — lecture ${k}`, owner: course.owner, meta: `Lecture ${k} of ${course.lectures}`, private: false, tags: [] });
  }
  return out;
}
