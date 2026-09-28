// The corner list's pure half (ui/more.ts draws it): which entries a spec
// offers, under what word, in which corner. Hans 2026-09-29: "an icon or a
// text called 'Sources' in the lower right hand corner … a list of things,
// some clickable … maybe also small thumbnails."
//
// A spec with `sources` gets the list for free — no `more` needed, so an
// author (or the model) who names the studies has them one click from the
// figure. `more: false` takes it away; `more.items` picks and orders the
// sources and adds entries that are not studies (a video, a guideline).
import type { MoreCorner, Spec, SpecMoreItem, SpecSource } from "../spec/types";
import { linkActionsFor, linkKindOf } from "./link-model";
import { sourceByline, sourceHref } from "./source-model";

export interface MoreEntry {
  title: string;
  /** Where a click goes — http(s) only; null when the entry is only read. */
  href: string | null;
  /** "Card and Krueger (1994)" for a source; absent for an extra. */
  byline?: string;
  /** A source's finding, or an extra's own line. */
  text?: string;
  /** Thumbnail URL: the author's, or a YouTube link's own. */
  image?: string;
  /** Where the link goes, said small: "🌐 nejm.org", "📺 Watch", "📕 PDF". */
  hint?: string;
  /** The source this entry is, when it is one. */
  sourceId?: string;
}

export interface MoreModel {
  label: string;
  corner: MoreCorner;
  entries: MoreEntry[];
  open: boolean;
}

const HTTP = /^https?:\/\//i;

function safe(url: string | null | undefined): string | null {
  return url && HTTP.test(url) ? url : null;
}

/** A YouTube link's own still, when the author gave none. */
function thumbFor(href: string | null): string | undefined {
  if (!href) return undefined;
  const k = linkKindOf(href);
  return k.kind === "youtube" ? `https://i.ytimg.com/vi/${k.id}/default.jpg` : undefined;
}

function hintFor(href: string | null): string | undefined {
  return href ? linkActionsFor([href])[0]?.label : undefined;
}

function fromSource(s: SpecSource): MoreEntry {
  const href = safe(sourceHref(s));
  const by = sourceByline(s);
  const image = safe(s.image) ?? thumbFor(href);
  return {
    title: s.title,
    href,
    ...(by && { byline: by }),
    ...(s.finding && { text: s.finding }),
    ...(image && { image }),
    ...(href && { hint: hintFor(href) }),
    sourceId: s.id,
  };
}

function fromItem(it: SpecMoreItem): MoreEntry {
  const href = safe(it.url);
  const image = safe(it.image) ?? thumbFor(href);
  const hint = hintFor(href);
  return { title: it.title, href, ...(it.text && { text: it.text }), ...(image && { image }), ...(hint && { hint }) };
}

/** What the corner shows for this spec, or null when it shows nothing. */
export function moreModel(spec: Spec): MoreModel | null {
  const more = spec.more;
  if (more === false) return null;
  const opts = typeof more === "object" && more !== null ? more : {};
  const sources = spec.sources ?? [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  // Unknown ids are dropped here; validation reports them.
  const entries: MoreEntry[] =
    opts.items === undefined
      ? sources.map(fromSource)
      : opts.items.flatMap((it): MoreEntry[] => {
          if (typeof it === "string") {
            const s = byId.get(it);
            return s ? [fromSource(s)] : [];
          }
          return it && typeof it.title === "string" && it.title.trim() !== "" ? [fromItem(it)] : [];
        });
  if (entries.length === 0) return null;
  const allSources = entries.every((e) => e.sourceId !== undefined);
  const label = opts.label?.trim() || (allSources ? "Sources" : "More");
  return { label, corner: opts.corner ?? "bottom-right", entries, open: opts.open === true };
}

/** Whether the list opens upward (a bottom corner) — it grows into the figure, never off it. */
export function opensUp(corner: MoreCorner): boolean {
  return corner.startsWith("bottom");
}
