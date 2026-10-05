// A cast's thumbnail pages as text (2026-10-05/06): what the publish panel
// shows and edits — each page a `## Thumbnail` line and its element lines —
// and putting such text back into a playlist as its thumbnail pages
// (role: thumbnail), never played (playlist.ts itemsOf). The first page is the
// cast's thumbnail, the others its variants, shown in turn and counted.

import { parsePlaylistText, type Playlist } from "../playlist/playlist";
import { printScriptPage } from "../spec/script/print";

/** The settings every written thumbnail page carries: its role, and its figure kept where it was put. */
const PAGE_HEAD = '## Thumbnail\nrole: thumbnail\npage: {"valign": "none"}\n';
const SEPARATOR = /^##\s*thumbnail\b.*$/i;

/** The playlist's thumbnail pages as text (a `## Thumbnail` line before each page's lines), or null when it has none. */
export function thumbnailBody(playlist: Playlist): string | null {
  const pages = playlist.entries.flatMap((e) => (e.kind === "item" && e.spec.role === "thumbnail" ? [e.spec] : []));
  if (pages.length === 0) return null;
  return pages
    .map((spec) =>
      ["## Thumbnail", ...printScriptPage(spec)
        .split("\n")
        .filter((l) => /^\s/.test(l) && l.trim() !== "")].join("\n"),
    )
    .join("\n\n");
}

/** The text's pages: split at `## Thumbnail` lines (text with none is one page), each its non-empty element lines. */
export function splitThumbnailPages(text: string): string[] {
  const pages: string[][] = [[]];
  for (const line of text.split(/\r?\n/)) {
    if (SEPARATOR.test(line.trim())) {
      if (pages[pages.length - 1].length) pages.push([]);
      continue;
    }
    if (line.trim()) pages[pages.length - 1].push(`    ${line.trim()}`);
  }
  return pages.filter((p) => p.length).map((p) => p.join("\n"));
}

/**
 * The playlist with `text`'s pages as its thumbnail pages (replacing any it
 * had), or with none when `text` is null or empty. Throws a reader's error
 * when the lines do not parse — the panel shows it.
 */
export function withThumbnailPage(playlist: Playlist, text: string | null): Playlist {
  const entries = playlist.entries.filter((e) => e.kind !== "item" || e.spec.role !== "thumbnail");
  const bodies = text ? splitThumbnailPages(text).slice(0, 5) : [];
  if (bodies.length === 0) return { ...playlist, entries };
  const parsed = parsePlaylistText(`# Thumbnail\n\n${bodies.map((b) => `${PAGE_HEAD}${b}\n`).join("\n")}`);
  const pages = parsed.entries.filter((e) => e.kind === "item" && e.spec.role === "thumbnail");
  if (pages.length !== bodies.length) throw new Error("Those lines are not thumbnail pages.");
  return { ...playlist, entries: [...entries, ...pages] };
}
