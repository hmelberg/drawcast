// The spoken text of a drawcast as plain HTML (2026-10-03): the Transcript
// section of a drawcast's page (standalone/page.ts). Search engines and AI
// crawlers do not index text inside a <script> block, and most do not run
// JavaScript at all — without this a page offers them a title and nothing
// else. It also serves screen readers and readers without JavaScript.
//
// Visible to people (a collapsed <details>), never hidden: text shown only to
// crawlers is what search engines penalise.
//
// Kept apart from page.ts so the player entry (play.ts), which imports
// page.ts, never pulls the playlist parser into its first download.

import { parsePlaylistText } from "../playlist/playlist";
import { playlistSpeakLines } from "../playlist/session";

/** The narration, once per line, in playing order. Empty when the text does not parse. */
export function transcriptLines(castText: string): string[] {
  try {
    return playlistSpeakLines(parsePlaylistText(castText))
      .map((l) => l.text.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The section's inner HTML: one paragraph per spoken line. */
export function transcriptHtml(lines: string[]): string {
  return lines.map((l) => `<p>${esc(l)}</p>`).join("\n");
}
