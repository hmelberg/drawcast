// The Body section's rules, DOM-free: where a click on the figure zooms to,
// the way back, and what a part is called. tray.ts and body-explore.ts render
// them; tests hold them against the real atlas.

import type { AtlasPart } from "../scenes/anatomy/types";

export type NameLang = "en" | "nb" | "la";

export const BODY_LABEL: Record<NameLang, string> = { en: "Body", nb: "Kropp", la: "Corpus" };

export interface Choice<T> {
  value: T;
  label: Record<NameLang, string>;
}

export const SYSTEM_CHOICES: Choice<("skeleton" | "viscera")[]>[] = [
  { value: ["viscera"], label: { en: "Organs", nb: "Organer", la: "Viscera" } },
  { value: ["skeleton"], label: { en: "Skeleton", nb: "Skjelett", la: "Skeleton" } },
  { value: ["skeleton", "viscera"], label: { en: "Both", nb: "Begge", la: "Ambo" } },
];
export const LAYER_CHOICES: Choice<"superficial" | "deep">[] = [
  { value: "superficial", label: { en: "In front", nb: "Foran", la: "Superficialis" } },
  { value: "deep", label: { en: "Behind", nb: "Bak", la: "Profundus" } },
];
export const NAME_CHOICES: Choice<NameLang>[] = [
  { value: "en", label: { en: "English", nb: "Engelsk", la: "Anglice" } },
  { value: "nb", label: { en: "Norwegian", nb: "Norsk", la: "Norvegice" } },
  { value: "la", label: { en: "Latin", nb: "Latin", la: "Latine" } },
];

const hasGeo = (parts: Record<string, AtlasPart>, id: string): boolean => (parts[id]?.rings.length ?? 0) > 0 && parts[id].kind !== "outline";
const childrenOf = (parts: Record<string, AtlasPart>, id: string): string[] => Object.keys(parts).filter((c) => parts[c].parent === id);
/** A part whose children carry geometry: a region (a hull) or a group (no geometry of its own). */
const isContainer = (parts: Record<string, AtlasPart>, id: string): boolean =>
  (parts[id]?.kind === "region" || parts[id]?.kind === "group") && childrenOf(parts, id).some((c) => hasGeo(parts, c) || isContainer(parts, c));

/** The nearest ancestor that is a region or a group, or null at the root. */
function containerAbove(parts: Record<string, AtlasPart>, id: string): string | null {
  let cur = parts[id]?.parent ?? null;
  while (cur) {
    if (isContainer(parts, cur)) return cur;
    cur = parts[cur]?.parent ?? null;
  }
  return null;
}

/**
 * Where a click lands the viewer. A container (region, group) is entered.
 * A leaf goes to its nearest container — unless the viewer is already
 * there, in which case the leaf is picked out and named instead. The
 * outline, the frame and unknown ids change nothing.
 */
export function focusTargetFor(parts: Record<string, AtlasPart>, clicked: string, currentFocus: string | null): { focus: string | null; highlight: string | null } {
  const p = parts[clicked];
  if (!p || p.kind === "outline") return { focus: currentFocus, highlight: null };
  if (isContainer(parts, clicked)) return { focus: clicked, highlight: null };
  if (p.kind === "group") return { focus: currentFocus, highlight: null }; // a bare group with nothing under it
  const above = containerAbove(parts, clicked);
  if (above === null) return { focus: currentFocus, highlight: null };
  if (above === currentFocus) return { focus: currentFocus, highlight: clicked };
  return { focus: above, highlight: null };
}

/** Ancestors root-first, ending at `focus`; empty for the whole body. */
export function breadcrumbFor(parts: Record<string, AtlasPart>, focus: string | null): string[] {
  const out: string[] = [];
  let cur: string | null = focus;
  while (cur && parts[cur]) {
    out.unshift(cur);
    cur = parts[cur].parent;
  }
  return out;
}

export function partLabel(parts: Record<string, AtlasPart>, id: string, names: NameLang): string {
  const n = parts[id]?.name;
  return n ? (n[names] ?? n.en) : id;
}
