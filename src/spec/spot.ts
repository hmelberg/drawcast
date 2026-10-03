// SPOT IT ON THE PICTURE (spec 2026-10-04-page-frame, W13): "Where is the
// liver? Tap it." The viewer taps a point; it is judged against the place's
// outline (or its box), with a little tolerance.
//
//   {"ask": {"question": "Where is the liver? Tap it.", "spot": "liver", "on": "body"}}
//
// `spot` names the place: a region of the `on` image (its `regions`), a
// template part (an anatomy organ, a maps country_<slug>) or any drawn
// element id. `on` names the picture, template or map it is on — needed
// only for an image's region.
//
// Sugar on the click widget, expanded before layout (spec/expand.ts):
//   {spot, on} → {widget: "click", answer: <the place>, spot: <the place>}
// where the place is `<image>:<region>` for a region (spec/places.ts) and
// the id otherwise. The plan gives it its box and a point inside it (the
// movie's pointer taps there), and the spot gate (ui/spot-gate.ts) judges
// the tap and draws the reveal.

import { handRegions } from "./places";
import type { AskArgs, Spec } from "./types";

const onOf = (ask: AskArgs): string | undefined =>
  typeof ask.on === "string" ? ask.on : Array.isArray(ask.on) && ask.on.length === 1 ? ask.on[0] : undefined;

/** The regions an image element names by hand ({} for anything else). */
function regionsOf(spec: Pick<Spec, "elements">, id: string | undefined): Record<string, unknown> {
  if (id === undefined) return {};
  const el = spec.elements?.find((e) => e.id === id);
  return el && el.type === "image" ? handRegions((el as { regions?: unknown }).regions) : {};
}

/** The place a spot ask names: `<image>:<region>` for a region of its `on` image, else the id itself. */
export function spotPlace(spec: Pick<Spec, "elements">, ask: AskArgs): string | null {
  if (typeof ask.spot !== "string" || ask.spot.trim() === "") return null;
  const spot = ask.spot.trim();
  if (spot.includes(":")) return spot;
  const on = onOf(ask);
  return on !== undefined && Object.hasOwn(regionsOf(spec, on), spot) ? `${on}:${spot}` : spot;
}

/** Spot asks as click asks on their place. The same object back when there is none. */
export function expandSpot(spec: Spec): Spec {
  const cmds = spec.commands ?? [];
  if (!cmds.some((c) => typeof c.ask?.spot === "string" && c.ask.widget === undefined)) return spec;
  return {
    ...spec,
    commands: cmds.map((cmd) => {
      const ask = cmd.ask;
      if (!ask || typeof ask.spot !== "string" || ask.widget !== undefined) return cmd;
      const place = spotPlace(spec, ask);
      if (place === null) return cmd;
      const { on: _on, ...rest } = ask;
      return { ...cmd, ask: { ...rest, widget: "click", answer: place, spot: place } };
    }),
  };
}

/** What is wrong with the spot asks of an authored spec (schema.ts semanticErrors). */
export function spotErrors(spec: Pick<Spec, "elements" | "commands">): string[] {
  const errs: string[] = [];
  (spec.commands ?? []).forEach((cmd, i) => {
    const a = cmd.ask;
    if (!a || a.spot === undefined) return;
    if (typeof a.spot !== "string" || a.spot.trim() === "") {
      errs.push(`commands[${i}]: ask.spot must name the place to tap (a region of the on image, a part, or an element id)`);
      return;
    }
    const clash = (["answer", "widget", "items", "choose", "code", "blanks", "pick", "others", "retry"] as const).filter((k) => a[k] !== undefined);
    if (clash.length > 0) errs.push(`commands[${i}]: ask.spot is answered by tapping the place — leave out ${clash.join(", ")}`);
    if (Array.isArray(a.on) && a.on.length !== 1) errs.push(`commands[${i}]: ask.on with spot names one picture, template or map`);
    const on = onOf(a);
    const regions = Object.keys(regionsOf(spec, on));
    const spot = a.spot.trim();
    const isElement = (spec.elements ?? []).some((e) => e.id === spot);
    if (regions.length > 0 && !spot.includes(":") && !regions.includes(spot) && !isElement) {
      errs.push(`commands[${i}]: ask.spot "${spot}" is not a region of ${on} — it has: ${regions.join(", ")}`);
    }
  });
  return errs;
}
