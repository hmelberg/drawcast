// Encoded pixels never visit the model. A pinned/file-mode portrait — or a
// resolved source element, whose page image is larger still — can carry
// kilobytes of opaque data in its `strokes` field; sending that through revise
// rounds or exemplar prompts burns tokens and risks the model corrupting it on
// re-emission. So specs are HOISTED before a model call — strokes swapped for
// a small sentinel — and restored afterwards by element id. A restored id that
// went missing simply loses its strokes (the layout falls back to the
// placeholder, and a name/url/reference element re-resolves from cache anyway).

import { formatPlaylist, itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import type { Spec, SpecElement } from "../spec/types";

/** The sentinel a hoisted strokes field carries through the model round-trip. */
export const HOISTED = "@pinned";

/** The element types whose `strokes` hold encoded pixels. */
function carriesBlob(el: SpecElement): boolean {
  return el.type === "portrait" || el.type === "source";
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
  for (const item of itemsOf(playlist)) {
    for (const el of item.spec.elements ?? []) {
      if (carriesBlob(el) && el.strokes && el.strokes !== HOISTED) {
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
      if (carriesBlob(el) && el.strokes === HOISTED) {
        const blob = blobs.get(el.id);
        if (blob) el.strokes = blob;
        else delete el.strokes;
      }
    }
  }
}

/** Exemplar hygiene: a spec copy with portrait/source strokes omitted entirely. */
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.elements?.some((e) => carriesBlob(e) && e.strokes)) return spec;
  return {
    ...spec,
    elements: spec.elements.map((e): SpecElement => (carriesBlob(e) && e.strokes ? { ...e, strokes: undefined } : e)),
  };
}
