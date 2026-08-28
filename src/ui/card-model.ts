// The info card, pure half (interactivity spec §9.5 "more info", §13):
// which elements carry a card, what the card calls them, and where Search
// goes. V1 name sources are the reliable, spec-level ones — a portrait's
// person (its wiki identity rides along) and an element's authored label
// text. Template parts wait for a real naming story: their element_ids
// docs are LLM-facing prose and their labels are symbols ("D", "P*").

import type { Spec } from "../spec/types";

export interface CardTarget {
  id: string;
  name: string;
  kind: "portrait" | "plain";
  /** The wiki identity (the portrait's `of`) — summary + Read more exist. */
  wikiName?: string;
}

/** A name a human would search for — not a curve symbol or a number.
 *  ≥3 chars with at least two consecutive letters ("GDP" yes, "D′"/"P*"/"42" no). */
export function meaningfulName(s: string): boolean {
  const t = s.trim();
  return t.length >= 3 && /[A-Za-zÀ-ÖØ-öø-ÿ]{2}/.test(t);
}

/** Every element of the spec that carries an info card, by id. A label
 *  element names itself AND, via attach_to, the element it labels — the
 *  curve is clickable, not just the word beside it. Portraits win over a
 *  label that happens to attach to them. */
export function cardTargets(spec: Spec): Map<string, CardTarget> {
  const out = new Map<string, CardTarget>();
  const usable = (id: unknown): id is string => typeof id === "string" && id !== "" && !id.includes("__");
  for (const el of spec.elements ?? []) {
    if (el.type === "label" && typeof el.text === "string" && meaningfulName(el.text)) {
      const t: Omit<CardTarget, "id"> = { name: el.text.trim(), kind: "plain" } as Omit<CardTarget, "id">;
      if (usable(el.id) && !out.has(el.id)) out.set(el.id, { id: el.id, ...t });
      if (usable(el.attach_to) && !out.has(el.attach_to)) out.set(el.attach_to, { id: el.attach_to, ...t });
    }
  }
  for (const el of spec.elements ?? []) {
    if (el.type === "portrait" && usable(el.id) && typeof el.of === "string" && el.of.trim() !== "") {
      const name = el.of.trim();
      out.set(el.id, { id: el.id, name, kind: "portrait", wikiName: name });
    }
  }
  return out;
}

/** The zero-authoring Search action: the name plus the drawcast's own title
 *  as disambiguating context ("demand curve" alone is search roulette). */
export function searchUrl(name: string, context?: string): string {
  const q = context && context.trim() !== "" ? `${name} ${context.trim()}` : name;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}
