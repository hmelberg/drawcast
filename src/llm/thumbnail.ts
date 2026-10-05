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

export const THUMBNAIL_SYSTEM = `You write the THUMBNAIL of a drawcast (a narrated, hand-drawn explainer): the one still picture that stands for it on drawcast.app's front page (shown about 280 px wide) and in link previews. Its job is to make someone curious enough to click — honestly: the cast must pay off what the thumbnail promises.

Patterns that work: the question with its surprising answer half-shown (a "?" where the result goes); one striking number, big; a contrast or tension (the shark against the mosquito); a before and after, or a mistake about to happen. One idea, readable small.

Reply with ONLY the page's element lines, each indented four spaces, nothing else (no heading, no settings, no narration, no code fence). The canvas is 1000 wide and 750 high, y UP (y 750 is the top). Keep everything above y 230: the band sits across the bottom. Keep the top-right corner (x above 700, y above 560) clear of words and drawing: a stamp or note goes there, and a sticker must never cover a word. Sizes: key number or word font_size 110–260; other words 60–90 (smaller vanishes at front-page size); icons size 220–330. At most about 12 lines.

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

/** The model's reply as page body lines: fences and prose dropped, each kept line indented four spaces. */
export function thumbnailBodyOf(reply: string): string {
  const out: string[] = [];
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "    ");
    const t = line.trim();
    if (!t || t.startsWith("```") || t.startsWith("#") || /^[a-z_]+:/.test(t)) continue;
    if (!/^(icon|text|math|path|shape|thumb|arrow|label|line|polygon|ellipse)\s/.test(t)) continue;
    // An icon's keyword quoted, as the notation needs it when it has spaces ("high voltage").
    const fixed = t.replace(/(\bof )(?!")([^"]+?)\s*$/, (_m, of: string, kw: string) => `${of}"${kw.trim()}"`);
    out.push(`    ${fixed}`);
  }
  return out.join("\n");
}

/** One request: the thumbnail page's body lines for this cast. */
export async function askThumbnail(client: Anthropic, model: string, castText: string, thumbLine?: string, signal?: AbortSignal): Promise<string> {
  const { text } = await callForText(client, model, THUMBNAIL_SYSTEM, [{ role: "user", content: thumbnailUser(castText, thumbLine) }], { signal, maxTokens: 1500 });
  const body = thumbnailBodyOf(text);
  if (!body) throw new Error("The AI's answer had no thumbnail lines.");
  return body;
}

// ---- In the cast-writing call (2026-10-05): the thumbnail rides the spec reply ----

/** The top-level field the spec reply may carry its thumbnail page in — never part of the spec schema (as treatment.ts template_gaps). */
export const THUMBNAIL_KEY = "thumbnail";

/** Appended to the cast-writing request when a thumbnail is wanted: what to add, in the reply's own JSON. */
export const THUMBNAIL_REQUEST_NOTE = `ALSO add a top-level "thumbnail" field beside the spec: the cast's listing picture on drawcast.app's front page (about 280 px wide) and in link previews, made to make someone curious enough to click — honestly: the cast must pay off what it promises. Not a copy of the figure: one idea, readable small — the question with its surprising answer half-shown, one striking number, a contrast, a mistake about to happen. Shape: {"elements": [ … ]}, the canvas 1000 × 750, y UP; everything above y 230 (a band runs across the bottom); the top-right corner (x > 700, y > 560) clear for a sticker. Elements, at most 10: {"id", "type": "icon", "of": "<keyword>", "set": "twemoji", "icon_look": "picture", "x", "y", "size": 220–330}; {"id", "type": "text", "text", "x", "y", "font_size": 60–260, "style": {"color"}}; "math" (tex, x, y, size 100–190); "path"/"shape" as in the spec; and the listing words as {"id", "type": "thumb", "kind": "band", "text": "<2–6 shouted words>"} (always one band) plus at most one {"type": "thumb", "kind": "stamp" | "note" | "star", "text", "x", "y", "angle"}.`;

/**
 * Takes the thumbnail off a spec reply, IN PLACE (before the spec is
 * validated), and returns it as a ready thumbnail page — or null when the
 * reply has none or it is not a valid page (dropped, never fatal: the
 * thumbnail is then made from the poster frame).
 */
export function takeThumbnail(json: unknown, validate: (spec: Spec) => boolean): Spec | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  if (!(THUMBNAIL_KEY in obj)) return null;
  const raw = obj[THUMBNAIL_KEY];
  delete obj[THUMBNAIL_KEY];
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { elements?: unknown }).elements)) return null;
  const elements = (raw as { elements: unknown[] }).elements.filter((e) => typeof e === "object" && e !== null).slice(0, 14) as Spec["elements"];
  if (!elements?.length) return null;
  const page: Spec = { title: "Thumbnail", role: "thumbnail", page: { valign: "none" }, elements, commands: [] };
  return validate(page) ? page : null;
}
