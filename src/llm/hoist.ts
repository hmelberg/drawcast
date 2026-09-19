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

type BlobField = "strokes" | "code_result" | "code_src";

/** The fields per element type that hold encoded/machine-written content,
 *  never meant for a model call. A code element carries two: `code_result`
 *  (the run's envelope) and `code_src` (the authored script stamped before
 *  control defaults were written in, design 2026-09-14 §2.5/pane-controls
 *  review) — both machine-written onto the render CLONE only (never the
 *  authored document, B11), but hoisted/stripped the same way in case one
 *  ever rides along in a saved or hand-pasted document. */
function blobFields(el: SpecElement): BlobField[] {
  // image/icon belong here for the same reason portrait/source do: a resolved
  // Commons photo is 10-34 KB of base64 in three bundled examples alone, and
  // it rode into every revise round and exemplar prompt until this list grew.
  if (el.type === "portrait" || el.type === "source" || el.type === "image" || el.type === "icon") return ["strokes"];
  if (el.type === "code") return ["code_result", "code_src"];
  return [];
}

/** A blob's key in the map: bare element id when the element has only one
 *  possible blob field (portrait/source/image/icon, unchanged from before
 *  code got a second one), `id:field` when it could have more than one (a
 *  code element's `code_result` and `code_src`) so the two never collide. */
function blobKey(id: string, field: BlobField, fields: BlobField[]): string {
  return fields.length > 1 ? `${id}:${field}` : id;
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
      const fields = blobFields(el);
      for (const field of fields) {
        if (el[field] && el[field] !== HOISTED) {
          blobs.set(blobKey(el.id, field, fields), el[field]!);
          el[field] = HOISTED;
          any = true;
        }
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
  return any ? { text: formatPlaylist(playlist, "script"), blobs } : { text: docText, blobs };
}

/** Put hoisted strokes back into the model's revised playlist, by element id. */
export function restorePortraitStrokes(playlist: Playlist, blobs: Map<string, string>): void {
  if (blobs.size === 0) return;
  itemsOf(playlist).forEach((item, i) => {
    const assets = blobs.get(assetsKey(i));
    if (assets) item.spec.assets = JSON.parse(assets) as Record<string, string>;
    for (const el of item.spec.elements ?? []) {
      const fields = blobFields(el);
      for (const field of fields) {
        if (el[field] === HOISTED) {
          const blob = blobs.get(blobKey(el.id, field, fields));
          if (blob) el[field] = blob;
          else delete el[field];
        }
      }
    }
  });
}

/** Exemplar hygiene: a spec copy with every encoded blob omitted entirely. */
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.assets && !spec.elements?.some((e) => blobFields(e).some((f) => e[f]))) return spec;
  return {
    ...spec,
    assets: undefined,
    elements: (spec.elements ?? []).map((e): SpecElement => {
      const fields = blobFields(e).filter((f) => e[f]);
      if (fields.length === 0) return e;
      const patch: Partial<Record<BlobField, undefined>> = {};
      for (const f of fields) patch[f] = undefined;
      return { ...e, ...patch };
    }),
  };
}
