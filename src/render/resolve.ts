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

import type { Spec } from "../spec/types";

export interface RenderResolveDeps {
  /** render/portrait.ts's resolvePortraits — mutates the spec it is given. */
  resolvePortraits: (spec: Spec) => Promise<unknown>;
  /** render/source.ts's resolveSources — mutates the spec it is given. */
  resolveSources: (spec: Spec, opts: { contactEmail: string }) => Promise<unknown>;
  contactEmail: string;
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
  ]);
  return copy;
}
