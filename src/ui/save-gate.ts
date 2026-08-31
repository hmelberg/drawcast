// Pure decision: can this editor text be saved (or otherwise adopted) right
// now, and if not, why? Shared by every Save destination (disk / Drive /
// GitHub) so their refusal rule cannot drift apart — that drift is exactly
// how Save used to work before this fix: ensureRendered() would silently
// swallow a parse failure and the destinations would go on to ship
// doc.playlist, the last GOOD render, with the author's actual edits nowhere
// in it. Also used by readPlaylistText in main.ts (impure — it calls
// setStatus), so the message a broken spec gets is written once.
//
// No DOM, so — unlike main.ts — this is importable and unit-testable under
// vitest's node environment (see shell-css.test.ts's note on why main.ts
// itself cannot be imported).

import { itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import { validateSpec } from "../spec/schema";

export type SaveDecision = { ok: true; playlist: Playlist } | { ok: false; reason: string };

/** Parse + validate playlist text; never throws. */
export function checkSaveable(text: string): SaveDecision {
  let playlist: Playlist;
  try {
    playlist = parsePlaylistText(text);
  } catch (err) {
    return { ok: false, reason: `Spec unreadable: ${(err as Error).message}` };
  }
  const items = itemsOf(playlist);
  if (items.length === 0) {
    return { ok: false, reason: "The playlist has no drawable items." };
  }
  for (const item of items) {
    const v = validateSpec(item.spec);
    if (!v.ok) {
      const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
      return { ok: false, reason: `Spec invalid: ${where}${v.errors[0]}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ""}` };
    }
  }
  return { ok: true, playlist };
}
