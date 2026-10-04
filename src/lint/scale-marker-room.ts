// A guessed scale's marker lands anywhere along the line, its number over
// it (spec/scale.ts scaleValueElements: y + 36 + …). A picture or a text the
// author put in that band covers the guess's number while the viewer drags
// it (W25: ants-on-earth's ant sat on "32 trillion"). Flag it, naming the
// element and how far to move it.

import { authoredScales, scaleGeometry } from "../spec/scale";
import type { Spec } from "../spec/types";
import { walkVisible, type LintIssue } from "./lint";
import { bboxOfText, type BBox } from "../layout/geometry";
import type { MeasureFn } from "../layout/measure";
import { leafDrawables, type Drawable } from "../layout/model";

/** The band over a scale's line its marker and number take (logical units). */
export function scaleMarkerBand(sc: Parameters<typeof scaleGeometry>[0]): BBox {
  const g = scaleGeometry(sc);
  const size = g.sizes?.answer ?? 28;
  const top = g.y + 36 + Math.round(size * 0.6) + size * 0.6;
  return { x: g.x0 - 20, y: g.y + 8, w: g.x1 - g.x0 + 40, h: top - (g.y + 8) };
}

export function lintScaleMarkerRoom(spec: Spec, drawables: Drawable[], measure: MeasureFn, expandId?: (id: string) => string[] | null | undefined): LintIssue[] {
  const scales = new Map(authoredScales(spec).map((sc) => [sc.id, sc]));
  const issues: LintIssue[] = [];
  const flagged = new Set<string>();
  walkVisible(spec.commands ?? [], expandId, (c, visible) => {
    const on = c.ask?.on;
    for (const raw of typeof on === "string" ? [on] : Array.isArray(on) ? on : []) {
      const sc = scales.get(raw.replace(/_(answer|marker)$/, ""));
      if (!sc) continue;
      const band = scaleMarkerBand(sc);
      for (const top of drawables) {
        if (top.id === sc.id || top.id.startsWith(`${sc.id}_`) || flagged.has(`${sc.id}|${top.id}`)) continue;
        const leaves = leafDrawables([top]);
        // On screen while the viewer guesses: drawn (or shown) before the ask.
        if (!visible.has(top.id) && !leaves.some((l) => visible.has(l.id))) continue;
        for (const leaf of leaves) {
          const b: BBox | null =
            leaf.kind === "text" ? (leaf.text.trim() === "" ? null : bboxOfText(leaf, measure))
            : leaf.kind === "image" ? { x: leaf.pos[0] - leaf.w / 2, y: leaf.pos[1] - leaf.h / 2, w: leaf.w, h: leaf.h }
            : null;
          if (!b) continue;
          const dy = Math.min(b.y + b.h, band.y + band.h) - Math.max(b.y, band.y);
          const dx = Math.min(b.x + b.w, band.x + band.w) - Math.max(b.x, band.x);
          if (dx <= 8 || dy <= 8) continue;
          flagged.add(`${sc.id}|${top.id}`);
          const up = Math.ceil(band.y + band.h - b.y);
          issues.push({
            rule: "scale-marker",
            ids: [top.id, sc.id],
            severity: "warn",
            message: `"${top.id}" lies where ${sc.id}'s guess marker and its number go (up to ${Math.round(band.y + band.h)}, over the line at ${Math.round(band.y - 8)}) — the viewer's number is hidden under it while they guess: move it up about ${up} (or make it smaller)`,
          });
          break;
        }
      }
    }
  });
  return issues;
}
