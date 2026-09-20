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

/**
 * A payload key (print.ts's PAYLOAD_KEYS: assets, subtitles, text_map,
 * templates) prints as a fence opened at column 0, its BODY the plain YAML
 * dump of whatever an author or the model put there — not the document's own
 * ink. Left visible, an asset (or subtitle) named the same as a SPEC_KEY
 * ("title", "assets"…) prints that name at column 0 too, and KEY_LINE —
 * checked first, unconditionally — would misread a real script, heading and
 * direction lines and all, as a spec document (round 1 review, C2 —
 * reachable by this plan's own design: Task 7 names an asset after its
 * filename, so `title.csv` gives an asset named `title`, and a hand-typed
 * `assets:` block is documented, design §6). So neither KEY_LINE nor the ink
 * signals below may see a fence's BODY — only its delimiters, which survive
 * this strip.
 *
 * Round 1 also read a bare fence DELIMITER (once its body was blanked) as
 * ink of its own — reverted in round 2: a spec pasted whole inside a single
 * ```yaml fence (the shape a chat reply comes in) went from a clear "not
 * JSON or YAML" error to silently parsing as a one-beat script, on paste and
 * import — paths `stripFence` does not guard — and widening to any tagged
 * fence made prose with an incidental ```js block a drawcast too. Only the
 * STRIPPING survives; a document with no ink besides a payload fence stays
 * undetectable, which is the PRE-EXISTING behaviour (a real drawcast always
 * has a title, a heading, or at least one direction line — see the Task 5
 * fix-up this round, which gave its test real ink instead of relying on that
 * gap).
 *
 * Two things a naive version of this regex gets wrong, found by running it
 * standalone rather than only through a test that happened not to hit them:
 * - `\S+` cannot cross a `\r`, so a CRLF file's opening line ("```assets\r")
 *   never matches — `looksLikeScript` normalizes line endings before this
 *   runs, the same way src/spec/script/lines.ts:96 does for the parser, so
 *   the two can never disagree about what a line is.
 * - the closing marker must tolerate trailing whitespace: a bare "```$"
 *   requires nothing after the three backticks but the newline, so a pasted
 *   or hand-edited "``` " (trailing space) fails to close the fence — the
 *   non-greedy body then runs on past it looking for the NEXT "```" at
 *   column 0, deleting whatever real ink (a spoken line, another fence's
 *   opener) sat in between.
 *
 * Left AS IS, deliberately: an UNTERMINATED fence (no closing "```" at all)
 * strips nothing, so C2 stays open for a truncated document. That is a
 * decision, not an oversight — a cut-off document is handled upstream by the
 * repair/retry that asks the model for a complete one, not by this
 * detector guessing where a missing fence would have closed.
 */
const PAYLOAD_FENCE = /^(```\S+)\n[\s\S]*?\n```[ \t]*$/gm;
function withoutPayloadFenceBodies(text: string): string {
  return text.replace(PAYLOAD_FENCE, "$1\n```");
}

/**
 * True when the text is a script: no spec key, not JSON, and carrying at
 * least one direction or heading — both read with every payload fence's own
 * body blanked out first, so a data value can never masquerade as document
 * structure (C2): a spec key inside a fence can no longer defeat detection,
 * and — the reviewer's evidence this is a class, not an instance — a script
 * carrying `subtitles` parses for the identical reason.
 *
 * That last requirement (heading or direction) is what keeps the format from
 * swallowing everything. Prose alone is syntactically a run of spoken lines,
 * so without it ANY text — a stray paragraph, a pasted email, a
 * half-downloaded file — would parse as a valid one-beat drawcast instead of
 * being reported as unreadable. A real script always has ink in it.
 */
export function looksLikeScript(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (/^\s*[{[]/.test(normalized)) return false;
  const ink = withoutPayloadFenceBodies(normalized);
  if (KEY_LINE.test(ink)) return false;
  return DIRECTION_LINE.test(ink) || HEADING_LINE.test(ink);
}
