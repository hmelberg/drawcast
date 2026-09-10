// Encoded pixels never visit the model. A pinned/file-mode portrait, a
// resolved source element (whose page image is larger still), a Commons
// photo (`image`) or an Iconify glyph (`icon`) can carry kilobytes of opaque
// data in its `strokes` field; sending that through revise rounds or
// exemplar prompts burns tokens and risks the model corrupting it on
// re-emission. So specs are HOISTED before a model call — strokes swapped for
// a small sentinel — and restored afterwards by element id. A restored id that
// went missing simply loses its strokes (the layout falls back to the
// placeholder, and a name/url/reference element re-resolves from cache anyway).

import { formatPlaylist, itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import type { Spec, SpecElement } from "../spec/types";
import { HOISTED } from "../spec/assets";

export { HOISTED };

/** The key under which item i's `assets` map waits in the blobs, beside the
 *  per-element strokes. Element ids never contain a colon (they are YAML keys
 *  the schema spells as identifiers), so the two cannot collide. */
const assetsKey = (item: number): string => `assets:${item}`;

/** The field per element type that holds encoded machine output, if any. */
function blobField(el: SpecElement): "strokes" | "code_result" | null {
  // image/icon belong here for the same reason portrait/source do: a resolved
  // Commons photo is 10-34 KB of base64 in three bundled examples alone, and
  // it rode into every revise round and exemplar prompt until this list grew.
  if (el.type === "portrait" || el.type === "source" || el.type === "image" || el.type === "icon") return "strokes";
  if (el.type === "code") return "code_result";
  return null;
}

export function hoistPortraitStrokes(docText: string): { text: string; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(docText);
  } catch {
    return { text: docText, blobs };
  }
  let any = false;
  itemsOf(playlist).forEach((item, i) => {
    for (const el of item.spec.elements ?? []) {
      const field = blobField(el);
      if (field && el[field] && el[field] !== HOISTED) {
        blobs.set(el.id, el[field]!);
        el[field] = HOISTED;
        any = true;
      }
    }
    // The `assets` map is the same bytes under another key (spec/assets.ts):
    // it leaves with them and comes back with them.
    if (item.spec.assets) {
      blobs.set(assetsKey(i), JSON.stringify(item.spec.assets));
      delete item.spec.assets;
      any = true;
    }
  });
  return any ? { text: formatPlaylist(playlist, "yaml"), blobs } : { text: docText, blobs };
}

/** Put hoisted strokes back into the model's revised playlist, by element id. */
export function restorePortraitStrokes(playlist: Playlist, blobs: Map<string, string>): void {
  if (blobs.size === 0) return;
  itemsOf(playlist).forEach((item, i) => {
    const assets = blobs.get(assetsKey(i));
    if (assets) item.spec.assets = JSON.parse(assets) as Record<string, string>;
    for (const el of item.spec.elements ?? []) {
      const field = blobField(el);
      if (field && el[field] === HOISTED) {
        const blob = blobs.get(el.id);
        if (blob) el[field] = blob;
        else delete el[field];
      }
    }
  });
}

/** Exemplar hygiene: a spec copy with every encoded blob omitted entirely. */
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.assets && !spec.elements?.some((e) => { const f = blobField(e); return f && e[f]; })) return spec;
  return {
    ...spec,
    assets: undefined,
    elements: (spec.elements ?? []).map((e): SpecElement => {
      const f = blobField(e);
      return f && e[f] ? { ...e, [f]: undefined } : e;
    }),
  };
}
