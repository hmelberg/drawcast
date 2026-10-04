// B11: render() must never write into the document's own spec objects.
//
// Both resolvers (render/portrait.ts, render/source.ts) fill
// `strokes`/`source`/`of`/links IN PLACE, and render's callers
// (playlist/session.ts, the exports) hand it the document's own specs — so
// merely VIEWING a drawcast used to rewrite the author's document: strokes
// leaked into library saves (main.ts autosave serializes doc.playlist), and
// the Publish embed count lied until it was patched to re-parse the editor
// text. publish/embed.ts already clones for the publish path; this is the
// same guarantee at the render boundary, fixing every render path at once.
//
// Deps are injected for the same reason embed.ts's are: a node test proves
// "never the document" with fake resolvers that scribble on what they get.

import type { CardItemSpec, Spec } from "../spec/types";
import type { RenderStyle } from "./svg-backend";
import { expandSpec } from "../spec/expand";

export interface RenderResolveDeps {
  /** render/portrait.ts's resolvePortraits — mutates the spec it is given. */
  resolvePortraits: (spec: Spec) => Promise<unknown>;
  /** render/source.ts's resolveSources — mutates the spec it is given. */
  resolveSources: (spec: Spec, opts: { contactEmail: string }) => Promise<unknown>;
  /** render/code.ts's resolveCode — mutates the spec it is given. Takes the
   *  render style the way resolveSources takes the contact address: a chart
   *  the author did not style follows the DRAWING's look, and only render()
   *  knows which look this figure is being drawn in. */
  resolveCode: (spec: Spec, deps: { style: RenderStyle }) => Promise<unknown>;
  /** render/image.ts's resolveImages — mutates the spec it is given. */
  resolveImages: (spec: Spec) => Promise<unknown>;
  /** render/icon.ts's resolveIcons — mutates the spec it is given. */
  resolveIcons: (spec: Spec) => Promise<unknown>;
  /** render/link.ts's resolveLinks — mutates the spec it is given. Optional:
   *  a caller with no links to show (a test, a tool) need not wire it. */
  resolveLinks?: (spec: Spec) => Promise<unknown>;
  /** render/template-pictures.ts — the pictures a template draws from its
   *  params (a timeline's thumbnails). Optional, like resolveLinks. */
  resolveTemplatePictures?: (spec: Spec) => Promise<unknown>;
  contactEmail: string;
  /** How the figure is being drawn — the default chart style follows it. */
  style: RenderStyle;
}

/**
 * A deep clone of `spec` with portraits and sources resolved into it.
 * Resolution failures degrade to the element's sketched placeholder, never a
 * throw — the same contract render() always had.
 */
export async function resolvedRenderSpec(spec: Spec, deps: RenderResolveDeps): Promise<Spec> {
  const copy = structuredClone(spec);
  await Promise.all([
    deps.resolvePortraits(copy).catch(() => undefined),
    deps.resolveSources(copy, { contactEmail: deps.contactEmail }).catch(() => undefined),
    deps.resolveCode(copy, { style: deps.style }).catch(() => undefined),
    deps.resolveImages(copy).catch(() => undefined),
    deps.resolveIcons(copy).catch(() => undefined),
    deps.resolveLinks?.(copy).catch(() => undefined),
    deps.resolveTemplatePictures?.(copy).catch(() => undefined),
  ]);
  return copy;
}

/** True when a cards element names an icon on an item (or its match partner). */
function hasCardIcons(spec: Spec): boolean {
  return (spec.elements ?? []).some(
    (el) => el.type === "cards" && Array.isArray(el.items) && el.items.some((it) => typeof it === "object" && it !== null && (it.icon !== undefined || (it as CardItemSpec).match_icon !== undefined)),
  );
}

/**
 * The spec render() draws: expanded (spec/expand.ts), then resolved. A
 * cards element's item icons are resolved FIRST, on a clone of the authored
 * spec (round 5 §3.3): a resolved icon makes every card of the element 96
 * high, and that is decided when the cards expand — resolving after the
 * expansion drew the icon into a 56-high card. The second resolve finds
 * those icons already there (and cached) and fetches nothing again.
 */
export async function expandedRenderSpec(spec: Spec, deps: RenderResolveDeps): Promise<Spec> {
  let authored = spec;
  if (hasCardIcons(spec)) {
    authored = structuredClone(spec);
    await deps.resolveIcons(authored).catch(() => undefined);
  }
  return resolvedRenderSpec(expandSpec(authored), deps);
}
