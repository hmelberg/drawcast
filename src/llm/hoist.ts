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

/** The field per element type that holds encoded machine output, if any. */
function blobField(el: SpecElement): "strokes" | "code_result" | null {
  if (el.type === "portrait" || el.type === "source") return "strokes";
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
  for (const item of itemsOf(playlist)) {
    for (const el of item.spec.elements ?? []) {
      const field = blobField(el);
      if (field && el[field] && el[field] !== HOISTED) {
        blobs.set(el.id, el[field]!);
        el[field] = HOISTED;
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
      const field = blobField(el);
      if (field && el[field] === HOISTED) {
        const blob = blobs.get(el.id);
        if (blob) el[field] = blob;
        else delete el[field];
      }
    }
  }
}

/** Exemplar hygiene: a spec copy with portrait/source strokes omitted entirely. */
export function stripStrokesForModel(spec: Spec): Spec {
  if (!spec.elements?.some((e) => { const f = blobField(e); return f && e[f]; })) return spec;
  return {
    ...spec,
    elements: spec.elements.map((e): SpecElement => {
      const f = blobField(e);
      return f && e[f] ? { ...e, [f]: undefined } : e;
    }),
  };
}
