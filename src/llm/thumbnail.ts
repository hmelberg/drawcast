// "Ask AI for a thumbnail" (2026-10-05): the publish panel asks the model for
// a thumbnail page — one still picture, written in the cast notation, made to
// draw people in — from the cast's title, subtitle and opening lines. The
// reply is the page's element lines only; card/page.ts puts them in a
// `## Thumbnail` page (role: thumbnail) and the converter compiles it.

import type Anthropic from "@anthropic-ai/sdk";
import { callForText } from "./client";
import { parsePlaylistText } from "../playlist/playlist";
import { playlistSpeakLines } from "../playlist/session";
import type { Spec } from "../spec/types";

/** How many thumbnails a signed-in author's cast is asked for: the front page shows them in turn and learns which is clicked. A signed-out author gets one (the registry keeps no more: drawcast-anvil registry.may_have_variants). */
export const THUMBNAIL_VARIANTS = 3;

/** The thumbnail writer's instructions for `n` thumbnails (three for a signed-in author — the front page tries them in turn — one otherwise). */
export function thumbnailSystem(n = THUMBNAIL_VARIANTS): string {
  return `You write the THUMBNAIL of a drawcast (a narrated, hand-drawn explainer): the one still picture that stands for it on drawcast.app's front page (shown about 280 px wide) and in link previews. Its job is to make someone curious enough to click — honestly: the cast must pay off what the thumbnail promises.

Patterns that work: the question with its surprising answer half-shown (a "?" where the result goes); one striking number, big; a contrast or tension (the shark against the mosquito); a before and after, or a mistake about to happen. One idea, readable small.

${n > 1 ? `Write ${n} thumbnails, truly different — each with a different hook AND a different main picture (the front page shows them in turn and keeps the one people click). Reply with ONLY the ${n} pages: each` : "Write ONE thumbnail. Reply with ONLY the page:"} a line "## Thumbnail" and then its element lines, each indented four spaces — nothing else (no settings, no narration, no code fence). The canvas is 1000 wide and 750 high, y UP (y 750 is the top). Keep everything above y 230: the band sits across the bottom. Keep the top-right corner (x above 700, y above 560) clear of words and drawing: a stamp or note goes there, and a sticker must never cover a word. Sizes: key number or word font_size 110–260; other words 60–90 (smaller vanishes at front-page size); icons size 220–330. At most about 12 lines.

The notation (ids are short words, unique on the page):
    icon <id> size 300 set twemoji x 260 y 470 icon_look picture of "<keyword>"   — a colour emoji picture, its keyword always quoted ("brain", "soccer ball")
    text <id> "<words>" x 700 y 520 font_size 90 #2f6b8f                         — words; a colour like #b5482e is optional
    math <id> tex "e^{i\\\\pi} = -1" x 500 y 560 size 130                           — a formula (backslashes doubled)
    path <id> smooth thick #c7702e points [[120,690],[360,300],[880,280]]         — a line or curve; dashed is allowed
    shape <id> shape rect x 270 y 470 width 280 height 280 style.fill #cfe3ee      — a box (x, y its centre); shape circle … radius 120
    thumb <id> "<headline>" kind band                                              — the tilted yellow strip across the bottom: 2–6 shouted words
    thumb <id> "<words>" kind stamp x 830 y 640 angle 12                          — a rubber stamp (also: note, star); x, y place it, else a free corner
    thumb <id> kind thinking                                                       — a cartoon figure (eyes, aha, surprised, puzzled, thinking), for children's casts

Always end with one band. Use only facts the cast's lines state.`;
}

/** Three, for the tests and the default. */
export const THUMBNAIL_SYSTEM = thumbnailSystem();

/** What the model is told about the cast: title, subtitle, the opening narration, the current words. */
export function thumbnailUser(castText: string, thumbLine?: string): string {
  const playlist = parsePlaylistText(castText);
  const lines = playlistSpeakLines(playlist)
    .map((l) => l.text.trim())
    .filter(Boolean)
    .slice(0, 14);
  return [
    `Title: ${playlist.meta.title ?? ""}`,
    playlist.meta.subtitle ? `Subtitle: ${playlist.meta.subtitle}` : "",
    thumbLine ? `Its current listing words: ${thumbLine}` : "",
    "Its narration begins:",
    ...lines.map((l) => `- ${l}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The model's reply as thumbnail pages: each a "## Thumbnail" line and its element lines (indented four spaces); fences and prose dropped. */
export function thumbnailBodyOf(reply: string): string {
  const out: string[] = [];
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "    ");
    const t = line.trim();
    if (/^##\s*thumbnail\b/i.test(t)) {
      if (out.length && out[out.length - 1] !== "## Thumbnail") out.push("", "## Thumbnail");
      else if (!out.length) out.push("## Thumbnail");
      continue;
    }
    if (!t || t.startsWith("```") || t.startsWith("#") || /^[a-z_]+:/.test(t)) continue;
    if (!/^(icon|text|math|path|shape|thumb|arrow|label|line|polygon|ellipse)\s/.test(t)) continue;
    // An icon's keyword quoted, as the notation needs it when it has spaces ("high voltage").
    const fixed = t.replace(/(\bof )(?!")([^"]+?)\s*$/, (_m, of: string, kw: string) => `${of}"${kw.trim()}"`);
    out.push(`    ${fixed}`);
  }
  // A reply with no "## Thumbnail" lines is one page.
  if (out.length && out[0] !== "## Thumbnail") out.unshift("## Thumbnail");
  return out.join("\n");
}

