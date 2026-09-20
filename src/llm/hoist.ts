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
import { ASSET_SEND_MAX, assetBytes, DATA_DESCRIPTOR, describeAsset, HOISTED, isDataAsset } from "../spec/assets";

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

export function hoistPortraitStrokes(docText: string): { text: string; blobs: Map<string, string>; described: { name: string; bytes: number }[] } {
  const blobs = new Map<string, string>();
  const described: { name: string; bytes: number }[] = [];
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(docText);
  } catch {
    return { text: docText, blobs, described };
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
    // BYTES leave with the blobs and come back with them, exactly as before.
    // DATA is decided per asset (design §5.1): small enough to send rides
    // along and may be edited; larger is replaced by a descriptor naming its
    // shape. The whole map is stashed either way, so nothing can be lost.
    if (item.spec.assets) {
      blobs.set(assetsKey(i), JSON.stringify(item.spec.assets));
      const forModel: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(item.spec.assets)) {
        if (!isDataAsset(value)) continue; // bytes: not shown at all
        const bytes = assetBytes(value);
        if (bytes > ASSET_SEND_MAX) {
          forModel[name] = describeAsset(value);
          described.push({ name, bytes });
        } else {
          forModel[name] = value;
        }
      }
      if (Object.keys(forModel).length > 0) item.spec.assets = forModel;
      else delete item.spec.assets;
      any = true;
    }
  });
  return any ? { text: formatPlaylist(playlist, "script"), blobs, described } : { text: docText, blobs, described };
}

/** Put hoisted strokes back into the model's revised playlist, by element id. */
export function restorePortraitStrokes(playlist: Playlist, blobs: Map<string, string>): void {
  if (blobs.size === 0) return;
  itemsOf(playlist).forEach((item, i) => {
    const stashed = blobs.get(assetsKey(i));
    if (stashed) {
      // The stash is the authority for everything the model could not edit —
      // bytes, and any data too large to send. An asset that WAS sent may have
      // been legitimately rewritten, so the reply's version wins for those.
      // A reply that drops the block entirely therefore loses nothing.
      const original = JSON.parse(stashed) as Record<string, unknown>;
      const returned = (item.spec.assets ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...original };
      for (const [name, value] of Object.entries(returned)) {
        const was = original[name];
        // The reply only wins when it is ITSELF data (round 1 review, C1): a
        // byte string — empty, or shaped like a descriptor — must never
        // replace rows just because the name was small enough to send. Without
        // this, `{openings: ""}` or `{openings: "@data 1 rows — …"}` silently
        // erased a user's data (resolveParamAssetRefs then treats the string
        // as bytes and leaves the reference dangling — a fresh way to lose
        // rows, not merely a confusing one).
        if (was !== undefined && isDataAsset(was) && assetBytes(was) <= ASSET_SEND_MAX && isDataAsset(value)) merged[name] = value;
      }
      item.spec.assets = merged;
    }
    // DATA_DESCRIPTOR is only ever MINTED on the way out (above, for an asset
    // too large to send) and is never itself in a stash — so if one is still
    // sitting in the restored document, this item's stash never covered that
    // name: most plausibly assetsKey's positional index (round 1 review, I1 —
    // pre-existing, not fixed here) landed on the wrong item, or none at all,
    // after a page was inserted or removed. Silently keeping it would look
    // like real content forever; throwing is too violent for a restore path
    // that must still return a document. Flagged instead — console.warn is
    // the only channel this module has today (Task 8 adds a real reporting
    // channel for a related but distinct gap; see round 1 review).
    for (const [name, value] of Object.entries(item.spec.assets ?? {})) {
      if (typeof value === "string" && value.startsWith(DATA_DESCRIPTOR)) {
        console.warn(`restorePortraitStrokes: item ${i}'s asset "${name}" is still a descriptor after restore — its stash was not found`);
      }
    }
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
