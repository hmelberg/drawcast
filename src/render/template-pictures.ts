// Pictures a TEMPLATE draws from its params (2026-09-29, the timeline's
// event thumbnails): resolved before layout, like the portrait element's —
// same cache, same keys, same Wikipedia lookup and photo look — and written
// into each target's `strokes` in the encodePhoto form the layout decodes.
// The template says which objects need a picture (SceneModule.pictures);
// this file knows nothing about timelines. Never throws: a miss leaves the
// target without strokes and the template draws no thumbnail.

import type { Spec } from "../spec/types";
import { scenes } from "../scenes/registry";
import { cacheGet, cachePut, TRACE_VERSION, thumbFromSummary, traceFromUrl, wikiSummaryUrl } from "./portrait";

export interface TemplatePictureDeps {
  fetch: typeof fetch;
  /** Image URL → encoded photo (render/portrait.ts traceFromUrl). */
  trace: (url: string) => Promise<string>;
  cacheGet: (key: string) => Promise<string | null>;
  cachePut: (key: string, v: string) => Promise<void>;
}

function defaultDeps(): TemplatePictureDeps {
  return { fetch: (...a) => globalThis.fetch(...a), trace: traceFromUrl, cacheGet, cachePut };
}

/** Resolve every picture the spec's template asks for, IN PLACE (render/resolve.ts hands a copy). */
export async function resolveTemplatePictures(spec: Spec, deps: TemplatePictureDeps = defaultDeps()): Promise<void> {
  const mod = spec.template ? scenes[spec.template] : undefined;
  if (!mod?.pictures || !spec.params) return;
  let wanted: ReturnType<NonNullable<typeof mod.pictures>> = [];
  try {
    wanted = mod.pictures(spec.params);
  } catch {
    return;
  }
  await Promise.all(
    wanted.map(async ({ target, of, url }) => {
      // The portrait element's own keys: a face traced once serves both.
      const key = url ? `p${TRACE_VERSION}|url|${url}` : of ? `p${TRACE_VERSION}|name|${of.trim().toLowerCase()}` : null;
      if (!key) return;
      try {
        let encoded = await deps.cacheGet(key);
        if (!encoded) {
          let imageUrl = url ?? null;
          if (!imageUrl && of) {
            const res = await deps.fetch(wikiSummaryUrl(of));
            if (!res.ok) return;
            imageUrl = thumbFromSummary(await res.json());
          }
          if (!imageUrl) return;
          encoded = await deps.trace(imageUrl);
          await deps.cachePut(key, encoded);
        }
        target.strokes = encoded;
      } catch {
        /* no picture: the template draws the label alone */
      }
    }),
  );
}
