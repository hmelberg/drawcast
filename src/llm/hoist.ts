// Portrait strokes never visit the model. A pinned/file-mode portrait can
// carry kilobytes of opaque trace data in its `strokes` field; sending that
// through revise rounds or exemplar prompts burns tokens and risks the model
// corrupting it on re-emission. So specs are HOISTED before a model call —
// strokes swapped for a small sentinel — and restored afterwards by element
// id. A restored id that went missing simply loses its strokes (the layout
// falls back to the placeholder, and a name/url portrait re-resolves from
// cache anyway).

import { formatPlaylist, itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import type { Spec, SpecElement } from "../spec/types";

/** The sentinel a hoisted strokes field carries through the model round-trip. */
export const HOISTED = "@pinned";

export function hoistPortraitStrokes(docText: string): { text: string; blobs: Map<string, string> } {
  const blobs = new Map<string, string>();
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(docText);
  } catch {
    return { text: docText, blobs };
  }
  let any = false;
  for (const item of itemsOf(playlist)) {
    for (const el of item.spec.elements ?? []) {
      if (el.type === "portrait" && el.strokes && el.strokes !== HOISTED) {
        blobs.set(el.id, el.strokes);
        el.strokes = HOISTED;
        any = true;
      }
    }
  }
  return any ? { text: formatPlaylist(playlist, "yaml"), blobs } : { text: docText, blobs };
}

/** Put hoisted strokes back into the model's revised playlist, by element id. */
export function restorePortraitStrokes(playlist: Playlist, blobs: Map<string, string>): void {
  if (blobs.size === 0) return;
  for (const item of itemsOf(playlist)) {
    for (const el of item.spec.elements ?? []) {
      if (el.type === "portrait" && el.strokes === HOISTED) {
        const blob = blobs.get(el.id);
        if (blob) el.strokes = blob;
        else delete el.strokes;
      }
    }
  }
}

/** Exemplar hygiene: a spec copy with portrait strokes omitted entirely. */
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.elements?.some((e) => e.type === "portrait" && e.strokes)) return spec;
  return {
    ...spec,
    elements: spec.elements.map((e): SpecElement => (e.type === "portrait" && e.strokes ? { ...e, strokes: undefined } : e)),
  };
}
