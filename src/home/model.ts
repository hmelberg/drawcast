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

/** Where a card goes: the name, in this tab — the front page is drawcast.app itself. */
export function homeHref(name: string): string {
  return `#${name}`;
}

/** The card picture: the published poster, through drawcast.app's card
 *  function (CDN-cached; the generic card when there is no poster).
 *  Absolute, so local dev and deploy previews show the real pictures too. */
export function thumbUrl(name: string): string {
  return `https://drawcast.app/card/${name}.png`;
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
  const format: HomeFormat | undefined = item.kind === "course" ? "course" : f?.format;
  const parts = [item.kind === "course" ? lecturesText(item.lectures) : "", item.updated ? `updated ${item.updated.slice(0, 10)}` : ""].filter(Boolean);
  return {
    name: item.name,
    title: item.title || f?.title || item.name,
    owner: item.owner,
    ...(format ? { format } : {}),
    meta: parts.join(" · "),
    private: item.private,
    tags: f?.tags ?? [],
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

/** The topic rows: every tag two or more curated drawcasts share, most used first. */
export function tagRows(featured: FeaturedEntry[], min = 2): { tag: string; entries: FeaturedEntry[] }[] {
  const by = new Map<string, FeaturedEntry[]>();
  for (const e of featured) for (const t of e.tags) by.set(t, [...(by.get(t) ?? []), e]);
  return [...by.entries()]
    .filter(([, entries]) => entries.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([tag, entries]) => ({ tag, entries }));
}
