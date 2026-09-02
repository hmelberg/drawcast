// Whether the drawing itself draws its title (C9, revised by Hans
// 2026-09-02): "titles that are part of the drawcast go on top when that is
// natural" — drawn ink, at the top of the canvas, as the opening beat the
// compiler prompt asks for. What he never wanted is a separate chrome-text
// title around the drawing DUPLICATING it — so the HTML title (and the video
// frame's title band) show only when the drawing does NOT carry the title,
// as the fallback for casts that never draw theirs.
//
// Exact match after normalization, deliberately: "Markov models" on the
// canvas does not count as drawing the title "Markov models part I" —
// a looser rule would silently hide real titles on near-misses.

import { leafDrawables, type Drawable } from "../layout/model";

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

export function titleIsDrawn(title: string | undefined, drawables: Drawable[]): boolean {
  if (!title) return false;
  const t = norm(title);
  if (t === "") return false;
  for (const d of leafDrawables(drawables)) {
    if (d.kind !== "text") continue;
    const text = d.lines && d.lines.length > 1 ? d.lines.join(" ") : d.text;
    if (norm(text) === t) return true;
  }
  return false;
}
