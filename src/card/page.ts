// A cast's thumbnail page as text (2026-10-05): what the publish panel shows
// and edits — the page's element lines only — and putting such lines back
// into a playlist as its one `## Thumbnail` page (role: thumbnail), never
// played (playlist.ts itemsOf).

import { parsePlaylistText, type Playlist } from "../playlist/playlist";
import { printScriptPage } from "../spec/script/print";

/** The settings every written thumbnail page carries: its role, and its figure kept where it was put. */
const PAGE_HEAD = '## Thumbnail\nrole: thumbnail\npage: {"valign": "none"}\n';

/** The playlist's thumbnail page as its body lines, or null when it has none. */
export function thumbnailBody(playlist: Playlist): string | null {
  for (const e of playlist.entries) {
    if (e.kind !== "item" || e.spec.role !== "thumbnail") continue;
    return printScriptPage(e.spec)
      .split("\n")
      .filter((l) => /^\s/.test(l) && l.trim() !== "")
      .join("\n");
  }
  return null;
}

/**
 * The playlist with `body` as its thumbnail page (replacing any it had), or
 * with none when `body` is null. Throws a reader's error when the lines do
 * not parse — the panel shows it.
 */
export function withThumbnailPage(playlist: Playlist, body: string | null): Playlist {
  const entries = playlist.entries.filter((e) => e.kind !== "item" || e.spec.role !== "thumbnail");
  if (body === null || body.trim() === "") return { ...playlist, entries };
  const parsed = parsePlaylistText(`# Thumbnail\n\n${PAGE_HEAD}${body.trim().split("\n").map((l) => `    ${l.trim()}`).join("\n")}\n`);
  const page = parsed.entries.find((e) => e.kind === "item" && e.spec.role === "thumbnail");
  if (!page || page.kind !== "item") throw new Error("Those lines are not a thumbnail page.");
  return { ...playlist, entries: [...entries, page] };
}
