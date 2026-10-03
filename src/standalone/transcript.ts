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

import { itemsOf, parsePlaylistText, sourceLanguage } from "../playlist/playlist";
import { playlistSpeakLines } from "../playlist/session";

/** The narration, once per line, in playing order. Empty when the text does not parse. */
export function transcriptLines(castText: string): string[] {
  return castFacts(castText).transcript;
}

/**
 * What a drawcast's page says about it (standalone/page.ts), read from the
 * cast itself: the spoken lines, the words that introduce it, its language
 * and level. Everything here is already public in the published file.
 */
export interface CastFacts {
  transcript: string[];
  /** The subtitle, else the founding question (`prompt:`) — the page's
   *  visible introduction and its search description. */
  intro?: string;
  /** The narration's language (BCP 47 primary tag, "en", "nb"…) — the page's lang. */
  lang?: string;
  level?: "basic" | "advanced";
  /** Drawcast / Quiz / Xplanation — the author's `format:`, else read from the structure (castFormat). */
  format: CastFormat;
  /** The header's `tags:`, when it has any. */
  tags?: string[];
}

export type CastFormat = "drawcast" | "quiz" | "xplanation";

const QUESTION_RE = /"(ask|quiz|choose|guess)"\s*:/;

/**
 * The format a drawcast's structure says it is (2026-10-03, the front page):
 * a book layout is an Xplanation; a question-LED cast is a Quiz (most
 * drawcasts end in a quiz, which does not make them one); anything else is a
 * Drawcast. Question-led, either way:
 * - short: a question within the first third of its commands, at most 12
 *   spoken lines (the bundled examples' tap-and-sort quizzes);
 * - longer: at most a third of the spoken lines before the first question,
 *   and at most 15 lines or a question for every 4 lines (the library's
 *   quiz batch: one question up front, 13–15 lines; "True or myth?": five
 *   questions in 20 lines).
 * Measured on the 389 bundled examples (25 quizzes, 3 books), the 61-cast
 * library and the 50-cast quiz batch (49 found; the one missed draws for a
 * while before it asks). An author's `format:` line overrides it.
 */
export function castFormat(specs: unknown[], spokenLines: number): CastFormat {
  if (specs.some((s) => typeof s === "object" && s !== null && "book" in s && (s as { book?: unknown }).book)) return "xplanation";
  const commands = specs.flatMap((s) => (typeof s === "object" && s !== null && Array.isArray((s as { commands?: unknown }).commands) ? ((s as { commands: unknown[] }).commands) : []));
  const isQuestion = (c: unknown): boolean => QUESTION_RE.test(JSON.stringify(c));
  const first = commands.findIndex(isQuestion);
  if (first < 0) return "drawcast";
  if (first <= Math.max(2, commands.length / 3) && spokenLines <= 12) return "quiz";
  const spokenBefore = commands.slice(0, first).filter((c) => typeof (c as { speak?: unknown })?.speak === "string" && (c as { speak: string }).speak.trim() !== "").length;
  const questions = commands.filter(isQuestion).length;
  return spokenBefore <= Math.max(1, spokenLines / 3) && (spokenLines <= 15 || questions * 4 >= spokenLines) ? "quiz" : "drawcast";
}

export function castFacts(castText: string): CastFacts {
  try {
    const playlist = parsePlaylistText(castText);
    const transcript = playlistSpeakLines(playlist)
      .map((l) => l.text.trim())
      .filter(Boolean);
    const intro = (playlist.meta.subtitle ?? playlist.meta.prompt)?.trim() || undefined;
    const lang = sourceLanguage(playlist) || undefined;
    const specs = itemsOf(playlist).map((i) => i.spec);
    const level = specs.find((sp) => sp.level)?.level;
    const format = playlist.meta.format ?? castFormat(specs, transcript.length);
    const tags = playlist.meta.tags;
    return { transcript, format, ...(intro ? { intro } : {}), ...(lang ? { lang } : {}), ...(level ? { level } : {}), ...(tags ? { tags } : {}) };
  } catch {
    return { transcript: [], format: "drawcast" };
  }
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The section's inner HTML: one paragraph per spoken line. */
export function transcriptHtml(lines: string[]): string {
  return lines.map((l) => `<p>${esc(l)}</p>`).join("\n");
}
