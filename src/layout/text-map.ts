// A scene template computes its own captions — "Susceptible" for compartment
// "S", "Reaction progress" under an energy diagram's x axis — so those words
// live in the layout code, never in the spec. A spec-level translator cannot
// see them, which is why a translated copy carries them separately and the
// layout substitutes them on the way out.

import type { Drawable } from "./model";
import type { LabelRequest } from "./labels";

function walkText(drawables: Drawable[], visit: (d: { text: string }) => void): void {
  for (const d of drawables) {
    if (d.kind === "text") visit(d);
    else if (d.kind === "group") walkText(d.children, visit);
  }
}

/** Every distinct string this layout actually draws, in paint order. */
export function collectDrawnText(drawables: Drawable[], labels: LabelRequest[]): string[] {
  const seen = new Set<string>();
  const push = (text: string): void => {
    const t = text.trim();
    if (t.length > 0) seen.add(t);
  };
  walkText(drawables, (d) => push(d.text));
  for (const l of labels) push(l.text);
  return [...seen];
}

/**
 * Substitute drawn text in place. Label requests are rewritten too, and both
 * happen BEFORE the label solver runs, so obstacle boxes, placement and
 * annotation targets are all measured against the words that will be drawn
 * rather than the ones they were translated from.
 */
export function applyTextMap(drawables: Drawable[], labels: LabelRequest[], map: Record<string, string>): void {
  const swap = (text: string): string => {
    const to = map[text.trim()];
    return typeof to === "string" && to.trim().length > 0 ? to : text;
  };
  walkText(drawables, (d) => {
    d.text = swap(d.text);
  });
  for (const l of labels) l.text = swap(l.text);
}
