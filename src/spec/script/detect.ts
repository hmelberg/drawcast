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
/** A `\`\`\`assets` fence at column 0 — how a script writes its own
 *  machine-written assets map (print.ts's PAYLOAD_KEYS) when the page has no
 *  other ink: a template-driven item with no elements of its own and a data
 *  asset too large to send, described down to one flat line (design §5.1).
 *  Real YAML/JSON never opens a document this way, and a whole-reply wrapper
 *  fence is tagged `yaml`/`json`, never `assets` — so this can only be a script. */
const ASSETS_FENCE_LINE = /^```assets$/m;

/**
 * True when the text is a script: no spec key, not JSON, and carrying at
 * least one direction, heading, or assets fence.
 *
 * That last requirement is what keeps the format from swallowing everything.
 * Prose alone is syntactically a run of spoken lines, so without it ANY text
 * — a stray paragraph, a pasted email, a half-downloaded file — would parse
 * as a valid one-beat drawcast instead of being reported as unreadable. A
 * real script always has ink in it.
 */
export function looksLikeScript(text: string): boolean {
  if (/^\s*[{[]/.test(text)) return false;
  if (KEY_LINE.test(text)) return false;
  return DIRECTION_LINE.test(text) || HEADING_LINE.test(text) || ASSETS_FENCE_LINE.test(text);
}
