// Is this text a script, or a spec document? One list, used by both
// src/spec/text.ts and src/playlist/playlist.ts, so they cannot disagree.
//
// The discriminator is the top-level key, not the shape: a spoken line
// containing a colon — "To slags aktører: husholdninger" — is ITSELF valid
// YAML, a one-key mapping, so reading YAML first would silently misread a
// script as a spec with one strange field.
//
// Only keys that a script can NEVER write at column 0 count. A script says
// its title with `#`, its template with `use:` and its params with `with:`,
// so these belong to YAML and JSON alone. (`lang`, `vars`, `domain`,
// `canvas`, `voice`, `level`, `record` and `zoom_from` are deliberately NOT
// here: a script writes those under their own names.)
export const SPEC_KEYS = [
  "title", "elements", "commands", "template", "params", "playlist",
  "assets", "subtitles", "text_map", "templates", "audio",
] as const;

const KEY_LINE = new RegExp(`^(?:${SPEC_KEYS.join("|")})\\s*:`, "m");

/** An indented line: a stage direction, which is what makes a script a script. */
const DIRECTION_LINE = /^[ \t]+\S/m;
/** A `#` or `##` heading at column 0. */
const HEADING_LINE = /^#{1,2}\s+\S/m;
/** A payload fence's OPENING delimiter — `\`\`\`assets` or `\`\`\`yaml`
 *  (print.ts's PAYLOAD_KEYS: assets, subtitles, text_map, templates) — still
 *  standing after withoutPayloadFenceBodies below has blanked its content.
 *  Column 0, always tagged. A script's own `code` element fence is always
 *  indented (print.ts's INDENT), so it never matches this; real YAML/JSON
 *  never opens a document with a bare fence at all, and a whole-reply
 *  wrapper is stripped (`stripFence`) long before this runs. */
const FENCE_LINE = /^```\S+$/m;

/**
 * A payload key prints as a fence opened at column 0, its BODY the plain
 * YAML dump of whatever an author or the model put there — not the
 * document's own ink. Left visible, an asset (or subtitle) named the same as
 * a SPEC_KEY ("title", "assets"…) prints that name at column 0 too, and
 * KEY_LINE — checked first, unconditionally — would misread a real script,
 * heading and direction lines and all, as a spec document (round 1 review,
 * C2 — reachable by this plan's own design: Task 7 names an asset after its
 * filename, so `title.csv` gives an asset named `title`, and a hand-typed
 * `assets:` block is documented, design §6). So neither KEY_LINE nor the ink
 * signals below may see a fence's BODY — only the delimiter that opens it,
 * which is what survives here.
 */
const PAYLOAD_FENCE = /^(```\S+)\n[\s\S]*?\n```$/gm;
function withoutPayloadFenceBodies(text: string): string {
  return text.replace(PAYLOAD_FENCE, "$1\n```");
}

/**
 * True when the text is a script: no spec key, not JSON, and carrying at
 * least one direction, heading, or payload fence — every signal read with
 * every payload fence's own body blanked out first, so a data value can
 * never masquerade as document structure in EITHER direction: a spec key
 * inside a fence can no longer defeat detection (C2), and a bare fence
 * marker still counts as ink even once its content is gone (what used to be
 * ASSETS_FENCE_LINE — generalized, since `subtitles`/`text_map`/`templates`
 * fence the same way and were unparseable for the identical reason).
 *
 * The heading/direction requirement is what keeps the format from
 * swallowing everything. Prose alone is syntactically a run of spoken lines,
 * so without it ANY text — a stray paragraph, a pasted email, a
 * half-downloaded file — would parse as a valid one-beat drawcast instead of
 * being reported as unreadable. A real script always has ink in it.
 */
export function looksLikeScript(text: string): boolean {
  if (/^\s*[{[]/.test(text)) return false;
  const ink = withoutPayloadFenceBodies(text);
  if (KEY_LINE.test(ink)) return false;
  return DIRECTION_LINE.test(ink) || HEADING_LINE.test(ink) || FENCE_LINE.test(ink);
}
