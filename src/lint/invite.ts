// The invitation words: a narration line that tells the viewer to act. Such a
// line belongs in an explore beat's speak — the movie skips that beat whole
// (export/video.ts) — never in an ordinary speak, which the movie says too
// (design 2026-09-14-pane-controls §2 rule 3, §5). Whole words, at the start
// of a clause or after "now"/"try"/"then", English and Norwegian. Kept
// dependency-free so the lint and the examples-style ratchet share it.
const WORDS = [
  "slide", "drag", "press", "click", "toggle", "move the slider", "turn the (?:knob|dial)", "set the \\w+ to", "try it",
  "dra", "trykk", "klikk", "skyv", "prøv selv", "prøv å (?:dra|trykke|klikke|skyve)",
];
export const INVITE_RE = new RegExp(`(?:^|[.!?:;—-]\\s*|\\b(?:now|then|try)\\s+)(?:${WORDS.join("|")})\\b`, "i");

export function isInvitation(text: string): boolean {
  return INVITE_RE.test(text);
}
