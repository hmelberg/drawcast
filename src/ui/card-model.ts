// The info card, pure half (interactivity spec §9.5 "more info", §13):
// which elements carry a card, what the card calls them, which links it
// offers, and where Search goes. Name sources are the reliable, spec-level
// ones — a portrait's person (its wiki identity rides along) and label
// text; an element carrying only links falls back to its prettified id.
// Template parts wait for a real naming story: their element_ids docs are
// LLM-facing prose and their labels are symbols ("D", "P*").

import type { Spec, SpecElement } from "../spec/types";

export interface CardTarget {
  id: string;
  name: string;
  kind: "portrait" | "plain";
  /** The wiki identity (the portrait's `of`) — summary + Read more exist. */
  wikiName?: string;
  /** Authored resource links (spec §13), merged from the element and any
   *  labels attached to it; deduped. */
  links: string[];
}

/** A name a human would search for — not a curve symbol or a number.
 *  ≥3 chars with at least two consecutive letters ("GDP" yes, "D′"/"P*"/"42" no). */
export function meaningfulName(s: string): boolean {
  const t = s.trim();
  return t.length >= 3 && /[A-Za-zÀ-ÖØ-öø-ÿ]{2}/.test(t);
}

/** The element's own links, post-normalize tolerant of a bare string. */
function linksOf(el: SpecElement): string[] {
  return typeof el.link === "string" ? [el.link] : Array.isArray(el.link) ? el.link.filter((l): l is string => typeof l === "string") : [];
}

/**
 * Every element of the spec that carries an info card, by id. A label
 * element names (and links) itself AND, via attach_to, the element it
 * labels — the curve is clickable, not just the word beside it. Portraits
 * win the name over a label that happens to attach to them; an element
 * with only links is card-bearing too, named by its prettified id.
 */
export function cardTargets(spec: Spec, ids?: readonly string[]): Map<string, CardTarget> {
  const out = new Map<string, CardTarget>();
  const usable = (id: unknown): id is string => typeof id === "string" && id !== "" && !id.includes("__");
  const ensure = (id: string, name: string, kind: "portrait" | "plain" = "plain"): CardTarget => {
    const t = out.get(id) ?? { id, name, kind, links: [] };
    out.set(id, t);
    return t;
  };
  const addLinks = (t: CardTarget, links: string[]): void => {
    for (const l of links) if (!t.links.includes(l)) t.links.push(l);
  };

  for (const el of spec.elements ?? []) {
    if (el.type !== "label" || typeof el.text !== "string" || !meaningfulName(el.text)) continue;
    const name = el.text.trim();
    if (usable(el.id)) addLinks(ensure(el.id, name), linksOf(el));
    if (usable(el.attach_to)) addLinks(ensure(el.attach_to, name), linksOf(el));
  }
  for (const el of spec.elements ?? []) {
    if (!usable(el.id)) continue;
    if (el.type === "source" && typeof el.of === "string" && el.of.trim() !== "") {
      // A source is named by its title — the same caption the figure draws,
      // and it wins over a stray label the way a portrait's person does. Its
      // click-through (the PDF, the archive page) is already in `link`: the
      // resolver appends it, so this costs the model nothing.
      const prev = out.get(el.id);
      const t: CardTarget = { id: el.id, name: el.of.trim(), kind: "plain", links: prev?.links ?? [] };
      out.set(el.id, t);
      addLinks(t, linksOf(el));
    } else if (el.type === "portrait" && typeof el.of === "string" && el.of.trim() !== "") {
      const name = el.of.trim();
      const prev = out.get(el.id);
      const t: CardTarget = { id: el.id, name, kind: "portrait", wikiName: name, links: prev?.links ?? [] };
      out.set(el.id, t);
      addLinks(t, linksOf(el));
    } else if (el.type !== "label" && linksOf(el).length > 0) {
      // A linked element with no label of its own: the id is the name.
      const t = ensure(el.id, el.id.replace(/_/g, " "));
      addLinks(t, linksOf(el));
    }
  }

  // Command-addressable ids the LAYOUT minted for an element — a source's
  // highlighter sweeps (`<id>_quote`, `<id>_quote_2`, …) — carry their
  // element's card. They sit ON the page and are much smaller than it, and
  // the hit test takes the SMALLEST containing box, so without this a click
  // on the marked passage would open nothing at all: the other half of the
  // R9 lesson, where a card-less box shadows the card element it belongs to.
  for (const id of ids ?? []) {
    const owner = /^(.+)_quote(_\d+)?$/.exec(id)?.[1];
    const t = owner ? out.get(owner) : undefined;
    if (t && !out.has(id)) out.set(id, t);
  }
  return out;
}

/** The zero-authoring Search action: the name plus the drawcast's own title
 *  as disambiguating context ("demand curve" alone is search roulette). */
export function searchUrl(name: string, context?: string): string {
  const q = context && context.trim() !== "" ? `${name} ${context.trim()}` : name;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
