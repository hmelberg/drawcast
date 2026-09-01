// Embedding images into the copy that gets published — never into the
// document the author has open.
//
// The hazard this module exists to avoid (P §3.4): `itemsOf`/`exportSequence`
// hand out the document's OWN spec objects, and both resolvers
// (render/portrait.ts's `resolvePortraits`, render/source.ts's
// `resolveSources`) fill `strokes` IN PLACE. Calling them on what the editor
// is showing would rewrite the author's file as a side effect of publishing —
// which is exactly the difference Publish is supposed to keep: Save is
// verbatim, Publish embeds into the copy it sends (§F.3).
//
// So: deep-clone every spec first, resolve on the clones, and rebuild the
// playlist around them with `playlistWithSpecs` (which spreads `...playlist`,
// so the header — title, subtitle, and B9's founding `prompt` — rides along
// into the published copy unchanged).
//
// The resolvers arrive as injected deps rather than being imported here, so
// the whole thing is testable without a network, a canvas, or an image
// decoder — and so a test can prove the "never the document" guarantee with
// fake resolvers that scribble on whatever spec they are handed.

import { itemsOf, playlistWithSpecs, type Playlist } from "../playlist/playlist";
import type { Spec } from "../spec/types";

export interface EmbedDeps {
  /** `render/portrait.ts`'s resolvePortraits — mutates the spec it is given. */
  resolvePortraits: (spec: Spec) => Promise<unknown>;
  /** `render/source.ts`'s resolveSources — mutates the spec it is given. */
  resolveSources: (spec: Spec, opts: { contactEmail: string }) => Promise<unknown>;
  /** Unpaywall wants a contact address; read fresh from Settings at publish time. */
  contactEmail: string;
}

/**
 * A FRESH playlist whose specs are deep clones with images resolved into
 * `strokes`. The input playlist and its spec objects are never touched —
 * §3.4: exportSequence hands out the document's own objects.
 *
 * Resolution failures are not thrown and not reported here: both resolvers
 * already leave a failed element without strokes (the layout draws its
 * placeholder) and return their per-element results. Publishing a drawcast
 * whose one portrait could not be traced is still a publish — the same
 * decision the Embed dialog makes for the document.
 */
export async function embeddedPlaylist(playlist: Playlist, deps: EmbedDeps): Promise<Playlist> {
  const specs = itemsOf(playlist).map((i) => structuredClone(i.spec));
  await Promise.all(
    specs.flatMap((s) => [deps.resolvePortraits(s), deps.resolveSources(s, { contactEmail: deps.contactEmail })]),
  );
  return playlistWithSpecs(playlist, specs);
}
