// The small-template-text advisory (W30, spec 2026-10-04-page-frame): text a
// TEMPLATE draws that lands under the readable minimum (TEXT_MIN) at the size
// it is drawn — after the template box's fit and the cast's text scale. Like
// the fill advisory it is advice, never an issue of layoutSpec (the examples
// gate and generation do not read it); `cast.mjs check` and the frames
// harness print it. The lint's own font-too-small (FONT_FLOOR, 14) still
// warns on its own below that.

import { TEXT_MIN } from "../layout/readable";
import type { Drawable } from "../layout/model";
import { lintableLeaves, type LintIssue } from "./lint";

/** Ids of what a template drew: top-level drawables that are not the spec's own elements nor the page's heading. */
function templateTops(drawables: Drawable[], elementIds: ReadonlySet<string>): Drawable[] {
  // An element's own satellites (a code element's controls pane, `<id>_ctl`) are the element's too.
  const ownedBy = (id: string) => elementIds.has(id) || [...elementIds].some((e) => id.startsWith(`${e}_`));
  return drawables.filter((d) => !ownedBy(d.id) && !/^card_\d+_/.test(d.id) && !d.id.startsWith("__"));
}

/**
 * The advisory for one laid-out page (drawn sizes — lint/at-scale.ts), or
 * null: how many of the template's texts are under TEXT_MIN, and the
 * smallest. Text an element of the spec draws is the author's own and not
 * judged here.
 */
export function smallTemplateText(drawables: Drawable[], spec: { template?: string; elements?: { id: string }[] }, visible?: (id: string) => boolean): LintIssue | null {
  if (!spec.template) return null;
  const own = new Set((spec.elements ?? []).map((e) => e.id));
  const small: { id: string; fs: number }[] = [];
  for (const top of templateTops(drawables, own)) {
    if (visible && !visible(top.id)) continue;
    for (const t of lintableLeaves([top])) {
      if (t.kind !== "text" || t.text.trim() === "" || t.font === "c64") continue;
      if (t.fontSize < TEXT_MIN - 0.05) small.push({ id: t.id, fs: t.fontSize });
    }
  }
  if (small.length === 0) return null;
  small.sort((a, b) => a.fs - b.fs);
  const least = small[0];
  return {
    rule: "small-text",
    ids: [],
    message:
      `template ${spec.template}: ${small.length} text${small.length === 1 ? "" : "s"} drawn under ${TEXT_MIN} units ` +
      `(smallest ${Math.round(least.fs * 10) / 10}, "${least.id}") — drawn small by the template, or shrunk by its box or a text.font_size under 26`,
    severity: "warn",
  };
}