/** One request: the thumbnail pages' text for this cast. */
export async function askThumbnail(client: Anthropic, model: string, castText: string, thumbLine?: string, signal?: AbortSignal, n = THUMBNAIL_VARIANTS): Promise<string> {
  const { text } = await callForText(client, model, thumbnailSystem(n), [{ role: "user", content: thumbnailUser(castText, thumbLine) }], { signal, maxTokens: 3000 });
  const body = thumbnailBodyOf(text);
  if (!body) throw new Error("The AI's answer had no thumbnail lines.");
  return body;
}

// ---- In the cast-writing call (2026-10-05): the thumbnail rides the spec reply ----

/** The top-level fields the spec reply may carry its thumbnail pages in — never part of the spec schema (as treatment.ts template_gaps). */
export const THUMBNAIL_KEY = "thumbnail";
export const THUMBNAILS_KEY = "thumbnails";

/** Appended to the cast-writing request when thumbnails are wanted: what to add, in the reply's own JSON — `n` of them (three for a signed-in author, one otherwise). */
export function thumbnailRequestNote(n = THUMBNAIL_VARIANTS): string {
  return `ALSO add a top-level "thumbnails" field beside the spec: ${n > 1 ? `${n} different listing pictures for the cast on drawcast.app's front page (about 280 px wide) and in link previews. The front page shows them in turn and keeps the one people click, so make them truly different — each with a different hook AND a different main picture: one the question with its surprising answer half-shown, one a single striking number, one a contrast or a mistake about to happen. Each must` : "ONE listing picture for the cast on drawcast.app's front page (about 280 px wide) and in link previews — the question with its surprising answer half-shown, one striking number, or a contrast. It must"} make someone curious enough to click, honestly: the cast must pay off what it promises. Shape: [{"elements": [ … ]}, …], each on the canvas 1000 × 750, y UP; everything above y 230 (a band runs across the bottom); the top-right corner (x > 700, y > 560) clear for a sticker. Elements, at most 10 per picture: {"id", "type": "icon", "of": "<keyword>", "set": "twemoji", "icon_look": "picture", "x", "y", "size": 220–330}; {"id", "type": "text", "text", "x", "y", "font_size": 60–260, "style": {"color"}}; "math" (tex, x, y, size 100–190); "path"/"shape" as in the spec; and the listing words as {"id", "type": "thumb", "kind": "band", "text": "<2–6 shouted words>"} (one band each) plus at most one {"type": "thumb", "kind": "stamp" | "note" | "star", "text", "x", "y", "angle"}.`;
}

/** Three, for the tests and the default. */
export const THUMBNAIL_REQUEST_NOTE = thumbnailRequestNote();

/** One reply value as a ready thumbnail page, or null when it is not a valid one. */
function pageOf(raw: unknown, validate: (spec: Spec) => boolean): Spec | null {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { elements?: unknown }).elements)) return null;
  const elements = (raw as { elements: unknown[] }).elements.filter((e) => typeof e === "object" && e !== null).slice(0, 14) as Spec["elements"];
  if (!elements?.length) return null;
  const page: Spec = { title: "Thumbnail", role: "thumbnail", page: { valign: "none" }, elements, commands: [] };
  return validate(page) ? page : null;
}

/**
 * Takes the thumbnails off a spec reply, IN PLACE (before the spec is
 * validated), and returns the valid ones as ready thumbnail pages — at most
 * five; `thumbnail` (one) is read too. Invalid ones are dropped, never
 * fatal: with none, the thumbnail is made from the poster frame.
 */
export function takeThumbnails(json: unknown, validate: (spec: Spec) => boolean): Spec[] {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return [];
  const obj = json as Record<string, unknown>;
  const raw = [...(Array.isArray(obj[THUMBNAILS_KEY]) ? (obj[THUMBNAILS_KEY] as unknown[]) : []), ...(THUMBNAIL_KEY in obj ? [obj[THUMBNAIL_KEY]] : [])];
  delete obj[THUMBNAILS_KEY];
  delete obj[THUMBNAIL_KEY];
  return raw.map((r) => pageOf(r, validate)).filter((p): p is Spec => p !== null).slice(0, 5);
}
