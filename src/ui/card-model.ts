// The info card, pure half (interactivity spec §9.5 "more info", §13):
// which elements carry a card, what the card calls them, which links it
// offers, and where Search goes. Name sources are the reliable, spec-level
// ones — a portrait's person and a source's title (their identity rides
// along) and the TEXT a viewer can read on the canvas: a label's, a node's,
// a tier-3 text's. An element carrying only links falls back to its
// prettified id. Template parts wait for a real naming story: their
// element_ids docs are LLM-facing prose and their labels are symbols
// ("D", "P*") — which meaningfulName screens out anyway.

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
  /**
   * Set on a target minted from a DRAWN text that is not itself command-
   * addressable (a template's axis caption, `axes__x_label`): the addressable
   * element whose visibility governs it. The word appears and disappears with
   * the part it belongs to, so the card must too.
   */
  owner?: string;
}

/** What the layout knows that the spec does not: what was actually drawn. */
export interface LayoutFacts {
  /** Command-addressable ids in draw order (`LayoutResult.order`). */
  order?: readonly string[];
  /**
   * Every text drawable actually painted: its own id, its words, and the
   * top-level drawable it belongs to. `owner` comes from the drawable TREE,
   * which is the only reliable answer — a template group's children need not
   * share its id prefix (`pv_loop`'s "Stroke volume" is `sv__t`).
   */
  texts?: readonly { id: string; text: string; owner?: string }[];
}

/** Element types whose `text` is a word on the canvas a viewer might ask about. */
const TEXT_BEARING = new Set(["label", "node", "text"]);

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
export function cardTargets(spec: Spec, layout: LayoutFacts | readonly string[] = {}): Map<string, CardTarget> {
  const facts: LayoutFacts = Array.isArray(layout) ? { order: layout as readonly string[] } : (layout as LayoutFacts);
  const ids = facts.order;
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

  // Text names its element. A LABEL also names what it attach_to's — the
  // curve is clickable, not just the word beside it. A node's text and a
  // tier-3 text name only themselves (there is nothing to reach through to),
  // but they are words on the canvas exactly like a label's, so they carry a
  // card on the same terms: a flowchart box reading "Confounding" is as
  // clickable as a label saying it.
  for (const el of spec.elements ?? []) {
    if (!TEXT_BEARING.has(el.type) || typeof el.text !== "string" || !meaningfulName(el.text)) continue;
    const name = el.text.trim();
    if (usable(el.id)) addLinks(ensure(el.id, name), linksOf(el));
    if (el.type === "label" && usable(el.attach_to)) addLinks(ensure(el.attach_to, name), linksOf(el));
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
    } else if (!TEXT_BEARING.has(el.type) && linksOf(el).length > 0) {
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

  // Finally the words a TEMPLATE drew. They are not spec elements — the
  // template computes them — so without this pass they are dead text: measured
  // 2026-08-29, only 3% of the readable words across the bundled drawcasts
  // were clickable, and "Nucleus", "Amplitude A" and "Base pair" were not
  // among them. A drawn word names itself, and the card lands on the WORD's
  // own box, never on the part that owns it: mapping an axis caption up to
  // `axes` would make the whole coordinate cross clickable as "Quantity (Q)".
  // Sub-drawable ids (`axes__x_label`) are exactly what this pass is for, so
  // the `__` screen that `usable` applies to SPEC ids does not apply here.
  const addressable = new Set(ids ?? []);
  for (const t of facts.texts ?? []) {
    if (typeof t.id !== "string" || t.id === "") continue;
    if (typeof t.text !== "string" || !meaningfulName(t.text)) continue;
    if (out.has(t.id)) continue;
    // Its own id may be addressable; otherwise the drawable tree says which
    // part owns it, and that part lends it both a home and a visibility.
    let owner: string | undefined;
    if (!addressable.has(t.id)) {
      if (t.owner !== undefined && addressable.has(t.owner)) owner = t.owner;
      else {
        for (const cand of addressable) {
          if (t.id.startsWith(cand) && (owner === undefined || cand.length > owner.length)) owner = cand;
        }
      }
      // Never mint a card whose visibility nothing governs: it would sit on
      // screen after the storyboard erased the part it belongs to.
      if (owner === undefined) continue;
    }
    // A part that already carries a card keeps it — a portrait's caption must
    // not shadow the portrait's own identity with a plain name.
    if (owner !== undefined && out.has(owner)) continue;
    out.set(t.id, { id: t.id, name: t.text.trim(), kind: "plain", links: [], owner });
  }
  return out;
}

/** The zero-authoring Search action: the name plus the drawcast's own title
 *  as disambiguating context ("demand curve" alone is search roulette). */
export function searchUrl(name: string, context?: string): string {
  const q = context && context.trim() !== "" ? `${name} ${context.trim()}` : name;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
