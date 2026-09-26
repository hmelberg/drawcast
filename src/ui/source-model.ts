// The spec's `sources`, as the player shows them: a citation line and, when
// the author knew one, a link. Shared by the info card (an element that
// `cites` a source) and the tray's Sources section.
import type { Spec, SpecSource } from "../spec/types";

/** Where a source opens: its DOI resolved, else its url, else nowhere. */
export function sourceHref(s: SpecSource): string | null {
  if (s.doi) return `https://doi.org/${s.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
  return s.url ?? null;
}

/** "Card and Krueger (1994)" — who and when, the way a talk cites it. */
export function sourceByline(s: SpecSource): string {
  const who = s.authors?.trim() ?? "";
  const when = s.year !== undefined ? `(${s.year})` : "";
  return [who, when].filter(Boolean).join(" ");
}

/** The sources an element cites, in its order; unknown ids are dropped (validation reports them). */
export function citedSources(spec: Spec, cites: string[] | string | undefined): SpecSource[] {
  const ids = typeof cites === "string" ? [cites] : Array.isArray(cites) ? cites : [];
  const byId = new Map((spec.sources ?? []).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is SpecSource => s !== undefined);
}
